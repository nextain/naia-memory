# Naia Memory — Project Index

> Mirror of `.agents/context/project-index.yaml` (human-readable)

- **Repo**: [nextain/naia-memory](https://github.com/nextain/naia-memory)
- **License**: Apache-2.0
- **Parent**: [nextain/naia-os](https://github.com/nextain/naia-os)

## Directory Structure / 디렉토리 구조

| Path | Description |
|------|-------------|
| `src/memory/` | Core memory system (MemorySystem, adapters, types) |
| `src/benchmark/` | Benchmark runner + comparison adapters |
| `docs/reports/` | Generated benchmark reports |
| `.agents/context/` | AI-optimized context (English, YAML/JSON) |
| `.users/context/` | Human-readable mirror (this directory) |

## Adapters

| ID | File | Description |
|----|------|-------------|
| `naia` | adapter-naia.ts | Naia Memory — this project |
| `mem0` | adapter-mem0.ts | mem0 OSS — vector search + LLM dedup |
| `sillytavern` | adapter-sillytavern.ts | SillyTavern — vectra + transformers.js |
| `letta` | adapter-letta.ts | Letta (formerly MemGPT) |
| `zep` | adapter-zep.ts | Zep CE |
| `openclaw` | adapter-openclaw.ts | OpenClaw |
| `sap` | adapter-sap.ts | Super Agent Party — mem0 + FAISS/ChromaDB |
| `jikime-mem` | adapter-jikime-mem.ts | Jikime Memory |
| `no-memory` | adapter-no-memory.ts | Baseline — no memory system |
