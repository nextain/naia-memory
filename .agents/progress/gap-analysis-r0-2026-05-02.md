# Gap Analysis — 현 구현체 vs Plan v1.1 Anchor

**Date**: 2026-05-02
**Subject**: 기존 코드(R5/R8/R9/R10/R14 시기) vs `plan-v3-anchor-2026-05-02.md`
**목적**: AI 가 흔들리지 않게 — gap, 모순, 자가 수정 메커니즘 점검

## 0. 조사 범위

| 영역 | 파일 |
|------|------|
| 기존 코드 (5K+ lines) | `src/memory/`, `src/server/naia-memory-api.ts`, `src/benchmark/` |
| 새 v3 drift 코드 (~600 lines) | `src/v3/` |
| 컨텍스트 문서 | `AGENTS.md`, `CLAUDE.md` (mirror), `.agents/context/*.yaml`, plan-v3-anchor |

## 1. 구현 현황 (기존 코드 인벤토리)

### 1.1 기존 구현 (R5~R14)

```
src/memory/
├─ index.ts (1181 lines)             # MemorySystem orchestrator
├─ types.ts (264 lines)              # 로컬 types (Episode, Fact, MemoryAdapter, BackupCapable)
├─ importance.ts                      # 3-axis scoring (CraniMem)
├─ decay.ts                           # Ebbinghaus
├─ reconsolidation.ts                 # 모순 감지
├─ knowledge-graph.ts                 # KG entity/relation
├─ llm-fact-extractor.ts              # episode → fact 추출
├─ context-budget.ts                  # context window allocator (P1 R14)
├─ embeddings.ts                      # EmbeddingProvider abstraction
├─ algorithms/{base,variantA,variantB}.ts   # 알고리즘 변형
├─ adapters/
│  ├─ local.ts (949 lines)            # ★ default 사용 (JSON + vector + BM25 + KG)
│  ├─ mem0.ts (500 lines)             # mem0 OSS backend (현재 미사용 라벨)
│  └─ qdrant.ts                       # Qdrant
└─ __tests__/ (7 test files)         # backup, compact, consolidation, decay, importance, memory-system, reconsolidation
src/server/
└─ naia-memory-api.ts (266 lines)            # REST server (mem0 protocol 호환)
```

### 1.2 v3 drift (이번 세션, ~600 lines)

```
src/v3/
├─ types.ts                           # 새 MemoryEngine interface (중복)
├─ index.ts
├─ orchestrator.ts                    # NaiaV3 클래스 (agent 영역 침범)
├─ pre/{ko-normalizer, importance-scorer, preprocess}.ts
├─ engine/mem0-engine.ts              # sketch only
├─ temporal/ko-time-parser.ts         # agent 영역 (자연어 의도)
├─ post/{abstention, contradiction, reranker}.ts
└─ management/api.ts
```

## 2. Gap 1: Interface 갭 (MemoryProvider)

### 2.1 현재 vs 목표

| 메서드 | naia-agent 의 MemoryProvider | 현재 MemorySystem | Gap |
|--------|----------------------------|---------------------|-----|
| `encode(input)` | `Promise<void>` | `Promise<Episode \| null>` | return type 다름 |
| `recall(query, opts)` | `Promise<MemoryHit[]>` | `Promise<Episode[]>` | shape 다름 (MemoryHit 변환 필요) |
| `consolidate()` | `Promise<ConsolidationSummary>` | `Promise<ConsolidationResult>` | shape 다름 (factsCreated, durationMs 매핑) |
| `close()` | `Promise<void>` | `Promise<void>` | OK |

**결론**: MemorySystem 이 MemoryProvider 인터페이스 implements 선언 X. 어댑팅 layer 필요.

### 2.2 권고 (R1.3 슬라이스)

```typescript
// 새 파일: src/memory/provider.ts
import type {
  MemoryProvider, MemoryInput, RecallOpts, MemoryHit, ConsolidationSummary,
  ImportanceCapable, ReconsolidationCapable, TemporalCapable,
  CompactableCapable, BackupCapable, KnowledgeGraphCapable,
} from "@nextain/agent-types";

import { MemorySystem } from "./index.js";

export class NaiaMemoryProvider
  implements MemoryProvider,
    ImportanceCapable,
    ReconsolidationCapable,
    TemporalCapable,
    CompactableCapable,
    BackupCapable,
    KnowledgeGraphCapable {

  constructor(private system: MemorySystem) {}

  async encode(input: MemoryInput) { await this.system.encode(input); }

  async recall(query: string, opts?: RecallOpts): Promise<MemoryHit[]> {
    const eps = await this.system.recall(query, opts);
    return eps.map(e => ({
      id: e.id,
      content: e.content,
      summary: e.summary,
      score: normalizeScore(e.strength),
      timestamp: e.timestamp,
      metadata: { encodingContext: e.encodingContext },
    }));
  }

  async consolidate(): Promise<ConsolidationSummary> {
    const t0 = Date.now();
    const r = await this.system.consolidate();
    return { factsCreated: r.factsCreated, durationMs: Date.now() - t0 };
  }

  async close() { await this.system.close(); }

  // Capability 구현 — MemorySystem 의 기존 함수 위임
  async scoreImportance(input) { return this.system.scoreImportance(input); }
  async findContradictions(factId) { return this.system.findContradictions(factId); }
  // TemporalCapable.recallWithHistory — 신규 구현 (R2.3)
  // CompactableCapable.compact — 이미 부분 구현, 노출만
  // BackupCapable.backup/restore — exportBackup/importBackup 매핑
  // KnowledgeGraphCapable — knowledge-graph.ts wrapper
}
```

## 3. Gap 2: Capability 인터페이스 implements 갭

| Capability | 기능 구현 | Interface implements | Gap 평가 |
|------------|:---:|:---:|:--:|
| BackupCapable | ✅ index.ts:807-836 (exportBackup/importBackup) | ❌ MemoryProvider 가 BackupCapable implements 안 함 | 노출만 필요 |
| CompactableCapable | ✅ index.ts:961+ ("shape of @nextain/agent-types") | ❌ implements 키워드 없음 | 명시적 implements 추가 |
| ImportanceCapable | ✅ importance.ts | ❌ | wrapper 필요 |
| ReconsolidationCapable | ✅ reconsolidation.ts | ❌ | wrapper 필요 |
| TemporalCapable | ⚠️ decay.ts (applyDecay 만, recallWithHistory 없음) | ❌ | recallWithHistory 신규 구현 필요 |
| KnowledgeGraphCapable | ✅ knowledge-graph.ts | ❌ | wrapper 필요 |
| EmbeddingCapable | ✅ embeddings.ts | ❌ | wrapper 필요 |
| SessionRecallCapable | ✅ index.ts (sessionRecall 메서드) | ❌ | wrapper 필요 |

**결론**: 8 capability 의 70% 가 코드로는 있음. **interface implements 선언 + 매핑 코드만** 추가하면 됨. R2 슬라이스에서 처리.

## 4. Gap 3: Server (naia-memory-api.ts) 갭

### 4.1 현재 상태

`src/server/naia-memory-api.ts` (266 lines):
- 옛 `MemoryAdapter` interface 사용 (LocalAdapter 또는 Mem0Adapter 직접)
- `MemorySystem` 객체 만들어서 사용
- REST 엔드포인트: `/memories`, `/search`, `/consolidate`, `/health`

### 4.2 v3 plan 과의 갭

| 항목 | 현재 | 목표 | Gap |
|------|------|------|------|
| Interface 노출 | 옛 MemoryAdapter | MemoryProvider | wrapper 필요 |
| Server consolidation race | ❌ `if (consolidating) return` race bug | per-user_id queue | **R1.1 P0 fix** |
| Adapter swap | env var 기반 (ADAPTER=local/mem0) | MemoryProviderConfig 스키마 | 부분 OK |

### 4.3 권고 (R1.1)

P0: server consolidation race fix. Per-user_id queue or proper Promise wait.

```typescript
// 현재 (bug):
async function ensureConsolidated() {
  if (!needsConsolidation || consolidating) return;  // ← race
  ...
}

// 수정 (Promise gate):
let consolidationPromise: Promise<void> | null = null;
async function ensureConsolidated() {
  if (!needsConsolidation) return;
  if (consolidationPromise) return consolidationPromise;  // wait existing
  consolidationPromise = (async () => {
    try {
      const r = await system.consolidateNow(true);
      needsConsolidation = false;
    } finally {
      consolidationPromise = null;
    }
  })();
  return consolidationPromise;
}
```

## 5. Gap 4: v3 drift 정리 갭

`src/v3/` 의 11 파일 처리 (plan §3.7 매핑):

| 파일 | 처리 | 새 위치 |
|------|------|---------|
| `v3/types.ts` | 삭제 | `@nextain/agent-types` 사용 |
| `v3/index.ts` | 삭제 | export 의미 없음 |
| `v3/orchestrator.ts` | 삭제 | agent 영역 침범 |
| `v3/pre/ko-normalizer.ts` | 이동 | `src/memory/ko-normalize.ts` 또는 encode 안에 통합 |
| `v3/pre/importance-scorer.ts` | 통합 | `src/memory/importance.ts` 와 중복 — 보강 후 삭제 |
| `v3/pre/preprocess.ts` | 통합 | encode 내부로 |
| `v3/engine/mem0-engine.ts` | 삭제 | `src/memory/adapters/mem0.ts` 와 중복 |
| `v3/temporal/ko-time-parser.ts` | **이전** | naia-agent 로 (자연어 의도) |
| `v3/post/reranker.ts` | 통합 | recall() 안 + context-budget.ts 와 통합 |
| `v3/post/contradiction.ts` | 통합 | `src/memory/reconsolidation.ts` 와 비교 후 통합 |
| `v3/post/abstention.ts` | **이전** | 일부는 agent (decision), 일부는 score normalize (memory) |
| `v3/management/api.ts` | **이전** | forget by query — 일부는 agent (intent), delete 는 MemoryProvider |

**작업량 추정**: R1.2 슬라이스, 1-2일.

## 6. Gap 5: 문서/컨텍스트 모순

### 6.1 AGENTS.md (535 lines) vs plan-v3-anchor — **모순 확인됨**

| AGENTS.md (구) | plan-v3-anchor (신) | 모순 여부 |
|----------------|---------------------|-----------|
| `mem0.ts` "존재하나 미사용" (line 20) | "MemoryProvider adapter 옵션, stack on top" | ⚠️ **모순** |
| "Fix: switch benchmark + production to LocalAdapter" (#12) | "mem0 KO fix 는 wrapper 안에서 회피" | ⚠️ **모순** (옛 결정) |
| "naia-local = 독자 엔진" (line 254) | "MemoryProvider impl, adapter 선택 가능" | ⚠️ **모순** |
| "12 카테고리 벤치" (R5/R8/R9/R10/R14) | "K-MemBench v2 9 카테고리" | ⚠️ **버전 다름** |
| "P0/P1/P2/P3 로드맵" (line 200+) | "R1/R2/R3/R4/R5 phases" | ⚠️ **버전 다름** |

→ **AGENTS.md 가 outdated** (R5~R14 시대). plan-v3-anchor 와 충돌.

### 6.2 CLAUDE.md == AGENTS.md (mirror)

CLAUDE.md 는 AGENTS.md 와 동일 (자동 sync). 같은 모순을 가짐.

### 6.3 `.agents/context/architecture.yaml`

R0 시점의 4-store cognitive architecture 만 기술. v3 anchor 와 직접 모순 없음 (보완 관계).

## 7. Gap 6: 자가 수정 메커니즘 (Anti-Drift)

### 7.1 현재 위험: AI 가 어디부터 읽나?

```
Session start:
  → CLAUDE.md (= AGENTS.md, outdated)  ← AI 가 먼저 읽음
  → 옛 정보 (4-store, R5~R14, mem0 미사용)
  → AI 가 "naia 자체 엔진 강화" 방향으로 작업 가능
  → architectural drift 재발 위험 ⚠️
```

### 7.2 plan-v3-anchor 는 어디 있나?

```
.agents/progress/plan-v3-anchor-2026-05-02.md  ← 새 SoT
                  ↑
                  AI 가 모르고 못 읽을 가능성
```

### 7.3 자가 수정 메커니즘 제안

**필수 fix** (R1.0 슬라이스, plan 시행 전 선행):

1. **AGENTS.md / CLAUDE.md 헤더 추가** — 본 문서가 outdated 임을 명시:
   ```markdown
   # ⚠️ STATUS: PARTIAL OUTDATED (2026-05-02)
   본 문서는 R5~R14 시대 컨텍스트. 새 v3 plan 이 SoT.
   **읽기 순서 (강제)**:
   1. `.agents/progress/plan-v3-anchor-2026-05-02.md`  ← 현 SoT
   2. `.agents/progress/decision-matrix.md`
   3. 본 AGENTS.md (참고용 — R5~R14 컨텍스트)
   ```

2. **Mandatory Reads 섹션 신설** — naia-agent 패턴:
   ```markdown
   ## Mandatory Reads (every session start)
   1. `.agents/progress/plan-v3-anchor-2026-05-02.md`
   2. `.agents/progress/decision-matrix.md`
   3. `../naia-agent/packages/types/src/memory.ts` (interface)
   ```

3. **모순 탐지 메커니즘**: 
   - `.agents/context/agents-rules.json` (있으면) 의 `forbidden_actions` 를 AI 가 자동 체크
   - PR template 에 plan §0 anchor 인용 의무
   - cross-review §Y 8 체크리스트 자동화

## 8. 모순 점검 결과

| 모순 | 위치 | 해결 |
|------|------|------|
| mem0 미사용 vs adapter 옵션 | AGENTS.md L20 vs plan §2.3 | AGENTS.md 헤더 update |
| LocalAdapter 강제 vs adapter swap | AGENTS.md L131 vs plan A03 | decision-matrix §A03 가 정답 |
| 12 카테고리 vs 9 카테고리 | AGENTS.md vs K-MemBench v2 | K-MemBench v2 가 새 표준 |
| P0/P1/P2/P3 vs R1/R2/R3/R4/R5 | AGENTS.md L137+ vs plan §4 | plan §4 가 새 표준 |
| `BackupCapable` 자체 정의 vs agent-types | types.ts vs `@nextain/agent-types` | agent-types import (R1.3) |

→ **5 개 모순 발견**. 모두 R1.0~R1.4 슬라이스에서 해결.

## 9. R1 추가 슬라이스 권고 (gap 해소)

기존 plan §4 R1 (3 슬라이스) 에 추가:

| Slice | 신규 추가 사유 |
|-------|---------------|
| **R1.0 (NEW)** | AGENTS.md outdated 헤더 + Mandatory Reads. 첫 작업 전 안티 드리프트 잠금 |
| R1.1 | server consolidation race fix (기존) |
| R1.2 | v3/ 코드 정리 (기존) |
| R1.3 | NaiaMemoryProvider wrapper 구현 (기존) |
| **R1.4 (NEW)** | AGENTS.md / CLAUDE.md 통합 — 옛 컨텍스트 archive, plan-v3-anchor 가 SoT 임을 명시 |
| **R1.5 (NEW)** | `.agents/context/agents-rules.json` 작성 — machine-readable forbidden_actions |

## 10. AI 흔들림 방지 — Self-Correction Pattern

### 10.1 AI 가 confused 할 때 "이 문서를 읽어라" 권고 트리거

| AI 의 confused 신호 | 권고 (AGENTS.md 헤더에) |
|---|---|
| "naia 자체 엔진 강화하자" 발화 | → plan §2.3 (mem0 stack on top) |
| "v3 레이어 더 만들자" | → decision-matrix §B04 (5-layer hybrid 거부) |
| "mem0 fork 해서 KO fix" | → decision-matrix §B01 (mem0 fork 금지) |
| "naia-memory 가 자연어 파싱" | → decision-matrix §B02 (자연어 의도는 agent) |
| "abstention 우리가 결정" | → decision-matrix §B03 (응답 결정은 agent) |
| "MemoryEngine 새 인터페이스" | → decision-matrix A01 (MemoryProvider 채택) |

### 10.2 PR Template 권고 (`.github/pull_request_template.md`)

```markdown
## 변경 사항
[fixes G##/D##]

## Anchor 인용 (required)
- 본 변경이 plan-v3-anchor §_ 의 어느 항목과 관련되나?
- decision-matrix §A/B/C/D 의 어느 항목 적용/추가?

## 머지 게이트 (4 모두 필수)
- [ ] 새 실행 가능 명령
- [ ] 단위 테스트 1+
- [ ] 통합 검증 1+
- [ ] CHANGELOG entry

## Cross-Review §Y 8 체크리스트 결과
- [ ] C1 인터페이스 계약 PASS
- [ ] C2 책임 경계 PASS
- [ ] C3 mem0 결합 회피 PASS
- ...
```

## 11. 결론

### 11.1 Gap 정리

| Gap | 심각도 | 해소 슬라이스 |
|-----|:---:|---|
| Interface (MemoryProvider) 갭 | HIGH | R1.3 |
| Capability implements 갭 | MED | R2 |
| Server consolidation bug | **CRITICAL** | R1.1 |
| v3 drift 코드 | HIGH | R1.2 |
| 컨텍스트 5개 모순 | **CRITICAL** | R1.0 + R1.4 |
| 자가 수정 메커니즘 부재 | HIGH | R1.0 + R1.5 |

### 11.2 R1 시작 가능 여부 — Re-evaluation

이전 cross-review #2: "R1 시작 안전" → **수정**: R1.0 (anti-drift lockdown) 먼저.

**올바른 R1 순서**:
```
R1.0 (NEW): AGENTS.md 헤더 + Mandatory Reads + plan-v3-anchor 명시
   ↓
R1.1: server consolidation race fix (P0 bug)
   ↓
R1.2: v3/ drift 정리
   ↓
R1.3: NaiaMemoryProvider wrapper
   ↓
R1.4 (NEW): AGENTS.md 통합 (옛/새 합치기, archive 처리)
   ↓
R1.5 (NEW): agents-rules.json (machine-readable forbidden)
```

### 11.3 자가 수정 메커니즘 평가

| 항목 | 현 상태 | 목표 |
|------|:---:|:---:|
| Mandatory Reads 정의 | ❌ | ✅ R1.0 |
| AGENTS.md 헤더 outdated 경고 | ❌ | ✅ R1.0 |
| decision-matrix §B 거부 항목 | ✅ | ✅ |
| PR template anchor 인용 | ❌ | ✅ R1.5 |
| cross-review 자동화 | ❌ (임시 /tmp) | ✅ R1 후 |
| agents-rules.json forbidden | ❌ | ✅ R1.5 |

→ **현재 anti-drift 메커니즘 부족**. R1.0 + R1.5 로 보강.

## 12. Cross-Review 결과 반영 (2026-05-02)

### Gemini Pro 추가 권고 — Benchmark Integrity gap

> "AGENTS.md '12 카테고리' vs K-MemBench v2 '9 카테고리' 변화 시, 기존 src/benchmark/ 코드가 새 9 카테고리와 호환되는지 분석 부재. 벤치마크 깨지면 R1 이후 개선/개악 판단 못 함."

**채택**: R1.6 슬라이스 신규 추가.

### GLM 추가 권고 — 5 추가 risk

| Risk | 처리 |
|------|------|
| 테스트 전략 변화 (wrapper 테스트) | R1.3 슬라이스 success criteria 에 wrapper 단위 테스트 명시 |
| 성능 영향 (wrapper latency) | R5.1 측정에 latency 비교 (wrapper 전후) 추가 |
| 배포 전략 | R1 후 별도 deployment-guide.md (R5 이후) |
| 의존성 관리 (@nextain/agent-types) | npm publish 지연 — file: 의존만 (plan §3.8 기존 명시됨) |
| 복잡성 증가 (8 capability + wrapper) | optional — 실제 사용되는 4-5 개만 우선 implements (R2 우선순위) |

## 13. 최종 R1 슬라이스 (cross-review 반영)

| Slice | 신규/기존 | 내용 | Success Criteria | 예상 시간 |
|-------|----------|------|---|---|
| **R1.0** | NEW | AGENTS.md outdated 헤더 + Mandatory Reads | AI 가 새 plan 먼저 읽는 환경 | 0.5일 |
| R1.1 | 기존 | server consolidation race fix | K-MemBench 27q r@50 > 0% (artifact 제거) | 1일 |
| R1.2 | 기존 | v3/ drift 정리 (12 파일 매핑) | tsc build OK + 기존 테스트 통과 | 1일 |
| R1.3 | 기존 | NaiaMemoryProvider wrapper 구현 | wrapper 단위 테스트 + LocalAdapter 가 MemoryProvider 만족 | 1.5일 |
| **R1.4** | NEW | AGENTS.md / CLAUDE.md 통합 (옛 archive) | plan-v3-anchor 가 SoT 임을 명시 | 0.5일 |
| **R1.5** | NEW | `.agents/context/agents-rules.json` 작성 | machine-readable forbidden_actions | 0.5일 |
| **R1.6** | NEW (Gemini) | 벤치마크 시스템 현행화 + 12→9 카테고리 호환 | K-MemBench v2 9 카테고리 측정 환경 valid | 1일 |

**총 R1 시간**: ~6일.

## 14. 다음 단계

1. ✅ gap analysis cross-review 통과 (2/2 PASS, 추가 권고 다 반영)
2. plan-v3-anchor 의 § R1 슬라이스 업데이트 (R1.0, R1.4, R1.5, R1.6 추가)
3. **R1.0 슬라이스 시작** — anti-drift lockdown (AGENTS.md 헤더 update)
4. R1.0 완료 후 R1.1 ~ R1.6 순차 진행

## 15. AI 흔들림 시 자가 수정 가이드 (요약)

이 섹션은 미래 세션의 AI 가 confused 했을 때 첫 참조점.

### "naia 자체 엔진 강화하자" 라는 생각이 들면
→ `decision-matrix.md` §A06 (mem0 stack on top) + plan §2.3 읽기

### "v3 레이어 더 만들자" 라는 생각이 들면
→ `decision-matrix.md` §B04 (5-layer hybrid 거부) + plan §0.2.2 읽기

### "MemoryProvider 새로 정의하자" 라는 생각이 들면
→ `decision-matrix.md` §A01 (기존 채택) + plan §0.1.2 읽기

### "mem0 fork 해서 KO fix" 라는 생각이 들면
→ `decision-matrix.md` §B01 (fork 금지) + plan §0.2.1 읽기

### "naia-memory 가 자연어 파싱" 라는 생각이 들면
→ `decision-matrix.md` §B02 (자연어는 agent) + plan §2.2 읽기

### "abstention 우리가 결정" 라는 생각이 들면
→ `decision-matrix.md` §B03 (응답 결정은 agent) + plan §2.2 읽기

**규칙**: 모든 큰 의사결정 전 위 항목 적어도 1개 인용 의무.
