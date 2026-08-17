# Naia Memory 벤치마크 증거 루프 — 2026-08-13

## 이번 실행에서 확인한 것

- CPU 전용 소형 지연 기준선: 1,000 합성 facts, 30 samples, 384 dims에서 surface p50 0.75ms / p95 0.83ms, deep p50 0.67ms / p95 1.08ms.
- 결과: `reports/perf/latency-accuracy-count1000.json`. 이 파일은 실제 생성 시각, Git revision/dirty 상태, 설정, Node·OS·CPU 환경을 영수증으로 포함한다.
- 기존 `count100000` 보고서의 `generatedAt`은 고정 benchmark clock을 사용한 과거 시각이었다. 이제 clock은 재현용 설정으로 분리하고 실제 생성 시각은 receipt에 남긴다.

## 신뢰 경계

이 지연 수치는 deterministic bag-of-tokens 임베더와 합성 코퍼스에서 SQLite/FTS5/sqlite-vec 검색 경로를 측정한 것이다. 한국어 의미 검색, 사용자 응답 정확도, GPU 성능을 뜻하지 않는다. GPU 1은 사용하지 않았다.

기존 한국어 recall@k 보고서는 241개 질의에 단일 `fact_ref`만 부여한다. 예를 들어 일반적인 취미·알레르기 질의가 임의의 하나의 사실에 고정돼 있어 다중 정답과 검색 후보를 오판할 수 있다. 따라서 기존 수치는 역사적 진단 자료로만 취급한다.

## 한국어 retrieval 계약 실측

`src/benchmark/quality/korean-retrieval-contract-v1.json`은 16개 수동 검토 질의를 11개 범주(조사·어미, 맛 복합어, 의미 재표현, 부정 충돌, 개체 구분, 시간 문맥 등)로 나눈다. 각 질의는 `acceptable_fact_ids`와 `forbidden_fact_ids`를 함께 가져, 포괄적인 질문을 임의의 단일 사실로 고정하지 않는다. 200개 사실과 110개 하드 네거티브를 같은 코퍼스에 넣고 CPU에서 실행했다.

| 설정 | hit@1 | hit@5 | MRR | forbidden@1 | forbidden@5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| RRF (기본) | 6.3% | 56.3% | 0.226 | 25.0% | 43.8% |
| RRF, KG spreading 비활성 | 6.3% | 56.3% | 0.226 | 25.0% | 43.8% |
| vector-only | 25.0% | 50.0% | 0.365 | 18.8% | 56.3% |

영수증: `reports/quality/korean-retrieval-contract-v1-rrf.json`, `reports/quality/korean-retrieval-contract-v1-rrf-no-kg-spreading.json`, `reports/quality/korean-retrieval-contract-v1-vector-only.json`. 둘 다 fact-bank/계약 데이터 해시, Git revision·dirty 상태, Node·OS·CPU, CPU 고정 설정을 기록한다.

KG spreading 비활성 실행은 기본 RRF와 전 지표가 같았다. 이 고정 코퍼스에는 KG 확산을 판별할 연결된 사실 그래프가 없으므로, 이 설정을 품질 개선 후보나 원인으로 해석하지 않는다.

결론은 아직 개선 완료가 아니다. vector-only는 1위 정확도와 MRR을 높였지만 금지 사실의 top-5 노출을 악화한다. 이 트레이드오프 때문에 기본 검색 모드를 바꾸지 않았으며, 다음 변경은 이 고정 계약에서 forbidden@1·@5를 함께 낮추는 경우에만 채택한다. 이 벤치는 retrieval만 점수화하고, 의도·응답·abstention은 naia-memory 범위 밖이다.

## 사후 적대 검토: RRF 후보 기각

BM25 0점 문서에 삽입 순서 기반의 RRF 순위 기여가 생기는 일반 결함을 발견해, 0점 문서를 BM25 순위 스트림에서 빼는 후보를 만들었다. 이 후보는 CPU에서 두 번 같은 결과로 재현됐다. 그러나 기준선 대비 hit@1은 6.3%→12.5%, hit@5는 56.3%→68.8%, MRR은 .226→.322로 올랐어도 forbidden@1은 25.0%→31.3%, forbidden@5는 43.8%→50.0%로 악화됐다. 따라서 후보는 되돌렸고 기본 검색 동작은 바꾸지 않았다. 세부 반례와 다음 실험 조건은 `reports/rrf-correction-adversarial-review-2026-08-13.md`에 기록한다.

## 경쟁 엔진 비교

Mem0 등과 직접 비교하려면 같은 fact/query 세트, 후보 수, 판정 규칙, 임베딩 모델·하드웨어·warmup/반복 수가 필요하다. 이 중 하나라도 다르면 “참고 수치”이지 승패 근거가 아니다. 현 저장소의 과거 비교는 이 조건이 섞여 있어 재실행 계약을 먼저 맞춰야 한다.
