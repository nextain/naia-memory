/** Public package entry for Naia Memory. */
export { MemorySystem } from "./memory-system.js";
export * from "./memory-system-api.js";
export { buildLLMDeleteVerifier } from "./llm-delete-verifier.js";
export * from "./consolidation-primitives.js";
export * from "./compaction-helpers.js";
export { LiteMemoryProvider } from "./lite-provider.js";
export type { LiteMemoryProviderOptions } from "./lite-provider.js";

// Storage adapter and embedding providers.
//
// AGENTS.md names LocalAdapter as "the path MemorySystem uses by default and
// that naia-agent integrates against", but the public entry never re-exported
// it, so every consumer that followed the documentation failed to compile.
// The package exposes only "." in its exports map, so there is no deep path to
// fall back to either.
export { LocalAdapter } from "./adapters/local.js";
export {
	NaiaGatewayEmbeddingProvider,
	OfflineEmbeddingProvider,
	OpenAICompatEmbeddingProvider,
} from "./embeddings.js";
export type { EmbeddingProvider } from "./embeddings.js";

// LLM-backed helpers the agent injects into MemorySystem. Their types
// (CompactionSummarizer, FactExtractor) already come out through the `export *`
// lines above, so exporting the builders and not their inputs left consumers
// able to name the shape but not construct it.
export { buildLLMFactExtractor } from "./llm-fact-extractor.js";
export { buildLLMSummarizer } from "./llm-summarizer.js";
export type { LLMSummarizerOptions } from "./llm-summarizer.js";
