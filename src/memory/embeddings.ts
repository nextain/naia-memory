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
}

/**
 * OfflineEmbeddingProvider — @huggingface/transformers (dynamic import).
 */
export class OfflineEmbeddingProvider implements EmbeddingProvider {
	readonly name = "offline";
	readonly dims: number;
	private pipeline: any = null;
	private readonly modelName: string;
	/** 실행 device(naia-embedded 컴퓨트 선택). 미지정 = transformers 기본(현행 동작 무변).
	 *  "cpu" = 강제 CPU / "gpu" = 가용 시 GPU(onnxruntime EP), 없으면 CPU 폴백("auto"로 매핑) / "auto" = 자동. */
	private readonly device?: "cpu" | "gpu" | "auto";
	private initPromise: Promise<void> | null = null;

	constructor(
		model:
			| "all-MiniLM-L6-v2"
			| "all-mpnet-base-v2"
			| "multilingual-e5-large" = "all-MiniLM-L6-v2",
		device?: "cpu" | "gpu" | "auto",
	) {
		this.modelName = model;
		this.device = device;
		if (model === "multilingual-e5-large") this.dims = 1024;
		else if (model === "all-mpnet-base-v2") this.dims = 768;
		else this.dims = 384;
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
				const hfModel =
					this.modelName === "multilingual-e5-large"
						? "Xenova/multilingual-e5-large"
						: `Xenova/${this.modelName}`;

				// device 매핑: gpu→"auto"(onnxruntime EP 가용 시 GPU, 없으면 CPU 폴백 — 메모리 비활성 회피) /
				// cpu→"cpu" / auto→"auto" / 미지정→옵션 없이(transformers 기본, 현행 무변).
				const pipeOpts =
					this.device === undefined
						? undefined
						: { device: this.device === "gpu" ? "auto" : this.device };
				this.pipeline = await pipelineFn("feature-extraction", hfModel, pipeOpts);
			})();
		}
		return this.initPromise;
	}

	async embed(text: string): Promise<number[]> {
		await this.init();
		const processedText =
			this.modelName === "multilingual-e5-large" ? `query: ${text}` : text;
		const result = await this.pipeline(processedText, {
			pooling: "mean",
			normalize: true,
		});
		return Array.from(result.data) as number[];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		await this.init();
		const processedTexts =
			this.modelName === "multilingual-e5-large"
				? texts.map((t) => `passage: ${t}`)
				: texts;
		return Promise.all(
			processedTexts.map(async (t) => {
				const result = await this.pipeline(t, {
					pooling: "mean",
					normalize: true,
				});
				return Array.from(result.data) as number[];
			}),
		);
	}
}

/**
 * OpenAICompatEmbeddingProvider — supports local LLMs (vLLM) and hosted APIs.
 */
export class OpenAICompatEmbeddingProvider implements EmbeddingProvider {
	readonly name: string = "openai-compat";

	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
		private readonly model: string,
		readonly dims = 1536,
	) {}

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
		const trimmedBase = this.baseUrl.replace(/\/+$/, "");
		const isGeminiCompat = /\/openai$/.test(trimmedBase);
		const url = isGeminiCompat
			? `${trimmedBase}/embeddings`
			: `${trimmedBase}/v1/embeddings`;
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({ model: this.model, input: texts }),
		});
		if (!res.ok) throw new Error(`Embedding API error: ${res.status} ${await res.text().catch(() => "")}`);
		const data = (await res.json()) as {
			data: Array<{ embedding: number[] }>;
			usage?: { prompt_tokens?: number; total_tokens?: number };
		};
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

	constructor(
		private readonly apiKey: string,
		private readonly model = "intfloat/multilingual-e5-large",
		readonly dims = 1024,
	) {}

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
	constructor(naiaGatewayUrl: string, naiaKey: string) {
		super(naiaGatewayUrl, naiaKey, "vertexai:text-embedding-004", 768);
	}
}
