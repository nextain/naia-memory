# Naia Memory — Integration Guide

> naia-agent / naia-os 가 `@nextain/naia-memory` 를 사용하기 위한 인터페이스 + 필요 파라미터 명세.
>
> 본 docs 는 *통합 측 (naia-agent / naia-os)* 가 reference 로 보면서 wire-in 하는 SoT.

## TL;DR

```ts
import {
  MemorySystem,
  LocalAdapter,
  OpenAICompatEmbeddingProvider,
  buildLLMFactExtractor,
} from "@nextain/naia-memory";

const memory = new MemorySystem({
  adapter: new LocalAdapter({
    storePath: "/path/to/store.json",
    embeddingProvider: new OpenAICompatEmbeddingProvider(
      baseURL, apiKey, model, dims,
    ),
  }),
  factExtractor: buildLLMFactExtractor({ apiKey, baseURL, model }),
});

await memory.encode({ content, role: "user" }, { project: "..." });
const result = await memory.recall(query, { project, topK: 10 });
// result.facts: Fact[], result.episodes: Episode[]
```

## 0. 책임 분리

| 책임 | 누구 |
|---|---|
| 사용자 setting UI (API 키 입력, 모델 선택) | naia-agent / naia-os |
| LLM / embedding / filter 인스턴스 build | naia-agent (사용자 setting → 인스턴스) |
| Memory `encode` / `recall` / `consolidate` 호출 | naia-agent (agent loop 안에서) |
| 자연어 의도 파악 (예: \"어제\" → timestamp) | naia-agent |
| Fact 추출 / vector search / decay / KG / R2.5 | naia-memory (내부 처리) |
| Provider 인터페이스 충실 구현 | naia-memory |

naia-memory 자체는 **환경변수 안 봐야** — caller (naia-agent) 가 명시 주입.
현재 default fallback (process.env) 은 *벤치마크 편의용*, 통합 시 caller 명시 주입 권장.

## 1. Memory 만들기 — 3가지 분리 주입

```ts
const memory = new MemorySystem({
  adapter,             // 1. backend (vector store + 자체 store)
  factExtractor,       // 2. LLM fact extraction
  embeddingProvider,   // 3. recall 의 query embedding (adapter 의 옵션과 일치 필요)
  contradictionFilter, // 선택. R2.5 활용 시
});
```

### 1.1 Adapter (backend)

| Adapter | 용도 | 상태 | 의존 / import |
|---|---|---|---|
| **`LocalAdapter`** | **실제 Default**. JSON store + cosine + BM25 + KG. 데스크톱/단일 사용자, 수만 fact 까지. `MemorySystem` 이 adapter 미주입 시 자동 생성하는 경로이자 `naia-agent` 연동 경로 | **Complete** | embedding provider · `@nextain/naia-memory` export |
| `SqliteAdapter` | SQLite + R-Tree + FTS5 + vec0. 대규모(100k+) 확장 경로 | **In progress** (store / keyword recall / getAll 동작, 고급 retrieval 미완 parity) | better-sqlite3, sqlite-vec · `@nextain/naia-memory` export |
| `QdrantAdapter` | Qdrant vector DB | 동작 (embeddingProvider 필수) | qdrant client · `@nextain/naia-memory` export |
| `Mem0Adapter` | mem0 OSS backend (vector store + LLM dedup). \"stack on top\" 패턴 | **internal / benchmark-only** — `index.ts` 가 export 하지 않음 (벤치마크 `naia-on-mem0` 경로 전용). 패키지 entry 에서 import 불가 | mem0ai/oss (devDependency) |

adapter 를 명시하지 않으면 `MemorySystem` 이 `LocalAdapter` 를 자동 생성한다
(소스: `src/memory/index.ts` 생성자). SQLite 경로는 `SqliteAdapter` 를 명시
주입해 opt-in 한다.

```ts
import { LocalAdapter, SqliteAdapter } from "@nextain/naia-memory";

// 기본 경로 — adapter 생략 시 MemorySystem 이 내부적으로 이걸 만든다.
new LocalAdapter({
  storePath,                   // host 가 결정한 JSON store 경로
  embeddingProvider: embedder, // EmbeddingProvider (생략 시 keyword-only recall)
});

// 확장 경로 (in progress) — 명시 opt-in.
new SqliteAdapter({
  dbPath,                      // host 가 결정한 SQLite DB 경로
  embeddingProvider: embedder, // EmbeddingProvider (필수 권장)
});
```

### 1.2 Embedding provider (4개 옵션)

```ts
import {
  OpenAICompatEmbeddingProvider,   // Gemini / OpenAI / vLLM 호환 endpoint
  OfflineEmbeddingProvider,         // @huggingface/transformers (CPU)
  HuggingFaceEmbeddingProvider,     // HF Inference API
  NaiaGatewayEmbeddingProvider,     // Naia Vertex gateway
} from "@nextain/naia-memory";
```

#### `OpenAICompatEmbeddingProvider`

```ts
new OpenAICompatEmbeddingProvider(
  baseUrl,    // string. Gemini compat 시 \".../v1beta/openai\" / vLLM 시 \"http://localhost:8001\"
  apiKey,     // string
  model,      // string. 예: \"gemini-embedding-001\" / \"vertexai:text-embedding-004\" / \"bge-m3\"
  dims,       // number. 모델별: gemini-embedding-001=3072, text-embedding-004=768, bge-m3=1024
);
```

#### `OfflineEmbeddingProvider` (CPU, GPU 없을 때)

```ts
new OfflineEmbeddingProvider(
  \"multilingual-e5-large\"  // 또는 \"all-MiniLM-L6-v2\" / \"all-mpnet-base-v2\"
);
// dims 자동 (multilingual-e5-large=1024)
```

### 1.3 LLM fact extractor

```ts
import { buildLLMFactExtractor } from \"@nextain/naia-memory\";

const factExtractor = buildLLMFactExtractor({
  apiKey,            // string (필수)
  baseURL,           // string (선택, default 는 Gemini AI Studio 또는 GATEWAY_URL env)
  model,             // string (선택, default \"gemini-2.5-flash-lite\")
  batchSize,         // number (선택, default 10)
});
```

LLM 모델은 OpenAI-compat chat completion endpoint 면 동작 (Gemini, OpenAI, vLLM 등).

### 1.5 R4 Background brain spike subscription (선택, naia-agent 측 책임)

```ts
import type {
  SpikeEvent,
  SpikeAction,
  ActiveContext,
} from "@nextain/naia-memory";

memory.on("spike", async (event: SpikeEvent): Promise<SpikeAction | void> => {
  // naia-agent: source-monitor + pragmatic-gate 로 결정
  const source = await sourceMonitor(event, currentTurn, recent);
  if (source.relevance < 0.6) return;
  const pragmatic = await pragmaticGate(event, dialogueFlow);
  if (!pragmatic.shouldInject) return;
  return {
    decision: "inject-now",
    reason: pragmatic.reason,
    modifiedContent: pragmatic.refined,
  };
});

// 사용자 turn 처리 시 active context push
memory.setActiveContext({
  topics: ["직업", "이직"],
  recentFactIds: ["fact-id-1", "fact-id-2"],
  scope: { project: "personal" }, // 필수 — cross-project leak 방지
  optOutTopics: ["민감주제"], // 선택
});
```

SpikeEvent reason (7 종):
- `contradiction` — R2.5 supersede 시점 (구현됨)
- `high-importance-relevant` — 새 fact + active context 매칭 (구현됨)
- `recall-failure-resolved` — 사용자 query 가 자주 fail 했는데 새 fact 추출 (future)
- `temporal-anchor` — \"1년 전 오늘\" 같은 시간 anchor (future)
- `cross-domain-analogy` — KG 의 두 도메인 사이 bridging fact (future)
- `user-emotion-anniversary` — high emotion fact 의 같은 날 (future)
- `repeated-fail` — 사용자 같은 query 반복했는데 답 변경됨 (future)

책임 분리 (anchor §A08):
- naia-memory = consolidation + replay + spike emit (구현 R4 Step 1-4 완료)
- naia-agent = subscribe + source-monitor + pragmatic-gate + active context inject

### 1.4 R2.5 Contradiction filter (선택)

```ts
import { selectFilter } from \"@nextain/naia-memory\";

const filter = selectFilter({
  provider: \"heuristic\" | \"gemini\" | \"vllm\",
  apiKey,    // gemini 시
  baseURL,   // gemini / vllm 시
  model,     // 선택
});

new MemorySystem({ adapter, factExtractor, contradictionFilter: filter });
```

기본은 heuristic — LLM 없이 빠름.

## 2. 사용 API

### 2.1 encode (저장)

```ts
await memory.encode(
  {
    content: string,         // turn 의 utterance
    role: \"user\" | \"assistant\" | \"tool\",
    timestamp?: number,      // unix ms (선택)
    context?: Record<string, string>,
  },
  {
    project?: string,        // scoping (선택)
    sessionId?: string,
    activeFile?: string,
  },
);
```

### 2.2 recall (회상)

```ts
const result = await memory.recall(
  query,  // string
  {
    project?: string,
    topK?: number,           // default 20
    deepRecall?: boolean,    // true 시 episode 도 포함 (default false = fact only)
    atTimestamp?: number,    // R2.3 bi-temporal: 해당 시점 기준 회상
  },
);

result.facts: Fact[];        // [{ id, content, score, ... }]
result.episodes: Episode[];  // deepRecall=true 시
```

### 2.3 consolidate (sleep cycle)

자동: host 가 `memory.startConsolidation()` 를 호출하면 `consolidationIntervalMs`
마다 (default 30분) 실행. **생성만으로는 타이머가 돌지 않는다** — host 가 명시적으로
시작/중지(`startConsolidation()` / `stopConsolidation()`)한다.
수동: `await memory.consolidateNow(force)` — force=true 면 **5분 age gate** 무시
(에피소드가 5분 이상 묵어야 consolidate 대상; force 시 즉시 처리).

### 2.4 close

```ts
await memory.close();  // adapter cleanup
```

## 3. Capability 패턴 (graceful degradation)

`isCapable` 와 capability 인터페이스는 `@nextain/naia-memory` 본 패키지에서 import
한다 (`src/memory/provider-types.ts` 정의, `index.ts` 재-export). 별도
`@nextain/agent-types` 패키지는 아직 ship 되지 않았다.

시그니처는 **제네릭이 아니라 문자열 기반**이다 —
`isCapable(provider, capName: string): boolean`. `capName` 은 capability
인터페이스 이름을 그대로 넘긴다.

```ts
import { isCapable } from \"@nextain/naia-memory\";

if (isCapable(provider, \"TemporalCapableProvider\")) {
  // applyDecay() / recallWithHistory() 사용 가능 (R2.3 bi-temporal)
}

if (isCapable(provider, \"ReconsolidationCapableProvider\")) {
  // findContradictions() 사용 가능 (R2.5 contradiction handling)
}
```

5 capability (`provider-types.ts` 의 `CAPABILITY_METHODS` SoT):
`BackupCapableProvider` (exportBackup·importBackup), `ImportanceScoringCapable`
(scoreImportance), `ReconsolidationCapableProvider` (findContradictions),
`TemporalCapableProvider` (applyDecay·recallWithHistory),
`CompactableCapableProvider` (compact).

> ⚠️ `isCapable` 은 **`MemoryProvider` 어댑터(예: 본 패키지가 export 하는
> `LiteMemoryProvider`)** 의 메서드 유무를 확인한다. `MemorySystem` 자신은
> `MemoryProvider` 계약이 아니라 자체 `encode`/`recall`/`consolidateNow` API 를
> 노출하므로, `isCapable(memorySystem, ...)` 가 아니라 provider 인스턴스에 쓴다.

## 4. 권장 사용자 setting 항목 (naia-agent 가 UI 로 받을 것)

```yaml
memory:
  profile: \"cloud\" | \"local\" | \"custom\"

  # cloud profile (기본)
  llm:
    provider: \"gemini\" | \"openai-compat\"
    apiKey: \"\"          # 사용자 입력
    baseURL: \"auto\"     # auto = AI Studio / Vertex gateway
    model: \"gemini-2.5-flash-lite\"

  embedding:
    provider: \"gemini\" | \"vllm\" | \"offline\"
    apiKey: \"\"
    baseURL: \"auto\"
    model: \"gemini-embedding-001\"
    dims: 3072

  contradictionFilter:
    enabled: false      # default off (heuristic 만)
    provider: \"gemini\" | \"vllm\"
    apiKey: \"\"
    baseURL: \"\"
    model: \"\"

  store:
    path: \"~/.naia/memory-store.json\"
    consolidationIntervalMs: 1800000   # 30분
```

### Profile A — \"빠른 시작\" (cloud)
- LLM: Gemini 2.5 Flash Lite (Vertex gateway 또는 AI Studio)
- Embedding: gemini-embedding-001 (3072d)
- Filter: heuristic (off)
- 비용: ~$0.005 / 100 turn

### Profile B — \"local privacy\" (사용자 GPU)
- LLM: vLLM Gemma 4 E4B (port 8000, openai-compat)
- Embedding: vLLM bge-m3 또는 OfflineEmbeddingProvider(multilingual-e5-large)
- Filter: vLLM Gemma 4 E4B
- 비용: GPU 전기료만

## 5. 통합 sample (naia-agent 측)

```ts
import {
  MemorySystem,
  LocalAdapter,
  OpenAICompatEmbeddingProvider,
  OfflineEmbeddingProvider,
  buildLLMFactExtractor,
  selectFilter,
} from \"@nextain/naia-memory\";

export async function buildMemory(setting: NaiaMemorySetting) {
  // 1. Embedding
  const embedder = setting.embedding.provider === \"offline\"
    ? new OfflineEmbeddingProvider(\"multilingual-e5-large\")
    : new OpenAICompatEmbeddingProvider(
        resolveBaseURL(setting.embedding.baseURL),
        setting.embedding.apiKey,
        setting.embedding.model,
        setting.embedding.dims,
      );

  // 2. Adapter
  const adapter = new LocalAdapter({
    storePath: setting.store.path,
    embeddingProvider: embedder,
  });

  // 3. LLM fact extractor
  const factExtractor = buildLLMFactExtractor({
    apiKey: setting.llm.apiKey,
    baseURL: resolveBaseURL(setting.llm.baseURL),
    model: setting.llm.model,
  });

  // 4. Contradiction filter (선택)
  const filter = setting.contradictionFilter.enabled
    ? selectFilter({
        provider: setting.contradictionFilter.provider,
        apiKey: setting.contradictionFilter.apiKey,
        baseURL: resolveBaseURL(setting.contradictionFilter.baseURL),
        model: setting.contradictionFilter.model,
      })
    : undefined;

  return new MemorySystem({
    adapter,
    factExtractor,
    contradictionFilter: filter,
    consolidationIntervalMs: setting.store.consolidationIntervalMs,
  });
}
```

## 6. 검증

본 레포(naia-memory) 측:
- `pnpm test` (vitest) — `src/memory/__tests__/` 단위/계약 테스트
- `pnpm run test:sqlite` — SqliteAdapter 스모크 (`scripts/test-sqlite.mjs`)
- `pnpm run benchmark` — 비교 벤치 (`src/benchmark/comparison/run-comparison.ts`)
- Phase A 측정 결과 (issue #23) — 한국어 76.8% semantic recall

통합 측(naia-agent) 책임 (이 레포 스크립트 아님 — 통합 측 레포에서 실행):
- naia-agent 의 host reference 및 R2.3 bi-temporal + R2.5 filter smoke 는
  naia-agent 레포의 example / smoke 스크립트에서 검증한다.

## 7. 변경 시 주의

- `MemoryProvider` interface 의 **현재 SoT 는 본 패키지 `src/memory/provider-types.ts`**
  (`@nextain/naia-memory` 가 re-export). 별도 `@nextain/agent-types` 패키지는 아직
  ship 되지 않았다 — provider-types.ts 헤더의 `TODO`(agent-types 발행 시 re-export 로
  치환) 가 미래 계획. naia-memory 는 이 계약의 *충실 구현* 책임.
- naia-memory 자체에 setting UI / config file loader X — 통합 측 책임
- env var fallback 은 *벤치마크 편의* 용도 — production 통합 시 명시 주입 권장
