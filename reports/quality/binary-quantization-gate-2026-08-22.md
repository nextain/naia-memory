# Deep recall 이진 양자화 게이트 — 2026-08-22

## 판정

**현재 형태의 이진 양자화 + float 재랭크는 채택하지 않는다.** 실제 고정 revision
`multilingual-e5-large` 임베딩으로 측정했지만, 정확도를 보존하면서 corpus를 충분히
줄이는 후보 크기가 없었다. 결과 상태는
`no_practical_candidate_at_internal_scale`이며 제품 코드에는 연결하지 않았다.

기존 `recall-at-k.ts`의 2-stage overlap 77.7%는 근거에서 제외한다. 해당 경로는
`OfflineEmbeddingProvider.embed()`가 자체 E5 query prefix를 추가하는데도 호출자가
`query: `를 한 번 더 붙였고, 200개 중 50개(25%)를 재랭크했다. 이 보고서의 새
게이트는 원문 query를 한 번만 전달하고 실제 fact ID, exact float 기준, hard
distractor를 사용한다.

## 실측

CPU에서 언어별 310개 fact(원본 200 + distractor 110)와 gold fact가 있는 172개
질의를 평가했다. `coarse <= corpus의 25%`, top-10 overlap 95% 이상, recall@1/5/10
손실 각각 1%p 이하, MRR 손실 0.01 이하를 모두 만족해야 통과한다.

| 언어 | coarse | corpus 비율 | overlap@10 | recall@5 손실 | recall@10 손실 | 판정 |
|---|---:|---:|---:|---:|---:|---|
| 한국어 | 50 | 16.1% | 73.5% | 4.07%p | 1.74%p | 실패 |
| 한국어 | 100 | 32.3% | 88.4% | 1.74%p | 1.16%p | 실패 |
| 한국어 | 200 | 64.5% | 98.6% | 0 | 0 | 비실용적 |
| 번역 영어 | 50 | 16.1% | 85.4% | 2.33%p | 4.07%p | 실패 |
| 번역 영어 | 100 | 32.3% | 96.0% | 1.16%p | 1.16%p | 실패 |
| 번역 영어 | 200 | 64.5% | 99.8% | 0 | 0 | 비실용적 |

25% 제한은 최초 결과에서 64.5% 재랭크가 형식상 `candidate`로 표시되는 주장 결함을
결정론적 검토에서 발견한 뒤 추가했고, 전체 실험을 다시 실행했다. 이는 성능을 좋게
보이기 위한 사후 선택이 아니라, “대부분을 재랭크해 exact 결과를 복원”하는 무의미한
통과를 닫는 보수적 fail-close 조건이다.

## 증거와 한계

- 원시 artifact: `binary-quantization-gate-2026-08-22.json`
- 모델 공간: `Xenova/multilingual-e5-large@00fc3aeb...`, q8, 1024차원,
  query/passage-v2, CPU
- 입력 4개 파일과 구현 2개 파일의 SHA-256, git revision, runtime/CPU 영수증 포함
- 새 단위 테스트 2/2, 기본 회귀 90파일/831개, SQLite smoke 19개 통과,
  typecheck/build 통과. SQLite parity 6개는 기존 WIP RED이며 별도 공개 제한이다.
- 영어 corpus는 한국어의 결정론적 번역본이므로 독립 다국어 증거가 아니다.
- 310행 단일-fact recall은 10만행 latency나 synthesis/abstention/lifecycle 품질을
  예측하지 않는다. artifact의 sub-millisecond 값도 소형 내부 microbenchmark일 뿐
  제품 latency 주장에 사용하지 않는다.
- OpenCode 계획 리뷰와 Claude focused 리뷰 모두 최종 판정 없이 정체되어
  `NOT_RUN(timeout/interrupted)`이다. 복구 모드이므로 formal review-pass CLEAN을
  주장하지 않는다.

## 다음 최적화 방향

이진 sign/Hamming 후보화는 여기서 중단한다. 다음 실험은 정확도 보존 게이트를 그대로
유지하면서 대규모 corpus에서 sublinear 탐색을 제공하는 ANN 경로(HNSW 기반 외부
어댑터 또는 별도 deep index)를 비교해야 한다. 같은 입력·동일 top-k·독립 다국어
corpus에서 exact float 대비 recall 손실, lifecycle filtering, cold-start, 메모리와
p50/p95를 함께 측정하기 전에는 기본 SQLite 경로를 바꾸지 않는다.
