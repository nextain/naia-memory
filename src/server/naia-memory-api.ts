import express from "express";
import type { MemoryAdapter } from "../memory/types.js";
import { MemorySystem } from "../memory/index.js";
import { LocalAdapter } from "../memory/adapters/local.js";
import { Mem0Adapter } from "../memory/adapters/mem0.js";
import { buildLLMFactExtractor } from "../memory/llm-fact-extractor.js";
import { OpenAICompatEmbeddingProvider } from "../memory/embeddings.js";
import { createConsolidationGate } from "./consolidation-gate.js";
import { VectorStore } from "./vector-store.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const apiKey = process.env.GEMINI_API_KEY || "";
const port = parseInt(process.env.PORT || "9876", 10);
const storePath = process.env.STORE_PATH || "/tmp/locomo-naia-memory.json";
const vectorStorePath =
	process.env.VECTOR_STORE_PATH ||
	storePath.replace(/\.json$/i, "") + ".vec.sqlite";
const vectorStore = new VectorStore(vectorStorePath);

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const GATEWAY_URL = process.env.GATEWAY_URL || "";
const GATEWAY_KEY = process.env.GATEWAY_MASTER_KEY || "";

const useGateway = GATEWAY_URL && GATEWAY_KEY;
const llmBase = useGateway ? `${GATEWAY_URL.replace(/\/+$/, "")}/v1/` : GEMINI_BASE;
const llmKey = useGateway ? GATEWAY_KEY : apiKey;

const embedBaseUrl = process.env.VLLM_EMBED_BASE
	|| (useGateway ? GATEWAY_URL.replace(/\/+$/, "") : GEMINI_BASE);
const embedApiKey = process.env.VLLM_EMBED_BASE
	? "empty" : (useGateway ? GATEWAY_KEY : apiKey);
const embedModel = process.env.VLLM_EMBED_MODEL
	|| (useGateway ? "vertexai/gemini-embedding-001" : "gemini-embedding-001");
const embedDims = process.env.VLLM_EMBED_DIM
	? parseInt(process.env.VLLM_EMBED_DIM, 10)
	: 3072;

const embedder = new OpenAICompatEmbeddingProvider(
	embedBaseUrl,
	embedApiKey,
	embedModel,
	embedDims,
);

const adapterType = (process.env.ADAPTER || "local").toLowerCase();
let adapter: MemoryAdapter;

if (adapterType === "mem0") {
	// mem0 OSS adapter — local CPU embedding (transformers.js) + GLM LLM
	// Override via env: MEM0_LLM_BASE_URL, MEM0_LLM_MODEL, EMBED_MODEL
	const embedModel = process.env.EMBED_MODEL || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
	const embedDim = parseInt(process.env.EMBED_DIM || "384", 10);
	const mem0LlmBase = process.env.MEM0_LLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
	const mem0LlmModel = process.env.MEM0_LLM_MODEL || "glm-4.5";
	const mem0LlmKey = process.env.MEM0_LLM_API_KEY || process.env.GLM_API_KEY || "";

	// LangChain HuggingFaceTransformersEmbeddings — ONNX CPU 실행, zero-cost
	const { HuggingFaceTransformersEmbeddings } = await import("@langchain/community/embeddings/huggingface_transformers");
	const embedderInstance = new HuggingFaceTransformersEmbeddings({
		model: embedModel,
	});

	adapter = new Mem0Adapter({
		userId: process.env.MEM0_USER_ID || "naia-default",
		mem0Config: {
			vectorStore: {
				provider: "memory",
				config: {
					collectionName: process.env.MEM0_COLLECTION || "naia-bench",
					dimension: embedDim,
				},
			},
			embedder: {
				provider: "langchain",
				config: {
					model: embedderInstance as unknown as string,
				},
			},
			llm: {
				provider: "openai",
				config: {
					apiKey: mem0LlmKey,
					baseURL: mem0LlmBase,
					model: mem0LlmModel,
				},
			},
		},
	});
	console.log(`  adapter: Mem0Adapter (in-memory, embedder=local-CPU/${embedModel} ${embedDim}d, llm=${mem0LlmModel})`);
} else {
	adapter = new LocalAdapter({ storePath, embeddingProvider: embedder });
	console.log(`  adapter: LocalAdapter`);
}

const factExtractor = buildLLMFactExtractor({
	apiKey: llmKey,
	baseURL: llmBase,
	model: useGateway ? "vertexai/gemini-2.5-flash-lite" : undefined,
});
const system = new MemorySystem({ adapter, factExtractor });

const gate = createConsolidationGate({
	consolidate: async () => {
		const r = await system.consolidateNow(true);
		console.log(
			`Consolidated: ${r.factsCreated} new facts, ${r.factsUpdated} updated`,
		);
	},
});
let addCount = 0;
const CONSOLIDATE_EVERY = 10;

// Server-side throttle for LLM-heavy adapters (Mem0Adapter triggers GLM call per add)
const ADD_INTERVAL_MS = parseInt(process.env.ADD_INTERVAL_MS || "0", 10);
let lastAddTs = 0;
async function addThrottle() {
	if (ADD_INTERVAL_MS <= 0) return;
	const now = Date.now();
	const wait = Math.max(0, lastAddTs + ADD_INTERVAL_MS - now);
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastAddTs = Date.now();
}

const unconsolidatedCount = (adapter as any).store?.episodes?.filter(
	(e: any) => !e.consolidated,
).length ?? 0;
if (unconsolidatedCount > 0) {
	console.log(`Found ${unconsolidatedCount} unconsolidated episodes, consolidating...`);
	gate.markDirty();
	gate.ensureConsolidated();
}

interface SearchResult {
	memory: string;
	score: number;
	id: string;
	created_at?: string;
	updated_at?: string;
}

app.post("/memories", async (req, res) => {
	try {
		const { messages, user_id, timestamp } = req.body;
		if (!messages || !user_id) {
			res.status(400).json({ error: "messages and user_id required" });
			return;
		}

		const content = messages
			.map((m: { role: string; content: string }) => m.content)
			.join("\n");
		const ts = timestamp ? Number(timestamp) : undefined;

		await addThrottle();
		await system.encode(
			{ content, role: "user", timestamp: ts },
			{ project: user_id },
		);

		gate.markDirty();
		addCount++;
		if (addCount % CONSOLIDATE_EVERY === 0) {
			gate.ensureConsolidated();
		}

		res.json({ results: [] });
	} catch (err: any) {
		console.error("ADD error:", err.message?.slice(0, 300));
		res.status(500).json({ error: err.message?.slice(0, 200) });
	}
});

app.post("/consolidate", async (_req, res) => {
	try {
		await gate.ensureConsolidated();
		res.json({ status: "ok" });
	} catch (err: any) {
		res.status(500).json({ error: err.message?.slice(0, 200) });
	}
});

app.post("/search", async (req, res) => {
	try {
		const { query, user_id, limit } = req.body;
		if (!query || !user_id) {
			res.status(400).json({ error: "query and user_id required" });
			return;
		}
		const topK = limit || 50;

		await gate.ensureConsolidated();

		const result = await system.recall(query, {
			project: user_id,
			topK,
		});

		const results: SearchResult[] = [
			...result.facts.map((f, i) => ({
				memory: f.content,
				score: f.relevanceScore ?? 1 - i * (1 / (result.facts.length + 1)),
				id: f.id,
				created_at: new Date(f.createdAt).toISOString(),
			})),
			...result.episodes.map((e, i) => ({
				memory: e.content,
				score: 0.5 - i * (0.5 / (result.episodes.length + 1)),
				id: e.id,
				created_at: new Date(e.timestamp).toISOString(),
			})),
		];

		results.sort((a, b) => b.score - a.score);
		res.json({ results });
	} catch (err: any) {
		console.error("SEARCH error:", err.message?.slice(0, 300));
		res.status(500).json({ error: err.message?.slice(0, 200) });
	}
});

app.delete("/memories", async (req, res) => {
	try {
		const userId = req.query.user_id as string;
		if (!userId) {
			res.status(400).json({ error: "user_id required" });
			return;
		}
		res.json({ message: "deleted" });
	} catch (err: any) {
		res.status(500).json({ error: err.message?.slice(0, 200) });
	}
});

// === Vector endpoint (Phase 3 cycle 1, naia-cognitive 통합) ============
// Peer review (Gemini + Gemma 4) 만장일치 결정. paradigm 본질.
//
// POST /memories/vector
//   body: {
//     user_id: string,
//     vector: number[],                    // pre-computed embedding (e.g. HuBERT 768 + chroma 12)
//     content?: string,                    // optional human-readable description
//     metadata?: {
//       source_type: "audio_fingerprint" | "image" | ...,
//       source_model: "hubert-chroma-v1.0",   // ★ embedding versioning
//       timestamp?: number | string,
//       additional_data?: object,
//     }
//   }
//
// Storage path: episodic store (Hippocampus) — content + vector + metadata.
// Search side: POST /search 가 query_vector + source_model filter 지원 (search extension).
//
// Embedding versioning 주의: 동일 source_model 끼리만 cosine 비교 의미 있음.
// 다른 model 의 vector 가 mix 되면 ranking 왜곡. metadata.source_model 로 분리.

app.post("/memories/vector", async (req, res) => {
	try {
		const { user_id, vector, content, metadata } = req.body;
		if (!user_id) {
			res.status(400).json({ error: "user_id required" });
			return;
		}
		if (!Array.isArray(vector) || vector.length === 0) {
			res.status(400).json({ error: "vector (non-empty array) required" });
			return;
		}
		if (!metadata?.source_model) {
			res.status(400).json({ error: "metadata.source_model required (embedding versioning)" });
			return;
		}

		const ts =
			metadata?.timestamp
				? typeof metadata.timestamp === "number"
					? metadata.timestamp
					: Date.parse(metadata.timestamp)
				: Date.now();

		await addThrottle();
		const id = vectorStore.add({
			user_id,
			vector,
			content,
			source_type: metadata.source_type ?? "vector",
			source_model: metadata.source_model,
			timestamp: ts,
			additional_data: metadata.additional_data ?? {},
		});
		res.json({
			id,
			user_id,
			vector_dim: vector.length,
			source_model: metadata.source_model,
			source_type: metadata.source_type ?? "vector",
			timestamp: ts,
		});
		return;
	} catch (err: any) {
		console.error("VECTOR ADD error:", err.message?.slice(0, 300));
		res.status(500).json({ error: err.message?.slice(0, 200) });
	}
});

// POST /search/vector — pre-computed query vector 로 vec0 검색
//   body: {
//     user_id: string,
//     query_vector: number[],
//     source_model: string,            // 같은 model 의 벡터만 검색
//     limit?: number (default 5),
//     filter?: { source_type?: string },
//   }
//   response: { results: Array<{ id, content, source_type, source_model, timestamp,
//                                additional_data, distance, score }> }
//
// score = 1 - distance/2 (cosine distance 0~2 → cosine sim 0~1)
app.post("/search/vector", async (req, res) => {
	try {
		const { user_id, query_vector, source_model, limit, filter } = req.body;
		if (!user_id) {
			res.status(400).json({ error: "user_id required" });
			return;
		}
		if (!Array.isArray(query_vector) || query_vector.length === 0) {
			res.status(400).json({ error: "query_vector (non-empty array) required" });
			return;
		}
		if (!source_model) {
			res.status(400).json({ error: "source_model required (embedding versioning)" });
			return;
		}
		const results = vectorStore.search({
			user_id,
			query_vector,
			source_model,
			limit: typeof limit === "number" ? limit : 5,
			filter,
		});
		res.json({ results });
	} catch (err: any) {
		console.error("VECTOR SEARCH error:", err.message?.slice(0, 300));
		res.status(500).json({ error: err.message?.slice(0, 200) });
	}
});

app.get("/health", (_req, res) => {
	res.json({ status: "ok" });
});

app.listen(port, () => {
	console.log(`naia-memory naia-memory API server on port ${port}`);
	console.log(`  store: ${storePath}`);
	console.log(`  vector store: ${vectorStorePath}`);
	console.log(`  embedder: ${process.env.VLLM_EMBED_BASE ? `${embedModel} (${embedDims}d, vLLM)` : `gemini-embedding-001 (3072d)`}`);
	console.log(`  fact extraction: ${useGateway ? `gateway (${GATEWAY_URL})` : "gemini direct"}`);
	console.log(`  lazy consolidation (consolidates on first search)`);
});

process.on("unhandledRejection", (err) => {
	console.error("Unhandled rejection:", err);
});

const flushAndExit = (signal: string) => {
	console.log(`\n[${signal}] flushing store before exit...`);
	try {
		(adapter as { saveImmediate?: () => void }).saveImmediate?.();
		console.log("[shutdown] store flushed");
	} catch (err: unknown) {
		console.error("[shutdown] flush error:", err);
	}
	process.exit(0);
};

process.on("SIGTERM", () => flushAndExit("SIGTERM"));
process.on("SIGINT", () => flushAndExit("SIGINT"));
