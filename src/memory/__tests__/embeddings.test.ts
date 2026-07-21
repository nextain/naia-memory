import { describe, expect, it } from "vitest";
import { OfflineEmbeddingProvider } from "../embeddings.js";

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
