# MIRACL 영어 primary 사전검증 보고서 — 2026-08-25

## 결론

영어 전체 소스에서 결정론적으로 뽑은 길이 층화 표본으로 primary 임베딩 경로를
검증했다. 실행 게이트는 `PASS`였지만, 현재 `padded-array-batch-v1`은 CPU에서
per-item 경로보다 **60.1% 느렸다(처리량 0.399배)**. 검색 nDCG@10은 유지됐으나
결과 집합은 완전히 동일하지 않았고 장문에서 벡터 차이가 커졌다. 따라서 이 결과는
영어 전체 실행을 시작할 수 있는 사전검증 증거이지, 배치 최적화·동등성·다국어 전이·
대외 경쟁력 주장의 증거가 아니다.

## 소스와 표본

- MIRACL 영어 전체 소스: 32,893,221문서, 압축 shard 66개, 5,060,264,106 bytes
- 전체 docid 중복: 0
- 전체 docid SHA-256: `23a425f3889a6b6a3f41f32666cb748fca05ae2e750abad13ebbc0354ebb7847`
- source lock SHA-256: `99727481b47a8a423ad8fa54ca09c8296515fba17ce9c9ce6356e53654918549`
- 표본: 7개 UTF-8 byte 길이 구간마다 1,024개, 합계 7,168문서
- 표본 passage SHA-256: `c433b84c3776d2bb96686c25d61800f659a7c51859a8459d81eef4723cad8356`

원래 계약의 `>=8192 bytes` 구간에는 전체 영어 코퍼스에도 366문서뿐이어서 구간당
1,024개라는 사전등록 조건을 충족할 수 없었다. 표본 수를 줄여 검정력을 낮추지 않고
`>=4096 bytes` 꼬리 구간으로 병합했다. 이 변경은 실제 전체 분포에서 확인된 계약
불가능성을 해소한 것이며 결과를 보고 임계값을 유리하게 조정한 것이 아니다.

전체 스트림 처리 중 모든 docid를 메모리 `Set`에 다시 보관하던 중복 검사를 제거했다.
상류의 disk-backed 전체 중복 검증을 신뢰하는 verified 모드에서는 연속 ordinal만
검증하고, 독립 표본 모드의 docid·ordinal 중복 검사는 그대로 유지한다. 100,000행
회귀 테스트를 추가했고 전체 소스 스캔의 메모리는 약 335MB 수준에서 유지됐다.

## 측정 결과

| 항목 | per-item | padded batch | 해석 |
|---|---:|---:|---|
| CPU 처리량 (docs/s) | 10.3947 | 4.1476 | batch/per-item 0.3990 |
| 잠금 질의 nDCG@10 | 0.983664 | 0.985295 | 64질의 표본에서 유지 |
| top-10 Jaccard | — | 0.738152 | 순위 집합은 동일하지 않음 |
| top-100 Jaccard | — | 0.660346 | 순위 집합은 동일하지 않음 |

- per-item 대비 batch cosine: 최솟값 0.916390, 중앙값 0.991708
- batch 순서 변경 cosine: 최솟값 0.901252, 중앙값 0.991870
- 최대 절대 벡터 차이: 0.049340
- 가장 큰 열화 구간: `>=4096 bytes`(cosine 최솟값 0.916390)
- 반복 실행 벡터는 bit-identical이었고 모든 값은 finite였다.

높은 nDCG는 source-derived 표본 내부의 64개 질의 결과다. 3,289만 문서 전체 영어
검색 품질, 통계적 비열등성, 다른 언어의 품질을 의미하지 않는다.

## 증거와 재현 경계

- 실행 증거: `reports/quality/miracl-en-primary-preflight/evidence.json`
- 실행 증거 SHA-256: `1c2284a5e6af4f5c3cfe256f17794fb5195d42753b4e9f13d23a1bafc21b447f`
- 벡터 artifact SHA-256: `b20970d2ac62d8d8fdec2339bb100f8f6f980b8c5c36dc9ff0fc98a514dc6042`
- source receipt 내부 passage SHA-256: `bbe692cd1e280cde8b2b6d674b1795c8adfeb7b3883ce226e927440cea476ab9`
- 실행은 `CUDA_VISIBLE_DEVICES=`로 CPU에 한정했다. GPU1은 사용하지 않았다.

대용량 source receipt(23MB)와 raw vector artifact(113MB)는 로컬 재검증 산출물이며
저장소에는 넣지 않는다. 저장소에는 해시가 결합된 소형 evidence와 본 보고서를 남긴다.

## 다음 개선 연구

현재 패딩 배열 배치를 제품 경로에 승격하지 않는다. 다음 preregistered 실험은 문서
길이 버킷으로 불필요한 패딩을 줄이는 경로와 실제 텐서 batch 경로를 각각 비교한다.
승격 조건은 per-item 대비 처리량이 실질적으로 증가하고, 장문 층의 cosine 및 잠금
검색 비열등성 조건을 동시에 만족하는 것이다. 조건을 통과한 뒤에만 영어 전체
32,893,221문서 실행 승인 게이트로 진행한다.

## 검증

- Vitest: 168 files, 1,410 tests 통과
- TypeScript: 제품 및 benchmark 두 설정 통과
- `git diff --check`: 통과. 실행 소스는 evidence producer 해시와 byte-identical하게
  보존해 포맷터의 한 줄 재배치는 적용하지 않았다.
- 공개 claim eligibility: 전 항목 `false`

독립 OpenCode `opencode/big-pickle` 적대 검토는 첨부 파일 탐색까지 수행했지만 180초
제한 안에 최종 판정을 반환하지 못했다. 상태는 `NOT_RUN(timeout)`이며 승인이나
`review-pass CLEAN`으로 간주하지 않는다. 결정론적 테스트와 해시 검증은 이와 별개로
통과했지만, 대외 공개 전에는 현재 digest에 대한 독립 판정이 다시 필요하다.
