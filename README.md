**English** | [한국어](README.ko.md)

# Naia Memory

[Docs index](docs/README.md) (Korean)

A library that lets an AI agent remember the way people do. Instead of storing every sentence of a conversation as a vector, it imitates human memory: it keeps only what matters, lets memories fade when they go unused, and sharpens the ones you recall again. When a fact arrives that contradicts what it knew, it updates the old memory with the new fact.

And that memory stays on the user's own machine. Rather than handing conversations to a service provider to manage memory on a remote server, it saves to a local file or a local database that the user owns.

## First, the questions that run through Naia Memory

### What is it, in one sentence

**Naia Memory is a local-first long-term memory layer that selectively stores, forgets, reinforces, and updates the events an agent has gone through with its user and the facts it learned from them.**

It is not just a conversation log or a vector search DB. It separates **episodic memory** (the raw conversation) from **semantic memory** (the facts extracted from it), and gives each memory an importance and a lifespan so that, as time passes, the memories that are still valid now surface first.

### How does it not forget

More precisely, Naia Memory is **not a system that forgets nothing; it is a system that forgets well so that what is needed lasts**. There are two distinct layers to this.

1. **Persistence of data:** selected memories are written to local storage rather than held in process memory, so they survive when the process or session ends.
2. **Persistence of memory:** only important utterances are stored, episodes are organized into reusable facts, and recalled memories are reinforced. Conversely, memories left unused for a long time weaken along a forgetting curve, and facts that have changed are replaced by the latest fact during reconsolidation.

So the fact "the user moved to a design company" does not just sit on disk. It is recalled for later questions about the user's job, lasts longer the more it is used, and when evidence arrives that the user changed jobs again, the old fact is pushed aside so it does not get in the way of the latest one.

### How do the main LLM, the memory LLM, embeddings, and the modules work

The main LLM and the memory LLM are not two agents talking to each other. **The main LLM is the one that answers the user**, and **the memory LLM is a narrow internal worker that organizes memories**.

```text
User utterance
   │
   ▼
naia-agent ── recall query ──▶ embedding · keyword · graph search
   │                              │
   │     relevant memory context ◀┘
   ▼
Main LLM ───────────────────────▶ answer to user
   │
   └── save conversation ──▶ importance gate ──▶ episodic memory
                                                      │
                                  memory LLM fact extraction · summarization
                                                      │
                                                      ▼
                          semantic memory · reconsolidation · local storage
```

- **Main LLM:** receives recalled memories as context, reasons, answers, and uses tools.
- **Memory LLM:** extracts atomic facts from accumulated episodes and refines summaries during context compaction. If it is not configured, the system runs in a reduced mode with heuristic fact extraction and deterministic summarization.
- **Embedding model:** turns utterances and memories into vectors so it can find memories that are close in meaning even when the wording differs. Keyword search works without embeddings.
- **Deterministic modules:** handle importance gating, BM25 · RRF · MMR rank fusion, forgetting, recall reinforcement, contradiction-candidate handling, and the storage lifecycle.
- **Storage adapter:** writes the actual memories to a store such as JSON, SQLite, or Qdrant.

If the memory LLM or the embedding provider is an external service, the input to that processing can leave the machine. If you need fully local operation, choose local models or the heuristic path.

### Where is memory stored

In the Naia product, the canonical memory lives **under `naia-settings` of the currently active ADK**. When naia-agent uses the default local adapter, the path is:

```text
<NAIA_ADK_PATH>/naia-settings/memory/store.json
```

naia-agent owns the product's local memory path; the shell or environment variables cannot redirect it to another local path. The only exception at the storage adapter boundary is an external backend such as Qdrant that the user explicitly chooses.

When the library is used on its own without naia-agent and no `storePath` is given, it uses `~/.naia/memory/naia-memory.json`. In other words, **the library's standalone fallback** and **the Naia product's ADK-owned path** are intentionally different. The Naia product host copies a verified existing workspace identity, memory store, and compiled KB into the new boundary for compatibility; if a file already exists at the new path, that file is kept as canonical. The originals are not deleted automatically, so rollback stays possible.

### How is it different from other long-term memory

The comparison below covers **only the default long-term memory layer**, not Hermes or OpenClaw as a whole.

| Criterion | Naia Memory | Hermes default memory | OpenClaw default memory |
|---|---|---|---|
| Default representation | Structured episodes, facts, and relations plus search indexes | A limited set of curated entries in `MEMORY.md` · `USER.md` | `USER.md` · `MEMORY.md` · dated Markdown logs |
| How it stores | Each turn's storage candidates are filtered by importance and kept as episodes, then consolidated into facts on the housekeeping cycle | The model adds, replaces, and deletes via a memory tool; an external provider can be attached separately | The model writes to Markdown explicitly; an optional search index is used |
| How it recalls | Each turn, a per-query hybrid search plus graph expansion, then context injection | Default files are a fixed snapshot at session start; external providers can prefetch per turn | Core files and recent logs are loaded into context, with semantic and keyword search when needed |
| Change over time | Importance gate, forgetting decay, recall reinforcement, consolidation and reconsolidation are the core lifecycle | Default files are small and explicitly curated | Centered on human-readable, editable files plus logs and cleanup jobs |
| Design focus | "What to forget and update, and when" | "How to maintain a small, explicit profile and notes" | "How to accumulate and search transparent Markdown records" |

Attaching an external memory provider plugin to Hermes can add semantic search or user modeling, so the table does not count those providers' features as native to Hermes default memory. OpenClaw is also extending its search and long-term memory promotion features, so the difference lies less in file format than in the fact that **Naia Memory makes forgetting, reinforcement, and reconsolidation the default lifecycle of its storage engine**.

Sources for the comparison: [Hermes Persistent Memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md), [Hermes file roles](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/which-file-does-what.md), [Hermes MemoryProvider contract](https://github.com/NousResearch/hermes-agent/blob/main/agent/memory_provider.py), [OpenClaw Memory overview](https://docs.openclaw.ai/concepts/memory).

### How mature is it

Right now **the core local path is integrated into the real naia-agent and working, while the large-scale storage path and the evaluation setup are still being developed**.

| Area | Current level |
|---|---|
| Episodic and semantic memory storage and recall | Implemented, with a path in operation |
| Importance gate, forgetting, recall reinforcement, consolidation and reconsolidation | Implemented |
| LocalAdapter (JSON) | Default and most complete path |
| naia-agent per-turn recall and storage, memory LLM and embedding selection | Integrated |
| Procedural memory | Early stage: success/failure tallies and corrective recall |
| Working memory | Not persisted by naia-memory; managed by the host runtime |
| SQLite large-scale path | Storage and search partly working; feature parity with LocalAdapter in progress |
| Korean long-term memory quality and large-scale latency validation | Benchmark harness exists; public reproducible results and operating criteria are still being built up |

So it is not "a proof-of-concept-only project", but it is also not yet a finished product in which every backend offers the same features or large-scale operational validation is complete.

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

**Privacy at the architecture level.** The memory itself is stored in a local file or local database that the user owns. That said, embedding, fact extraction, summarization, and contradiction judgment can call external models depending on how you configure them. When structured memory deletion is enabled, the structured values of up to 32 candidates are sent to a separate verifier endpoint, which approves and selects the exact deletion target. The API server enables this path only when `DELETE_VERIFIER_API_KEY`, a `DELETE_VERIFIER_BASE_URL` different from the extractor's, `DELETE_VERIFIER_MODEL`, and `DELETE_VERIFIER_PROVIDER` are all set explicitly; otherwise it refuses deletion (fail-closed). The library never hides which provider is used: the caller injects the provider explicitly or selects it through environment variables, so what leaves the machine is visible in the code. To keep every word of a conversation local, wire embedding, extraction, summarization, and the deletion verifier to local models and set contradiction judgment to the rule-based filter or a local vLLM.

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

Naia Memory handles **WHO memory** that builds up with the user, naia-kb-compiler handles **WHAT knowledge** with sources, and naia-persona handles repeatedly validated **HOW to behave and speak**.

| Project | What it owns | When it runs | Relation to Naia Memory |
|---|---|---|---|
| [naia-agent](https://github.com/nextain/naia-agent) | Conversation loop, main LLM, tools, context compaction | Real time | Recalls memories before each turn and puts them in the main LLM's context, then saves the conversation after the answer. As the host, it also wires the settings and execution permissions for the memory LLM, embeddings, and storage adapter. |
| **naia-memory** | Personal events, facts, relations, and their lifecycle | Real-time storage and recall, housekeeping when idle | The canonical store for dynamically changing personal long-term memory. |
| [naia-kb-compiler](https://github.com/nextain/naia-kb-compiler) | Compiles sources such as documents and URLs into a verifiable `kb.json` | Mostly offline | Not a place to store memory. It keeps stable knowledge that needs sources, citations, and promotion rules separately, and the agent fetches it when needed through the `search` · `ask` tools. |
| [naia-persona](https://github.com/nextain/naia-persona) | Learns, evaluates, and promotes tone, preferences, and behavior patterns as model adapters | Slow offline cycle | Does not train directly on raw memory. Only derived samples that pass consent, PII cleanup, deduplication, and quality checks are used as candidates, and they are promoted to a persona adapter after human approval. |
| [naia-adk](https://github.com/nextain/naia-adk) | Workspace format and ownership boundaries for settings, skills, and knowledge | Always | The owning root for product memory files. Memories live under the active ADK's `naia-settings/memory`. |
| [naia-shell](https://github.com/nextain/naia-shell) | Desktop shell and user touchpoint | Real time | Provides user input and the settings UI, but memory judgment and storage logic belong to the agent and memory. |

```text
User ↔ shell ↔ naia-agent main LLM
                    ├─ push/prefetch ↔ naia-memory       (personal dynamic memory)
                    └─ search/ask    → naia-kb-compiler  (source-based knowledge)

consented records in naia-memory ── cleanup · validation ──▶ naia-kb-compiler
                                                                │
                                                                ▼
                                                 naia-persona training candidates
                                                                │
                                                    evaluation · human approval
                                                                ▼
                                                         persona adapter
```

Memory and knowledge are not merged into one store. "The user moved to a new job today" can be recalled from naia-memory right away, while an official company policy document is managed by kb-compiler along with its source. A fact like "the user prefers concise answers" is also applied immediately through memory context first; only behavior patterns that repeat over a long period and are consented to and validated move on to naia-persona's slow training.

The maturity of each project should also be read separately. The maturity table earlier in this README describes naia-memory itself and does not vouch for the maturity of the naia-kb-compiler or naia-persona pipelines.

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

If you're reading the code for the first time, `src/memory/index.ts` (the engine) and `src/memory/provider-types.ts` (the consumer contract) give you the whole picture. How to attach it to a higher-level runtime is in the [integration guide](docs/integration.md) (Korean); the design behind the brain-inspired layout is in [cognitive architecture](docs/cognitive-architecture.md) (Korean). The full doc index is at [docs/README.md](docs/README.md) (Korean).

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

Properties like naturally occurring forgetting, contradiction detection within free-flowing speech, and procedural memory are only properly verified in an integrated setup combined with naia-agent and naia-shell. Those items are tracked in the integration benchmarks of the respective repos.

## AI-Native open source

This project treats AI context as a first-class artifact. The context files under `.agents/` are versioned alongside the code, and AI contributions are marked with an `Assisted-by:` git trailer. Memory is stored locally and owned by the user; unless you attach external models for embedding, fact extraction, summarization, or contradiction judgment, no conversation is handed to a service provider's server.

The AI context under `.agents/` and `.users/` is licensed under [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## License

Apache License 2.0 — see [LICENSE](LICENSE). Built by [Nextain](https://nextain.io), part of the Naia stack (incl. [naia-shell](https://github.com/nextain/naia-shell)).
