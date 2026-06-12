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

## 0.5 Agent turn-loop 결선 레시피 (consumer 측 참고용)

> 헥사고날 consumer(new-naia-agent)는 자체 `MemoryPort` 뒤에 naia-memory 어댑터를
> 둔다. **고정 계약은 공개 표면 `encode` + `recall` 둘뿐** — 내부 타입 누출 없음.
> 실행 가능한 reference + round-trip 증명:
> `src/memory/__tests__/agent-turn-integration.test.ts` (LocalAdapter, 무외부의존,
> 3 pass). 거기 `AgentMemoryAdapter` 는 **예시**다 — agent 가 복사 후 자신의 정책으로
> 바꾼다.
>
> ⚠️ **아래 `topK: 5`·라벨 문자열("(기억)"/"(이전 대화)")·facts-first 순서·`join("\n")`
> 반환 형태에 더해 — _무엇을 언제 저장/주입할지_(예: 양쪽 발화 저장 여부, 요약 저장,
> 주입 시점)까지 전부 _agent 소유 정책_의 예시다 (L03 — naia-memory 가 prompt/저장
> 정책을 규정하지 않음).** agent 가 자유롭게 교체한다. naia-memory 가 고정하는 건
> `encode` / `recall`의 **시그니처(공개 표면)뿐**.

턴 루프 결선 (예시):

```ts
// ── pre-turn: 회상 → 프롬프트 주입 (형식·topK 는 agent 가 정함) ──
const { episodes, facts } = await memory.recall(userMessage, { project, topK: 5 /* 예시 */ });
const memoryBlock = [
  ...facts.map((f) => `- (기억) ${f.content}`),       // 라벨·순서 = agent 정책 예시
  ...episodes.map((e) => `- (이전 대화) ${e.content}`),
].join("\n");           // 비면 주입 생략 (cold start)
// → memoryBlock 을 system/context 에 주입하고 LLM 호출

// ── post-turn: 저장 (무엇을·언제 저장할지 = agent 정책; encode 시그니처만 고정) ──
await memory.encode({ content: userMessage,    role: "user"      }, { project, sessionId });
await memory.encode({ content: assistantReply, role: "assistant" }, { project, sessionId });
```

핸드오프 체크리스트 (agent 세션이 wire-in 시):
1. `@nextain/naia-memory` 의존 추가 (workspace 또는 빌드된 dist 참조).
2. `AgentMemoryAdapter` 예시를 참고해 agent 의 `MemoryPort` 구현 — 형식·topK·순서는 agent 가 정함.
3. `chat-turn-handler` 에 pre-turn recall(주입) / post-turn encode(저장) 결선.
4. 사용자 setting → embeddingProvider / factExtractor 주입(없으면 keyword recall 로 동작 — 위 reference 가 그 경로).
5. agent 측 통합 테스트(실 stdio) = **그 repo의 P01~P05 + 드리프트 계약** 준수해 추가 (G2 의 'agent 측 결선' 책임).

> 본 repo(naia-memory) 의 G2 책임 = **소비 가능한 표면 + 증명 + 레시피 제공**까지.
> 실제 agent 배선·실 stdio 통합 테스트는 new-naia-agent 세션이 그 repo 거버넌스 안에서 수행.

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

| Adapter | 용도 | 의존 |
|---|---|---|
| **`SqliteAdapter`** | **권장 Default**. SQLite + R-Tree + FTS5 + vec0. 대규모(1M+) 확장성 | better-sqlite3, sqlite-vec |
| `LocalAdapter` | JSON store + cosine + BM25 + KG. 소규모/개발용 | embedding provider |
| `Mem0Adapter` | mem0 OSS backend (vector store + LLM dedup). \"stack on top\" 패턴 | mem0ai/oss + embedding/llm config |
| `QdrantAdapter` | Qdrant vector DB | qdrant client |

```ts
import { SqliteAdapter } from "@nextain/naia-memory";

new SqliteAdapter({
  dbPath: "~/.naia/memory/naia-memory.db",
  embeddingProvider: ..., // EmbeddingProvider (필수 권장)
});
```

### 1.2 Embedding provider (5개 옵션)

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
    topK?: number,           // default 10
    deepRecall?: boolean,    // true 시 episode 도 포함 (default false = fact only)
    atTimestamp?: number,    // R2.3 bi-temporal: 해당 시점 기준 회상
  },
);

result.facts: Fact[];        // [{ id, content, score, ... }]
result.episodes: Episode[];  // deepRecall=true 시
```

### 2.3 consolidate (sleep cycle)

자동: `consolidationIntervalMs` 마다 (default 30분).
수동: `await memory.consolidateNow(force)` — force=true 면 1시간 age gate 무시.

### 2.4 close

```ts
await memory.close();  // adapter cleanup
```

## 3. Capability 패턴 (graceful degradation)

```ts
import { isCapable } from \"@nextain/agent-types\";

if (isCapable<TemporalCapable>(memory, \"temporal\")) {
  await memory.atTimestamp(...);  // R2.3 bi-temporal
}

if (isCapable<ReconsolidationCapable>(memory, \"reconsolidation\")) {
  // R2.5 contradiction handling 동작
}
```

8 capability: `BackupCapable`, `EmbeddingCapable`, `KnowledgeGraphCapable`,
`ImportanceCapable`, `ReconsolidationCapable`, `TemporalCapable`,
`SessionRecallCapable`, `CompactableCapable`.

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

- `naia-agent/examples/naia-memory-host.ts` (Slice 3) — 동작하는 reference
- `pnpm smoke:naia-memory` — naia-agent 측 smoke (R2.3 bi-temporal + R2.5 filter)
- Phase A 측정 결과 (issue #23) — 한국어 76.8% semantic recall

## 7. 변경 시 주의

- `MemoryProvider` interface 는 `@nextain/agent-types` 의 SoT — naia-memory 는 *충실 구현* 만
- naia-memory 자체에 setting UI / config file loader X — 통합 측 책임
- env var fallback 은 *벤치마크 편의* 용도 — production 통합 시 명시 주입 권장
