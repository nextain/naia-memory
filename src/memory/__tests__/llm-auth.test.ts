import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLLMFactExtractor } from "../llm-fact-extractor.js";
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
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("OpenAI-compatible LLM auth", () => {
	it("fact extractor가 Naia gateway에는 X-AnyLLM-Key만 전송한다", async () => {
		let capturedHeaders: HeadersInit | undefined;
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			capturedHeaders = init?.headers;
			return new Response(JSON.stringify({
				choices: [{ message: { content: '{"1":[]}' } }],
			}), { status: 200, headers: { "content-type": "application/json" } });
		});
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
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			capturedHeaders = init?.headers;
			return new Response(JSON.stringify({
				choices: [{ message: { content: "요약" } }],
			}), { status: 200, headers: { "content-type": "application/json" } });
		});
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
		vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			capturedHeaders = init?.headers;
			return new Response(JSON.stringify({ choices: [{ message: { content: '{"1":[]}' } }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}));

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
		vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			capturedHeaders = init?.headers;
			return new Response(JSON.stringify({ choices: [{ message: { content: "요약" } }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}));

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
