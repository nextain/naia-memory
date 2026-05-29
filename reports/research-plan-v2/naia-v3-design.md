# Naia Memory v3 — Architecture Design (Data-Driven, 2026-05-01)

**Trigger**: K-MemBench v2 cross-review (GLM + Gemini Flash) + LoCoMo pattern analysis + 사용자 use case ("multi-turn conversational continuity for Naia OS").

**Input data**:
- LoCoMo recall@50 32.7% / @200 61.9% (naia LocalAdapter)
- mem0 platform recall@50 82.7% / @200 91.6%
- Critical gaps: temporal -76pp, ranking -50pp at top-50
- naia 차별점: abstention 90% (R8 v2), contradiction handling

## Design Philosophy

### Reject (이전 plan 의 잘못된 framing)
- ❌ "LoCoMo SOTA parity" 목표
- ❌ "naia 자체 retrieval 인프라 완성"
- ❌ "mem0 OSS 완전 의존" — Franken-stack 위험
- ❌ "신경망 다 갈아엎기"

### Embrace (data + cross-review 합산)
- ✅ **mem0 OSS = retrieval engine** (검증된 80%+ retrieval 능력)
- ✅ **naia layer = stateless guardrail/reranker** (clean interface)
- ✅ **차별점 보존**: abstention/contradiction/multilingual KO/importance gating
- ✅ **temporal subsystem 신규** — Zep 식 bi-temporal KG (가장 큰 -76pp gap fix)
- ✅ **Naia OS UX 통합** = 진짜 ground truth (Gemini peer review)

## Architecture (5 layer, stateless)

```
Application Layer (Naia OS)
       ↓ POST /memories, /search
naia-memory-api server (Express, port 9876, REST 기존 유지)
       ↓
─────────────── Naia v3 Core ───────────────
  1. Naia Pre-Processing (stateless)
     - Importance scoring (3-axis)
     - KO normalization (konlpy)
     - Encoding context tagging
       ↓
  2. Mem0 OSS Engine (stateless storage/retrieve)
     - Voyage embedding (free 200M tokens)
     - In-memory vector store
     - GLM-4.5 fact extraction
       ↓ top-K candidates
  3. Temporal Subsystem (NEW — Zep-style)
     - bi-temporal index (event-time / sys-time)
     - reference_date resolution ("어제", "지난주")
     - merge with mem0 candidates
       ↓
  4. Naia Post-Processing (stateless reranker)
     - Multi-signal rerank (importance × strength × decay × temporal proximity)
     - Contradiction detection (status active 만)
     - Privacy filter (PII detection)
       ↓
  5. Abstention Decision (LLM-judged)
     - top score < threshold → "I don't know"
```

## Component Detail

### 1. Pre-Processing (stateless)
- Input: episode text + encoding context
- Naia layer:
  - Importance scoring (3-axis: importance × surprise × emotion)
  - KO normalization (konlpy 형태소 분석)
  - Tag enrichment (entity 추출)
- Output: enriched episode → mem0 add()

### 2. Mem0 OSS Engine (stateless)
- 기존 `Mem0Adapter` 활용 (이미 patch 완료)
- 기능: vector store + embedding + LLM fact extraction
- 사용자만, modification X
- Interface: `add()`, `search() → [{memory, score}]`

### 3. Temporal Subsystem (NEW)
- 별도 index — bi-temporal: (event_time, system_time)
- timestamp 정규화 (Unix s vs ms 자동 감지)
- "어제" / "지난 주" / "오늘 아침" → reference_date 기반 datetime 변환
- Search 시 temporal query detection → temporal index prefilter, mem0 candidates 와 merge

### 4. Post-Processing Reranker (stateless)
- mem0 candidates (top-200) → Naia signal rerank → top-K
- Signals: mem0 score, importance (3-axis), strength (Ebbinghaus), temporal proximity, status filter
- Output: top-K reranked + naia metadata

### 5. Abstention Decision
- top-K max score < threshold → abstain
- LLM judge: "이 메모리들로 답할 수 있는가?"
- Output: `{ should_abstain: bool, refusal_message?: string }`

## Interface Contract (Franken-stack mitigation)

```typescript
type Pre = (episode: Episode) => EnrichedEpisode;
interface Engine {
  add(e: EnrichedEpisode, userId: string): Promise<void>;
  search(query: string, userId: string, k: number): Promise<Candidate[]>;
}
type TemporalEnrich = (query: string, refDate: Date, candidates: Candidate[]) => Candidate[];
type Rerank = (query: string, candidates: Candidate[], signals: Signal[]) => RankedMemory[];
type AbstentionCheck = (query: string, ranked: RankedMemory[]) => { abstain: boolean; reason?: string };
```

각 함수는 input 만 받고 output 만 반환. **side-effect 분리 = clean Franken 회피**.

## Capability vs Policy Score (K-MemBench v2 alignment)

| Capability (mem0 backbone) | Policy (naia layer) |
|---|---|
| single_hop_recall | abstention |
| multi_session_callback | contradiction_handling |
| entity_resolution | privacy filter |
| temporal_ko (NEW) | preference_application |

→ Capability 영역 = mem0 점수 ±5pp (engine 동일)
→ Policy 영역 = naia 우위 보존 (Naia OS use case 의 진짜 가치)

## 예상 점수 (data-driven 추정)

| Metric | naia (LocalAdapter) | mem0 OSS+CPU (실측 2026-05-02) | mem0 platform |
|---|---:|---:|---:|
| LoCoMo recall@50 | 32.7% | **34.7%** | 82.7% |
| LoCoMo recall@200 | 61.9% | 46.7% | 91.6% |
| Temporal recall@50 | 10.0% | 10.8% | 86.3% |
| Open-domain recall@50 | 29.2% | **0.0%** ⚠️ | 70.8% |
| Single-hop recall@50 | 42.8% | 55.7% | 82.8% |
| Abstention (R8 v2) | 90% | 측정 안 함 | 측정 X |

**실측 결과 (conv 0, 152 q, 2026-05-02 02:21 완료)**:
- mem0 OSS + CPU embedding (Xenova/paraphrase-multilingual-MiniLM-L12-v2 384d) + GLM-4.5 fact extraction
- 8h22m ingest + 40s predict, 2 chunks 손실 (0.48%), 27 transient retries
- **결론**: mem0 OSS+CPU = LocalAdapter 와 비슷한 성능 (top-50). Voyage 같은 production embedding 없이는 mem0 platform 수준 도달 X.
- **embedding 이 retrieval 의 bottleneck** — Xenova MiniLM 384d ≪ Voyage 1024d/3072d (-48pp gap @top-50 vs platform)

## Cost-aware 결정 (사용자 환경 제약)

- **GPU + RAM**: vllm-omni 학습으로 풀 사용 → CPU only embedding 불가피
- **유료 API 거부**: OpenAI / Voyage 결제 X → 무료 / OSS embedding 만
- **이 제약 하에서의 raw recall 천장**: ~50% (실측)
- **Implication**: Naia OS 의 personal memory 사용자 환경 = 정확히 이 제약. **현실적 목표 = 사용성**, not LoCoMo SOTA.

## Implementation Plan

### Phase 1 (1주): Mem0Adapter activation + naia stateless layer
- 현재 patch 활용 (이미 build OK)
- Voyage 결제 등록 (사용자 5분, 사용 0원)
- LocalAdapter → Mem0Adapter 전환
- naia post-processing 분리 (Reranker / Abstention 모듈)

### Phase 2 (1-2주): Temporal subsystem
- bi-temporal index 설계 (in-memory KV + timestamp range)
- "어제" "지난 주" parser (KO 시간)
- Search pipeline 통합

### Phase 3 (2-3주): K-MemBench v2 측정
- AI Hub 71630 data (사용자 신청 후 1-3일)
- 5 systems × 7 categories × CRS metric
- naia v3 + mem0 OSS + Letta + Zep + SuperLocalMemory 비교

### Phase 4 (지속): Naia OS dogfooding
- 실 사용자 testing
- 진짜 ground truth (Gemini peer review #1)
- "Memory is feature, not product" 검증

## Risk + Mitigation

| Risk | Mitigation |
|---|---|
| Franken-stack | Stateless function 분리 — 각 layer input/output 만 |
| mem0 OSS breaking change | semver pinning + 자체 Mem0Adapter wrapper |
| Temporal subsystem 복잡도 | Phase 2 별도 → 통합 점진적 |
| K-MemBench sample size | LoCoMo 도 병행 (sanity check) |
| Naia OS 통합 전 측정만 결론 위험 | Phase 4 dogfooding 진짜 검증 |

## Open Questions

1. Voyage dim: 512 (lite, free) vs 1024 (voyage-3)?
2. Temporal index 위치: naia layer or mem0 metadata?
3. Abstention threshold tuning?
4. KO 형태소 분석기: konlpy vs khaiii?

---

## K-MemBench v2 1차 cross-review 반영 (2026-05-02)

### 추가 권고 (둘 다 동의)

1. **Capability / Policy 아키텍처 공식화** — naia v3 도 코드 레벨에서 두 모듈 분리:
   - `lib/capability/` : retrieval engine (mem0 OSS+CPU 또는 직접 구현)
   - `lib/policy/` : reranker, contradiction detector, abstention judge, edit/forget handler

2. **능동적 contradiction detection 모듈** (proactive):
   - 새 정보 입력 시 기존 메모리와 모순 즉시 탐지
   - flag 후 metadata 에 conflict 표시 → 검색 시 양쪽 다 retrieve

3. **Memory management API**:
   - `add(content, metadata)` — 기존
   - `delete(fact_id)` — naia OS 사용자 프라이버시 제어
   - `update(fact_id, new_content)` — 사실 수정
   - `forget(query_pattern)` — query-based forget (synthetic forget command 처리)

4. **Confidence-based storage**:
   - 발화의 fact-likelihood × importance 추론
   - threshold 미만은 working memory 만 (long-term 저장 X) → memory 오염 방지

### 보류 (out-of-scope for v3)

- Multi-modal integration (text-only 유지)
- Real-time learning loop (static persona features 유지)
- Long-range (10+ sessions) — K-MemBench v2 데이터 한계

## Final v3 Module Layout

```
src/v3/
├─ pre/
│  ├─ ko-normalizer.ts      # 형태소 분석 (konlpy 한국어 wrapper)
│  ├─ importance-scorer.ts  # 3-axis (importance × surprise × emotion)
│  └─ encoding-context.ts   # tag enrichment
├─ engine/
│  ├─ mem0-adapter.ts       # 기존 Mem0Adapter 재활용
│  └─ types.ts              # Engine interface (stateless add/search)
├─ temporal/
│  ├─ bi-temporal-index.ts  # event-time + system-time map
│  ├─ ko-time-parser.ts     # "어제", "지난주" → datetime
│  └─ merge.ts              # candidates + temporal candidates
├─ post/
│  ├─ reranker.ts           # multi-signal rerank
│  ├─ contradiction.ts      # conflict detection (active flag)
│  ├─ abstention.ts         # threshold + LLM judge
│  └─ privacy.ts            # PII filter
├─ management/
│  ├─ delete.ts             # fact_id-based delete
│  ├─ update.ts             # status transition (active → superseded)
│  └─ forget.ts             # query-pattern forget (synthetic 처리)
└─ orchestrator.ts          # 5-layer pipeline composition (stateless)
```

## 5차 계획 (구현 → 측정 → 보고)

| Phase | Output | Cross-review |
|-------|--------|---|
| 0. Design (DONE) | naia-v3-design.md | ✅ 1차 review 반영 |
| 1. K-MemBench v2 baseline 측정 | reports/k-membench-v2/baseline.md | ✅ 2차 review (queries) |
| 2. naia v3 구현 | src/v3/ 5 layers | 4차 review (code) |
| 3. naia v3 검증 측정 | reports/naia-v3/verification.md | 3차 review (priority) |
| 4. 최종 보고서 + 개발 내역서 | reports/final/ | 5차 review |

---

**Naia v3 = data-driven (LoCoMo + K-MemBench v2 + cross-review) + risk-aware (Franken mitigation, stateless function 분리) + Naia OS use case-aligned (capability + policy split + memory management API).**
