# Naia Memory

[한국어](README.md) · [English](README.en.md) · [Docs index](docs/README.md)

A library that lets an AI agent remember the way people do. Instead of storing every sentence of a conversation as a vector, it imitates human memory: it keeps only what matters, lets memories fade when they go unused, sharpens the ones you recall again, and updates old facts when a contradicting one arrives.

And that memory stays on the user's own machine. Rather than handing conversations to a service provider to manage remotely, it saves to a local file or a local database that the user owns.

## What it does

It takes the conversation between an agent and a user and does two things: it stores (encode) and it recalls.

When storing, it first decides whether an utterance is worth remembering. A meaningless "hi" gets filtered out; something like "I switched to a design company" is kept. That decision comes from three scores: how important the content is (importance), how new it is relative to what's already known (surprise), and whether it carries emotion (emotion).

When recalling, it takes a query and returns the relevant memories. It doesn't lean on a single vector similarity. It runs both a semantic search (cosine similarity, matching by meaning) and a keyword search (BM25, matching by overlapping words), then fuses the two rankings into one (RRF, Reciprocal Rank Fusion). On top of that it pulls in associated memories through a knowledge graph (spreading activation), and finally trims redundant results for diversity (MMR, Maximal Marginal Relevance).

The simplest usage looks like this.

```typescript
import {
  MemorySystem,
  LocalAdapter,
  OpenAICompatEmbeddingProvider,
  HeuristicContradictionFilter,
  buildLLMFactExtractor,
} from "@nextain/naia-memory";

// Inject the embedding provider and the fact extractor explicitly.
// No hidden env-var magic — what you use is visible in the code.
const embedder = new OpenAICompatEmbeddingProvider(
  baseURL, apiKey, "gemini-embedding-001", 3072,
);
const adapter = new LocalAdapter({
  storePath: "/path/to/store.json",
  embeddingProvider: embedder,
});
const factExtractor = buildLLMFactExtractor({
  apiKey, baseURL, model: "gemini-2.5-flash-lite",
});

const memory = new MemorySystem({
  adapter,
  factExtractor,
  // Inject the contradiction filter explicitly too. The rule-based filter
  // makes no external LLM call. Omit this line and the library auto-selects a
  // filter from environment variables (GEMINI_API_KEY, etc.), so judgment can
  // leave the machine even in the default state.
  contradictionFilter: new HeuristicContradictionFilter(),
});

// Store
await memory.encode(
  { content: "I switched to a design company", role: "user" },
  { project: "personal" },
);

// Recall
const result = await memory.recall("What is the user's job?", {
  project: "personal",
  topK: 10,
});
// result.facts: extracted facts
// result.episodes: original conversation fragments
```

`MemorySystem` is the engine that runs storage, recall, and the background housekeeping. You can use it directly as above, or, when attaching it to a higher-level runtime like naia-agent, use the `MemoryProvider` contract described under "The contract seam" below.

The housekeeping resembles human sleep. While a conversation piles up, the raw text is left alone; later it is processed in a batch that distills the raw dialogue into short, solid facts.

```typescript
// Run one pass now
await memory.consolidateNow();

// Or run it on a background timer (default 30 minutes).
// The timer does not start on its own — the host opts in.
memory.startConsolidation();
// Stop with: memory.stopConsolidation()
```

## Features

**A brain-inspired memory layout.** Memories are split into stores of different character. The core two are episodic memory (likened to the hippocampus), which holds time-stamped events with their context, and semantic memory (likened to the neocortex), which holds the facts and relations distilled from them. There is also an early form of procedural memory (likened to the basal ganglia), which learns methods that repeatedly succeed, and working memory (likened to the prefrontal cortex), the currently active context. Episodic and semantic memory are complete and working; procedural memory is at an early stage that tallies skill success/failure; working memory is not stored by the library but managed by the host runtime.

**Importance gating.** The three axes above (importance, surprise, emotion) filter what gets stored. Because not every utterance is saved, the store doesn't bloat with noise.

**Forgetting curve and reinforcement.** Memory strength decays over time along an Ebbinghaus forgetting curve. Facts left unused weaken naturally, while recalling a memory extends its life. The more often you bring something up, the longer it stays.

**Reconsolidation and contradiction detection.** During housekeeping it checks whether a new fact conflicts with an existing one. When "I switched jobs" comes in, it supersedes the prior job fact. The conflict judgment uses a swappable filter. If you don't specify one, the library auto-selects from environment variables: a local vLLM endpoint (`VLLM_REASONING_BASE`) picks vLLM, otherwise `GEMINI_API_KEY` picks Gemini, and only when neither is set does it fall back to the rule-based (heuristic) filter. Only the heuristic makes no external LLM call, so in an environment where `GEMINI_API_KEY` is set, contradiction judgment can leave for an external LLM even in the default state. To keep judgment local, inject the rule-based filter explicitly as in the example above, or use a local vLLM.

**Knowledge graph.** It extracts entities and relations and links them into a graph. Recalling "ramen" spreads activation to "friend" and "Friday" that appeared alongside it, pulling associated memories along.

**Hybrid search.** Recall fuses semantic (cosine) and keyword (BM25) search with RRF, then adds knowledge-graph association and MMR diversity. An optional cross-encoder reranker can sit on top, but the default reranker is a no-op that leaves the order unchanged; the actual cross-encoder model is injected by the caller.

**Swappable storage backends.** Storage logic lives behind a single `MemoryAdapter` interface, so backends can be swapped. See the structure section below for the options.

**Privacy at the architecture level.** The memory itself is stored in a local file or local database that the user owns. That said, embedding, fact extraction, summarization, and contradiction judgment can call external models depending on how you configure them. The library never hides that choice: the caller injects the provider explicitly or selects it through environment variables, so what leaves the machine is visible in the code. To keep every word of a conversation local, wire embedding, extraction, and summarization to local models and set contradiction judgment to the rule-based filter or a local vLLM.

## Why it's built this way

Most memory systems are search engines at heart: store everything as vectors and pull it back by cosine similarity. That makes the store grow without bound, accumulate noise, and put stale, wrong information on equal footing with the latest.

Naia Memory's goal is not to win first place on a benchmark with a perfect recall score. It's to resemble human memory. People don't remember everything: they keep what matters, forget what goes unused, sharpen what they recall often, and update facts when they change. For an agent that lives alongside you over time, those properties are more useful than a perfect log.

As a flow: an utterance arrives and the importance scorer (importance.ts) assigns the three-axis score that decides whether to store it; stored raw text passes through the fact extractor (llm-fact-extractor.ts) during housekeeping and moves into semantic memory; a recall request has the adapter (adapters/local.ts) weave cosine, BM25, knowledge graph, and MMR into a ranking. Throughout, the forgetting curve (decay.ts) keeps lowering the strength of unused memories.

## Structure

```
src/
├── memory/
│   ├── index.ts                # MemorySystem — the store/recall/housekeeping engine (package entry)
│   ├── provider.ts             # NaiaMemoryProvider — MemoryProvider contract impl (consumer wrapper)
│   ├── provider-types.ts       # MemoryProvider contract + capability interfaces + isCapable()
│   ├── lite-provider.ts        # LiteMemoryProvider — lightweight 8G-tier implementation
│   ├── types.ts                # MemoryAdapter storage contract + domain types (Episode/Fact/Skill…)
│   ├── importance.ts           # three-axis scoring: importance, surprise, emotion
│   ├── decay.ts                # Ebbinghaus forgetting curve, reinforcement on recall
│   ├── reconsolidation.ts      # contradiction detection / supersede during housekeeping
│   ├── contradiction-filter.ts # conflict filter (heuristic / Gemini / vLLM, selectable)
│   ├── knowledge-graph.ts      # entity/relation extraction + spreading activation
│   ├── reranker.ts             # cross-encoder rerank (default no-op; cross-encoder is injected)
│   ├── embeddings.ts           # four embedding providers (OpenAI-compat / offline / HF / gateway)
│   ├── llm-fact-extractor.ts   # raw dialogue → atomic facts
│   ├── llm-summarizer.ts       # context-compaction summarizer
│   └── adapters/
│       ├── local.ts            # JSON + cosine + BM25 + knowledge graph (complete, default)
│       ├── sqlite.ts           # SQLite backend (in progress, see below)
│       ├── mem0.ts             # mem0 backend (benchmark-only, not exported)
│       └── qdrant.ts           # Qdrant vector-DB backend
├── server/                     # Express HTTP wrapper (exposes the library over REST, port 9876)
└── benchmark/
    ├── aihub141/               # Korean multi-session recall bench (AI Hub 141)
    └── comparison/             # adapters to compare against other systems (mem0/Letta, etc.)
```

### What to import

The package entry (`@nextain/naia-memory`) exports `MemorySystem` (the engine); `LocalAdapter`, `SqliteAdapter`, `QdrantAdapter` (storage backends); `LiteMemoryProvider` (the lightweight impl); the embedding providers; `buildLLMFactExtractor`; and the `MemoryProvider` contract types. For solo experimentation, using `MemorySystem` directly as in the example above is the simplest path.

### The contract seam

A higher-level runtime like naia-agent doesn't call `MemorySystem` directly; it only sees the `MemoryProvider` contract (`provider-types.ts`). The faithful implementation of that contract is `NaiaMemoryProvider` (`provider.ts`), which delegates internally to `MemorySystem`. As long as the contract holds, you can swap in another implementation such as mem0 or Letta without changing runtime code. In other words, naia-agent treats the memory implementation as a black box behind the interface.

For small, 8GB-class environments, `LiteMemoryProvider` implements the same contract. It skips the heavy housekeeping, knowledge graph, and worker thread; it stores facts append-only in SQLite and does brute-force cosine recall with the injected embedder.

### Storage backend status

The default, complete backend is `LocalAdapter`. It stores to a JSON file and runs cosine, BM25, and the knowledge graph in memory. It targets desktop / single-user use up to tens of thousands of facts, and it's the path naia-agent actually integrates against.

`SqliteAdapter` is in progress. Store, keyword recall, vector recall (sqlite-vec), and a surface (hot) tier that keeps frequently used facts aside for fast lookup all work today. What has not yet reached `LocalAdapter` parity is the cognitive machinery: emotion gating, epoch anchoring, knowledge-graph association, and insight distillation. So the path that is complete and used by default is `LocalAdapter`, while `SqliteAdapter` is being shaped into the performance path for large-scale growth.

Bringing the cognitive features up to `LocalAdapter` parity on top of FTS5, sqlite-vec, and R-Tree is the remaining goal.

## Place in the Naia ecosystem

Naia Memory is one of four repos that make up the Naia open-source AI platform; it owns memory.

- [naia-os](https://github.com/nextain/naia-os) — desktop shell and OS image (the host)
- [naia-agent](https://github.com/nextain/naia-agent) — conversation loop, tools, context compaction runtime
- [naia-adk](https://github.com/nextain/naia-adk) — workspace format and skill library
- **naia-memory** (this repo) — the memory implementation

The four repos couple through public interfaces, not runtime dependencies. Naia Memory does not depend on the naia-agent runtime, and naia-agent treats this package only as a black box behind the `MemoryProvider` contract.

## Install and start

```bash
pnpm add @nextain/naia-memory
# or
npm install @nextain/naia-memory
```

To develop from source:

```bash
pnpm install
pnpm exec tsc --noEmit   # type check
pnpm exec vitest run     # unit tests
```

If you're reading the code for the first time, `src/memory/index.ts` (the engine) and `src/memory/provider-types.ts` (the consumer contract) give you the whole picture. How to attach it to a higher-level runtime is in the [integration guide](docs/integration.md); the design behind the brain-inspired layout is in [cognitive architecture](docs/cognitive-architecture.md). The full doc index is at [docs/README.md](docs/README.md).

## Roadmap and evaluation

### How it's measured

Benchmarks check whether the properties the library claims actually hold.

The Korean recall bench (`src/benchmark/aihub141/`) measures recall accuracy on AI Hub 141 Korean multi-session dialogue. It feeds 100 natural human-written conversations across several sessions, then measures with recall@k how well later questions bring back the relevant facts. The raw data can't be redistributed under the NIA license, so the repo commits only the loader and scorer; you download the data yourself and pass it via `AIHUB_141_PATH` to reproduce. Once you've obtained the dataset, run it like this:

```bash
AIHUB_141_PATH=/path/to/aihub/141... \
GEMINI_API_KEY=xxx \
  pnpm exec tsx src/benchmark/aihub141/run.ts \
    --adapter=naia-local --limit=100 --level=4 --topK=20
```

Adapters that measure this library side by side with other memory systems (mem0/Letta, etc.) live under `src/benchmark/comparison/`.

### Reading the benchmark numbers

It's tempting to line up another system's published score (say, the judge score on the English LoCoMo dataset) against this library's Korean recall@k and rank them, but the two measure different things in different languages with different scoring, so they shouldn't be read that way. It's a rough sense of position, not a leaderboard. Since the goal itself is human-like memory rather than a perfect recall score, proxy metrics like recall@k and latency are directional signals, not the north star.

### What's next

- A framework to measure contradiction-filter accuracy (recall, supersede precision, false-positive rate)
- A/B measurements that toggle individual memory properties on and off
- Generalization checks on other Korean datasets

Properties like naturally occurring forgetting, contradiction detection within free-flowing speech, and procedural memory are only properly verified in an integrated setup combined with naia-agent and naia-os. Those items are tracked in the integration benchmarks of the respective repos.

## AI-Native open source

This project treats AI context as a first-class artifact. The context files under `.agents/` are versioned alongside the code, and AI contributions are marked with an `Assisted-by:` git trailer. Memory is stored locally and owned by the user; unless you attach external models for embedding, fact extraction, summarization, or contradiction judgment, no conversation is handed to a service provider's server.

The AI context under `.agents/` and `.users/` is licensed under [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## License

Apache License 2.0 — see [LICENSE](LICENSE). Built by [Nextain](https://nextain.io), part of [Naia OS](https://github.com/nextain/naia-os).
