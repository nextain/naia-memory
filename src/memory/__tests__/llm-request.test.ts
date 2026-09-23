import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GeminiFlashLiteContradictionFilter,
	VllmReasoningContradictionFilter,
	type ContradictionCandidate,
} from "../contradiction-filter.js";
import { buildLLMDeleteVerifier } from "../llm-delete-verifier.js";
import { buildLLMFactExtractor } from "../llm-fact-extractor.js";
import { buildLLMQueryStructurer } from "../llm-query-structurer.js";
import {
	chatCompletionsUrl,
	isGpt5FamilyModel,
	temperatureField,
} from "../llm-request.js";
import { buildLLMSummarizer } from "../llm-summarizer.js";
import type { Episode } from "../types.js";

const episode: Episode = {
	id: "episode-1",
	content: "사용자 선호 에디터는 VS Code다.",
	summary: "",
	timestamp: Date.now(),
	importance: { importance: 0.5, surprise: 0.5, emotion: 0.5, utility: 0.5 },
	encodingContext: { project: "req-test" },
	consolidated: false,
	recallCount: 0,
	lastAccessed: Date.now(),
	strength: 1,
	role: "user",
};

const deleteEpisode: Episode = {
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

const proposedFact = {
	content: "User preference: folk",
	entities: [],
	topics: [],
	importance: 0.8,
	sourceEpisodeIds: [deleteEpisode.id],
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
		evidenceQuote: deleteEpisode.content,
		targetQuote: "folk",
	},
};

const deleteCandidates = [
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

const contradictionCandidate: ContradictionCandidate = {
	existing: {
		id: "fact-1",
		content: "user uses Neovim editor",
		entities: ["Neovim", "user"],
		topics: ["editor"],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		importance: 0.7,
		recallCount: 0,
		lastAccessed: Date.now(),
		strength: 0.7,
		status: "active",
		sourceEpisodes: [],
	},
	newInfo: "user switched to VS Code",
};

let capturedUrl: string | undefined;
let capturedBody: Record<string, unknown> | undefined;

function setupFetchMock(payload: unknown) {
	capturedUrl = undefined;
	capturedBody = undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			capturedUrl = String(input);
			capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
			return new Response(JSON.stringify(payload), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}),
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("isGpt5FamilyModel", () => {
	it("identifies GPT-5 family model ids bare and provider-qualified", () => {
		const trueCases = [
			"gpt-5",
			"gpt-5.4-nano",
			"gpt-5-4-nano",
			"GPT-5.6-luna",
			"azure:gpt-5.4-nano",
			"openai/gpt-5-mini",
		];
		for (const model of trueCases) {
			expect(isGpt5FamilyModel(model)).toBe(true);
		}

		const falseCases = [
			"gpt-4o",
			"gpt-50",
			"gemini-3.1-flash-lite",
			"deepseek-v4-flash",
			"",
			undefined,
			"my-gpt-5x",
		];
		for (const model of falseCases) {
			expect(isGpt5FamilyModel(model)).toBe(false);
		}
	});
});

describe("temperatureField", () => {
	it("resolves temperature according to model default and override", () => {
		expect(temperatureField("gemini-2.5-flash-lite", 0, undefined)).toEqual({
			temperature: 0,
		});
		expect(temperatureField("gpt-5.4-nano", 0, undefined)).toEqual({});
		expect(temperatureField("gpt-5.4-nano", 0, 0.5)).toEqual({
			temperature: 0.5,
		});
		expect(temperatureField("gemini-2.5-flash-lite", 0, null)).toEqual({});
		expect(temperatureField("gemini-2.5-flash-lite", 0, Number.NaN)).toEqual({
			temperature: 0,
		});
		expect(temperatureField("gpt-5.4-nano", 0, Number.NaN)).toEqual({});
	});
});

describe("chatCompletionsUrl", () => {
	it("joins base URL with exactly one slash before chat/completions", () => {
		expect(chatCompletionsUrl("https://g/v1")).toBe(
			"https://g/v1/chat/completions",
		);
		expect(chatCompletionsUrl("https://g/v1/")).toBe(
			"https://g/v1/chat/completions",
		);
		expect(chatCompletionsUrl("https://g/v1///")).toBe(
			"https://g/v1/chat/completions",
		);
	});
});

describe("memory-LLM request builders for GPT-5 and Gemini", () => {
	describe("buildLLMFactExtractor", () => {
		const fakeResponse = { choices: [{ message: { content: '{"1":[]}' } }] };

		it("omits temperature and normalizes url for gpt-5.4-nano", async () => {
			setupFetchMock(fakeResponse);
			const extractor = buildLLMFactExtractor({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gpt-5.4-nano",
				failurePolicy: "throw",
			});
			await extractor([episode]);

			expect(capturedUrl).toBe("https://gateway.test/v1/chat/completions");
			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("sends temperature 0 for gemini by default", async () => {
			setupFetchMock(fakeResponse);
			const extractor = buildLLMFactExtractor({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
				failurePolicy: "throw",
			});
			await extractor([episode]);

			expect(capturedBody?.temperature).toBe(0);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("omits temperature when null override is passed for gemini", async () => {
			setupFetchMock(fakeResponse);
			const extractor = buildLLMFactExtractor({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
				temperature: null,
				failurePolicy: "throw",
			});
			await extractor([episode]);

			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});
	});

	describe("buildLLMSummarizer", () => {
		const fakeResponse = { choices: [{ message: { content: "요약" } }] };

		it("omits temperature and normalizes url for gpt-5.4-nano", async () => {
			setupFetchMock(fakeResponse);
			const summarizer = buildLLMSummarizer({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gpt-5.4-nano",
			});
			await summarizer({
				messages: [{ role: "user", content: "안녕" }],
				seedSummary: "s",
				keepTail: 0,
				targetTokens: 256,
			});

			expect(capturedUrl).toBe("https://gateway.test/v1/chat/completions");
			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("sends temperature 0.2 for gemini by default", async () => {
			setupFetchMock(fakeResponse);
			const summarizer = buildLLMSummarizer({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
			});
			await summarizer({
				messages: [{ role: "user", content: "안녕" }],
				seedSummary: "s",
				keepTail: 0,
				targetTokens: 256,
			});

			expect(capturedBody?.temperature).toBe(0.2);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("omits temperature when null override is passed for gemini", async () => {
			setupFetchMock(fakeResponse);
			const summarizer = buildLLMSummarizer({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
				temperature: null,
			});
			await summarizer({
				messages: [{ role: "user", content: "안녕" }],
				seedSummary: "s",
				keepTail: 0,
				targetTokens: 256,
			});

			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});
	});

	describe("buildLLMDeleteVerifier", () => {
		const fakeResponse = {
			choices: [
				{
					message: {
						content: JSON.stringify({
							authorized: true,
							kind: "durable_cessation",
							targetFactId: "folk-fact",
						}),
					},
				},
			],
		};

		it("omits temperature and normalizes url for gpt-5.4-nano", async () => {
			setupFetchMock(fakeResponse);
			const verifier = buildLLMDeleteVerifier({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gpt-5.4-nano",
			});
			await verifier(deleteEpisode, proposedFact as any, deleteCandidates as any);

			expect(capturedUrl).toBe("https://gateway.test/v1/chat/completions");
			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("sends temperature 0 for gemini by default", async () => {
			setupFetchMock(fakeResponse);
			const verifier = buildLLMDeleteVerifier({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
			});
			await verifier(deleteEpisode, proposedFact as any, deleteCandidates as any);

			expect(capturedBody?.temperature).toBe(0);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("omits temperature when null override is passed for gemini", async () => {
			setupFetchMock(fakeResponse);
			const verifier = buildLLMDeleteVerifier({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
				temperature: null,
			});
			await verifier(deleteEpisode, proposedFact as any, deleteCandidates as any);

			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});
	});

	describe("buildLLMQueryStructurer", () => {
		const fakeResponse = {
			choices: [
				{
					message: {
						content: JSON.stringify({
							subject: "사용자",
							property: "선호 에디터",
						}),
					},
				},
			],
		};

		it("omits temperature and normalizes url for gpt-5.4-nano", async () => {
			setupFetchMock(fakeResponse);
			const structurer = buildLLMQueryStructurer({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gpt-5.4-nano",
			});
			await structurer("내가 선호하는 에디터가 뭐였지?");

			expect(capturedUrl).toBe("https://gateway.test/v1/chat/completions");
			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("sends temperature 0 for gemini by default", async () => {
			setupFetchMock(fakeResponse);
			const structurer = buildLLMQueryStructurer({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
			});
			await structurer("내가 선호하는 에디터가 뭐였지?");

			expect(capturedBody?.temperature).toBe(0);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("omits temperature when null override is passed for gemini", async () => {
			setupFetchMock(fakeResponse);
			const structurer = buildLLMQueryStructurer({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
				temperature: null,
			});
			await structurer("내가 선호하는 에디터가 뭐였지?");

			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});
	});

	describe("GeminiFlashLiteContradictionFilter", () => {
		const fakeResponse = {
			choices: [
				{
					message: {
						content: JSON.stringify({
							"1": {
								contradiction: true,
								confidence: 0.9,
								reason: "switched",
							},
						}),
					},
				},
			],
		};

		it("omits temperature and normalizes url for gpt-5.4-nano", async () => {
			setupFetchMock(fakeResponse);
			const filter = new GeminiFlashLiteContradictionFilter({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gpt-5.4-nano",
			});
			await filter.filter([contradictionCandidate]);

			expect(capturedUrl).toBe("https://gateway.test/v1/chat/completions");
			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("sends temperature 0 for gemini by default", async () => {
			setupFetchMock(fakeResponse);
			const filter = new GeminiFlashLiteContradictionFilter({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
			});
			await filter.filter([contradictionCandidate]);

			expect(capturedBody?.temperature).toBe(0);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("omits temperature when null override is passed for gemini", async () => {
			setupFetchMock(fakeResponse);
			const filter = new GeminiFlashLiteContradictionFilter({
				apiKey: "k",
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
				temperature: null,
			});
			await filter.filter([contradictionCandidate]);

			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});
	});

	describe("VllmReasoningContradictionFilter", () => {
		const fakeResponse = {
			choices: [
				{
					message: {
						content: JSON.stringify({
							"1": {
								contradiction: true,
								confidence: 0.9,
								reason: "switched",
							},
						}),
					},
				},
			],
		};

		it("omits temperature and normalizes url for gpt-5.4-nano", async () => {
			setupFetchMock(fakeResponse);
			const filter = new VllmReasoningContradictionFilter({
				baseURL: "https://gateway.test/v1",
				model: "gpt-5.4-nano",
			});
			await filter.filter([contradictionCandidate]);

			expect(capturedUrl).toBe("https://gateway.test/v1/chat/completions");
			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("sends temperature 0 for default/non-gpt model", async () => {
			setupFetchMock(fakeResponse);
			const filter = new VllmReasoningContradictionFilter({
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
			});
			await filter.filter([contradictionCandidate]);

			expect(capturedBody?.temperature).toBe(0);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});

		it("omits temperature when null override is passed", async () => {
			setupFetchMock(fakeResponse);
			const filter = new VllmReasoningContradictionFilter({
				baseURL: "https://gateway.test/v1",
				model: "gemini-2.5-flash-lite",
				temperature: null,
			});
			await filter.filter([contradictionCandidate]);

			expect("temperature" in (capturedBody ?? {})).toBe(false);
			expect("tools" in (capturedBody ?? {})).toBe(false);
		});
	});
});
