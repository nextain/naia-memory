# Benchmark History: R5–R14 (Archived from AGENTS.md)

**Archived**: 2026-05-03 (R1.4)
**Reason**: AGENTS.md 경량화 — 상세 벤치마크 기록은 본 파일로 이동.
**Current SoT**: `.agents/progress/plan-v3-anchor-2026-05-02.md`

---

**Cognitive memory architecture for AI agents** — Naia OS의 핵심 메모리 패키지.
importance-gated encoding, vector retrieval, knowledge graph, Ebbinghaus decay, head-to-head benchmark suite.

## Project Structure

```
src/
├── memory/                    # Core memory system
│   ├── index.ts               # MemorySystem — main orchestrator
│   ├── types.ts               # Type definitions
│   ├── importance.ts          # 3-axis scoring (importance × surprise × emotion)
│   ├── decay.ts               # Ebbinghaus forgetting curve
│   ├── reconsolidation.ts     # Contradiction detection on retrieval
│   ├── knowledge-graph.ts     # Entity/relation extraction + spreading activation
│   ├── embeddings.ts          # gemini-embedding-001 (3072d) / multilingual-e5-large (1024d) / offline
│   └── adapters/
│       ├── local.ts           # 독자 엔진: JSON + cosine + BM25 + KG (default, 실제 사용중)
│       ├── mem0.ts            # mem0 OSS backend (존재하나 미사용)
│       └── qdrant.ts          # Qdrant vector DB backend (존재하나 미사용)
├── benchmark/
│   ├── fact-bank.json         # 1000 Korean facts (fictional persona)
│   ├── fact-bank.en.json      # 1000 English facts
│   ├── query-templates.json   # Korean test queries (12 categories)
│   ├── query-templates.en.json # English test queries
│   ├── criteria.ts            # Scoring criteria
│   └── comparison/
│       ├── run-comparison.ts  # Main benchmark runner
│       ├── types.ts           # BenchmarkAdapter interface
│       ├── judge.ts           # Standalone re-judge script
│       ├── adapter-naia.ts    # Naia Memory (formerly Alpha Memory) adapter
│       ├── adapter-mem0.ts    # mem0 OSS
│       ├── adapter-sillytavern.ts
│       ├── adapter-letta.ts
│       ├── adapter-graphiti.ts   # Graphiti (getzep/graphiti) — Neo4j temporal KG
│       ├── adapter-openclaw.ts
│       ├── adapter-sap.ts
│       ├── adapter-open-llm-vtuber.ts
│       ├── adapter-starnion.ts   # Starnion (구 jikime-mem) — SQLite + ChromaDB
│       └── adapter-no-memory.ts  # 베이스라인 (project-airi, memory 없음)
```

## 4-Store Architecture

| Store | Brain Analog | What it holds |
|-------|-------------|--------------|
| **Episodic** | Hippocampus | Timestamped events with full context |
| **Semantic** | Neocortex | Facts, entities, relationships |
| **Procedural** | Basal Ganglia | Skills, strategies, learned patterns |
| **Working** | Prefrontal Cortex | Active context (managed externally) |

## Key Commands

```bash
# Install
pnpm install

# API Keys (pick one):
# 1. GEMINI_API_KEY — GCP Naia-OS project "Gemini API Key v2" (permanent, no expiry)
#    gcloud services api-keys get-key-string projects/<GCP_PROJECT>/locations/global/keys/<KEY_ID>
# 2. GATEWAY_URL + GATEWAY_MASTER_KEY — any-llm gateway (Vertex AI routing)
#    prod: https://naia-gateway-<GCP_PROJECT>.asia-northeast3.run.app
#    dev:  https://naia-gateway-dev-<GCP_PROJECT>.asia-northeast3.run.app (key in agents-rules.json)

# Run benchmark (Korean, keyword judge)
GEMINI_API_KEY=xxx pnpm exec tsx src/benchmark/comparison/run-comparison.ts --adapters=naia-local --judge=keyword --lang=ko

# Run benchmark (English)
GEMINI_API_KEY=xxx pnpm exec tsx src/benchmark/comparison/run-comparison.ts --adapters=naia-local --judge=keyword --lang=en

# Re-judge existing results
pnpm exec tsx src/benchmark/comparison/judge.ts --input=reports/xxx.json --judge=gemini-pro-cli
pnpm exec tsx src/benchmark/comparison/judge.ts --input=reports/xxx.json --judge=claude-cli
pnpm exec tsx src/benchmark/comparison/judge.ts --input=reports/xxx.json --judge=glm-api
pnpm exec tsx src/benchmark/comparison/judge.ts --input=reports/xxx.json --judge=keyword
```

## Benchmark Categories (12)

| Category | What it tests |
|----------|--------------|
| direct_recall | 직접 사실 회상 |
| semantic_search | 의미 기반 검색 |
| proactive_recall | 선제적 기억 제안 |
| abstention | 모르는 건 모른다고 함 (환각 방지) |
| irrelevant_isolation | 무관한 질문에 개인정보 삽입 안 함 |
| multi_fact_synthesis | 여러 기억 조합 |
| entity_disambiguation | 동명이인/맥락 구분 |
| contradiction_direct | 직접적 모순 처리 |
| contradiction_indirect | 간접적 모순 처리 |
| noise_resilience | 노이즈 속 정보 회상 |
| unchanged_persistence | 업데이트 후 안 바뀐 기억 유지 |
| temporal | 시간 관련 기억 (과거 상태 회상) |

## Judge Modes

| Mode | How | Speed |
|------|-----|-------|
| keyword | exact/substring match | instant |
| gemini-pro-cli | gemini CLI (batch 10) | fast |
| glm-api | Z.AI API direct (batch 10) | fast |
| claude-opus-cli | claude CLI (batch 10) | fast |

**CRITICAL: 모든 judge(GLM, Gemini, Claude)는 반드시 배치 10개 묶음으로 호출. 절대 문항별 개별 호출 금지. Claude Opus는 $15/MTok(입력) + $75/MTok(출력)으로 개별 호출 시 10배 토큰 낭비 + 10배 느림.**

## Response LLM

Default: `gemini-2.5-flash-lite` (via OpenAI-compatible API). Configurable with `--llm` flag.

| LLM | Notes |
|-----|-------|
| gemini-flash-lite (default) | gemini-2.5-flash-lite via direct API |
| gemini | Same API path, explicitly named |
| gemini-cli | gemini CLI tool (buggy `-m` flag, avoid) |
| qwen3 | Local ollama qwen3:8b |

## Scoring

- Core tests: weighted pass rate
- Bonus tests: extra credit
- Grade: A (90%+), B (75%+), C (60%+), F (<60%), F (abstention fail)

## Known Issues (from benchmark results)

- **Naia Layer over-filtering (R8 v2 critical)**: Importance gating improves keyword precision +3pp but degrades semantic recall -13.5pp. semantic_search 2/18 vs mem0 base 16/18. Fix: hard filter → soft re-ranking. → P0
- **unchanged_persistence cascade delete**: Contradiction update deletes unrelated facts. All adapters 0/11 in R8 v2. Fix: status field + non-destructive update. → P0
- **multi_fact_synthesis 0%**: No multi-hop retrieval. Both naia-local and mem0 score 0/15. Fix: query decomposition + LLM synthesis. → P1
- **deprecated embedding + missing vector search**: `text-embedding-004` (768d, EN-optimized, deprecated 2026-01-14) is not wired into LocalAdapter. Benchmark uses Mem0Adapter backend — LocalAdapter has never been measured. → alpha-memory#5 (Critical)
- **Mem0Adapter LLM dedup kills Korean**: mem0 KO 24.5% = naia KO 24.0% — same pipeline, confirmed root cause. mem0's EN-optimized LLM dedup strips Korean text during normalization. Fix: switch benchmark + production to LocalAdapter. → alpha-memory#12
- **abstention is retrieval failure, not confidence gating**: naia abstention 100% (KO) / 75% (EN) is a false positive — nothing is retrieved so LLM says "I don't know". Real fix requires vector search first, then cosine similarity threshold. → alpha-memory#9
- **temporal 0-15%**: Naia overwrites facts on contradiction update, losing past state history. R8 v2: naia 3/20, mem0 0/20. → alpha-memory#8
- **EN fact bank 260/488 untranslated**: Mixed KO/EN queries in EN benchmark. Degrades EN result reliability. → **FIXED** in R9 (full EN translation)
- **naia-local EN pipeline Korean anchor**: Fact extractor, sessionRecall headers, benchmark prompt all had Korean anchors causing EN collapse. → **FIXED** (Bug #6)

## Benchmark Infrastructure Bugs (2026-04-23, GLM-5.1 + Gemini 2.5 Pro Cross-Reviewed)

5개 버그/개선항목을 GLM-5.1과 Gemini 2.5 Pro가 교차 검증. **전원 CONFIRMED**.

### Bug #1: judge.ts v2 템플릿 변환 누락 [HIGH]

`run-comparison.ts`는 `convertV2ToV1()`로 v2 `queries[]` → v1 `capabilities.{cap}.queries[]` 변환 후 `scoring.score_3` → `expected_contains` 매핑. `judge.ts`에는 이 변환 로직이 없어 `templates.capabilities`가 `undefined` → `queryLookup` 비어감.

**영향**: R9 GLM/Gemini re-judge가 제약 없이 "적절히 답했으면 PASS"로 평가. keyword judge는 5개 항목 `NO_JUDGE` → FAIL 처리.

**수정안**: `convertV2ToV1()`을 공유 모듈로 추출, judge.ts에 적용.

### Bug #2: judge.ts v2 템플릿 경로 탐지 오류 [HIGH]

judge.ts가 항상 v1 템플릿(`query-templates.json`)만 로드. `--v2` 플래그/자동 감지 없음.

**수정안**: `--v2` 플래그 + 파일명 기반 자동 감지로 `query-templates-v2.json` 로드.

### Bug #3: judge.ts 체크포인트 resume 부재 [MEDIUM]

배치별 저장은 있으나 재시작 시 전부 재judge. GLM 240문항 ~15분, 중간 타임아웃 시 전체 손실.

**수정안**: judge 모드별 결과를 분리 저장 (`judge_results.glm-api`, `judge_results.gemini-pro-cli` 등). 재시작 시 이미 judge된 항목 스킵.

### Bug #4: v2 scoring 구조 미활용 [LOW]

`score_2`(부분 정답), `score_1`(관련 but 오답)이 `entry.scoring`에 보존되나 `buildJudgePrompt()`와 `keywordJudge()`에서 무시됨.

**수정안**: LLM judge 프롬프트에 `score_2` 힌트 추가. keywordJudge 부분 점수는 false positive 리스크로 보류.

### Bug #5: R9 혼합 실행 — v2 fact bank + v1 templates [HIGH]

R9가 `--v2` 플래그로 실행됐으나 실제로는 v2 fact bank(200 facts) + **v1 templates(240 queries)** 혼합 사용. v2 templates(241 queries)는 한 번도 사용 안 됨.

**증거**:
- R9 DIRE=25 (v1 direct_recall=25, v2는 49)
- R9 CONT=35 (v1 cd=20+ci=15, v2도 20+15이지만 내용 다름)
- `scoringV2: true`는 `--v2` 플래그로 설정되었으나 템플릿은 v1

**결론**: R9 전체 결과(KO)를 v2 templates 기반으로 재실행 필요.

## Reports

Benchmark results are saved in `reports/` as JSON files.

### Report Structure

```
reports/
├── REPORT_TEMPLATE.md       ← 보고서 작성 절차/템플릿 (3-AI 협업 방법 포함)
├── EXECUTION_HISTORY.md     ← 벤치마크 실행 이력
├── r5-en-benchmark/
│   ├── report-ko.md         ← R5 EN 벤치마크 한국어 보고서
│   └── report-en.md         ← R5 EN 벤치마크 영문 보고서
├── r6-ko-benchmark/
│   └── report-ko.md         ← R6 KO 벤치마크 한국어 보고서
├── r8-v2-5adapter/
│   └── report-ko.md         ← R8 v2 최종 보고서 (precision-recall 분석 + 로드맵)
└── runs/                    ← 원시 JSON 결과 파일
```

### R5 EN Benchmark Results (2026-04-12, GLM-5.1 Judge)

| Rank | Adapter | Score | Grade |
|------|---------|-------|-------|
| 1 | letta | 87.5% | F(abs) |
| 2 | open-llm-vtuber | 85.2% | F(abs) |
| 3 | naia | 84.0% | F(abs) |
| 4 | mem0 | 83.1% | F(abs) |
| 5 | sillytavern | 79.8% | F(abs) |
| 6 | sap | 74.1% | F(abs) |
| 7 | graphiti | 55.8% | F |
| 8 | openclaw | 43.3% | F |
| 9 | airi(baseline) | 33.9% | F |

**Key Findings:**
- All memory-capable systems fail abstention (40-65%) — memory-confidence structural coupling issue
- naia unchanged_persistence 47%: known bug naia-os#221 (cascade delete on contradiction update)
- graphiti: contradiction 100% vs semantic_search 4% — Neo4j KG cannot substitute vector search
- **NOT measured**: retrieval latency (ms) and per-query token cost — planned for R7

### R6 KO Benchmark Results (2026-04-13, keyword Judge)

| Rank | Adapter | Score | EN R5 | EN→KO |
|------|---------|-------|-------|-------|
| 1 | letta | 67.5% | 87.5% | -20pp |
| 2 | **naia** | **24.7%** (KW) / **24.0%** (GLM) | 84.0% | -60pp |
| 3 | mem0 | 24.0% | 83.1% | -59pp |
| 4 | sillytavern | 17.6% | 79.8% | -62pp |
| 5 | airi(baseline) | 16.0% | 33.9% | -18pp |
| 6 | openclaw | 14.8% | 43.3% | -29pp |
| 7 | open-llm-vtuber | 14.4% | 85.2% | -71pp |
| 8 | sap | 12.9% | 74.1% | -61pp |
| — | graphiti | DNF | 55.8% | — |

**Key Findings:**
- Korean language barrier: most systems drop 50-70pp vs EN — EN-optimized LLM pipeline is the bottleneck
- letta alone retains meaningful KO performance — internal multilingual LLM processing
- airi(no-memory) outperforms openclaw/open-llm-vtuber/sap — memory systems don't beat baseline in KO
- graphiti DNF at query 156/240 due to Neo4j 500 errors
- naia: cacheId bug fixed (c77990f) + per-query consolidation O(n²) removed; KO result: 24.7% (keyword) / 24.0% (GLM-5.1)

**Bug Fixes (R6):**
- `cacheId` always uses `cache-${lang}` — keeps EN/KO data in separate DBs (was using shared `stable` DB)
- Removed 3× `consolidateNow(force=true)` per-query calls — was O(n²) over 1000 facts

**naia EN R6 (bug-fixed rerun, 2026-04-14):**
- **GLM-5.1: 83.5%** (201/240) — essentially same as R5 EN 84.0%; bug fixes did not degrade EN performance
- keyword: 61% (150/240) — shows judge calibration gap (keyword 73% of GLM score)
- Highs: entity_disambiguation 100%, multi_fact_synthesis 95%, noise_resilience 95%
- Lows: abstention 55% (known structural bug), semantic_search 88% (GLM) vs 36% (keyword)

**Report:** See `reports/r6-ko-benchmark/report-ko.md`

### R8 v2 Benchmark Results (2026-04-23, synthetic factbank, 5 adapters × 3-Judge)

**설계**: v2 합성 팩트뱅크(200 허구 팩트, 241 쿼리)로 LLM 사전지식 경로 차단. airi baseline 33.9%→15%로 차단 확인.

**아키텍처 관계**: `naia-local = 독자 엔진 (LocalAdapter: JSON + vector + BM25 + KG) + Naia Layer (importance gating, LLM consolidation, contradiction detection)`. mem0 코드 전혀 미사용. 서버(`naia-memory-api.ts`)는 mem0 REST 프로토콜만 호환.

**이중 순위 (공정성 vs 사용자 경험)**:

| 지표 | 1위 | 2위 | 3위 |
|------|-----|-----|-----|
| Keyword (정확도) | **naia-local** 31.5% | mem0 28.5% | sillytavern 26.5% |
| Consensus (사용자 경험) | **mem0** 39.8% | naia-local 38.6% | sillytavern 27.0% |
| GLM (관대 semantic) | **mem0** 79.5% | naia-local 66.0% | sillytavern 50.0% |
| Gemini (엄격 semantic) | **mem0** 32.0% | naia-local 28.5% | sillytavern 23.0% |

**Precision-Recall 트레이드오프**:
- Naia Layer가 keyword 정밀도 +3pp 개선, semantic recall -13.5pp 저하
- 원인: Importance Gating이 너무 공격적 (80%), Consolidation 정보 손실 (20%)
- semantic_search: naia 2/18 vs mem0 16/18 (8배 격차)
- unchanged_persistence: 전멸 0/11 (cascade delete)
- multi_fact_synthesis: 전멸 0/15
- temporal: naia 3/20 vs mem0 0/20 (유일한 naia 우위 카테고리)
- letta R7→R8 추락: KO 67.5%→14.5% (사전지식 경로 차단으로 무너짐)
- 모든 시스템 F 등급 (1위도 40% 미만)

**Report:** See `reports/r8-v2-5adapter/report-ko.md`

### R9 v2 KO+EN Results (2026-04-24, 2 adapters × 3-Judge, v2 templates fix)

**변경사항**: Bug #1-#5 수정 + v2 templates 정상 사용 + EN pipeline 한국어 anchor 제거 (llm-fact-extractor, sessionRecall, benchmark prompt).

#### KO (241 queries)

| Judge | naia-local | mem0 | Gap |
|-------|:---:|:---:|:---:|
| Keyword | 87 (37%) | 84 (34%) | naia +3 |
| GLM | 105 (44%) | 127 (53%) | mem0 +9 |
| Gemini | 105 (44%) | 117 (49%) | mem0 +5 |
| **평균** | **42%** | **45%** | **mem0 +3** |

#### EN (241 queries, 한국어 anchor 수정 후)

| Judge | naia-local | mem0 | Gap |
|-------|:---:|:---:|:---:|
| Keyword | 51 (21%) | 52 (22%) | mem0 +1 |
| GLM | 65 (27%) | 117 (49%) | mem0 +22 |
| Gemini | 61 (25%) | 125 (52%) | mem0 +27 |
| **평균** | **24%** | **41%** | **mem0 +17** |

#### 통합 순위

| Adapter | KO | EN | **통합** | KO→EN 격차 |
|---------|:---:|:---:|:---:|:---:|
| mem0 | 45% | 41% | **43%** | -4pp |
| naia-local | 42% | 24% | **33%** | **-18pp** |

**Key Findings**:
- mem0가 KO/EN 모두 안정 (43%), naia-local은 EN에서 붕괴 (-18pp)
- naia-local EN 붕괴 원인: importance gating + keyword search가 EN에 부적합, vector search만으로 recall 부족
- EN contradiction_direct: naia 10-13/20 vs mem0 15-19/20 — negation detection은 언어 독립적이나 retrieval에서 격차
- abstention: naia EN 17/20 (85%)은 false positive — 실제로는 검색 실패
- 양 시스템 모두 unchanged_persistence 0-1/11, multi_fact_synthesis 0/15 — 구조적 문제

**Bug #6: EN pipeline Korean anchor [FIXED 2026-04-24]**
- `llm-fact-extractor.ts:89` 한국어 예시 → EN 팩트가 한국어로 저장 → 검색 불가
- `index.ts:546-581` sessionRecall() 한국어 헤더 → LLM이 EN 쿼리에 한국어 응답
- 수정 후 naia-local EN: 16% → 21% (keyword), 22% → 27% (GLM)

### R10 KO Two-Stage Retrieval (2026-04-24, 2-Judge 완료, mem0 미실행)

**변경사항**: Three-Layer Architecture의 Retrieval Layer 개선 — Stage 1 broad recall (importance无关) + Stage 2 re-rank with importance/strength.

#### R10 naia-local KO vs R9 mem0 KO (동일 judge 조건)

| Category | R10 naia (gemini) | R9 mem0 (gemini) | Gap | R10 naia (kw) | R9 mem0 (kw) | Gap |
|----------|:-----------------:|:----------------:|:---:|:-------------:|:------------:|:---:|
| contradiction_direct | 14/20 | 18/20 | -4 | 1/20 | 2/20 | -1 |
| contradiction_indirect | 11/15 | 14/15 | -3 | 9/15 | 10/15 | -1 |
| abstention | 18/20 | 14/20 | **+4** | 15/20 | 12/20 | **+3** |
| irrelevant_isolation | 15/15 | 14/15 | **+1** | 15/15 | 15/15 | = |
| semantic_search | 7/18 | 6/18 | **+1** | 4/18 | 6/18 | -2 |
| entity_disambiguation | 9/20 | 11/20 | -2 | 11/20 | 7/20 | **+4** |
| noise_resilience | 15/20 | 14/20 | **+1** | 12/20 | 5/20 | **+7** |
| proactive_recall | 10/18 | 14/18 | -4 | 9/18 | 11/18 | -2 |
| direct_recall | 9/49 | 18/49 | **-9** | 8/49 | 12/49 | -4 |
| unchanged_persistence | 1/11 | 0/11 | **+1** | 0/11 | 0/11 | = |
| temporal | 2/20 | 3/20 | -1 | 2/20 | 3/20 | -1 |
| multi_fact_synthesis | 0/15 | 4/15 | -4 | 0/15 | 1/15 | -1 |
| **TOTAL** | **111/241 (46%)** | **130/241 (54%)** | **-8pp** | **86/241 (37%)** | **84/241 (34%)** | **+3pp** |

**Gemini judge: mem0 +8pp 우세. Keyword judge: naia +3pp 우세.**

#### naia 구조적 우위 (judge 무관)
- **abstention**: naia 90% vs mem0 70-80% — 노이즈 필터링으로 "모른다" 정확
- **irrelevant_isolation**: naia 100% vs mem0 93% — 개인정보 무단 노출 제로
- **noise_resilience**: keyword 기준 naia 60% vs mem0 25% (+35pp)
- **contradiction detection**: 구조적 기능 (mem0엔 없음)

#### naia 구조적 열위
- **direct_recall**: naia 18% vs mem0 37% (gemini) — recall 자체가 부족
- **multi_fact_synthesis**: 양쪽 모두 0-27% — RAG 구조적 한계
- **unchanged_persistence**: 양쪽 모두 0-9% — cascade delete 구조적 버그

**미완료**: R10 mem0 KO 실실행, R10 EN, GLM judge

### R14 KO P0+P1+P2 Integrated Results (2026-04-25, fresh DB, 2-Judge)

**변경사항**: P0(topK+status) + P1(Context Budget Allocator, encoding gate 제거) + P2(Hybrid Search RRF) 전체 적용. Fresh DB에서 재실행.

#### R14 vs R10 비교

| Category | R10 kw | R14 kw | Δ kw | R10 gem | R14 gem | Δ gem |
|----------|:------:|:------:|:----:|:-------:|:-------:|:-----:|
| direct_recall | 8/49 | 13/49 | **+5** | 9/49 | 18/49 | **+9** |
| semantic_search | 4/18 | 5/18 | +1 | 7/18 | 8/18 | +1 |
| proactive_recall | 9/18 | 6/18 | -3 | 10/18 | 7/18 | -3 |
| abstention | 15/20 | 8/20 | **-7** | 18/20 | 14/20 | **-4** |
| irrelevant_isolation | 15/15 | 15/15 | = | 15/15 | 15/15 | = |
| multi_fact_synthesis | 0/15 | 1/15 | +1 | 0/15 | 2/15 | **+2** |
| entity_disambiguation | 11/20 | 9/20 | -2 | 9/20 | 4/20 | **-5** |
| contradiction_direct | 1/20 | 3/20 | +2 | 14/20 | 12/20 | -2 |
| contradiction_indirect | 9/15 | 13/15 | **+4** | 11/15 | 15/15 | **+4** |
| noise_resilience | 12/20 | 15/20 | **+3** | 15/20 | 17/20 | +2 |
| unchanged_persistence | 0/11 | 1/11 | +1 | 1/11 | 2/11 | +1 |
| temporal | 2/20 | 3/20 | +1 | 2/20 | 3/20 | +1 |
| **TOTAL** | **86/241** | **92/241** | **+6** | **111/241** | **117/241** | **+6** |
| | (36%) | (38%) | **+2pp** | (46%) | (49%) | **+3pp** |

#### Key Findings

- **전체 +2-3pp 개선** — P0+P1+P2 통합 효과는 미미
- **direct_recall 대폭 개선**: kw +5, gem +9 — encoding gate 제거로 더 많은 fact 저장 + context budget allocator로 더 관련성 높은 선택
- **contradiction_indirect 완벽**: 15/15 (100%) — RRF hybrid search가 간접 모순 탐지 향상
- **noise_resilience 향상**: +2-3 — hybrid search 노이즈 필터링 개선
- **abstention 하락**: kw -7, gem -4 — encoding gate 제거로 더 많은 fact가 검색되어 "모른다" 감소. 구조적 trade-off
- **entity_disambiguation 하락**: gem -5 — 더 많은 후보가 검색되어 disambiguation 어려워짐
- **unchanged_persistence 여전히 낮음**: 1-2/11 — P0 status field로 약간 개선되었으나 근본적 한계

#### P2 Hybrid Search 결론

RRF (Reciprocal Rank Fusion)은 contradiction_indirect에서 효과적이나 전체 개선은 +2-3pp에 불과. BM25 단독(R12: 86/241) 대비 RRF(R14: 92/241)가 +6 keyword 개선. encoding gate 제거가 더 큰 기여.

## Architecture Review Round 1 (2026-04-24, Gemini 2.5 Pro + Claude Sonnet 4)

### R10 soft re-ranking 실패 분석

importance를 multiply에서 additive로 전환 → net zero (recall up, precision down more).
만장일치: 가중치 조정이 아닌 **구조적 변경** 필요.

### 아키텍처 컨셉 검증 (2라운드)

**최초 결론 (1라운드)**: Importance gating을 검색에서 제거, 순수 vector search로 전환
**아키텍트 반박**: "망각은 버그"는 저장 삭제에만 해당. 컨텍스트 주입 필터링으로서의 망각은 필수
**2라운드 합의**: **Semantic forgetting(저장 삭제)은 버그, Pragmatic forgetting(컨텍스트 필터링)은 필수 기능**

### Three-Layer Architecture (만장일치 채택)

```
Storage Layer:      모든 episode 무조건 저장 (gate 없음, 삭제 없음)
                     Ebbinghaus decay는 archival priority에만 사용
    ↓
Retrieval Layer:    Broad vector + keyword recall (top 100-500)
                     importance无关, 순수 관련성 signal
    ↓
Context Injection:   Multi-signal ranking → context budget allocation
                     (vector × recency × frequency × importance/emotion)
                     제한된 context window에 최적의 subset 주입
```

### 3-axis scoring 재포지셔닝

- **기존**: Encoding gate (무엇을 저장할지) → **실패**
- **수정**: Context budget allocator (무엇을 보여줄지) → **타당**

### 스케일별 crossover point

| 메모리 수 | Vector만 | 추가 signal |
|-----------|:--------:|:-----------:|
| < 1,000 | 충분 | No |
| 1,000-10,000 | crossover | Recency |
| 10,000+ | 노이즈 | Importance/Emotion 필수 |

## Architecture Review Round 2 (2026-04-25, Gemini 2.5 Pro + Claude Sonnet 4)

**목적**: R1의 "다 버려라" 결론에 대한 반론과 정밀 분석.

### 핵심 합의: "비유가 틀린 게 아니라 구현이 미흡했다"

| 구성요소 | R1 결론 | R2 수정 |
|---|---|---|
| 4-Store Architecture | "비유가 틀림" | **"4개 중 1개만 구현됨 — 구현이 미흡"** |
| 3-Axis Scoring | "개념이 틀림" | **"키워드 정규식 수준 — 구현이 틀림"** |
| Ebbinghaus Decay | "AI에 불필요" | **"컨텍스트 윈도우에 적용하면 의미 있음"** |

### naia의 진짜 구조적 우위 (양 AI 확인)

1. **Contradiction detection** (`reconsolidation.ts`): mem0엔 없는 기능
2. **Importance gating → abstention 90%**: 노이즈 필터링이 "모른다" 정확도 향상
3. **irrelevant_isolation 100%**: 개인정보 무단 노출 제로

### mem0 46% 실패 원인 분석

- **검색(recall) 실패 + 생성(generation) 실패 복합**
- 시간 관계 추론 불가 (temporal 15%)
- 복합 질문 조합 불가 (multi_fact_synthesis 27%)
- 부정문/이중부정 인식 한계 (contradiction_direct 30%)

### 개선 로드맵 (양 AI 공통 제안, 예상 43% → 70%)

1. **unchanged_persistence 수정** (status field) — 확실 +9pp, 2일
2. **Query decomposition** (multi_fact_synthesis) — 최대 +27pp, 1주
3. **Contradiction detection 유지/강화** — naia 핵심 차별점
4. **Hybrid search** (BM25 + vector) — recall 향상
5. **Memory-as-a-Tool** — 장기 아키텍처 전환

### 3-Axis Scoring 진화 방향

LLM 기반 scoring (latency/cost 문제) 대신:
- **v1**: 키워드 정규식 (현재, "나쁘지 않음")
- **v2**: 사전 학습 토큰 임베딩 코사인 유사도 (ms 단위, 정확)
- **v3**: 하이브리드 (키워드 + 임베딩)

Gate: F1 ≥ 5% 개선, latency < 10ms/query

## Implementation Roadmap

### P0: Two-Stage Retrieval (완료)

- [x] Stage 1: Broad vector + keyword recall (importance无关)
- [x] Stage 2: Re-rank with importance/strength among candidates only
- [x] R10 KO naia-local keyword 37%, gemini 46% (mem0 미실행)

### P0 (병렬): unchanged_persistence 수정 (완료)

- [x] 메모리 스키마에 `status` 필드 추가 (active/superseded/archived)
- [x] Contradiction update 시 물리적 삭제 → 상태 변경만
- [x] Cascade delete 로직 제거, 대상 메모리 ID 1개만 업데이트

### P1: Context Budget Allocator (완료)

- [x] Encoding gate 제거 — Storage Layer는 모든 episode 저장
- [x] `context-budget.ts` — token budget 기반 context-worthiness ranking
- [x] `sessionRecall()`에 budget allocator 통합 (default 2000 tokens)
- [x] `shouldStore()` / `STORAGE_GATE_THRESHOLD` dead code 제거

### P2: Hybrid Search (완료, #16)

- [x] BM25 구현 (`local.ts`) — R12: 86/241, direct_recall +3 but contradiction -11
- [x] RRF (Reciprocal Rank Fusion) 결합 — R14: 92/241 keyword (+6 vs R12), contradiction_indirect 100%
- [x] R14 통합 검증 — P0+P1+P2 전체: kw 92/241 (38%), gem 117/241 (49%)
- **결론**: RRF는 contradiction_indirect에 효과적, 전체 +2-3pp. encoding gate 제거가 더 큰 기여.

### P3: Dual-Path Retrieval

- [ ] Raw episode 보존 + fact extraction 병렬 운영 (Episodic Store 구현)
- [ ] Episode path + Graph path 동시 검색 → Contextual fusion
- [ ] Consolidation을 source of truth가 아닌 index/cache로 격하

### P4: multi_fact_synthesis

- [ ] Query Decomposition: LLM이 복합 쿼리를 서브쿼리로 분해
- [ ] Multi-hop 검색: 1차 결과에서 엔티티 추출 → 2차 검색

### P5: Judge 시스템 2.0

- [ ] Binary PASS/FAIL → 다차원 평가 (Accuracy, Completeness, Relevance)
- [ ] HITL 캘리브레이션 세트 (50-100개 인간 평가 항목)

### P6: Token Embedding Scoring (keyword → token embedding 진화)

Replace keyword heuristic in `importance.ts` with token-embedding-based scoring:

- **Phase 1 (prototype)**: Extract static token embeddings from pre-trained model (all-MiniLM-L6-v2 or LLM embedding layer). Compute cosine similarity between input tokens and pre-defined emotion/importance/surprise seed vectors. Run parallel with existing keyword scorer.
- **Phase 2 (benchmark)**: Compare keyword vs embedding vs hybrid on identical conditions. Gate: F1 ≥ 5% improvement, latency < 10ms/query.
- **Phase 3 (integration)**: If Phase 2 passes, add `ScoringProvider` interface to `scoreImportance()` with keyword (default) / embedding / hybrid modes.

**Risk**: Static token embeddings are context-independent (same limitation as keywords). The improvement may be marginal for the added complexity. Benchmark data required before committing.

**Patent note**: Included as "다른 실시예" in patent filing `docs-business/05. 특허/cognitive-memory-system/`. If benchmark proves ≥10% F1 gain, file divisional application or amendment.

## Conventions

- Language: English for code/docs, Korean for discussions
- Package: `@nextain/naia-memory` (Apache-2.0)
- Part of Naia OS ecosystem
- **Anti-overfitting**: 벤치마크 카테고리를 알고 튜닝하는 건 과적합. 프로덕션에선 쿼리 카테고리를 모름. 카테고리별 적응형 가중치, 카테고리별 threshold 등 벤치카테고리 구조에 의존하는 최적화는 금지. 범용 단일 전략만 허용.
