import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLLMDeleteVerifier } from "../llm-delete-verifier.js";
import { buildLLMFactExtractor } from "../llm-fact-extractor.js";
import type { Episode } from "../types.js";

const episode: Episode = {
	id: "delete-evidence-1",
	content: "I permanently stopped liking folk.",
	summary: "",
	timestamp: Date.now(),
	importance: { importance: 0.5, surprise: 0.5, emotion: 0.5, utility: 0.5 },
	encodingContext: { project: "delete-evidence" },
	consolidated: false,
	recallCount: 0,
	lastAccessed: Date.now(),
	strength: 1,
	role: "user",
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("secondary LLM delete authorization", () => {
	const proposedFact = {
		content: "User preference: folk",
		entities: [],
		topics: [],
		importance: 0.8,
		sourceEpisodeIds: [episode.id],
		operation: "delete" as const,
		structured: {
			subject: "User",
			property: "music preference",
			value: "folk",
			polarity: "affirmed" as const,
			cardinality: "single" as const,
		},
		deleteEvidence: {
			kind: "durable_cessation" as const,
			evidenceQuote: episode.content,
			targetQuote: "folk",
		},
	};
	const candidates = [
		{
			id: "folk-fact",
			structured: {
				subjectId: "person:self",
				propertyId: "profile:music-preference",
				value: "folk",
				polarity: "affirmed" as const,
				cardinality: "single" as const,
			},
		},
	];

	it.each([
		[
			{
				authorized: true,
				kind: "durable_cessation",
				targetFactId: "folk-fact",
			},
			{ authorized: true, targetFactId: "folk-fact" },
		],
		[
			{
				authorized: true,
				kind: "explicit_removal_request",
				targetFactId: "folk-fact",
			},
			{ authorized: false },
		],
		[
			{ authorized: true, kind: "durable_cessation", targetFactId: "unknown" },
			{ authorized: false },
		],
		[{ authorized: false }, { authorized: false }],
		[{ authorized: "true" }, { authorized: false }],
	])("accepts only an exact boolean authorization", async (body, expected) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							choices: [{ message: { content: JSON.stringify(body) } }],
						}),
						{ status: 200 },
					),
			),
		);
		const verifier = buildLLMDeleteVerifier({
			apiKey: "test",
			baseURL: "https://example.test/v1/",
		});
		expect(await verifier(episode, proposedFact, candidates)).toEqual(expected);
	});

	it("fails closed on transport or parse failure", async () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("bad", { status: 503 })),
		);
		const verifier = buildLLMDeleteVerifier({
			apiKey: "test",
			baseURL: "https://example.test/v1/",
		});
		expect(await verifier(episode, proposedFact, candidates)).toEqual({
			authorized: false,
		});
		expect(warning).toHaveBeenCalledWith(expect.stringContaining("HTTP 503"));
	});

	it("fails closed on malformed successful output", async () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("not-json", { status: 200 })),
		);
		const verifier = buildLLMDeleteVerifier({
			apiKey: "test",
			baseURL: "https://example.test/v1/",
		});
		expect(await verifier(episode, proposedFact, candidates)).toEqual({
			authorized: false,
		});
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("malformed output"),
		);
	});

	it("uses the stronger verifier model and enough room for an ID response by default", async () => {
		let requestBody: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input, init) => {
				requestBody = JSON.parse(String(init?.body));
				return new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: JSON.stringify({
										authorized: false,
									}),
								},
							},
						],
					}),
					{ status: 200 },
				);
			}),
		);
		const verifier = buildLLMDeleteVerifier({
			apiKey: "test",
			baseURL: "https://example.test/v1/",
		});

		await verifier(episode, proposedFact, candidates);

		expect(requestBody).toMatchObject({
			model: "gemini-2.5-flash",
			max_tokens: 96,
		});
		const prompt = String(
			(requestBody?.messages as Array<{ content: string }>)[0]?.content,
		);
		expect(prompt).toContain(
			'"candidates":[{"id":"folk-fact","structured":{"subjectId":"person:self","propertyId":"profile:music-preference","value":"folk","polarity":"affirmed","cardinality":"single"}}]',
		);
	});
});

describe("LLM fact delete evidence", () => {
	const validDelete = {
		content: "User preference: folk",
		operation: "delete",
		deleteEvidenceKind: "durable_cessation",
		deleteEvidenceQuote: "I permanently stopped liking folk.",
		deleteTargetQuote: "folk",
		structured: {
			subject: "User",
			property: "music preference",
			value: "folk",
			polarity: "affirmed",
			cardinality: "single",
		},
	};

	async function extractCandidate(
		candidate: Record<string, unknown>,
		overrides: Partial<Episode> = {},
	) {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					choices: [
						{ message: { content: JSON.stringify({ "1": [candidate] }) } },
					],
				}),
			),
		);
		return buildLLMFactExtractor({
			apiKey: "test-secret",
			baseURL: "https://provider.test/v1/",
			model: "test-model",
		})([{ ...episode, ...overrides }]);
	}

	it.each([
		["missing evidence kind", { deleteEvidenceKind: undefined }],
		["unknown evidence kind", { deleteEvidenceKind: "quoted_speech" }],
		["missing evidence quote", { deleteEvidenceQuote: undefined }],
		["invisible evidence quote", { deleteEvidenceQuote: "\u200d" }],
		["compatibility filler evidence quote", { deleteEvidenceQuote: "\u3164" }],
		["partial evidence quote", { deleteEvidenceQuote: "stopped" }],
		["ungrounded evidence quote", { deleteEvidenceQuote: "never said" }],
		["missing target quote", { deleteTargetQuote: undefined }],
		["invisible target quote", { deleteTargetQuote: "\u200d" }],
		["compatibility filler target quote", { deleteTargetQuote: "\u3164" }],
		["ungrounded target quote", { deleteTargetQuote: "jazz" }],
		["missing structured target", { structured: undefined }],
		[
			"empty structured subject",
			{ structured: { ...validDelete.structured, subject: "" } },
		],
		[
			"empty structured property",
			{ structured: { ...validDelete.structured, property: "" } },
		],
		[
			"empty structured value",
			{ structured: { ...validDelete.structured, value: "" } },
		],
		[
			"negated structured target",
			{ structured: { ...validDelete.structured, polarity: "negated" } },
		],
	])("rejects %s", async (_name, mutation) => {
		await expect(
			extractCandidate({ ...validDelete, ...mutation }),
		).resolves.toEqual([]);
	});

	it("treats an unknown operation as a non-destructive upsert", async () => {
		const facts = await extractCandidate({
			...validDelete,
			operation: "Delete",
		});
		expect(facts).toHaveLength(1);
		expect(facts[0]?.operation).toBe("upsert");
	});

	it.each(["assistant", "tool"] as const)(
		"rejects deletion authority from a %s episode",
		async (role) => {
			await expect(extractCandidate(validDelete, { role })).resolves.toEqual(
				[],
			);
		},
	);

	it("rejects deletion authority from an episode without a role", async () => {
		await expect(
			extractCandidate(validDelete, { role: undefined }),
		).resolves.toEqual([]);
	});

	it("accepts deletion authority from a user episode", async () => {
		await expect(
			extractCandidate(validDelete, { role: "user" }),
		).resolves.toHaveLength(1);
	});

	it("grounds canonically equivalent NFC evidence and target quotes", async () => {
		const decomposedContent = "더 이상 우표 수집을 하지 않아요.".normalize(
			"NFD",
		);
		const candidate = {
			...validDelete,
			deleteEvidenceQuote: "더 이상 우표 수집을 하지 않아요.",
			deleteTargetQuote: "우표 수집",
			structured: { ...validDelete.structured, value: "우표 수집" },
		};
		await expect(
			extractCandidate(candidate, { content: decomposedContent }),
		).resolves.toHaveLength(1);
	});

	it("rejects deletes whose grounded target does not match the structured value", async () => {
		const structured = (value: string, polarity = "affirmed") => ({
			subject: "User",
			property: "music preference",
			value,
			polarity,
			cardinality: "single",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							choices: [
								{
									message: {
										content: JSON.stringify({
											"1": [
												{
													content: "User preference: jazz",
													operation: "delete",
													structured: structured("jazz"),
												},
												{
													content: "User preference: classical",
													operation: "delete",
													deleteEvidenceKind: "quoted_speech",
													deleteEvidenceQuote: "User",
													deleteTargetQuote: "not in episode",
													structured: structured("classical"),
												},
												{
													content: "User preference: rock",
													operation: "delete",
													deleteEvidenceKind: "durable_cessation",
													deleteEvidenceQuote: "not in episode",
													deleteTargetQuote: "folk",
													structured: structured("rock", "negated"),
												},
												{
													content: "User preference: blues",
													operation: "delete",
													deleteEvidenceKind: "durable_cessation",
													deleteEvidenceQuote: " ",
													deleteTargetQuote: "folk",
													structured: structured("blues"),
												},
												{
													content: "User preference: classical",
													operation: "delete",
													deleteEvidenceKind: "durable_cessation",
													deleteEvidenceQuote:
														"I permanently stopped liking folk.",
													deleteTargetQuote: "folk",
													structured: structured("classical"),
												},
												{
													content: "User preference: empty",
													operation: "delete",
													deleteEvidenceKind: "durable_cessation",
													deleteEvidenceQuote:
														"I permanently stopped liking folk.",
													deleteTargetQuote: "folk",
													structured: structured(""),
												},
												{
													content: "User preference: folk",
													operation: "delete",
													deleteEvidenceKind: "durable_cessation",
													deleteEvidenceQuote:
														"I permanently stopped liking folk.",
													deleteTargetQuote: "folk",
													structured: structured("FOLK"),
												},
											],
										}),
									},
								},
							],
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
			),
		);

		const facts = await buildLLMFactExtractor({
			apiKey: "test-secret",
			baseURL: "https://provider.test/v1/",
			model: "test-model",
		})([episode]);

		expect(facts.map((fact) => fact.content)).toEqual([
			"User preference: folk",
		]);
		for (const fact of facts) {
			expect(fact.operation).toBe("delete");
			expect(fact.deleteEvidence).toEqual({
				kind: "durable_cessation",
				evidenceQuote: "I permanently stopped liking folk.",
				targetQuote: "folk",
			});
		}
	});
});
