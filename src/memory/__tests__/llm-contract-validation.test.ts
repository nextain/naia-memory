import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildLLMFactExtractor,
	LLMFactExtractionError,
	parseLLMFactResponse,
} from "../llm-fact-extractor.js";
import { buildLLMSummarizer } from "../llm-summarizer.js";
import type { Episode } from "../types.js";

const episode: Episode = {
	id: "contract-episode-1",
	content: "User prefers Vim.",
	summary: "",
	timestamp: 1_700_000_000_000,
	importance: { importance: 0.5, surprise: 0.5, emotion: 0.5, utility: 0.5 },
	encodingContext: { project: "contract-test" },
	consolidated: false,
	recallCount: 0,
	lastAccessed: 1_700_000_000_000,
	strength: 1,
	role: "user",
};

const secondEpisode: Episode = {
	...episode,
	id: "contract-episode-2",
	content: "User prefers Helix.",
};

function responseEnvelope(
	content: unknown,
	finishReason?: string,
): Record<string, unknown> {
	return {
		choices: [
			{
				finish_reason: finishReason ?? "stop",
				message: { content },
			},
		],
	};
}

function responseEnvelopeWithoutFinish(content: unknown): Record<string, unknown> {
	return { choices: [{ message: { content } }] };
}

function responseEnvelopeWithFinish(
	content: unknown,
	finishReason: unknown,
): Record<string, unknown> {
	return {
		choices: [{ finish_reason: finishReason, message: { content } }],
	};
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

/** Small deterministic validator for the exact JSON-schema request we send. */
function validatesJsonSchema(value: unknown, schema: unknown): boolean {
	if (!isSchemaRecord(schema)) return false;
	if (Array.isArray(schema.anyOf)) {
		return schema.anyOf.some((branch) => validatesJsonSchema(value, branch));
	}
	if (
		Array.isArray(schema.enum) &&
		!schema.enum.some((member) => Object.is(member, value))
	) {
		return false;
	}

	switch (schema.type) {
		case "string":
			return typeof value === "string";
		case "array":
			return (
				Array.isArray(value) &&
				(!schema.items ||
					value.every((item) => validatesJsonSchema(item, schema.items)))
			);
		case "object": {
			if (!isSchemaRecord(value)) return false;
			const properties = isSchemaRecord(schema.properties)
				? schema.properties
				: {};
			if (
				schema.required !== undefined &&
				(!Array.isArray(schema.required) ||
					!schema.required.every(
						(key) => typeof key === "string" && hasOwn(value, key),
					))
			) {
				return false;
			}
			if (
				schema.additionalProperties === false &&
				Object.keys(value).some((key) => !hasOwn(properties, key))
			) {
				return false;
			}
			return Object.entries(value).every(
				([key, child]) =>
					!hasOwn(properties, key) ||
					validatesJsonSchema(child, properties[key]),
			);
		}
		default:
			return false;
	}
}

function expectFailure(
	data: unknown,
	code: LLMFactExtractionError["code"],
	episodes: readonly Episode[] = [episode],
): void {
	try {
		parseLLMFactResponse(data, episodes);
		throw new Error("expected parseLLMFactResponse to reject");
	} catch (error: unknown) {
		expect(error).toBeInstanceOf(LLMFactExtractionError);
		expect(error).toMatchObject({ code });
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("LLM memory contract validation", () => {
	it("keeps the string-fact response format and episode provenance", () => {
		const facts = parseLLMFactResponse(
			responseEnvelope('{"1":["User prefers Vim."]}'),
			[episode],
		);

		expect(facts).toHaveLength(1);
		expect(facts[0]).toMatchObject({
			content: "User prefers Vim.",
			sourceEpisodeIds: [episode.id],
		});
		expect(facts[0].operation).toBeUndefined();
	});

	it("rejects truncated, missing, non-string, trailing, and malformed JSON", () => {
		expectFailure(responseEnvelope('{"1":[]}', "length"), "truncated");
		expectFailure({ choices: [{ message: {} }] }, "missing-content");
		expectFailure(responseEnvelope(["not-a-string"]), "nonstring-content");
		expectFailure(
			responseEnvelope('{"1":[]} {"1":[]}'),
			"invalid-json",
		);
		expectFailure(responseEnvelope("[]"), "invalid-top-level-shape");
		expectFailure(responseEnvelope('{"1":{}}'), "invalid-episode-shape");
		expectFailure(responseEnvelope('{"1":[""]}'), "invalid-episode-shape");
	});

	it("keeps missing finish compatibility and fails closed for rejected finishes", async () => {
		expect(
			parseLLMFactResponse(
				responseEnvelopeWithoutFinish('{"1":["compatibility fact"]}'),
				[episode],
			),
		).toHaveLength(1);
		expectFailure(
			responseEnvelopeWithFinish('{"1":[]}', 42),
			"semantic-rejection",
		);
		expectFailure(
			responseEnvelopeWithFinish('{"1":[]}', "content_filter"),
			"semantic-rejection",
		);
		expectFailure(
			responseEnvelopeWithFinish('{"1":[]}', "tool_calls"),
			"semantic-rejection",
		);
		expectFailure(
			responseEnvelopeWithFinish('{"1":[]}', "max_output_tokens"),
			"truncated",
		);

		const rejectedResponses = [
			{ finishReason: 42, code: "semantic-rejection" as const, failurePolicy: "throw" as const },
			{
				finishReason: "content_filter",
				code: "semantic-rejection" as const,
				failurePolicy: "skip" as const,
			},
			{ finishReason: "length", code: "truncated" as const, failurePolicy: "throw" as const },
			{
				finishReason: "max_tokens",
				code: "truncated" as const,
				failurePolicy: "skip" as const,
			},
		];

		for (const testCase of rejectedResponses) {
			const fetchMock = vi.fn(async () =>
				new Response(
					JSON.stringify(
						responseEnvelopeWithFinish(
							'{"1":["must not become a fact"]}',
							testCase.finishReason,
						),
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
			vi.stubGlobal("fetch", fetchMock);
			const failures: string[] = [];
			const extract = buildLLMFactExtractor({
				apiKey: "test-key",
				baseURL: "https://provider.test/v1/",
				failurePolicy: testCase.failurePolicy,
				onFailure: (failure) => failures.push(failure.code),
			});

			if (testCase.failurePolicy === "throw") {
				await expect(extract([episode])).rejects.toMatchObject({
					code: testCase.code,
				});
			} else {
				await expect(extract([episode])).resolves.toEqual([]);
			}
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(failures).toEqual([testCase.code]);
			vi.unstubAllGlobals();
		}
	});

	it("requires exact single and multiple episode key mappings and binds source IDs", () => {
		expect(
			parseLLMFactResponse(responseEnvelope('{"1":[]}'), [episode]),
		).toEqual([]);
		expectFailure(responseEnvelope("{}"), "invalid-episode-shape");
		expectFailure(responseEnvelope('{"1":[],"2":[]}'), "invalid-top-level-shape");

		const twoEpisodes = [episode, secondEpisode];
		expect(
			parseLLMFactResponse(responseEnvelope('{"1":[],"2":[]}'), twoEpisodes),
		).toEqual([]);
		expectFailure(
			responseEnvelope('{"1":[]}'),
			"invalid-episode-shape",
			twoEpisodes,
		);
		expectFailure(
			responseEnvelope('{"2":[]}'),
			"invalid-episode-shape",
			twoEpisodes,
		);
		expectFailure(
			responseEnvelope('{"1":[],"2":[],"3":[]}'),
			"invalid-top-level-shape",
			twoEpisodes,
		);

		const facts = parseLLMFactResponse(
			responseEnvelope('{"1":["first source fact"],"2":["second source fact"]}'),
			twoEpisodes,
		);
		expect(facts).toHaveLength(2);
		expect(facts.map((fact) => fact.sourceEpisodeIds)).toEqual([
			[episode.id],
			[secondEpisode.id],
		]);
	});

	it("rejects recursive and wrongly typed structures while preserving safe fallbacks and deletes", () => {
		const partial = parseLLMFactResponse(
			responseEnvelope(
				JSON.stringify({
					"1": [
						{
							content: "partial structured fact",
							structured: { subject: "User" },
						},
					],
				}),
			),
			[episode],
		);
		expect(partial[0]).toMatchObject({
			content: "partial structured fact",
			operation: "upsert",
			sourceEpisodeIds: [episode.id],
		});
		expect(partial[0].structured).toBeUndefined();

		const invalidStructuredValues = [
			{ subject: 42 },
			{ propertyId: ["profile:editor"] },
			{ polarity: "unknown" },
			{ cardinality: 1 },
			{ structured: {} },
		];
		for (const structured of invalidStructuredValues) {
			expectFailure(
				responseEnvelope(
					JSON.stringify({ "1": [{ content: "invalid structure", structured }] }),
				),
				"semantic-rejection",
			);
		}

		for (const operation of ["replace", 1, null]) {
			expectFailure(
				responseEnvelope(
					JSON.stringify({ "1": [{ content: "invalid operation", operation }] }),
				),
				"semantic-rejection",
			);
		}

		const invalidIds = parseLLMFactResponse(
			responseEnvelope(
				JSON.stringify({
					"1": [
						{
							content: "User allergy: peanuts",
							structured: {
								subject: "User",
								subjectId: "invented:person",
								property: "allergy",
								propertyId: "invented:allergy",
								value: "peanuts",
								polarity: "affirmed",
								cardinality: "multi",
							},
						},
					],
				}),
			),
			[episode],
		);
		expect(invalidIds[0].structured).toMatchObject({
			subject: "User",
			property: "allergy",
			value: "peanuts",
			polarity: "affirmed",
			cardinality: "multi",
			provenance: "extractor",
		});
		expect(invalidIds[0].structured?.subjectId).toBeUndefined();
		expect(invalidIds[0].structured?.propertyId).toBeUndefined();

		const deletionEpisode: Episode = {
			...episode,
			content: "Please delete my peanut allergy memory.",
		};
		const groundedDelete = parseLLMFactResponse(
			responseEnvelope(
				JSON.stringify({
					"1": [
						{
							content: "User allergy: peanuts",
							operation: "delete",
							deleteEvidenceKind: "explicit_removal_request",
							deleteEvidenceQuote: deletionEpisode.content,
							deleteTargetQuote: "peanut allergy",
							structured: {
								subject: "User",
								subjectId: "person:self",
								property: "allergy",
								propertyId: "profile:allergy",
								value: "peanuts",
								polarity: "affirmed",
								cardinality: "multi",
							},
						},
					],
				}),
			),
			[deletionEpisode],
		);
		expect(groundedDelete).toHaveLength(1);
		expect(groundedDelete[0]).toMatchObject({
			operation: "delete",
			deleteEvidence: {
				kind: "explicit_removal_request",
				evidenceQuote: deletionEpisode.content,
				targetQuote: "peanut allergy",
			},
		});

		const ungroundedDelete = parseLLMFactResponse(
			responseEnvelope(
				JSON.stringify({
					"1": [
						{
							content: "User allergy: peanuts",
							operation: "delete",
							deleteEvidenceKind: "explicit_removal_request",
							deleteEvidenceQuote: deletionEpisode.content,
							deleteTargetQuote: "not present",
							structured: {
								subject: "User",
								subjectId: "person:self",
								property: "allergy",
								propertyId: "profile:allergy",
								value: "peanuts",
								polarity: "affirmed",
								cardinality: "multi",
							},
						},
					],
				}),
			),
			[deletionEpisode],
		);
		expect(ungroundedDelete).toEqual([]);
	});

	it("serializes and validates the complete strict fact schema", async () => {
		let requestBody: Record<string, unknown> | undefined;
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(
					JSON.stringify(responseEnvelope('{"1":[],"2":[]}')),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		await buildLLMFactExtractor({
			apiKey: "test-key",
			baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
			structuredOutput: { provider: "gemini", schemaName: "complete_facts" },
		})([episode, secondEpisode]);

		const responseFormat = requestBody?.response_format as Record<string, unknown>;
		expect(Object.keys(responseFormat).sort()).toEqual(["json_schema", "type"]);
		expect(responseFormat.type).toBe("json_schema");
		const jsonSchema = responseFormat.json_schema as Record<string, unknown>;
		expect(Object.keys(jsonSchema).sort()).toEqual(["name", "schema", "strict"]);
		expect(jsonSchema.name).toBe("complete_facts");
		expect(jsonSchema.strict).toBe(true);

		const schema = jsonSchema.schema as Record<string, unknown>;
		expect(Object.keys(schema).sort()).toEqual([
			"additionalProperties",
			"properties",
			"required",
			"type",
		]);
		expect(schema.type).toBe("object");
		expect(schema.additionalProperties).toBe(false);
		expect(Object.keys(schema.properties as object).sort()).toEqual(["1", "2"]);
		expect(schema.required).toEqual(["1", "2"]);

		const episodeSchemas = schema.properties as Record<string, Record<string, unknown>>;
		for (const key of ["1", "2"]) {
			const episodeSchema = episodeSchemas[key];
			expect(Object.keys(episodeSchema).sort()).toEqual(["items", "type"]);
			expect(episodeSchema.type).toBe("array");
			const itemSchema = episodeSchema.items as Record<string, unknown>;
			expect(Object.keys(itemSchema)).toEqual(["anyOf"]);
			expect(itemSchema.anyOf).toHaveLength(2);
			expect(itemSchema.anyOf).toContainEqual({ type: "string" });

			const factObject = (itemSchema.anyOf as Array<Record<string, unknown>>).find(
				(branch) => branch.type === "object",
			) as Record<string, unknown>;
			expect(Object.keys(factObject).sort()).toEqual([
				"additionalProperties",
				"properties",
				"required",
				"type",
			]);
			expect(factObject.type).toBe("object");
			expect(factObject.additionalProperties).toBe(false);
			expect(factObject.required).toEqual(["content"]);
			const factProperties = factObject.properties as Record<string, unknown>;
			expect(Object.keys(factProperties).sort()).toEqual([
				"content",
				"deleteEvidenceKind",
				"deleteEvidenceQuote",
				"deleteTargetQuote",
				"operation",
				"structured",
			]);
			expect(factProperties.content).toEqual({ type: "string" });
			expect(factProperties.operation).toEqual({
				type: "string",
				enum: ["upsert", "delete"],
			});
			expect(factProperties.deleteEvidenceKind).toEqual({
				type: "string",
				enum: ["explicit_removal_request", "durable_cessation"],
			});
			expect(factProperties.deleteEvidenceQuote).toEqual({ type: "string" });
			expect(factProperties.deleteTargetQuote).toEqual({ type: "string" });

			const structured = factProperties.structured as Record<string, unknown>;
			expect(Object.keys(structured).sort()).toEqual([
				"additionalProperties",
				"properties",
				"type",
			]);
			expect(structured.type).toBe("object");
			expect(structured.additionalProperties).toBe(false);
			expect(Object.keys(structured.properties as object).sort()).toEqual([
				"cardinality",
				"polarity",
				"property",
				"propertyId",
				"subject",
				"subjectId",
				"value",
			]);
			expect((structured.properties as Record<string, unknown>).polarity).toEqual({
				type: "string",
				enum: ["affirmed", "negated"],
			});
			expect((structured.properties as Record<string, unknown>).cardinality).toEqual({
				type: "string",
				enum: ["single", "multi"],
			});
		}

		const validPayload = {
			"1": [
				"legacy string fact",
				{
					content: "User editor: Vim",
					operation: "upsert",
					structured: {
						subject: "User",
						subjectId: "person:self",
						property: "editor",
						propertyId: "preference:editor",
						value: "Vim",
						polarity: "affirmed",
						cardinality: "single",
					},
				},
			],
			"2": [
				{
					content: "User stopped using Vim",
					operation: "delete",
					deleteEvidenceKind: "durable_cessation",
					deleteEvidenceQuote: "User stopped using Vim",
					deleteTargetQuote: "Vim",
					structured: {
						subject: "User",
						subjectId: "person:self",
						property: "editor",
						propertyId: "preference:editor",
						value: "Vim",
						polarity: "affirmed",
						cardinality: "single",
					},
				},
			],
		};
		expect(validatesJsonSchema(validPayload, schema)).toBe(true);
		for (const invalidPayload of [
			{ "1": [], "2": undefined },
			{ "1": [], "2": [], "3": [] },
			{ "1": [{ content: 42 }], "2": [] },
			{ "1": [{ content: "x", unknown: true }], "2": [] },
			{ "1": [{ content: "x", operation: "replace" }], "2": [] },
			{ "1": [{ content: "x", structured: { structured: {} } }], "2": [] },
			{
				"1": [
					{
						content: "x",
						structured: { subjectId: 42 },
					},
				],
				"2": [],
			},
		]) {
			expect(validatesJsonSchema(invalidPayload, schema)).toBe(false);
		}
	});

	it("sends all 16 head messages and keeps eight external tail messages out of summarization", async () => {
		let requestBody: Record<string, unknown> | undefined;
		const headMessages = Array.from({ length: 16 }, (_, index) => ({
			role: index % 2 === 0 ? "user" : "assistant",
			content:
				index === 15
					? "head-16 FINAL NEGATION: I no longer use Vim. CURRENT STATE: I use Helix now."
					: `head-${String(index + 1).padStart(2, "0")} durable detail`,
		}));
		const tailMessages = Array.from(
			{ length: 8 },
			(_, index) => `tail-only-${String(index + 1).padStart(2, "0")}`,
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(
					JSON.stringify({ choices: [{ message: { content: "polished" } }] }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}),
		);

		const result = await buildLLMSummarizer({
			apiKey: "test-key",
			baseURL: "https://provider.test/v1/",
			model: "contract-summarizer-model",
		})({
			messages: headMessages,
			keepTail: tailMessages.length,
			targetTokens: 321,
			seedSummary: "deterministic seed",
		});

		expect(result).toBe("polished");
		const prompt = String(
			((requestBody?.messages as Array<Record<string, unknown>>)[0] ?? {}).content,
		);
		for (const message of headMessages) expect(prompt).toContain(message.content);
		for (const tail of tailMessages) expect(prompt).not.toContain(tail);
		expect(prompt).toContain("321");
		expect(prompt).toContain("deterministic seed");
		expect(prompt).toContain("FINAL NEGATION");
		expect(prompt).toContain("CURRENT STATE");
		expect(requestBody?.model).toBe("contract-summarizer-model");
		expect(requestBody?.max_tokens).toBe(1024);
		expect(requestBody?.messages).toHaveLength(1);

		const fallbackCases = [
			{
				response: new Response("unavailable", { status: 503 }),
			},
			{
				response: new Response(
					JSON.stringify({ choices: [{ message: { content: { wrong: true } } }] }),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			},
			{
				response: new Response(
					JSON.stringify({ choices: [{ message: { content: "" } }] }),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			},
		];
		for (const testCase of fallbackCases) {
			const fetchMock = vi.fn(async () => testCase.response);
			vi.stubGlobal("fetch", fetchMock);
			await expect(
				buildLLMSummarizer({
					apiKey: "test-key",
					baseURL: "https://provider.test/v1/",
				})({
					messages: [{ role: "user", content: "fallback input" }],
					keepTail: 8,
					targetTokens: 321,
					seedSummary: "fallback seed",
				}),
			).resolves.toBe("fallback seed");
			expect(fetchMock).toHaveBeenCalledTimes(1);
			vi.unstubAllGlobals();
		}
	});

	it("sends strict structured output only to the official Gemini endpoint", async () => {
		let requestBody: Record<string, unknown> | undefined;
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(
					JSON.stringify(responseEnvelope('{"1":[]}')),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		await buildLLMFactExtractor({
			apiKey: "test-key",
			baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
			structuredOutput: { provider: "gemini", schemaName: "contract_facts" },
		})([episode]);

		const responseFormat = requestBody?.response_format as Record<
			string,
			unknown
		>;
		expect(responseFormat.type).toBe("json_schema");
		expect(responseFormat.json_schema).toMatchObject({
			name: "contract_facts",
			strict: true,
		});
		expect(
			(responseFormat.json_schema as Record<string, unknown>).schema,
		).toMatchObject({ required: ["1"] });

		const failures: string[] = [];
		const gatewayExtract = buildLLMFactExtractor({
			apiKey: "test-key",
			baseURL: "https://gateway.test/v1/",
			structuredOutput: { provider: "gemini" },
			failurePolicy: "skip",
			onFailure: (failure) => failures.push(failure.code),
		});
		await expect(gatewayExtract([episode])).resolves.toEqual([]);
		expect(failures).toEqual(["configuration"]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("sends non-strict schema to OpenAI-compatible hosts with the chosen token field", async () => {
		let requestBody: Record<string, unknown> | undefined;
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(
					JSON.stringify(responseEnvelope('{"1":[]}')),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		const failures: string[] = [];
		await buildLLMFactExtractor({
			apiKey: "test-key",
			baseURL: "https://foundry.test/openai/v1/",
			structuredOutput: { provider: "openai-compatible" },
			maxTokensParam: "max_completion_tokens",
			failurePolicy: "skip",
			onFailure: (failure) => failures.push(failure.code),
		})([episode]);

		expect(failures).toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const responseFormat = requestBody?.response_format as Record<string, unknown>;
		expect(responseFormat.type).toBe("json_schema");
		expect(responseFormat.json_schema).toMatchObject({
			name: "naia_memory_facts",
			strict: false,
		});
		expect(
			(responseFormat.json_schema as Record<string, unknown>).schema,
		).toMatchObject({ required: ["1"] });
		expect(requestBody).toHaveProperty("max_completion_tokens", 8192);
		expect(requestBody).not.toHaveProperty("max_tokens");
	});

	it("keeps max_tokens as the default token field", async () => {
		let requestBody: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(
					JSON.stringify(responseEnvelope('{"1":[]}')),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}),
		);
		await buildLLMFactExtractor({
			apiKey: "test-key",
			baseURL: "https://provider.test/v1/",
		})([episode]);
		expect(requestBody).toHaveProperty("max_tokens", 8192);
		expect(requestBody).not.toHaveProperty("max_completion_tokens");
	});

	it("sends the summarizer token ceiling under the chosen field", async () => {
		const bodies: Record<string, unknown>[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				return new Response(
					JSON.stringify({ choices: [{ message: { content: "polished" } }] }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}),
		);
		const input = {
			messages: [{ role: "user" as const, content: "durable decision" }],
			keepTail: 8,
			targetTokens: 256,
			seedSummary: "seed",
		};
		await buildLLMSummarizer({
			apiKey: "test-key",
			baseURL: "https://foundry.test/openai/v1/",
			maxTokensParam: "max_completion_tokens",
		})(input);
		await buildLLMSummarizer({
			apiKey: "test-key",
			baseURL: "https://provider.test/v1/",
		})(input);
		expect(bodies[0]).toHaveProperty("max_completion_tokens", 1024);
		expect(bodies[0]).not.toHaveProperty("max_tokens");
		expect(bodies[1]).toHaveProperty("max_tokens", 1024);
		expect(bodies[1]).not.toHaveProperty("max_completion_tokens");
	});

	it("makes the requested target explicit while retaining full transcript input", async () => {
		let requestBody: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(
					JSON.stringify({ choices: [{ message: { content: "polished" } }] }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}),
		);

		const result = await buildLLMSummarizer({
			apiKey: "test-key",
			baseURL: "https://provider.test/v1/",
		})({
			messages: [
				{ role: "user", content: "first durable decision" },
				{ role: "assistant", content: "second unresolved item" },
			],
			keepTail: 8,
			targetTokens: 321,
			seedSummary: "deterministic seed",
		});

		expect(result).toBe("polished");
		const prompt = String(
			(
				(requestBody?.messages as Array<Record<string, unknown>>)[0] ?? {}
			).content,
		);
		expect(prompt).toContain("321");
		expect(prompt).toContain("first durable decision");
		expect(prompt).toContain("second unresolved item");
		expect(requestBody?.max_tokens).toBe(1024);
	});
});
