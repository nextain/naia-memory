/**
 * #27 Step 3 — Cross-encoder re-ranker interface.
 *
 * Phase B-γ + #27 sweep 측정 결과: naia 의 base retrieval (cosine + BM25 +
 * RRF + KG + MMR + threshold) 모두 noise band ±2pp. *real ranking 강화* =
 * cross-encoder.
 *
 * Pattern: caller (naia-agent) 가 인스턴스 주입. naia-memory LLM/모델 호출 X
 * (책임 분리, anchor §A08). LocalAdapter 가 search 결과 받은 후 reranker
 * 적용 (option).
 *
 * 권장 모델:
 * - BGE-reranker-v2-m3 (multilingual, 한국어 OK, ~570MB)
 * - Cohere reranker (cloud, 영어 우선)
 * - cross-encoder/ms-marco-MiniLM-L-6-v2 (영어 small)
 *
 * Future implementations:
 * - `OfflineRerankerProvider` (transformers.js, BGE-reranker-v2-m3)
 * - `OpenAICompatRerankerProvider` (Voyage / Jina cross-encoder API)
 * - `VllmRerankerProvider` (사용자 GPU 의 BGE-reranker)
 */

export interface RerankerProvider {
	/** Provider name for logging/debugging */
	readonly name: string;
	/**
	 * Re-score candidate results against the query.
	 * Returns same items in (potentially) new order with updated scores.
	 *
	 * @param query - the user query
	 * @param candidates - retrieval results (cosine + BM25 fused). Each
	 *   candidate has `content` (string) + optional `metadata`.
	 * @param topK - max items to return (after re-rank)
	 */
	rerank<T extends { content: string }>(
		query: string,
		candidates: T[],
		topK: number,
	): Promise<Array<T & { rerankScore: number }>>;
}

/**
 * No-op reranker — returns input unchanged. Default when no reranker configured.
 * Useful for testing + backward compat.
 */
export class IdentityReranker implements RerankerProvider {
	readonly name = "identity";

	async rerank<T extends { content: string }>(
		_query: string,
		candidates: T[],
		topK: number,
	): Promise<Array<T & { rerankScore: number }>> {
		return candidates.slice(0, topK).map((c, i) => ({
			...c,
			rerankScore: 1 - i / Math.max(1, candidates.length),
		}));
	}
}

/**
 * OfflineRerankerProvider — transformers.js 의 cross-encoder 사용.
 *
 * 권장 모델 (Xenova ONNX 검증, 2026-05-09):
 * - bge-reranker-base (multilingual XLM-RoBERTa, ~280MB, **default**)
 * - bge-reranker-large (multilingual XLM-RoBERTa-large, ~570MB)
 * - ms-marco-MiniLM-L-6-v2 (영어 small, ~80MB)
 *
 * 첫 사용 시 ~/.cache/huggingface/hub/ 에 download. 이후 cached.
 *
 * GPU 권장 (FP16 ~280-600MB), CPU 도 작동 (느림 ~100-200ms/pair).
 *
 * 사용 예:
 *   const reranker = new OfflineRerankerProvider("bge-reranker-base");
 *   const memory = new MemorySystem({ reranker, ... });
 *
 * NOTE: BGE-reranker-v2-m3 는 Xenova 에 ONNX 형식 없음 (2026-05-09 확인).
 * v2-m3 사용 시 BAAI/bge-reranker-v2-m3 + transformers (Python) 필요.
 */
export class OfflineRerankerProvider implements RerankerProvider {
	readonly name = "offline-reranker";
	private static readonly BATCH_SIZE = 8;
	private pipeline: any = null;
	private readonly modelName: string;
	private initPromise: Promise<void> | null = null;

	constructor(
		model:
			| "bge-reranker-base"
			| "bge-reranker-large"
			| "ms-marco-MiniLM-L-6-v2" = "bge-reranker-base",
	) {
		this.modelName = model;
	}

	private init(): Promise<void> {
		if (!this.initPromise) {
			this.initPromise = (async () => {
				let pipelineFn: typeof import("@huggingface/transformers")["pipeline"];
				try {
					({ pipeline: pipelineFn } = await import(
						"@huggingface/transformers"
					));
				} catch {
					throw new Error(
						"@huggingface/transformers is required. Run: pnpm add @huggingface/transformers",
					);
				}
				// HF Xenova mirror — transformers.js compatible.
				const hfModel = `Xenova/${this.modelName}`;
				// Node defaults to fp32. The q8 ONNX variant is substantially smaller
				// and is the supported CPU baseline for the offline provider.
				this.pipeline = await pipelineFn("text-classification", hfModel, {
					device: "cpu",
					dtype: "q8",
				});
			})();
		}
		return this.initPromise;
	}

	private async scorePairs(query: string, passages: string[]): Promise<number[]> {
		const inputs = this.pipeline.tokenizer(
			passages.map(() => query),
			{
				text_pair: passages,
				padding: true,
				truncation: true,
			},
		);
		const output = await this.pipeline.model(inputs);
		const rows = output.logits.tolist() as number[][];
		return rows.map((row) => {
			if (row.length === 1) return 1 / (1 + Math.exp(-row[0]));
			const max = Math.max(...row);
			const probabilities = row.map((value) => Math.exp(value - max));
			const total = probabilities.reduce((sum, value) => sum + value, 0);
			return probabilities[probabilities.length - 1] / total;
		});
	}

	async rerank<T extends { content: string }>(
		query: string,
		candidates: T[],
		topK: number,
	): Promise<Array<T & { rerankScore: number }>> {
		if (candidates.length === 0) return [];
		await this.init();

		const scored: Array<T & { rerankScore: number }> = [];
		for (let offset = 0; offset < candidates.length; offset += OfflineRerankerProvider.BATCH_SIZE) {
			const batch = candidates.slice(offset, offset + OfflineRerankerProvider.BATCH_SIZE);
			try {
				const scores = await this.scorePairs(query, batch.map((candidate) => candidate.content));
				if (scores.length !== batch.length) throw new Error("reranker returned an unexpected batch size");
				for (let index = 0; index < batch.length; index++) {
					scored.push({ ...batch[index], rerankScore: scores[index] });
				}
			} catch (e: any) {
				console.warn(`[OfflineRerankerProvider] batch rerank failed; retrying individually: ${e.message}`);
				for (const candidate of batch) {
					try {
						const [score] = await this.scorePairs(query, [candidate.content]);
						scored.push({ ...candidate, rerankScore: score ?? 0 });
					} catch (candidateError: any) {
						console.warn(
							`[OfflineRerankerProvider] rerank failed for "${candidate.content.slice(0, 50)}": ${candidateError.message}`,
						);
						scored.push({ ...candidate, rerankScore: 0 });
					}
				}
			}
		}

		return scored.sort((a, b) => b.rerankScore - a.rerankScore).slice(0, topK);
	}
}
