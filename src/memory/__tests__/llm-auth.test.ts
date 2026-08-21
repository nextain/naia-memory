import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLLMFactExtractor } from "../llm-fact-extractor.js";
import { buildLLMQueryStructurer } from "../llm-query-structurer.js";
import { buildLLMSummarizer } from "../llm-summarizer.js";
import type { Episode } from "../types.js";

const episode: Episode = {
	id: "episode-1",
	content: "사용자 선호 에디터는 VS Code다.",
	summary: "",
	timestamp: Date.now(),
	importance: { importance: 0.5, surprise: 0.5, emotion: 0.5, utility: 0.5 },
	encodingContext: { project: "auth-contract" },
	consolidated: false,
	recallCount: 0,
	lastAccessed: Date.now(),
	strength: 1,
	role: "user",
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("OpenAI-compatible LLM auth", () => {
	it("query structurer extracts a bounded identity and preserves gateway auth", async () => {
		let capturedHeaders: HeadersInit | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedHeaders = init?.headers;
				return new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content:
										'```json\n{"subject":"사용자","property":"선호 에디터"}\n```',
								},
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}),
		);

		const result = await buildLLMQueryStructurer({
			apiKey: "test-secret",
			auth: "x-anyllm",
			baseURL: "https://gateway.test/v1",
			model: "test-model",
		})("내가 선호하는 에디터가 뭐였지?");

		expect(result).toEqual({ subject: "사용자", property: "선호 에디터" });
		const headers = capturedHeaders as Record<string, string>;
		expect(headers["X-AnyLLM-Key"]).toBe("Bearer test-secret");
		expect(headers.Authorization).toBeUndefined();
	});

	it("query structurer fails closed on empty, malformed, and nonspecific output", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [{ message: { content: "{}" } }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		vi.stubGlobal("fetch", fetchMock);
		const structure = buildLLMQueryStructurer({
			apiKey: "",
			baseURL: "https://provider.test/v1/",
			model: "test",
		});

		await expect(structure("   ")).resolves.toBeUndefined();
		await expect(structure("안녕?")).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("fact extractor preserves only valid explicit structured facts", async () => {
		const deletionEpisode = {
			...episode,
			content: "땅콩 알레르기 기억을 삭제해 줘.",
		};
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
													content: "사용자 거주지: 서울",
													structured: {
														subject: "사용자",
														subjectId: "person:self",
														property: "거주지",
														propertyId: "profile:residence",
														value: "서울",
														polarity: "affirmed",
														cardinality: "single",
													},
												},
												{
													content: "불완전한 구조도 원문은 남긴다",
													structured: { subject: "사용자" },
												},
												{
													content: "사용자 알레르기: 땅콩",
													operation: "delete",
													deleteEvidenceKind: "explicit_removal_request",
													deleteEvidenceQuote:
														"땅콩 알레르기 기억을 삭제해 줘.",
													deleteTargetQuote: "땅콩 알레르기",
													structured: {
														subject: "사용자",
														subjectId: "person:self",
														property: "알레르기",
														propertyId: "invented:allergy",
														value: "땅콩",
														polarity: "affirmed",
														cardinality: "multi",
													},
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
		})([deletionEpisode]);

		expect(facts).toHaveLength(3);
		expect(facts[0].structured).toEqual({
			subject: "사용자",
			subjectId: "person:self",
			property: "거주지",
			propertyId: "profile:residence",
			value: "서울",
			polarity: "affirmed",
			cardinality: "single",
			provenance: "extractor",
		});
		expect(facts[1].structured).toBeUndefined();
		expect(facts[1].operation).toBe("upsert");
		expect(facts[2].operation).toBe("delete");
		expect(facts[2].structured?.value).toBe("땅콩");
		expect(facts[2].structured?.subjectId).toBeUndefined();
		expect(facts[2].structured?.propertyId).toBeUndefined();
	});

	it("fact extractor accepts general multilingual memory identity IDs", async () => {
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
													content: "사용자 선호 색상: 초록색",
													structured: {
														subject: "사용자",
														subjectId: "person:self",
														property: "선호 색상",
														propertyId: "preference:color",
														value: "초록색",
														polarity: "affirmed",
														cardinality: "single",
													},
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

		const [fact] = await buildLLMFactExtractor({
			apiKey: "test-secret",
			baseURL: "https://provider.test/v1/",
			model: "test-model",
		})([episode]);

		expect(fact.structured?.propertyId).toBe("preference:color");
	});

	it("fact extractor prompt distinguishes durable cessation from temporary negation", async () => {
		let prompt = "";
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as {
					messages: Array<{ content: string }>;
				};
				prompt = body.messages[0]?.content ?? "";
				return new Response(
					JSON.stringify({ choices: [{ message: { content: '{"1":[]}' } }] }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}),
		);

		await buildLLMFactExtractor({
			apiKey: "test-secret",
			baseURL: "https://provider.test/v1/",
			model: "test-model",
		})([episode]);

		expect(prompt).toContain(
			"previously durable state no longer holds in the present",
		);
		expect(prompt).toContain(
			'words such as "permanently" or "forever" are not required',
		);
		expect(prompt).toMatch(/temporary\s+exceptions/);
		expect(prompt).toContain("quoted speech");
		expect(prompt).toContain("another person's state");
		expect(prompt).toContain('"durable_cessation"');
		expect(prompt).toContain('"deleteEvidenceQuote"');
		expect(prompt).toContain('"preference:music-genre"');
	});

	it("fact extractor benchmark policy throws on provider and parse failures", async () => {
		const extract = buildLLMFactExtractor({
			apiKey: "test-secret",
			baseURL: "https://provider.test/v1/",
			model: "test-model",
			failurePolicy: "throw",
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("denied", { status: 401 })),
		);
		await expect(extract([episode])).rejects.toThrow(
			"LLM fact extraction failed with HTTP 401",
		);

		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							choices: [{ message: { content: "not-json" } }],
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
			),
		);
		await expect(extract([episode])).rejects.toThrow(
			"LLM fact extraction returned an invalid response",
		);
	});

	it("fact extractor benchmark policy fails closed after transport retries", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("secret-bearing transport detail");
			}),
		);
		const extract = buildLLMFactExtractor({
			apiKey: "test-secret",
			baseURL: "https://provider.test/v1/",
			model: "test-model",
			failurePolicy: "throw",
		});

		const pending = extract([episode]);
		const observed = pending.then(
			() => undefined,
			(error: unknown) => error,
		);
		await vi.runAllTimersAsync();
		const error = await observed;
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe(
			"LLM fact extraction transport failed after 3 attempts",
		);
		expect((error as Error).message).not.toContain(
			"secret-bearing transport detail",
		);
	});

	it("fact extractor가 Naia gateway에는 X-AnyLLM-Key만 전송한다", async () => {
		let capturedHeaders: HeadersInit | undefined;
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedHeaders = init?.headers;
				return new Response(
					JSON.stringify({
						choices: [{ message: { content: '{"1":[]}' } }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		const extract = buildLLMFactExtractor({
			apiKey: "test-secret",
			auth: "x-anyllm",
			baseURL: "https://gateway.test/v1/",
			model: "test-model",
		});
		await extract([episode]);

		const headers = capturedHeaders as Record<string, string>;
		expect(headers["X-AnyLLM-Key"]).toBe("Bearer test-secret");
		expect(headers.Authorization).toBeUndefined();
	});

	it("summarizer의 기본 인증은 기존 bearer 계약을 유지한다", async () => {
		let capturedHeaders: HeadersInit | undefined;
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedHeaders = init?.headers;
				return new Response(
					JSON.stringify({
						choices: [{ message: { content: "요약" } }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		const summarize = buildLLMSummarizer({
			apiKey: "test-secret",
			baseURL: "https://provider.test/v1/",
			model: "test-model",
		});
		await summarize({
			messages: [{ role: "user", content: "기억할 내용" }],
			seedSummary: "",
			keepTail: 0,
			targetTokens: 100,
		});

		const headers = capturedHeaders as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer test-secret");
		expect(headers["X-AnyLLM-Key"]).toBeUndefined();
	});

	it("fact extractor의 기본 인증은 기존 bearer 계약을 유지한다", async () => {
		let capturedHeaders: HeadersInit | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedHeaders = init?.headers;
				return new Response(
					JSON.stringify({ choices: [{ message: { content: '{"1":[]}' } }] }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}),
		);

		await buildLLMFactExtractor({
			apiKey: "test-secret",
			baseURL: "https://provider.test/v1/",
			model: "test-model",
		})([episode]);

		const headers = capturedHeaders as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer test-secret");
		expect(headers["X-AnyLLM-Key"]).toBeUndefined();
	});

	it("summarizer가 Naia gateway에는 X-AnyLLM-Key만 전송한다", async () => {
		let capturedHeaders: HeadersInit | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedHeaders = init?.headers;
				return new Response(
					JSON.stringify({ choices: [{ message: { content: "요약" } }] }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}),
		);

		await buildLLMSummarizer({
			apiKey: "test-secret",
			auth: "x-anyllm",
			baseURL: "https://gateway.test/v1/",
			model: "test-model",
		})({
			messages: [{ role: "user", content: "기억할 내용" }],
			seedSummary: "",
			keepTail: 0,
			targetTokens: 100,
		});

		const headers = capturedHeaders as Record<string, string>;
		expect(headers["X-AnyLLM-Key"]).toBe("Bearer test-secret");
		expect(headers.Authorization).toBeUndefined();
	});
});
