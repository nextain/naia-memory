# MIRACL 한국어 실제 배치 추론 A/B 사전등록

날짜: 2026-08-22

상태: 사전등록 (`REVIEW_ONLY`, 실행 전)

기준선 실행 커밋: `2693437c9ed0022b12026b4b23ee601d813fecae`

## 목적

`OfflineEmbeddingProvider.embedBatch()`의 문서별 추론을 Transformers 배열 입력의
실제 배치 추론으로 바꿀 때 CPU 처리량이 개선되는지, 그리고 q8 패딩에 따른 벡터
차이가 검색 품질을 훼손하지 않는지 검증한다. 8개 문자열 탐색 시험에서는 처리시간이
28.55ms에서 10.11ms로 2.82배 개선됐지만 벡터 성분 최대 절대 차이가
0.01556이었으므로, 속도만으로 변경을 채택하지 않는다.

## 선행 조건

현재 진행 중인 개별 추론 MIRACL 한국어 전체 코퍼스 기준선의 결과 JSON, TREC run,
소스 해시, 체크포인트 영수증을 먼저 고정한다. 기준선이 끝나기 전에 평가 CLI나
임베딩 공급자 소스를 변경하지 않는다.

## 실험군

- A: 현재 구현과 동일한 문서별 파이프라인 호출, 문서 배치 크기 8.
- B: 동일한 8개 전처리 문자열을 한 번의 배열 입력으로 전달하는 실제 배치 호출.
- 공통 고정값: MIRACL KO 소스 잠금, dev 213질의, 문서 1,486,752개, 문서 순서,
  `multilingual-e5-large` revision, q8, prefix, mean pooling, L2 normalization,
  최대 길이 512, title/text 조합, Qdrant cosine exact top-100, CPU-only.

## 증거 정체성 수정

현행 `embeddingPolicySha256`은 모델 정책과 passage 조합만 포함해 A와 B를 구분하지
못한다. 따라서 B 구현 전 정책 입력을 버전 2로 올리고 아래 항목을 포함한다.

- `inferenceMode`: `per-item-v1` 또는 `padded-array-batch-v1`
- `embeddingBatchSize`
- `inputOrder`: `corpus-ordinal-stable-v1`
- `transformersVersion`
- 기존 모델·전처리·passage 조합 전체

이 값은 Qdrant collection 이름과 체크포인트 identity에 반영되어 A 벡터를 B가
재사용할 수 없게 한다. 기존 A 결과의 실행 정체성은 고정된 평가 소스 해시와 정책
영수증의 결합으로 보존하되, 정책 해시만으로 추론 모드를 증명한다고 주장하지 않는다.

## 판정 기준

B 채택에는 다음 조건을 모두 요구한다.

1. 전체 코퍼스 `nDCG@10`과 `Recall@100` 각각의 B-A 평균 차이가 -0.005 이상이다.
2. 두 지표의 질의별 paired bootstrap 10,000회 95% percentile 신뢰구간 하한도
   각각 -0.005 이상이다. bootstrap seed는 `0x4e414941`로 고정한다.
3. 213개 질의의 top-10 집합 Jaccard 평균은 0.90 이상, top-100 집합 Jaccard
   평균은 0.95 이상이다.
4. A/B 질의 ID, qrels 범위, ranking 길이·중복을 fail-closed로 검증한다.
5. 동일한 독립 metric 재계산에서 JSON과 TREC 수치가 일치한다.
6. 격리된 고정 표본에서 A/B 실행 순서를 교차한 5회 warm run 중앙값과 전체 코퍼스
   벡터 생성 벽시계 시간이 모두 최소 1.5배 개선되고 peak RSS와 실패율을 공개한다.

품질 조건 하나라도 실패하면 B를 기본값으로 채택하지 않는다. 품질은 통과하지만
처리량 조건이 실패하면 성능 최적화로도 채택하지 않는다.

## 과적합·주장 경계

판정 임계값은 B 결과를 보기 전에 이 문서로 고정한다. 동일 dev 결과를 보고 배치
크기나 임계값을 바꾸지 않는다. 이 실험은 기존 임베딩 모델의 실행 최적화만 검증하며,
Naia 고유의 기억 업데이트·삭제·충돌 해결 우위를 증명하지 않는다. 한국어 한 언어의
통과를 다국어 전체의 증거로 확대하지 않는다.

## 실행 전 자체 적대감사와 보완

첫 문서에는 평균 품질 손실 기준만 있고 표본 불확실성은 채택 조건이 아니었다.
또한 Jaccard를 보고만 하도록 해 순위가 크게 달라져도 채택할 수 있었고, TREC와
qrels가 실제 기준선 결과에 결합됐는지 확인하는 실행 도구가 없었다. 이를 차단하기
위해 다음을 결과 확인 전에 추가했다.

- 두 metric 모두 평균 차이와 bootstrap 95% 하한에 비열등성 조건을 적용한다.
- top-10/top-100 Jaccard를 각각 0.90/0.95의 채택 조건으로 만든다.
- `ranking-ab-analysis.ts`가 정확한 질의 대응, qrels 범위, 중복 없는 exact top-100,
  결정론적 paired bootstrap을 fail-closed로 계산한다.
- `ranking-ab-analysis-cli.ts`가 잠긴 qrels를 재검증하고 A/B 결과 JSON의 TREC 해시,
  qrels 해시, 213질의, 1,486,752문서, exact search, top-100 설정을 결합한다.
- A/B의 MIRACL 소스·topics·코퍼스 docid·모델/전처리 정책·passage 조합·벡터 저장소
  설정이 모두 같은지 비교하고, 격리를 위해 달라야 하는 collection 이름만 제외한다.
- 분석 영수증의 `passed`는 순위 비열등성만 뜻한다. 처리량과 정책 정체성은 별도
  증거가 없으면 채택 판정에 사용할 수 없다.

검증 결과는 전용 테스트 8개, 전체 테스트 932개, benchmark 포함 TypeScript
typecheck 통과다.

## 적대 검토 상태

자동 외부 검토 세션은 소스와 호출부를 읽었으나 최종 판정문을 반환하지 않았다.
따라서 현재 상태는 `NOT_RUN/REVIEW_ONLY`이며 독립 검토 완료로 계산하지 않는다.
파일 접근을 제거한 기준 검토와 Claude 헤드리스 검토도 최종 판정문 없이 종료되어
동일하게 증거에서 제외했다.
실행 결과 채택 전에는 결과를 보지 않은 검토자에게 정책 정체성, 체크포인트 격리,
비열등성 기준, 통계 계산과 주장 문구를 다시 검토받는다.
