/**
 * EmbeddingProvider abstraction — 5 built-in providers.
 */

/**
 * EmbeddingProvider interface — injectable into MemorySystem and adapters.
 */
export interface EmbeddingProvider {
	/** Embed a single text string. Returns a float vector. */
	embed(text: string): Promise<number[]>;
	/** Embed multiple texts in one call. Returns one vector per text. */
	embedBatch(texts: string[]): Promise<number[][]>;
	/** Embedding vector dimensions */
	readonly dims: number;
	/** Provider name for logging/debugging */
	readonly name: string;
	/** Stable identity of the vector space, including preprocessing semantics. */
	readonly embeddingSpaceId?: string;
}

export interface OfflineEmbeddingPolicyReceipt {
	model: string;
	revision: string;
	dtype: "q8" | "fp32";
	dimensions: number;
	queryPrefix: string;
	passagePrefix: string;
	pooling: "mean";
	normalize: true;
	tokenizerMaxLength: 512;
	truncation: true;
	titleConcatenation: "provider-receives-precomposed-text";
}

function embeddingEndpointIdentity(baseUrl: string): string {
	const endpoint = new URL(baseUrl);
	if (!/^https?:$/.test(endpoint.protocol)) {
		throw new Error("Embedding endpoint must use http or https");
	}
	// Paths are deliberately excluded: hosted gateways sometimes put API keys
	// in path segments. Deployment identity is supplied separately.
	return endpoint.origin;
}

export const OFFLINE_MODEL_REVISIONS = {
	"all-MiniLM-L6-v2": "751bff37182d3f1213fa05d7196b954e230abad9",
	"all-mpnet-base-v2": "e086c5e0b3a57b0ce46dd6d9c0662948860b35f3",
	"multilingual-e5-small": "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
	"multilingual-e5-base": "1ec9243030a27d1a115d5c340572074c125b58b2",
	"multilingual-e5-large": "00fc3aeb3dbb95842de2ac1961d33c6319acf57b",
	"paraphrase-multilingual-MiniLM-L12-v2":
		"2c4055b12046f11709e9df2c122e59ffbdc2f900",
} as const;

/** Resolve the exact HTTP route used by OpenAI-compatible embedding calls. */
export function openAICompatEmbeddingEndpoint(baseUrl: string): string {
	const trimmedBase = baseUrl.replace(/\/+$/, "");
	return /\/(?:openai|v1)$/.test(trimmedBase)
		? `${trimmedBase}/embeddings`
		: `${trimmedBase}/v1/embeddings`;
}

type OfflineModelName = keyof typeof OFFLINE_MODEL_REVISIONS;
export type OfflineBatchInferenceMode = "per-item-v1" | "padded-array-batch-v1";

interface OfflineFeatureExtractionResult {
	data: ArrayLike<number>;
}

type OfflineFeatureExtractionPipeline = (
	input: string | string[],
	options: {
		pooling: "mean";
		normalize: true;
		truncation: true;
		max_length: 512;
	},
) => Promise<OfflineFeatureExtractionResult>;

/**
 * OfflineEmbeddingProvider — @huggingface/transformers (dynamic import).
 */
export class OfflineEmbeddingProvider implements EmbeddingProvider {
	readonly name = "offline";
	readonly dims: number;
	readonly embeddingSpaceId: string;
	private pipeline: OfflineFeatureExtractionPipeline | null = null;
	private readonly modelName: string;
	private readonly revision: string;
	/** 실행 device(naia-embedded 컴퓨트 선택). 미지정 = transformers 기본(현행 동작 무변).
	 *  "cpu" = 강제 CPU / "gpu" = 가용 시 GPU(onnxruntime EP), 없으면 CPU 폴백("auto"로 매핑) / "auto" = 자동. */
	private readonly device?: "cpu" | "gpu" | "auto";
	readonly batchInferenceMode: OfflineBatchInferenceMode;
	private initPromise: Promise<void> | null = null;

	get policyReceipt(): OfflineEmbeddingPolicyReceipt {
		const e5 = this.modelName.startsWith("multilingual-e5-");
		return {
			model: `Xenova/${this.modelName}`,
			revision: this.revision,
			dtype: e5 ? "q8" : "fp32",
			dimensions: this.dims,
			queryPrefix: e5 ? "query: " : "",
			passagePrefix: e5 ? "passage: " : "",
			pooling: "mean",
			normalize: true,
			tokenizerMaxLength: 512,
			truncation: true,
			titleConcatenation: "provider-receives-precomposed-text",
		};
	}

	constructor(
		model: OfflineModelName = "all-MiniLM-L6-v2",
		device?: "cpu" | "gpu" | "auto",
		revision?: string,
		batchInferenceMode: OfflineBatchInferenceMode = "per-item-v1",
	) {
		this.modelName = model;
		this.revision = revision ?? OFFLINE_MODEL_REVISIONS[model];
		this.device = device;
		this.batchInferenceMode = batchInferenceMode;
		// paraphrase-multilingual-MiniLM-L12-v2 = 384d 다국어(한국어) 경량. all-MiniLM-L6-v2 와
		// 같은 384d 지만 다국어 학습 → 한국어 회상 가능(실측 top-1 5/5). fp32 단일파일이라 로드 안정.
		if (model === "multilingual-e5-large") this.dims = 1024;
		else if (model === "multilingual-e5-base") this.dims = 768;
		else if (model === "all-mpnet-base-v2") this.dims = 768;
		else this.dims = 384; // all-MiniLM-L6-v2 · paraphrase-multilingual-MiniLM-L12-v2
		const dtype = model.startsWith("multilingual-e5-") ? "q8" : "fp32";
		this.embeddingSpaceId = `offline:Xenova/${model}@${this.revision}:dims=${this.dims}:dtype=${dtype}:mean-normalized:query-passage-v2`;
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
				const hfModel = `Xenova/${this.modelName}`;

				// multilingual-e5-large: fp32 가중치가 2GB 초과 external-data
				// (onnx/model.onnx_data)로 저장돼 onnxruntime-node 가 이 스택에서
				// 역직렬화 실패(external-initializer offset 이 데이터 파일 길이 초과).
				// q8 단일파일 변형은 CPU 에서 안정 로드되고 한국어 회상 품질을 보존한다
				// (실측 top-1 5/5 vs all-mpnet 영어전용 2/5). 나머지 모델은 기본 fp32 로 정상 로드.
				const dtype: "q8" | undefined = this.modelName.startsWith(
					"multilingual-e5-",
				)
					? "q8"
					: undefined;

				// device 매핑: gpu→"auto"(onnxruntime EP 가용 시 GPU, 없으면 CPU 폴백 — 메모리 비활성 회피) /
				// cpu→"cpu" / auto→"auto" / 미지정→옵션 없이(transformers 기본, 현행 무변).
				const deviceOpt =
					this.device === undefined
						? undefined
						: this.device === "gpu"
							? "auto"
							: this.device;
				const pipeOpts = {
					...(deviceOpt !== undefined ? { device: deviceOpt } : {}),
					...(dtype !== undefined ? { dtype } : {}),
					revision: this.revision,
				};
				this.pipeline = (await pipelineFn(
					"feature-extraction",
					hfModel,
					pipeOpts,
				)) as unknown as OfflineFeatureExtractionPipeline;
			})();
		}
		return this.initPromise;
	}

	async embed(text: string): Promise<number[]> {
		await this.init();
		if (!this.pipeline)
			throw new Error("offline embedding pipeline is unavailable");
		const pipeline = this.pipeline;
		const policy = this.policyReceipt;
		const processedText = `${policy.queryPrefix}${text}`;
		const result = await pipeline(processedText, {
			pooling: policy.pooling,
			normalize: policy.normalize,
			truncation: policy.truncation,
			max_length: policy.tokenizerMaxLength,
		});
		return Array.from(result.data) as number[];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		await this.init();
		if (!this.pipeline)
			throw new Error("offline embedding pipeline is unavailable");
		const pipeline = this.pipeline;
		const policy = this.policyReceipt;
		const processedTexts = texts.map(
			(text) => `${policy.passagePrefix}${text}`,
		);
		if (this.batchInferenceMode === "per-item-v1")
			return Promise.all(
				processedTexts.map(async (t) => {
					const result = await pipeline(t, {
						pooling: policy.pooling,
						normalize: policy.normalize,
						truncation: policy.truncation,
						max_length: policy.tokenizerMaxLength,
					});
					return Array.from(result.data) as number[];
				}),
			);
		const result = await pipeline(processedTexts, {
			pooling: policy.pooling,
			normalize: policy.normalize,
			truncation: policy.truncation,
			max_length: policy.tokenizerMaxLength,
		});
		const flattened = Array.from(result.data) as number[];
		if (flattened.length !== texts.length * this.dims)
			throw new Error(
				`batched embedding shape mismatch: expected ${texts.length}x${this.dims}, got ${flattened.length} values`,
			);
		return texts.map((_, index) =>
			flattened.slice(index * this.dims, (index + 1) * this.dims),
		);
	}
}

/**
 * OpenAICompatEmbeddingProvider — supports local LLMs (vLLM) and hosted APIs.
 */
export class OpenAICompatEmbeddingProvider implements EmbeddingProvider {
	readonly name: string = "openai-compat";
	readonly embeddingSpaceId?: string;

	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
		private readonly model: string,
		readonly dims = 1536,
		deploymentRevision?: string,
	) {
		const endpoint = embeddingEndpointIdentity(baseUrl);
		this.embeddingSpaceId = deploymentRevision
			? `openai-compat:${endpoint}:model=${model}@${deploymentRevision}:dims=${dims}:raw-input-v1`
			: undefined;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		// URL bug fix (#20): the previous `${baseUrl}/v1/embeddings` produced
		// `https://...v1beta/openai//v1/embeddings` for Gemini's OpenAI-compat
		// path (baseUrl already ends with "openai/"), which 404'd silently.
		// LocalAdapter.embedWithCache catches the throw and returns null, so
		// factEmbeddings stayed empty for the whole benchmark — masking the
		// R2.3/R2.5 mechanisms entirely.
		//
		// Distinguish two layouts:
		//   - Gemini OpenAI-compat:  baseUrl ends with `openai` or `openai/`
		//                            and the embeddings endpoint is `${base}/embeddings`.
		//   - OpenAI / vLLM standard: baseUrl typically does NOT include `/v1/`,
		//                             and the endpoint is `${base}/v1/embeddings`.
		const url = openAICompatEmbeddingEndpoint(this.baseUrl);
		let res: Response | undefined;
		const retryDelaysMs = [1_000, 2_000, 4_000];
		for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
			res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({ model: this.model, input: texts }),
			});
			if (res.ok || (res.status !== 429 && res.status < 500)) break;
			const delayMs = retryDelaysMs[attempt];
			if (delayMs === undefined) break;
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		if (!res) throw new Error("Embedding API request did not execute");
		if (!res.ok)
			throw new Error(
				`Embedding API error: ${res.status} ${await res.text().catch(() => "")}`,
			);
		const data = (await res.json()) as {
			data: Array<{ embedding: number[]; index?: number }>;
			usage?: { prompt_tokens?: number; total_tokens?: number };
		};
		if (!Array.isArray(data.data) || data.data.length !== texts.length)
			throw new Error(
				`Embedding API cardinality mismatch: expected ${texts.length}, received ${Array.isArray(data.data) ? data.data.length : "non-array"}`,
			);
		for (const [index, item] of data.data.entries()) {
			if (
				!item ||
				!Array.isArray(item.embedding) ||
				item.embedding.length < 1 ||
				item.embedding.some((value) => !Number.isFinite(value))
			)
				throw new Error(`Embedding API returned an invalid vector at index ${index}`);
		}
		const indexed = data.data.some((item) => item.index !== undefined);
		if (indexed) {
			const indices = data.data.map((item) => item.index);
			if (
				indices.some(
					(index) =>
						!Number.isInteger(index) || index == null || index < 0 || index >= texts.length,
				) ||
				new Set(indices).size !== texts.length
			)
				throw new Error("Embedding API returned invalid response indices");
			data.data.sort((left, right) => (left.index as number) - (right.index as number));
		}
		// Track usage for benchmark cost reporting (no-op if tracker not used).
		try {
			const { recordEmbedding } = await import("./usage-tracker.js");
			const tok =
				data.usage?.total_tokens ??
				data.usage?.prompt_tokens ??
				// Fallback: rough estimate by char count (4 chars/token avg KO/EN mixed)
				Math.ceil(texts.reduce((s, t) => s + t.length, 0) / 4);
			recordEmbedding(tok);
		} catch {}
		return data.data.map((d) => d.embedding);
	}

	async embed(text: string): Promise<number[]> {
		return (await this.embedBatch([text]))[0];
	}
}

/**
 * HuggingFaceEmbeddingProvider — uses HF Inference API.
 */
export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
	readonly name = "huggingface";
	readonly embeddingSpaceId?: string;

	constructor(
		private readonly apiKey: string,
		private readonly model = "intfloat/multilingual-e5-large",
		readonly dims = 1024,
		_modelRevision?: string,
	) {
		// This hosted route is alias-based; a caller-supplied git revision is
		// not guaranteed to be the revision actually served by Hugging Face.
		this.embeddingSpaceId = undefined;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		const res = await fetch(
			`https://api-inference.huggingface.co/pipeline/feature-extraction/${this.model}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					inputs: texts,
					options: { wait_for_model: true },
				}),
			},
		);
		if (!res.ok) throw new Error(`HF Embedding error: ${res.status}`);
		const data = (await res.json()) as number[][];
		return data;
	}

	async embed(text: string): Promise<number[]> {
		// E5 query prefix
		const query = `query: ${text}`;
		const res = await fetch(
			`https://api-inference.huggingface.co/pipeline/feature-extraction/${this.model}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					inputs: [query],
					options: { wait_for_model: true },
				}),
			},
		);
		const data = (await res.json()) as number[][];
		return data[0];
	}
}

/**
 * NaiaGatewayEmbeddingProvider — any-llm /v1/embeddings → Vertex AI text-embedding-004.
 */
export class NaiaGatewayEmbeddingProvider extends OpenAICompatEmbeddingProvider {
	override readonly name = "naia-gateway";
	constructor(
		naiaGatewayUrl: string,
		naiaKey: string,
		deploymentRevision?: string,
	) {
		super(
			naiaGatewayUrl,
			naiaKey,
			"vertexai:text-embedding-004",
			768,
			deploymentRevision,
		);
	}
}
