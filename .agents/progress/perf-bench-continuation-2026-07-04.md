---
session_id: e14912ec-25e3-46fa-b815-6f01896e1a8c
topic: naia-memory 성능 벤치 재실행 + 지속 개선
date: 2026-07-04
status: in-progress
---

# naia-memory 성능 벤치 재실행 + 지속 개선

## 목표 (루크 지시 2026-07-04)
1. 최신 git pull
2. 성능 벤치 재실행 → 현재 도달 지점 파악
3. 벤치 및 성능 개선 지속

## 시작 상태
- 브랜치: fix/local-close-flush (origin/fix/local-close-flush 동기)
- origin/main 대비 21 커밋 뒤 (main 브랜치 기준)
- remote: github.com/nextain/alpha-memory
- 문서(v6.0) 명시 벤치: Surface 9.74ms / Deep ~80ms @ 100k facts

## /goal (2026-07-04 루크)
naia-memory = naia 생태계에서 기억·성격·무의식을 관할하는 **소뇌**.
- 객관적 + 체감가능한 벤치마크 개선
- 성능 개선을 루프로 진행
- 각 페이즈마다 결과 기록 + 적대리뷰로 방향 탐색
- 달성 목표: "기억에 대한 경험" + 실시간 컨텍스트 압축

## 아키텍처 실태 (main e703635)
- **두 어댑터**: LocalAdapter(default, 인지기능 완전) / SqliteAdapter(고성능 경로, In-progress)
- SqliteAdapter는 recall/store/getAll만 실동작. decay·associate·consolidate·KG·epoch·delete·export = **no-op 골격**. 인지 풍부함은 LocalAdapter에.
- 실시간 컨텍스트 압축 = `MemorySystem.compact()` (v3: rolling-summary fast-path + anchored iterative + structured 5-section). LLM summarizer 주입 가능.
- 인지 모델: docs/cognitive-architecture.md (Tulving-CLS 4-store, spike→active brain=진짜 차별점)

## Phase 0 — Baseline (2026-07-04)
### 지연 성능 (stress-test-tiered-100k, SqliteAdapter, all-MiniLM-L6-v2 CPU)
| 지표 | 값 | 목표 | 판정 |
|---|---|---|---|
| Surface recall 'topic-500' | 7.96ms | <25ms | ✅ |
| Surface recall 'group-5' | 6.62ms | <25ms | ✅ |
| 100k 주입 wall | 2m46s | — | (임베딩 지배) |
| 100k 주입 CPU | 54min | — | ⚠ 반복 루프 부담 |
| Table | HOT=10k / COLD=100k | — | — |

### baseline 벤치의 방법론적 한계 (개선 대상 = /goal '벤치마크 개선')
1. **단일 샘플** — warmup·p50/p95 없음. 7.96ms는 1회 측정.
2. **deep recall 미측정** — tiered는 surface만. 문서 ~80ms 주장 미검증.
3. **쿼리 2개**, 둘 다 hit 보장. 정확도(precision@k) 미측정.
4. **정확도/회상품질 축 부재** — latency+비제로 hit만. 소뇌 역할엔 정확도가 핵심.
5. **주입이 임베딩에 지배** (54 CPU-min) → 반복 루프 불가능 수준. 임베딩 캐시/결정론 embedder로 분리 필요.

## 벤치 프로그램 (2축 설계 — /goal '객관적+체감가능')
소뇌(기억·성격·무의식) 역할을 2개 직교 축으로 측정:

**축 A — 검색 성능/스케일 (체감가능=응답성)**
- 결정론 embedder로 임베딩 비용 분리 → sqlite-vec 브루트포스는 지연이 (dims,코퍼스크기)에만 의존하므로 대표성 유지. 반복 루프 가능.
- 지표: surface/deep recall p50/p95/p99, 주입 throughput, RSS/DB 풋프린트.
- 하네스: `src/benchmark/perf/{deterministic-embedder,run-latency}.ts` (신규). 산출 `reports/perf/*.json`.

**축 B — 기억 품질/경험 (객관적=정확도·인지충실도)**
- 실 embedder + 라벨 코퍼스(aihub141/phase-b/locomo 기존 자산). precision@k·MRR·모순처리·decay 곡선·consolidation 품질·컨텍스트 압축(compact) 충실도.
- 기존 하네스 재활용 + compact 압축률/충실도 신규 지표.

## 루프 구조 (페이즈별)
각 페이즈 = [측정 → 결과기록 → 적대리뷰(방향탐색) → 정직한 개선 → 재측정]. 과적합/꼼수 배제(CLAUDE.md 자가개선 철학).

## 진행 로그
- 2026-07-04: main 전환·pull(21커밋)·typecheck GREEN·네이티브 OK. tiered baseline 측정 완료.
- 2026-07-04: 축 A 하네스 신규 작성(결정론 embedder + p50/p95/precision + surface/deep). smoke(count=2000) GREEN. 100k 실행 중.
- 병목 후보(코드리딩): recall 1회 = worker IPC 4왕복 직렬(FTS→vec→id_map→최종SELECT). upsert = fact당 다수 IPC. better-sqlite3 동기 worker.

## Phase 1 — 축 A robust baseline (2026-07-04, 100k, 300 samples, dims=384)
| 경로 | p50 | p95 | p99 | max | mean | 목표 | precision@k |
|---|---|---|---|---|---|---|---|
| Surface(hot 10k) | 4.00 | 5.34 | 8.47 | 9.49 | 4.15 | <25ms ✅ | 54.7% |
| Deep(full 100k) | 40.68 | 43.78 | 49.28 | 54.88 | 41.01 | <100ms ✅ | 13.3% |

- 주입 1631 facts/s (임베딩 분리 후, worker-IPC bound). RSS 288MB, DB 196MB.
- 산출물: `reports/perf/latency-accuracy-count100000.json` (재현 가능).
- **관찰 1**: deep = surface × ~10 (41 vs 4ms) ≈ 코퍼스 10배 ⇒ vec 브루트포스 스캔이 deep 지배(가설, 계측 필요).
- **관찰 2**: precision@k는 합성 코퍼스 숫자토큰 prefix(`500*`) 충돌로 오염 → 정확도 판단 불가. **정확도는 축 B(실코퍼스)로**. 축 A는 latency 전용으로 확정.
- 두 목표(surface<25, deep<100) 모두 이미 충족 → 개선 여지는 deep 41ms 단축 + 주입 throughput.

## Phase 2 — deep recall 병목 귀속 (계측, worker 없이 직접 DB)
`src/benchmark/perf/breakdown.ts` (200 calls median):
| 단계 | ms | 비중 |
|---|---|---|
| embed(local) | 0.016 | — |
| FTS query | 0.109 | 0.3% |
| **vec 브루트포스 스캔** | **38.99** | **98.9%** |
| id_map resolve | 0.136 | 0.3% |
| final SELECT | 0.128 | 0.3% |
| SQL 합 | 39.40 | — |
| worker IPC 오버헤드 | ~1.3 (40.7-39.4) | — |

- **교정**: 초기 "IPC 4왕복" 가설 기각. IPC는 ~1.3ms뿐. deep 지연은 **전적으로 sqlite-vec 100k×384 float32 브루트포스**. → 측정이 추측을 교정(feedback: 격리토글>추측).
- 개선 방향 후보: (1) binary quantization coarse→float rerank (2) FTS 후보게이팅 vec (recall 시맨틱 변화 risk→축B 검증필요) (3) dims 축소. ANN/HNSW는 sqlite-vec 0.1.9 미지원.

## Phase 3 — binary-quant 최적화 프로브 (`src/benchmark/perf/probe-binary-quant.ts`)
sqlite-vec 0.1.9 지원: `vec_quantize_binary`(dims%8==0), `vec_distance_hamming`. i8 미지원.
100k×384 기준 (median, 200 calls):
| 전략 | 지연 | overlap@10 vs float |
|---|---|---|
| float32 브루트 (baseline) | 33.7ms | 100% (기준) |
| binary Hamming 단독 | 2.1ms | 33% (단독은 recall 손실) |
| 2-stage vec0 rerank (IN필터) | 79.9ms | 100% (vec0 point-lookup 비효율→풀스캔) |
| **2-stage JS rerank, coarse=100** | **8.6ms** | 100% |
| 2-stage JS rerank, coarse=200 | 16.0ms | 100% |
| 2-stage JS rerank, coarse=400 | 34.7ms | 100% |

- 이진 build: 100k 0.7s. binary Hamming 자체 2ms(16x). float top-10이 binary top-100 안에 100% 포함 → coarse=100 rerank로 34→8.6ms(**4x**).
- **정직성 경고(적대 자기리뷰)**: overlap 100%는 **결정론 embedder**(구조없는 벡터) 산물이라 **대표성 없음**. 실 embedder에선 binary recall이 다를 수 있음(보통 더 좋으나 미검증). 어댑터에 wiring 전 **축 B(실코퍼스 recall@k)로 quality 검증 필수** — 안 하면 latency 위해 recall 희생하는 과적합 위험.
- 2-stage rerank의 `IN(N)` TEXT-PK 배치로드가 coarse 증가 시 급격히 느려짐(400=무의미). INTEGER rowid 키면 개선 여지.

## 적대적 자기리뷰 (방향 탐색)
1. **축 A는 latency만 신뢰** — precision은 합성코퍼스 오염. 정확도 주장 금지.
2. **perf 목표 이미 충족**(surface 4ms<25, deep 41ms<100). 추가 latency 최적화는 "필수"가 아닌 "여지".
3. **/goal의 진짜 갭 = 축 B(기억 품질/경험) + compact(실시간 컨텍스트 압축) 벤치 부재.** 이 둘이 소뇌 역할의 핵심인데 robust 하네스가 없음. 기존 aihub141/phase-b/locomo는 quality지만 최신 재실행·정합 필요.
4. binary-quant는 매력적이나 quality 미검증 상태 wiring = 과적합 함정. 축 B 먼저.

## 다음 방향 결정 필요 (사람 게이트)
A) binary-quant를 축 B로 recall 검증 후 어댑터 wiring (perf 심화)
B) 축 B 정확도 하네스 + compact 압축 벤치 신규 구축 (/goal 폭 우선) ← 권장
C) 둘 병행

**루크 결정(2026-07-04): B (축 B 품질+compact 우선).**

## Phase 4 — compact 컨텍스트 압축 벤치 (`src/benchmark/quality/compact-bench.ts`)
로컬 전용(외부 API 0). 82메시지 대화 + anchor 사실 10개 산포, keepTail=8, head 74메시지 compact.
| 경로 | realtime | 지연 | 압축률(recap tok/in tok) | fidelity(anchor 보존) |
|---|---|---|---|---|
| A: deterministic (기본) | false | 0.73ms | 24.5% (600→147) | 30% (7/10 소실) |
| B: rolling-summary primed | true | 0.12ms | **161.8% (971 — 팽창)** | 70% |
| C: mock LLM summarizer | true | 0.16ms | 16.5% (600→99) | 90% |

- **관찰 1**: 기본 deterministic recap = 4x 압축이지만 중간 진술 사실 70% 소실(첫유저=Goal, 첫/끝 인용, 대문자 토픽만 보존). 실시간 압축의 정량적 약점.
- **관찰 2 (중요)**: rolling-summary realtime 경로가 **압축이 아니라 팽창**(161.8%). 최근 메시지 verbatim 누적 → 이 window 크기에선 압축 목적 상실. rollingHeadroom 설계 재검토 필요. **설계 이슈로 flag.**
- **관찰 3**: LLM summarizer 90% fidelity 16.5% 압축 = frontier. 요약기가 주는 가치 = fidelity 30%→90%.
- 산출물: `reports/quality/compact-compression.json`. aihub141/phase-b(정확도)는 GEMINI_API_KEY+데이터셋 필요 → 게이트.

## 필수 aihub141/phase-b 실행 조건 (게이트)
- `GEMINI_API_KEY` + (선택)`GATEWAY_URL`/`GATEWAY_MASTER_KEY` + `AIHUB_141_PATH`(사용자 데이터셋). API 비용 발생 → 사람 승인 후.
- 로컬 무의존 축 B = compact(완료) + 로컬 OfflineEmbedder recall@k(다음).

## Phase 5 — 한국어 recall@k (`src/benchmark/quality/recall-at-k.ts`) — 1차 무효+원인규명
fact-bank v2 200 facts + distractor, 172 라벨쿼리, multilingual-e5-large(1024d) 로컬.
**1차 결과 무효**: recall@1=0%, @10=12.2%, MRR=0.017 (near-zero). 원인 격리(clean-store 6-fact 재현 + 원시 코사인):
- **원시 임베딩은 정상**: 쿼리별 gold fact가 최고 코사인("알레르기"→땅콩 0.897, "취미"→기타 0.900). query/passage prefix 둘 다 판별.
- **깨끗한 임시 store + 6 fact = 어댑터 recall 완벽**(gold 전부 rank 0). 즉 어댑터 정상.
- **버그 1**: 벤치가 LocalAdapter 기본 공유 store(홈 하위 .naia/memory JSON) 사용 → 이전 실행 누적 오염.
- **버그 2 (실 finding)**: e5 dims 1024<2000 → auto=RRF. 한국어 FTS5 기본 토크나이저가 형태소 분절 못해 BM25 랭킹 오염 → gold 매몰. vector-only는 gold 0.87~0.93로 깨끗이 1위. ⇒ **한국어는 vector-only ≫ RRF** (실 품질 인사이트, /goal 기여).
- 조치: 벤치 수정(clean temp store + RRF vs vector-only 비교 + binary-quant TEXT-PK). e5 CPU 임베딩이 400 fact에 1162s(19분) — 비용 큼, distractor 제외로 반감.
- binary-quant vec0 PK: INTEGER PK 오류 → TEXT PK로 (perf harness서 검증된 패턴).

### Phase 5b — 수정 후 결과 + 최종 진단
clean temp store, 200 facts(distractor 제외), 172 라벨쿼리:
| mode | recall@1 | recall@5 | recall@10 | MRR |
|---|---|---|---|---|
| RRF (BM25+vec) | 0.6% | 2.3% | 8.7% | 0.018 |
| vector-only | 0.6% | 6.4% | 21.5% | 0.039 |
(direct_recall만: RRF @10=8.3% / vector-only @10=16.7%)

- 절대값 여전히 낮아 end-to-end 진단(gold 순위 직접계산, query vs passage prefix):
  - **직접 쿼리는 gold rank 0** ("음주 여부 관련 기억나는거"→"술 안 마셔" rank0, "DAU 목표 관련"→rank0). **검색 자체는 완벽 작동**.
  - **일반/추론 쿼리는 gold 매몰** — "취미 뭐야?" gold라벨="책 2권"인데 top="요리 취미"(더 맞음); "알레르기 있어?" gold라벨="약 아침에"(top="땅콩 알레르기"). **fact_ref 라벨 = 단일-gold 검색용 아님, LLM-judge 답변평가용.**
  - **passage-prefix 도움 안 됨**(rank 오히려↑) → "e5 문서 prefix 버그" 가설 **측정으로 기각**. 어댑터 query-prefix OK.
- **최종 결론**: fact-bank v2에 대한 recall@k(fact_ref)는 **부적합 지표**(라벨 성격 불일치로 과소평가). 유효한 것: (1) 검색은 직접쿼리서 정상 (2) **한국어 vector-only ≫ RRF**(@10 21.5 vs 8.7, FTS 토큰화 약점) — 상대신호 유효 (3) 답변품질은 LLM-judge(aihub141/phase-b, API게이트)가 정도(正道).
- 공유-store 버그가 성능도 악화(오염 store 매 upsert O(N²) 재저장 → 400fact 1162s). clean store로 200fact 8.5s.

## 이번 세션 산출물 (커밋 대기)
신규 하네스: `src/benchmark/perf/{deterministic-embedder,run-latency,breakdown,probe-binary-quant}.ts`, `src/benchmark/quality/{compact-bench,recall-at-k}.ts`.
리포트: `reports/perf/{README.md,latency-accuracy-count100000.json}`, `reports/quality/{compact-compression.json,recall-at-k.json}`.
진행: 본 파일. (커밋은 루크 지시 시)

## Phase 6 — #1 RRF 한국어 검색 결함 수정 (2026-07-04)
루크 "차례대로 진행" → 후보 순차 진행.
- **결함 확정(코드정독+계측)**: `local.ts` RRF 모드가 entity/KG 보너스(eb: 정확매치 +0.3, KG 활성 ×2)를 **완전 무시**(vector-only만 `vs+eb` 사용). 정확 entity 쿼리서 RRF ≪ vector-only(비정상).
- **검증(clean 단일-gold probe: 쿼리=고유 entity)**: 수정 전 RRF recall@1=2.9%/MRR 0.047 → 수정 후 5.3%/0.103 (2배). vector-only는 6.5%/0.192(불변, 참조).
- **수정**: RRF relevanceScore에 eb 추가(vector-only와 일관). `src/memory/adapters/local.ts` ~756.
- **무회귀**: 유닛 372/372 통과. fact-bank recall 불변(8.7%→8.7%, 추론쿼리는 eb=0이라 무영향).
- **깊은 finding(미변경, 스코프 필요)**: RRF K=60 rank-fusion이 벡터 신호 압축 → 시맨틱 임베더(e5 1024d)엔 vector-only가 recall@10 21.5 vs 8.7로 우월. 후보: dims<2000 vector-only 기본화 / RRF_K 하향 / score-based fusion. **retrieval 광범위 변경 → 별도 스코프 + clean 코퍼스/LLM-judge 검증 후.**
- ⚠ recall@k(fact-bank)는 부적합 지표라 이 설계변경 검증엔 못 씀.

## Phase 7 — #2 compact rolling-summary 팽창(162%) 수정 (2026-07-04)
- **결함 확정(recap 덤프 계측)**: `updateRollingSummary` eviction이 encode마다 1건씩 발생 → `compressEvictedMessages([1건])`가 메시지당 `[evicted 1:...]` 블록을 `rs.compressed`에 append → 무한 성장. 50 evict = 3625자 recap(입력 600토큰보다 큼). "compressed"가 압축 아닌 per-message 로깅.
- **수정**: 집계 다이제스트로 — `evictedCount`(누적)+`evictedFirst`(최초 quote) 필드 추가, stem = `"N earlier message(s) compacted; oldest: ..."` 한 줄. orphan `compressEvictedMessages` 제거. `rollingCompressedMax`는 방어적 cap으로 유지(옵션 계약·sentinel 경로 보존). `src/memory/index.ts`.
- **검증**: recap 3625→637자. compact-bench 압축률 **161.8%→29.7%**(971→178토큰). 유닛 **372/372 통과**(RS-07 sentinel 방어경로 유지).
- fidelity 70%→50%: 옛 70%는 로깅버그 부산물(162% 팽창 대가, 실사용불가). 이제 B는 A(deterministic 30%)보다 fidelity↑ & realtime=true인 합리적 지점. 추가 fidelity는 #3.

## Phase 8 — #3 compact deterministic fidelity: negative result (과적합 거부)
- 원칙적 접근 후보: 시스템 importance 점수로 salient 메시지 보존. **검증**: scoreImportance가 fact/filler 미구분 — "강아지 이름 Rex"=0.15 = "Okay what next?"=0.15, "That makes sense"=0.24(오히려↑). importance는 키워드/감정 휴리스틱이라 진술 사실을 못 짚음.
- 키워드/대문자 기반 보존 = 내 합성 anchor(대부분 대문자·하이픈)에 **과적합** — CLAUDE.md 자가개선 철학("꼼수·과적합 철저 배제") 위반.
- **결론(negative result)**: deterministic 고충실도 압축은 근본적 한계(~30-50%). 원칙적 해법 = **LLM summarizer(C=90% 이미 구현)**. 권고: 호스트(naia-agent)가 고충실 필요 시 summarizer 주입, deterministic은 zero-cost bounded 폴백. **과적합 개선 미시도(의도적).**

## Phase 9 — #4 binary-quant 실임베딩 recall 검증 → 보류 (2026-07-04)
`RUN_BINQUANT=1 recall-at-k` (실 e5, 200 한국어 facts, dims=1024):
- binary-only overlap@10 vs float: 34.7%
- 2-stage(coarse=50) overlap@10 vs float: **77.7%** (결정론 embedder는 100%였음 → **실 임베딩선 22% recall 손실**, Phase 3 flag 확인).
- **결정**: deep recall 이미 <100ms(41ms) 충족인데 binary-quant는 ~8ms 대가로 22% recall 희생 = latency 위해 품질 희생(게이트가 막던 함정). **어댑터 wiring 보류.** 재개 조건: (1) 1M+ 스케일서 latency 실병목화 (2) ~95%+ recall 보존하는 coarse 설정 확인(실 대규모 임베딩 검증 필요, 100k 실임베딩 19분 비용).
- 결정론 프로브(latency)는 유효, binary quant recall 검증엔 부적합 재확인.

## 다음 루프 후보 — 진행 상태 ("차례대로 진행" 2026-07-04)
1. ✅ **#1 RRF 한국어 검색** — eb 누락 결함 수정(Phase 6). 깊은 이슈(vector-only 기본화)는 미결(별도 스코프).
2. ✅ **#2 compact 팽창(162%)** — 집계 stem 수정(Phase 7). 162→30%.
3. ✅ **#3 compact fidelity** — negative result, 과적합 거부(Phase 8). LLM summarizer가 정도.
4. ✅ **#4 binary-quant** — 실임베딩 22% recall 손실 확인 → 보류(Phase 9).
5. ⬜ **#5 인지 속성 벤치** (감쇠곡선·재응고·consolidation·무의식 spike) — 소뇌 핵심, 아직 벤치 없음. **대형 신규 구축 → 별도 세션 권장.**
6. ⬜ **RRF vs vector-only 기본화 결정** (#1 깊은 finding) — retrieval 광범위 변경, clean 코퍼스/LLM-judge 검증 필요.
7. ⬜ **LLM-judge 축**(aihub141/phase-b) — GEMINI_API_KEY+데이터셋, API 비용 사람 게이트.

## 커밋 대기 (루크 지시 시)
- 코드 수정 2건: `src/memory/adapters/local.ts`(RRF eb), `src/memory/index.ts`(rolling stem 집계). 유닛 372/372 통과.
- 신규 하네스 6 + 리포트 2 + 진행 1.
