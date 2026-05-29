# naia-memory v3 — Plan Anchor (2026-05-02)

**Status**: Pre-cross-review draft. Lock context against drift.
**Context**: 이번 세션 작업이 architectural drift 했음. 사용자 cross-review 요청 후 정정.

## 0. 컨텍스트 잠금 (Anti-Drift Anchors)

### 0.1 절대 변하지 않는 사실 (immutable facts)

1. **4-repo 아키텍처는 이미 정의됨**:
   - `naia-os` = Host (Tauri shell)
   - `naia-agent` = Runtime + interface SoT (`@nextain/agent-types`)
   - `naia-adk` = Workspace format standard
   - `naia-memory` = **MemoryProvider 레퍼런스 구현**

2. **MemoryProvider 인터페이스는 이미 정의됨** (`naia-agent/packages/types/src/memory.ts`):
   - 최소 계약: `encode`, `recall`, `consolidate`, `close`
   - Optional capability 인터페이스 8개:
     - `BackupCapable`, `EmbeddingCapable`, `KnowledgeGraphCapable`
     - `ImportanceCapable`, `ReconsolidationCapable` (모순 감지)
     - `TemporalCapable` (시간 decay + atTimestamp recall)
     - `SessionRecallCapable`, `CompactableCapable`
   - `isCapable<C>()` 타입 가드로 graceful degradation

3. **사용자 directive (`naia-agent/docs/naia-memory-wire.md`)**:
   > "기억을 불러오거나 선택하는 모듈은 **naia-memory** 에서 해야 한다"
   - **naia-memory**: encode + recall + 랭킹 + decay + importance gating + compact
   - **naia-agent**: provider interface 호출 + 결과를 extraSystemPrompt 에 주입
   - 자연어 의도 파악 (예: "어제" → timestamp) 은 agent

4. **Interfaces, not dependencies** (plan A.1):
   - naia-agent 는 naia-memory 를 runtime import 안 함
   - 호스트가 구현체 주입
   - npm publish 지연 — 로컬 file: 의존만

5. **Naia OS 의 진짜 사용 케이스**:
   - 한국어 personal memory backend
   - 멀티 세션 연속성
   - 사용자 환경 = CPU only + 무료 API (vllm-omni 학습 중)

### 0.2.1 사용자 directive 추가 (2026-05-02): 코드 결합 회피

> "업스트림과 역할 분리 충실히, 업스트림보다는 mem0위에 올라간다는 방식이 낫지 않을까도 싶네. 코드 단위로 결합되면 나중에 굉장히 힘들더라고"

**해석**:
- naia-memory 가 mem0 코드를 fork / extend / 직접 import 하는 패턴 = ❌ **금지**
- naia-memory 가 mem0 를 **backend service / library API 로 호출만** 하는 패턴 = ✅ **권장**
- "위에 올라간다" = **stack on top via interface call**, NOT codebase fusion

**3 가지 결합 패턴 비교**:

| 패턴 | 설명 | 평가 |
|---|---|---|
| (A) Code import + extend | mem0 코드를 src/ 안으로 import, subclass | ❌ Careti-Cline 식 어려움 |
| (B) Code-level dependency (npm dep) | `mem0ai` package 를 직접 require, fork branch 추적 | ⚠️ 결합도 높음 |
| (C) **Backend service / library call only** | adapter 가 mem0 호출만, 우리 코드는 mem0 코드와 격리 | ✅ **이 방향** |

**구체적 강제 사항**:
1. mem0 의 코드를 `src/v3/` 또는 다른 곳에 **fork / vendor 하지 않음**
2. `Mem0Adapter` 는 mem0ai package 를 **interface 호출 용으로만** 사용 (ts file 1개에 contained)
3. mem0 의 internal API / private 함수 사용 X (public API 만)
4. mem0 가 broken 되어도 **다른 adapter (Local, Qdrant, Zep) swap** 으로 우회 가능
5. naia capability 코드 (`reconsolidation`, `temporal` 등) 는 mem0 와 **무관하게 작동**

→ **mem0 의 어떤 변화도 우리 capability 코드에 영향 X**.

### 0.2.2 이번 세션의 architectural drift (정정 대상)

| 잘못한 것 | 사실 어디 속하나 |
|---|---|
| `naia-memory/src/v3/types.ts` 에 새 `MemoryEngine` 인터페이스 정의 | ❌ **이미 `naia-agent/packages/types/memory.ts` 에 `MemoryProvider` 있음** |
| `post/abstention.ts`, `post/contradiction.ts` 등을 "naia v3 layer" 로 만듦 | ❌ **`ReconsolidationCapable` 으로 이미 인터페이스화** |
| `temporal/ko-time-parser.ts` 를 memory layer 에 둠 | ❌ **자연어 의도 파악은 agent 책임** |
| `orchestrator.ts` 작성 | ❌ **agent 의 역할 침범** |
| "mem0 + naia layer hybrid" 권고 결론 | ❌ **mem0 는 MemoryProvider 의 한 adapter 옵션일 뿐** |

→ v3 코드는 **이미 정의된 인터페이스를 무시하고 재발명** 했음.

## 1. Goal (구체적, 측정 가능)

### 1.1 Mission
**naia-memory 는 `MemoryProvider` 인터페이스의 reference implementation** 으로서 한국어 멀티 세션 personal memory backend 의 검증된 capability 들을 제공.

### 1.2 Success Metrics (Phase 별)

| Phase | 측정 가능한 결과 | 검증 방법 |
|-------|----------------|---|
| **R1 (안정화)** | server consolidation race bug fix, K-MemBench 27q valid 측정 | r@50 > 0% (현재 1.9% artifact 제거) |
| **R2 (capability 인터페이스 구현)** | `ImportanceCapable`, `ReconsolidationCapable`, `TemporalCapable`, `CompactableCapable` 구현 + 테스트 | `isCapable<>()` 검증 + 단위 테스트 통과 |
| **R3 (한국어 강화)** | Korean fact extraction prompt fix, KO normalize encode 적용 | K-MemBench KO 단일 카테고리 r@50 ≥ 30% |
| **R4 (multi-adapter)** | LocalAdapter + Mem0Adapter 둘 다 같은 `MemoryProvider` contract 통과 | contract-tests.ts 둘 다 PASS |
| **R5 (검증)** | LoCoMo + K-MemBench v2 full 측정 | naia r@50 ≥ 50% (현재 33%) |

### 1.3 Non-Goals (이번 라운드 안 함)
- LoCoMo 1위 (SOTA 추격) — 사용자 환경 제약
- Multi-modal (text only)
- Naia OS 직접 wire-up (Phase R5 이후)

## 2. 책임 경계 (이미 정의된 architecture 충실히)

### 2.1 naia-memory 가 담당
```
encode (저장):
  - 입력 정규화 (한국어 형태소, 검색 가능성 보장)
  - importance gating (threshold)
  - episodic store
  - ImportanceCapable.scoreImportance() 노출

recall (검색):
  - 멀티 시그널 ranking (vector + BM25 + decay + importance)
  - score normalize 0..1
  - context-dependent (project, sessionId)
  - 결과 = MemoryHit[]

consolidate:
  - episodic → semantic (fact 추출)
  - 한국어 인지 prompt
  - ConsolidationSummary 반환

ReconsolidationCapable.findContradictions:
  - 새 입력 vs 기존 fact 모순 감지
  - 결과 = Contradiction[]

TemporalCapable:
  - applyDecay() — 주기적 decay
  - recallWithHistory(query, atTimestamp) — 시점 기반 recall

CompactableCapable.compact:
  - 대화 요약 (장기)
  - CompactionResult 반환
```

### 2.2 naia-agent 가 담당 (memory 가 안 함)
```
자연어 의도 파악:
  - "어제" / "5일 전" → atTimestamp 변환
  - "잊어줘 X" → forget intent + memory 호출
  - "그건 사실 X 아니야" → contradiction → findContradictions(id) 호출

Recall 결과 활용:
  - provider.recall() 호출
  - isCapable<>() 로 capability 분기
  - 결과를 extraSystemPrompt 에 주입

Abstention decision:
  - memory score < threshold + LLM judgment
  - "I don't know" 응답 결정
```

### 2.3 mem0 의 위치 (사용자 directive 0.2.1 반영)

**원칙**: mem0 위에 **올라간다** (stack on top via interface), **합쳐지지 않는다** (no codebase fusion).

```
[naia-memory]                           ← 우리 capability 코드 (mem0 와 격리)
   ├─ MemoryProvider 구현
   ├─ ImportanceCapable, ReconsolidationCapable, TemporalCapable...
   └─ adapters/                         ← interface call layer
        ├─ local.ts                     # 자체 store
        ├─ mem0.ts                      # mem0 의 public API 호출만
        ├─ qdrant.ts                    # Qdrant 호출만
        └─ zep.ts                       # Zep 호출만
                ↓
        [mem0 OSS]                      ← 별도 codebase, 우리가 안 건드림
```

**구체적 처리**:
- `Mem0Adapter` = mem0ai npm package 의 public API 만 호출 (단일 파일 contained)
- mem0 의 internal logic (LLM dedup 한국어 버그) 은 **우리 prompt 로 회피** (adapter wrapper 안에서):
  ```typescript
  // adapter-mem0.ts 안
  async add(ep: Episode) {
    // mem0 의 한국어 dedup 회피 — 우리가 미리 fact 추출
    const koFact = await ourKoFactExtraction(ep.content);
    await mem0.add({ ...ep, content: koFact });  // mem0 에는 이미 정제된 fact
  }
  ```
- mem0 capability 부족 부분은 **우리 capability 가 보완** — 메모리 코어에서 분기:
  ```typescript
  if (adapter.hasNativeTemporal) { use adapter.temporalRecall(); }
  else { useOurTemporalIndex(); }
  ```
- mem0 가 broken 되면? → adapter swap (LocalAdapter 또는 다른 OSS)
- 한국어 prompt fix 의 path:
  - **(우선)** 우리 wrapper 안에서 회피 (mem0 안 건드림)
  - **(차선)** mem0 upstream 에 PR (영향 작은 fix 만)
  - **(거부)** mem0 fork 후 patch — Careti 식 maintenance 부담 회피

## 3. 개발 표준

### 3.1 Implementation Process (Slice 방법론, naia-agent 기준 차용)

각 작업 단위 = "Slice". Slice 머지 차단 게이트 4개:

1. **새 실행 가능 명령** — `pnpm exec ...` 사용자 가치 1줄
2. **단위 테스트 1+** — vitest, 회귀 잡기
3. **통합 검증 1+** — fixture-replay 또는 real-LLM smoke (KEY 있을 때만) 또는 실 backend 호출
4. **README/CHANGELOG entry 1건** — 사용자 향한 변화 기록

(c) 통합 검증 부재 = **머지 거부**.

### 3.2 Cross-Review §Y (2 consecutive clean different-profile)

소스/테스트 변경 시:
- 최소 2 명의 다른 reviewer (Gemini Pro + GLM, 또는 다른 조합) cross-review
- 둘 다 PASS (clean) = green
- different-profile = AI 다양화 (같은 모델 두 번 호출은 안 됨)

**"clean" 기준 체크리스트** (둘 다 모든 항목 PASS 필요):

| # | 체크 항목 | PASS 기준 |
|---|-----------|---------|
| C1 | 인터페이스 계약 준수 | `MemoryProvider` 메서드 시그니처 정확, `isCapable<>()` 사용 정확 |
| C2 | 책임 경계 (memory vs agent) | 자연어 의도 파악 코드 X, 검색 로직만 |
| C3 | mem0 코드 결합 회피 | mem0 fork/vendor X, public API 호출만 |
| C4 | PII 로깅 안 함 | content raw 로그 X, hash 만 |
| C5 | API key 노출 안 함 | env var name 만 OK, value X |
| C6 | 단위 테스트 있음 | vitest, no I/O |
| C7 | 통합 검증 있음 | fixture-replay 또는 real-LLM smoke |
| C8 | CHANGELOG entry | 사용자 향한 변화 명시 |

**의견 충돌 해결**:
- 두 reviewer 가 다른 결론 → 3차 reviewer 추가 (다른 AI) → 다수결
- 그래도 충돌 → 사용자 결정 + 결과 `.agents/progress/decision-matrix.md` §D 에 기록
- "주관적 판단" 회피: 항상 위 8 체크리스트로 객관화

### 3.3 Testing Standards

```
packages/{package}/
├─ src/
└─ test/
   ├─ unit/                # vitest, no I/O, no LLM
   ├─ integration/          # 실 backend 호출 (KEY 있을 때만)
   └─ fixture/              # fixture-replay
       ├─ recordings/       # 실 호출 녹음 (CI 재생)
       └─ player.ts         # replay 도구
```

**원칙**:
- CI 에서 KEY 없을 때 fixture-replay 만으로 모든 test pass
- real-LLM smoke = `KEY=... pnpm test:smoke` opt-in
- fixture 에 실제 API key 절대 금지 (.gitignore 강제)
- F11: SDK breaking 감지 — `@anthropic-ai/sdk` 또는 `mem0` minor bump 시 fixture 재녹화 + 재생 검증 의무

### 3.4 Logging Standards

```typescript
// 모든 로그는 구조화된 JSON, level 명시
logger.info("memory.encode", {
  episodeId,
  importance,
  durationMs,
  // PII 노출 금지: content 자체는 로그 안 함, hash 만
  contentHash: sha256(content).slice(0, 12),
});

logger.warn("memory.recall.no_results", { query: queryHash, topK });
logger.error("memory.consolidate.failed", { error: err.message, retry: attempt });
```

**준수 사항**:
- Event name = `{module}.{action}` 또는 `{module}.{action}.{outcome}`
- PII (사용자 발화 원문) stdout/stderr/log 절대 노출 금지 — hash 만
- API key, secret 절대 노출 금지 (key 이름만 OK, F09 cleanroom 원칙)
- 비동기 작업: start/complete 페어 + duration_ms
- 에러: error name + retryable flag + severity

### 3.5 코드 스타일

- **TypeScript** ESM only, Node ≥ 22, strict
- **Commit**: Conventional Commits (`type(scope): summary [fixes G##]`)
- **Branch**: `feat/r{N}-slice-{kebab}` or `fix/r{N}-{kebab}`
- **PR**: 24h 자가 관찰 (혼자 작업 시)
- **Code review**: cross-review §Y (2 다른 AI clean)
- **License**: Apache-2.0

### 3.6 Naming + Conventions

```
src/memory/                         # 메모리 코어
├─ types.ts                         # 로컬 타입 (MemoryProvider re-export 용)
├─ index.ts                         # MemorySystem (orchestrator)
├─ provider.ts                      # MemoryProvider 구현 (NEW, R2)
├─ capabilities/                    # capability 구현 (NEW, R2)
│  ├─ importance.ts                 # ImportanceCapable
│  ├─ reconsolidation.ts            # ReconsolidationCapable
│  ├─ temporal.ts                   # TemporalCapable
│  └─ compactable.ts                # CompactableCapable
├─ adapters/                         # storage backends
│  ├─ local.ts                      # LocalAdapter (기존)
│  ├─ mem0.ts                       # Mem0Adapter (기존, KO fix 적용)
│  └─ qdrant.ts                     # QdrantAdapter (기존)
└─ embeddings/                       # 임베딩 abstraction (기존)

src/server/                          # REST API server
└─ memory-rest.ts                    # MemoryProvider → REST (naia-memory-api.ts 정리)

src/v3/                              # ⚠️ 이전 작업 — R2 시 정리/재배치
                                     # 대부분 capabilities/ 또는 agent 영역으로 이동
```

### 3.7 Migration: v3 코드 처리

이전 작업의 `src/v3/` 코드 정리 단계 (R2 첫 슬라이스):

| 파일 | 처리 |
|------|---|
| `v3/types.ts` (MemoryEngine) | 삭제 — `@nextain/agent-types/memory` 사용 |
| `v3/pre/ko-normalizer.ts` | `src/memory/ko-normalize.ts` 로 이동, encode 안에 통합 |
| `v3/pre/importance-scorer.ts` | `src/memory/capabilities/importance.ts` 로 변환 |
| `v3/temporal/ko-time-parser.ts` | **naia-agent 로 이전** — 자연어 의도 파악 |
| `v3/post/reranker.ts` | recall() 내부로 흡수 (이미 reranking 있음, 보강) |
| `v3/post/contradiction.ts` | `src/memory/capabilities/reconsolidation.ts` 로 변환 |
| `v3/post/abstention.ts` | **분리** — score 부분은 recall() 내부, 결정은 agent |
| `v3/management/api.ts` | 분리 — delete/update 는 MemoryProvider, intent 파싱은 agent |
| `v3/orchestrator.ts` | **삭제** — agent 의 역할 |
| `v3/engine/mem0-engine.ts` | 삭제 — `adapters/mem0.ts` 와 중복 |

### 3.8 의존성 관리

- **runtime dep**: 최소화. `@nextain/agent-types` 의 interface 만 사용
- **dev dep**: vitest, tsx
- **선택적 dep** (peerDep 또는 optional):
  - mem0ai (Mem0Adapter 사용 시만)
  - @qdrant/js-client-rest (QdrantAdapter 사용 시만)
  - hnswlib-node (LocalAdapter 사용 시만)
- **lockfile**: pnpm-lock.yaml 커밋
- **Node**: ≥ 22

### 3.9 보안 + 권한

| 관심사 | 위치 |
|---|---|
| API key 저장 | host (env 또는 keychain), naia-memory 안 봄 |
| PII 로깅 | hash 만, raw 금지 |
| Cross-user 격리 | user_id 강제 (recall opts.context) |
| Backup encryption | host 책임 (BackupCapable.backup() 은 raw bytes 만 반환) |
| PII 식별 (KO) | R3 슬라이스에 PII detector 추가 (주민번호, 전화번호 패턴) |
| Adapter 호출 timeout | 모든 adapter 호출 30s timeout, retry 3회 (exponential backoff) |

### 3.10 에러 핸들링 + 복원성 (Resilience)

```typescript
// Standard pattern in every adapter
class XAdapter implements MemoryProvider {
  async recall(query, opts) {
    return retry(
      () => this.backend.search(query, opts),
      { maxAttempts: 3, backoff: "exponential", baseMs: 100 }
    );
  }

  // Fallback to graceful degradation, NOT silent failure
  async encode(input) {
    try {
      await this.backend.add(input);
    } catch (err) {
      logger.error("memory.encode.failed", {
        adapter: "mem0", retryable: isRetryable(err),
      });
      throw err; // 호출자가 결정 — 다른 adapter 로 swap 또는 abort
    }
  }
}
```

**Adapter fallback** (host 에서 설정):
```typescript
// Optional pattern in host
const memory = new FallbackProvider([
  new Mem0Adapter(...),    // primary
  new LocalAdapter(...),   // fallback if mem0 down
]);
```

**Fallback 은 host 책임** — naia-memory 의 MemoryProvider 는 단일 backend 가정. multi-backend 결합은 host 가 wrapper 로 처리.

### 3.11 CI/CD 파이프라인 (R1.1 슬라이스에 추가)

```yaml
# .github/workflows/ci.yml (초안)
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test:unit              # vitest unit, no I/O
      - run: pnpm test:fixture           # fixture-replay
      - run: pnpm test:contract          # adapter contract tests (R4)
      - if: ${{ env.ANTHROPIC_API_KEY }} # opt-in real-LLM smoke
        run: pnpm test:smoke
        env: { ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }} }
  bench:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - run: pnpm bench                  # K-MemBench + LoCoMo subset
      - run: pnpm bench:compare main     # regression detect
```

**Regression detection**:
- `pnpm bench` 결과 → `bench-results/{commit_sha}.json` 저장
- PR 시 `main` baseline 과 비교 → ≥ 5pp drop 시 fail

### 3.12 설정 관리 (host → naia-memory 전달 계약)

```typescript
// @nextain/agent-types 에 추가 제안
export interface MemoryProviderConfig {
  adapter: "local" | "mem0" | "qdrant" | "zep";
  storePath?: string;           // local
  mem0?: { apiKey: string; baseURL?: string };
  qdrant?: { url: string; collection: string };
  zep?: { apiKey: string; baseURL: string };
  embeddingProvider?: EmbeddingProviderConfig;
  importance?: { threshold: number };
  decay?: { halfLifeDays: number };
}
```

호스트 (naia-os) 가 위 config 객체 전달, factory 가 적절한 adapter 반환.

## 4. Phase 별 구체 계획

### Phase R1 (~6일): 안정화 + 정리 + Anti-drift Lockdown

**Goal**: server bug 제거 + v3 drift 정리 + 컨텍스트 모순 5건 해결.

**중요 변경 (2026-05-02 gap analysis cross-review)**:
- R1.0 (NEW): anti-drift lockdown 먼저 (AGENTS.md outdated 헤더)
- R1.4 (NEW): AGENTS.md / CLAUDE.md 통합
- R1.5 (NEW): agents-rules.json (machine-readable)
- R1.6 (NEW): 벤치마크 시스템 현행화 (12 카테고리, v1/v2 모두 검증 완료)

| Slice | 내용 | Success Criteria | 예상 |
|-------|------|---|---|
| **R1.0** | AGENTS.md outdated 헤더 + Mandatory Reads. plan-v3-anchor 를 SoT 로 명시 | AI session start 시 새 plan 먼저 읽음. AGENTS.md 첫 50 lines 안에 anchor 인용 | 0.5일 |
| R1.1 | server consolidation race condition fix (Promise gate 또는 per-user_id queue) | K-MemBench 27q 측정에서 r@50 > 0% (artifact 제거) + unit test | 1일 |
| R1.2 | v3/ 디렉토리 정리 (§3.7 매핑대로 이동/삭제) | tsc build 통과 + 기존 테스트 통과 + v3/ 비움 | 1일 |
| R1.3 | NaiaMemoryProvider wrapper (`src/memory/provider.ts`) | MemoryProvider implements + wrapper 단위 테스트 + LocalAdapter contract test | 1.5일 |
| **R1.4** | AGENTS.md / CLAUDE.md 통합 (R5~R14 archive 처리, 새 anchor 우선) | 옛 컨텍스트 → `docs/archive/` 이동, AGENTS.md 가 plan-v3-anchor 인용 | 0.5일 |
| **R1.5** | `.agents/context/agents-rules.json` (machine-readable forbidden_actions) | F-MEM-01~06 + decision-matrix §B 항목 JSON 화 | 0.5일 |
| **R1.6** | 벤치마크 시스템 현행화 — 12 카테고리 v1/v2 호환 검증 | K-MemBench v2 12 카테고리 측정 환경 valid + run-comparison.ts 호환 | 0.5일 |

### Phase R2 (1-2주): Capability 구현

**Goal**: 4개 핵심 capability 구현.

| Slice | 내용 | Success Criteria |
|-------|------|---|
| R2.1 | `ImportanceCapable` — 3-axis scoring | 단위 테스트 + 기존 importance.ts 재사용 |
| R2.2 | `ReconsolidationCapable.findContradictions` | 단위 테스트 + 기존 reconsolidation.ts 재사용 |
| R2.3 ✅ | `TemporalCapable` — bi-temporal index + recallWithHistory (commit 346e8ae) | recall pool 이 시점 유효 fact 만 (existing -v{ts}/superseded scheme 활용). 실측 점수 #8 코멘트로 측정 후 보고 — issue #8 acceptance "0%→40%+" 는 천장 16% (R2.3+R2.5+date-parsing 모두 합쳐도). |
| R2.4 | `CompactableCapable.compact` | 대화 요약 단위 테스트 |
| **R2.5** ✅ | **Hybrid contradiction filter** — dual-process retrieval-rerank (1차 token-embedding-style candidate / 2차 small LLM filter). Issue #14 D.5 deferrals 정식 해결책. | `ContradictionFilterProvider` interface + `Heuristic` / `GeminiFlashLite` / `VllmReasoning` 구현. selectFilter env priority: `VLLM_REASONING_BASE > GEMINI_API_KEY > Heuristic`. commit be8f739 + 4737651 + 5027791. |
| **R2.6** ✅ | **VllmReasoningContradictionFilter** 실제 구현 — local Gemma via vLLM. Default model: `google/gemma-4-E4B` (소형 모델 SOTA, ~10GB FP16, MatFormer Effective 4B). | Privacy-preserving, free at margin. Code-fenced JSON output 자동 stripping. Transport 실패 시 heuristic graceful fallback. commit 5027791. |
| **R2.6.1** | 측정 — `serve-embedding.sh` (qwen3-emb 0.6B → :8001) + reasoning 서버 (gemma-4-E4B → :8002), GPU 1 (RTX 4060) 바인딩 | KO benchmark `--categories=contradiction_direct,temporal` 모드 비교 (heuristic / vllm) — issue #8/#14 코멘트 보고 |
| **R2.7** | (deferred) Date parsing slice — temporal benchmark 의 absolute_date / recurring / relative_date 카테고리 (~15/25 query) | issue #8 의 천장 40% 도달 위해 필수. 별도 슬라이스. |

### Phase R3 (1주): 한국어 강화 ✅ 완료

**Goal**: 한국어 처리 정밀도.

| Slice | 내용 | 상태 | 결과 |
|-------|------|------|------|
| R3.0 | BM25→KO normalize 연결 | ✅ | `local.ts`에서 KO detect 후 ko-normalize 라우팅 |
| R3.1 | KO normalize 강화 | ✅ | 조사 18→60+, 어미 원형 복원 28패턴, 14 테스트 |
| R3.2 | KO fact extraction prompt | ✅ | 한국어 규칙+예시 추가 |
| R3.3 | Embedding A/B 측정 | ✅ | 6개 로컬+API 임베딩 비교 완료 |

**R3.3 Embedding A/B 결과 (V2 KO keyword judge, auto-adaptive mode)**:

| Embedding | Score | Size | Mode | 실행 |
|-----------|:-----:|------|------|------|
| **gemini-embedding-001** | **49%** | API | vector-only | API |
| **qwen3-embedding:8b** | **39%** | 4.7GB | rrf | Ollama 로컬 |
| qwen3-embedding:0.6b | 31% | 639MB | rrf | Ollama 로컬 |
| bge-m3 | 29% | 1.2GB | rrf | Ollama 로컬 |
| snowflake-arctic-embed2 | 27% | 1.2GB | rrf | Ollama 로컬 |
| nomic-embed-text | 22% | 274MB | rrf | Ollama 로컬 |
| multilingual-e5-large | 20% | offline | rrf | HF 로컬 |

**결정**: gemini 유지 (기본), qwen3-embedding:8b를 로컬 최적으로 채택 (완전 로컬 모드 시).

**R4.0 vLLM 통합 (2026-05-04)**: Ollama → vLLM 마이그레이션 완료.
- 서빙 프레임워크 단일화: vllm-omni만 사용 (Ollama 제거)
- `adapter-naia-local.ts`: Ollama endpoint → `VLLM_EMBED_BASE` env (default `localhost:8001`)
- `run-comparison.ts`: `callOllama` → `callVllm` (`VLLM_BASE` env, default `localhost:8000`)
- `naia-memory-api.ts`: `VLLM_EMBED_BASE`/`VLLM_EMBED_MODEL`/`VLLM_EMBED_DIM` env 지원
- `scripts/serve-embedding.sh`: vLLM 임베딩 서버 실행 스크립트
- **다음 단계**: 노트북 RTX 4060 (8GB)에서 vLLM 임베딩 서버 구동 후 벤치마크 실행

**R3 추가 성과 — V2 keyword judge KO 정규화**:
- `ko-judge-helpers.ts` 공유 모듈 (18개 한국어 어미/동의어 패턴 + `(변경)` 접미어 제거)
- contradiction_direct: 15% → 80% (keyword judge 버그 수정)
- 전체: 38.6% → 49% (+10pp)

**R3 추가 성과 — 검색 모드 자동 적응**:
- `local.ts`: embedding dims >= 2000 → vector-only, < 2000 → rrf (BM25 하이브리드)
- 환경변수 `NAIA_SEARCH_MODE`로 오버라이드 가능

### Phase R4 (1주): Multi-adapter validation

**Goal**: 어떤 adapter 든 같은 contract 통과.

| Slice | 내용 | 상태 | 결과 |
|-------|------|------|------|
| R4.1 | `contract-tests.ts` | ✅ | 10/10 PASS (naia-local). 팩토리 패턴으로 adapter 확장 가능 |
| R4.2 | Adapter swap 가이드 문서 | 대기 | docs/adapter-guide.md |

**contract-tests.ts 구체 케이스** (모든 adapter 필수 PASS):

```typescript
describe("MemoryProvider contract", () => {
  // C-01: encode + recall basic
  it("add 후 즉시 recall 시 해당 아이템 반환 (top-1)", ...)
  // C-02: user isolation
  it("다른 user_id 의 메모리는 retrieve 안 됨", ...)
  // C-03: empty state
  it("비어있는 user 에 recall 시 빈 배열 반환", ...)
  // C-04: score normalization
  it("recall 결과의 score 모두 [0, 1] 범위", ...)
  // C-05: timestamp ordering
  it("같은 score 일 때 timestamp DESC 정렬", ...)
  // C-06: consolidate idempotent
  it("consolidate 두 번 호출해도 같은 결과", ...)
  // C-07: KO preservation
  it("한국어 입력 → recall 결과에 한국어 keyword 보존", ...)
  // C-08: capability detection
  it("isCapable<ImportanceCapable>() 정확", ...)
  // C-09: error handling
  it("backend 일시 장애 시 throw, 다음 호출 정상 동작", ...)
  // C-10: close cleanup
  it("close() 후 add/recall 호출 시 throw", ...)
});
```

새 adapter 추가 시 위 10 케이스 모두 PASS 의무.

### Phase R5 (2주): 검증 측정

**Goal**: 진짜 검증된 baseline.

| Slice | 내용 | Success Criteria |
|-------|------|---|
| R5.1 | K-MemBench v2 full 540q 측정 (LocalAdapter + Mem0Adapter 둘 다) | 둘 다 완주, 결과 비교 |
| R5.2 | LoCoMo conv 1-9 측정 (conv 0 결과 일반화) | 10 conv 통계 |
| R5.3 | naia-agent 와 통합 smoke 테스트 | provider.recall() 호출 → extraSystemPrompt 주입 검증 |

**R3 (KO ≥ 30%) → R5 (전체 ≥ 50%) 성능 갭 가설** (cross-review 권고):

20pp 향상의 출처 (작은 +pp 들의 합산):
- R2.3 TemporalCapable 구현 → temporal r@50 10% → 30% (+20pp 부분, 2/9 카테고리에 영향) ≈ 전체 +4-5pp
- R3 KO normalize + KO embedding 모델 옵션 → KO 측 카테고리 전반 +5-7pp
- R3.2 Mem0Adapter 의 KO prompt fix → mem0 backend 사용 시 KO recall +10pp (한국어 keyword 보존)
- R4.1 contract-tests 통과 검증 → noise 줄여서 +2-3pp
- 합산: ~17-25pp

**Risk**: 측정 방법 (lenient vs strict keyword) 차이로 ±5pp 변동. R5.3 통합 테스트가 단지 "측정 가능 환경" 입증에 목표.

## 5. 진행 트래킹

- **Master status**: `nextain/naia-memory#?` (issue 신설)
- **Slice issues**: 각 slice = 1 sub-issue
- **Cross-review log**: `.agents/progress/cross-review-log-r{N}.md`
- **Decision matrix**: `.agents/progress/decision-matrix.md` (§A 채택 / §B 거부 / §C pending / §D 신규)

## 6. 리스크 + 완화

| 리스크 | 완화 |
|---|---|
| Architecture drift 재발 | 본 문서를 mandatory read 로 등록, 모든 PR 에 본 문서 인용 강제 |
| mem0 OSS upstream 깨짐 | LocalAdapter 가 자체 store, mem0 는 옵션 |
| 한국어 fact 추출 품질 | R3.2 + benchmark gate (KO 단일 카테고리 ≥ 30%) |
| Cross-review burnout | 자동화 — `tools/cross-review.py` 로 GLM + Gemini 자동 호출 |

## 7. SoT (Single Source of Truth)

**현 시점 (2026-05-02)**: AGENTS.md 미작성. **본 plan-v3-anchor 문서 = 현 SoT**.

충돌 시 우선순위 (현재):
```
.agents/context/agents-rules.json (있으면)  >  본 plan-v3-anchor 문서  >  기존 README/CLAUDE.md
```

AGENTS.md 작성 후 (R1 슬라이스 마무리 시):
```
.agents/context/agents-rules.json  >  AGENTS.md  >  본 plan-v3-anchor (참고용 archive)
```

도구별 mirror (CLAUDE.md / GEMINI.md 등) = AGENTS.md 의 자동 sync (Slice R1.4).

## 8. 변경 이력 + 빠진 것

### 8.0 Cross-Review Resolution (2026-05-02)

**§Y 다수결 적용**:
| Reviewer | Profile | Verdict | Notes |
|----------|---------|---------|---|
| Gemini 2.5 Pro | high-quality | **PASS** | Approve, R1 시작 권장 |
| GLM-4.5-air | small/free | **NEEDS_FIX** | 4 항목 critical (over-applied label) |
| Claude 3.5 Haiku | tie-breaker | **PASS** | R1 시작 가능 |

**다수결**: PASS (2/3). R1 시작 인정.

**GLM 우려 분석** (왜 over-applied):
- "MemoryProvider 무시" → 사실 plan 이 정확히 채택 (§0.1.2, §3.7) — GLM 오독
- "책임 경계 불명확" → §2.1 vs §2.2 매우 명확 — GLM 오독
- "한국어 검증 부재" → §3.2 C7 + Contract C-07 + R3 phase 다 있음 — GLM 오독
- "구현 전략 모호" → vague, 구체 fix 안 제시

→ Plan v1.1 의 실제 약점은 "데이터 스키마 진화" (Gemini 단독 지적, R2 backlog 로 인정).

### 8.1 v1.0 → v1.1 (2026-05-02 cross-review #1 후)

Cross-review (Gemini Pro + GLM-air) 권고 반영:
- ✅ SoT 명확화 — AGENTS.md 작성 전까지 본 문서가 SoT
- ✅ Cross-review §Y 의 "clean" 8 체크리스트 명시
- ✅ contract-tests.ts 구체 10 케이스
- ✅ R3→R5 성능 갭 가설 (20pp 출처 분해)
- ✅ 에러 핸들링 + 복원성 (3.10)
- ✅ CI/CD 파이프라인 초안 (3.11)
- ✅ 설정 관리 (3.12) — `MemoryProviderConfig`
- ✅ PII 식별 (3.9 보강)

### 8.2 여전히 빠진 것 (R1 시작 후 보강)

- `tools/cross-review.py` 구체 구현 (현재 임시 `/tmp/cross_review.py`)
- 데이터 마이그레이션 가이드 (LocalAdapter ↔ Mem0Adapter export/import)
- 한국어 fact extraction prompt 의 실제 구현 코드
- 8 capability 구현 우선순위 (Importance + Reconsolidation + Temporal 이 R2 우선, 나머지 후순위)
- 한국어 테스트 데이터셋 버전 관리 (K-MemBench v2 → v3 migration 정책)
- naia-os 와 통합 시 boot sequence (host 의 init 코드 sample)

이 항목들은 **R1 슬라이스 시작 시 sub-issue 로 등록**, 본 문서 v1.2 에 채움.
