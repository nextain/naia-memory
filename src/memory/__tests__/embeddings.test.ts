import { describe, expect, it, vi } from "vitest";
import {
	HuggingFaceEmbeddingProvider,
	NaiaGatewayEmbeddingProvider,
	OfflineEmbeddingProvider,
	OpenAICompatEmbeddingProvider,
} from "../embeddings.js";

/**
 * OfflineEmbeddingProvider — model→dims 계약 (naia-agent 가 의존).
 * naia-agent memory-adapter-embedding.contract.test.ts 가 이 dims 를 assert 하므로
 * 여기서 소스 측 계약을 고정한다. (실제 로드/dtype 동작은 벤치 e5-sanity-check.ts +
 * 부스 프리페치 실측으로 검증 — 유닛 스위트는 모델을 다운로드하지 않는다.)
 *
 * multilingual-e5-large 는 init() 에서 dtype="q8" 단일파일로 로드된다(fp32 external-data
 * 2GB 역직렬화 실패 회피). dims 는 dtype 과 무관하게 1024 로 고정.
 */
describe("OfflineEmbeddingProvider · model→dims 계약", () => {
	it("multilingual-e5-large = 1024d (다국어·한국어 CPU 임베딩)", () => {
		const p = new OfflineEmbeddingProvider("multilingual-e5-large", "cpu");
		expect(p.dims).toBe(1024);
		expect(p.name).toBe("offline");
	});

	it("multilingual E5 크기별 차원을 노출한다", () => {
		expect(
			new OfflineEmbeddingProvider("multilingual-e5-small", "cpu").dims,
		).toBe(384);
		expect(
			new OfflineEmbeddingProvider("multilingual-e5-base", "cpu").dims,
		).toBe(768);
		expect(
			new OfflineEmbeddingProvider("multilingual-e5-large", "cpu").dims,
		).toBe(1024);
	});

	it("all-mpnet-base-v2 = 768d (영어 전용, 정확)", () => {
		expect(new OfflineEmbeddingProvider("all-mpnet-base-v2").dims).toBe(768);
	});

	it("all-MiniLM-L6-v2 = 384d (영어 전용, 경량) — 기본값", () => {
		expect(new OfflineEmbeddingProvider().dims).toBe(384);
		expect(new OfflineEmbeddingProvider("all-MiniLM-L6-v2").dims).toBe(384);
	});

	it("paraphrase-multilingual-MiniLM-L12-v2 = 384d (다국어·한국어, 경량·빠름)", () => {
		const p = new OfflineEmbeddingProvider(
			"paraphrase-multilingual-MiniLM-L12-v2",
			"cpu",
		);
		expect(p.dims).toBe(384);
		expect(p.name).toBe("offline");
	});
});

describe("OfflineEmbeddingProvider · explicit true batch", () => {
	it("preserves the default per-item inference mode", () => {
		expect(new OfflineEmbeddingProvider().batchInferenceMode).toBe(
			"per-item-v1",
		);
	});

	it("runs one padded array inference and restores row boundaries", async () => {
		const provider = new OfflineEmbeddingProvider(
			"all-MiniLM-L6-v2",
			"cpu",
			undefined,
			"padded-array-batch-v1",
		);
		const pipeline = vi.fn().mockResolvedValue({
			data: Float32Array.from(
				{ length: provider.dims * 2 },
				(_, index) => index,
			),
		});
		Object.assign(provider as object, {
			pipeline,
			initPromise: Promise.resolve(),
		});
		const rows = await provider.embedBatch(["first", "second"]);
		expect(pipeline).toHaveBeenCalledTimes(1);
		expect(pipeline.mock.calls[0]?.[0]).toEqual(["first", "second"]);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toHaveLength(provider.dims);
		expect(rows[1]?.[0]).toBe(provider.dims);
	});

	it("fails closed when the runtime returns an unexpected batch shape", async () => {
		const provider = new OfflineEmbeddingProvider(
			"all-MiniLM-L6-v2",
			"cpu",
			undefined,
			"padded-array-batch-v1",
		);
		Object.assign(provider as object, {
			pipeline: vi.fn().mockResolvedValue({ data: new Float32Array(1) }),
			initPromise: Promise.resolve(),
		});
		await expect(provider.embedBatch(["first", "second"])).rejects.toThrow(
			"batched embedding shape mismatch",
		);
	});
});

describe("remote embedding-space identity", () => {
	it("retries transient 429/5xx responses with deterministic backoff", async () => {
		vi.useFakeTimers();
		try {
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce({ ok: false, status: 503 })
				.mockResolvedValueOnce({ ok: false, status: 429 })
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ data: [{ embedding: [1], index: 0 }] }),
				});
			vi.stubGlobal("fetch", fetchMock);
			const result = new OpenAICompatEmbeddingProvider(
				"https://embedding.example",
				"key",
				"model",
			).embed("query");
			await vi.runAllTimersAsync();
			await expect(result).resolves.toEqual([1]);
			expect(fetchMock).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});

	it("does not retry non-transient client errors", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 400,
			text: async () => "bad request",
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			const provider = new OpenAICompatEmbeddingProvider(
				"https://embedding.example",
				"key",
				"model",
			);
			await expect(provider.embed("query")).rejects.toThrow(
				"Embedding API error: 400 bad request",
			);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("fails closed on OpenAI-compatible response cardinality and index drift", async () => {
		const provider = new OpenAICompatEmbeddingProvider(
			"https://embedding.example",
			"key",
			"model",
		);
		for (const data of [
			[],
			[{ embedding: [1] }, { embedding: [2] }],
			[{ embedding: [1], index: 1 }],
			[{ embedding: [1], index: 0 }, { embedding: [2], index: 0 }],
		]) {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					json: async () => ({ data }),
				}),
			);
			await expect(provider.embed("query")).rejects.toThrow(
				/cardinality|invalid vector|invalid response indices/,
			);
			vi.unstubAllGlobals();
		}
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					data: [
						{ embedding: [2], index: 1 },
						{ embedding: [1], index: 0 },
					],
				}),
			}),
		);
		await expect(provider.embedBatch(["first", "second"])).resolves.toEqual([
			[1],
			[2],
		]);
		vi.unstubAllGlobals();
	});

	it("requires immutable remote revisions and excludes endpoint credentials and paths", () => {
		const providers = [
			new OpenAICompatEmbeddingProvider(
				"https://url-user:url-secret@embedding.example/v1?token=query-secret#fragment-secret",
				"secret-a",
				"model-a",
				384,
				"deploy-2026-08-16",
			),
			new NaiaGatewayEmbeddingProvider(
				"https://gateway.example",
				"secret-c",
				"gateway-release-1",
			),
		];
		for (const provider of providers) {
			expect(provider.embeddingSpaceId).toBeTruthy();
			expect(provider.embeddingSpaceId).not.toContain("secret");
			expect(provider.embeddingSpaceId).not.toContain("token=");
			expect(provider.embeddingSpaceId).not.toContain("/v1");
		}
	});

	it("leaves mutable aliases unverifiable and rejects malformed endpoints", () => {
		expect(
			new OpenAICompatEmbeddingProvider(
				"https://embedding.example",
				"key",
				"latest",
			).embeddingSpaceId,
		).toBeUndefined();
		expect(
			new HuggingFaceEmbeddingProvider("key").embeddingSpaceId,
		).toBeUndefined();
		expect(
			new HuggingFaceEmbeddingProvider("key", "model", 2, "caller-revision")
				.embeddingSpaceId,
		).toBeUndefined();
		expect(
			() =>
				new OpenAICompatEmbeddingProvider(
					"not-a-url:user:secret",
					"key",
					"model",
					384,
					"rev",
				),
		).toThrow();
	});
});
