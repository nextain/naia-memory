# MIRACL 아랍어 전체 코퍼스 실행 자격화

날짜: 2026-08-23

상태: `RUNNER_QUALIFIED / SCORE_PENDING`

## 결과

MIRACL 아랍어 dev 평가 소스와 전체 코퍼스를 고정 revision에서 내려받아 모든 파일의
크기와 SHA-256을 검증했다. 압축 코퍼스 5개 샤드를 순서대로 전수 스캔한 결과는
2,061,414문서이며, ordered docid stream SHA-256은
`b81389dd2afad4d0273ec92c25f446b478cb41afb8327c162f8919d93b3c3659`다.
topics와 qrels는 각각 사전등록된 2,896개 질의를 포함한다.

이 관측값을 실행 계약에 고정하고, 기존 한국어 전용 전체 코퍼스 러너가 언어별 소스
영수증을 검증하도록 일반화했다. 소스, 체크포인트, Qdrant collection, 결과 경로는
언어와 소스·임베딩 정책 해시로 분리된다. CPU-only 강제 조건은 유지된다.

## 주장 경계

이 체크포인트는 아랍어 실행 입력과 러너가 자격화됐다는 뜻일 뿐, 검색 품질이나
다국어 우위를 증명하지 않는다. 아랍어 full-corpus exact-vector 점수와 독립 재계산이
완료되기 전에는 외부 경쟁력 주장에 사용할 수 없다. 영어는 소스 manifest만
고정됐으며 전체 문서 수와 ordered docid identity가 아직 자격화되지 않았다.

## 적대 리뷰

OpenCode `big-pickle` scoped review는 실제 다운로드 바이트 7개, 전체 문서 스캔,
topics/qrels cardinality, 한국어 legacy namespace 동등성, 언어 간 캐시 격리와
CPU-only guard를 재검증하고 `PASS`를 반환했다. 비본질 hardening 지적으로 명시한
한국어 source receipt 경로가 존재하지 않을 때의 묵시적 fallback은, 사용자가 경로를
명시한 경우 fail-closed하도록 반영했다.
