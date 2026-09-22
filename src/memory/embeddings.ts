import { rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

/** EmbeddingProvider abstraction — 5 built-in providers. */

/**
 * Substrings indicating a corrupt or truncated offline model cache file.
 * If creating the pipeline throws an error matching any of these, or matching
 * "Load model from" + "failed", OfflineEmbeddingProvider clears the corrupt model
 * cache directory so the next process start can re-download cleanly.
 *
 * NOTE: transformers.js cannot recover via in-process retry once session creation fails,
 * because createInferenceSession poisons the module-global wasmInitPromise on first rejection
 * (@huggingface/transformers@3.8.1 src/backends/onnx.js:153,157: wasmInitPromise ??= sessionPromise;
 * subsequent calls await wasmInitPromise and rethrow the initial failure forever).
 * Therefore, any corrupt load error clears the cache and asks the caller to restart the process.
 * (nextain/naia-shell#681, FR-MEM-EMBED-HEAL-1..3)
 */
export const CORRUPT_MODEL_ERROR_PATTERNS = [
	"Protobuf parsing failed",
	"invalid model",
	"Invalid model",
	"failed to load model",
	"unexpected end",
	"Unexpected end",
] as const;

export function isCorruptModelError(error: unknown): boolean {
	const message =
		error instanceof Error ? error.message : String(error ?? "");
	const causeMessage =
		error instanceof Error && error.cause instanceof Error
			? error.cause.message
			: "";
	const combined = `${message} ${causeMessage}`;
	if (
		CORRUPT_MODEL_ERROR_PATTERNS.some((pattern) => combined.includes(pattern))
	) {
		return true;
	}
	return combined.includes("Load model from") && combined.includes("failed");
}

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

export type OfflineModelName = keyof typeof OFFLINE_MODEL_REVISIONS;

/** Byte size of the ONNX file transformers loads for each pinned model revision
 *  (q8 → onnx/model_quantized.onnx for multilingual-e5-*, fp32 → onnx/model.onnx otherwise).
 *  Source: Hugging Face X-Linked-Size for Xenova/<model>@<revision>, read 2026-09-22 (nextain/naia-shell#681). */
export const OFFLINE_MODEL_FILE_BYTES = {
	"all-MiniLM-L6-v2": { file: "onnx/model.onnx", bytes: 90387606 },
	"all-mpnet-base-v2": { file: "onnx/model.onnx", bytes: 435826547 },
	"multilingual-e5-small": { file: "onnx/model_quantized.onnx", bytes: 118308185 },
	"multilingual-e5-base": { file: "onnx/model_quantized.onnx", bytes: 278647662 },
	"multilingual-e5-large": { file: "onnx/model_quantized.onnx", bytes: 561768762 },
	"paraphrase-multilingual-MiniLM-L12-v2": { file: "onnx/model.onnx", bytes: 470268510 },
} as const satisfies Record<OfflineModelName, { file: string; bytes: number }>;

/** Resolve the exact HTTP route used by OpenAI-compatible embedding calls. */
export function openAICompatEmbeddingEndpoint(baseUrl: string): string {
	const trimmedBase = baseUrl.replace(/\/+$/, "");
	return /\/(?:openai|v1)$/.test(trimmedBase)
		? `${trimmedBase}/embeddings`
		: `${trimmedBase}/v1/embeddings`;
}

function getGuardedTargetDir(
	env: { cacheDir?: unknown; useFSCache?: unknown } | null | undefined,
	modelName: string,
	revision: string,
): string | null {
	if (
		!env ||
		env.useFSCache === false ||
		typeof env.cacheDir !== "string" ||
		env.cacheDir.trim() === ""
	) {
		return null;
	}
	const resolvedCacheDir = resolve(env.cacheDir);
	const targetDir = join(env.cacheDir, "Xenova", modelName, revision);
	const resolvedTarget = resolve(targetDir);
	const rel = relative(resolvedCacheDir, resolvedTarget);
	const isStrictlyInside =
		rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
	if (!isStrictlyInside) {
		return null;
	}
	return resolvedTarget;
}

/**
 * Pre-flight check before first pipeline creation.
 * Checks if the cached model file matches expected size for pinned default revisions.
 * If file exists with a mismatched size, purges the model/revision directory and returns true.
 * If file is missing or matches expected size or guard fails, does nothing and returns false.
 */
export async function purgeTruncatedModelCache(
	env: { cacheDir?: unknown; useFSCache?: unknown } | null | undefined,
	model: string,
	revision: string,
): Promise<boolean> {
	const defaultRevision = (
		OFFLINE_MODEL_REVISIONS as Record<string, string | undefined>
	)[model];
	if (!defaultRevision || revision !== defaultRevision) {
		return false;
	}
	const entry = (
		OFFLINE_MODEL_FILE_BYTES as Record<
			string,
			{ file: string; bytes: number } | undefined
		>
	)[model];
	if (!entry) {
		return false;
	}
	const targetDir = getGuardedTargetDir(env, model, revision);
	if (!targetDir) {
		return false;
	}
	const modelFilePath = join(targetDir, entry.file);
	let s: import("node:fs").Stats;
	try {
		s = await stat(modelFilePath);
	} catch {
		return false;
	}
	if (s.size === entry.bytes) {
		return false;
	}
	await rm(targetDir, { recursive: true, force: true });
	console.warn(
		`[OfflineEmbeddingProvider] cleared truncated model cache (${modelFilePath}: actual ${s.size} bytes, expected ${entry.bytes} bytes): ${targetDir}`,
	);
	return true;
}

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
			const promise = this.loadPipeline();
			this.initPromise = promise.catch((error) => {
				this.initPromise = null;
				throw error;
			});
		}
		return this.initPromise;
	}

	private async loadPipeline(): Promise<void> {
		this.pipeline = null;
		let transformers: typeof import("@huggingface/transformers");
		try {
			transformers = await import("@huggingface/transformers");
		} catch {
			throw new Error(
				"@huggingface/transformers is required. Run: pnpm add @huggingface/transformers",
			);
		}
		const { pipeline: pipelineFn, env } = transformers;
		const hfModel = `Xenova/${this.modelName}`;

		// Pre-flight check: purge truncated model cache before first create() call
		await purgeTruncatedModelCache(env, this.modelName, this.revision);

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

		const create = async () => {
			return (await pipelineFn(
				"feature-extraction",
				hfModel,
				pipeOpts,
			)) as unknown as OfflineFeatureExtractionPipeline;
		};

		let origError: unknown;
		try {
			this.pipeline = await create();
			return;
		} catch (err: unknown) {
			origError = err;
		}

		if (!isCorruptModelError(origError)) {
			throw origError;
		}

		const targetDir = getGuardedTargetDir(env, this.modelName, this.revision);
		if (!targetDir) {
			throw origError;
		}

		await rm(targetDir, { recursive: true, force: true });
		console.warn(
			`[OfflineEmbeddingProvider] cleared corrupt model cache: ${targetDir}`,
		);

		const origMsg =
			origError instanceof Error ? origError.message : String(origError);

		throw new Error(
			"offline embedding model cache was corrupt and has been cleared; restart the process to reload it (transformers.js keeps the first failed session for the whole process): " +
				origMsg,
			{ cause: origError },
		);
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
