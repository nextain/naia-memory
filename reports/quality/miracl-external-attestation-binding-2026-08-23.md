# MIRACL 외부 실행 증명 바인딩 — 2026-08-23

## 결론

MIRACL 한국어 전체 코퍼스 실행 영수증을 독립 실행자의 Ed25519 서명 증명으로 승격할 수 있는 분리형 검증 경로를 구현했다. 기존 영수증은 계속 `LOCAL_PASS`, `self-observed-local`, `publicClaimEligible: false`로 남고, 별도 검증 봉투만 모든 검사를 통과할 때 `PUBLIC_ATTESTATION_PASS`가 된다.

현재 공개 적격 판정은 여전히 **false**다. 테스트에서 생성한 키와 서명은 공격 방어를 검증하는 합성 fixture일 뿐 실제 독립 실행 증거가 아니다. 공개 경쟁력 주장에는 외부 신뢰 도메인의 실행자가 동일 프로토콜을 실행하고 서명한 실제 challenge·attestation·실행 산출물이 추가로 필요하다.

## 바인딩 범위

- 데이터셋: MIRACL 소스 잠금, topics/qrels 해시, 문서·질의 수, 코퍼스 docid 체인, passage 구성
- 프로토콜: exact search, top-k, 평가 지표·허용오차, 고정된 `trec_eval` 버전·커밋·바이너리
- 구현: 평가 및 런타임 모니터 소스, Qdrant 버전·커밋, 임베딩 모델·리비전
- 설정: 실행 설정, 임베딩 정책 해시, Qdrant 런타임 설정
- 실행 증거: 결과·TREC·launch·runtime 해시, 체크포인트 체인, 평가 stdout, 반복 평가 안정성
- 원본 영수증: 파싱 후 재직렬화가 아니라 정확한 입력 바이트의 SHA-256

각 매니페스트 해시는 영수증 안에서 재계산되며, 외부 실행자의 증명은 원본 영수증 해시와 다섯 매니페스트 해시를 모두 서명한다. 공개 판정은 발급자·실행자 이름 분리, 공개키 재료 분리, 실행자 신뢰 도메인 분리, 챌린지 nonce·시간 범위, Ed25519 서명을 모두 fail-closed로 검사한다.

## 적대 검토

OpenCode 구현 리뷰 1차는 세 가지를 제기했다.

1. 이름만 다른 동일 공개키를 발급자와 실행자에 등록하는 별칭 공격: 유효. SPKI DER 공개키 비교와 회귀 테스트를 추가했다.
2. 실행 전 challenge에 미래의 receipt 해시를 포함하라는 제안: 기각. challenge는 실행 전에 발급되며, 사후 runner attestation이 정확한 원본 receipt와 전체 실행 바인딩을 서명한다. 악성 runner가 새 receipt에 재서명하는 문제는 challenge 필드 추가로 해결되지 않는다.
3. 동일 키 공격 테스트 부재: 유효. 별칭 이름과 동일 키 material 조합이 거부되는 테스트를 추가했다.

수정 후 2차 OpenCode 리뷰는 지정한 공격면에서 `NO BLOCKING FINDINGS`를 보고했다. 이는 정식 `review-pass CLEAN` 주장이 아니며, OpenCode 기반 읽기 전용 적대 검토 기록이다.

## 검증 결과

- 집중 검증: 2 test files, 22 tests passed
- 전체 검증: 125 test files, 1,032 tests passed
- TypeScript typecheck: passed
- Biome intended-file check: passed
- `git diff --check`: passed
- GPU 사용: 없음
- MIRACL 장기 CPU 실행: 2026-08-23 확인 시 12시간 15분 이상 생존, 평가 프로세스 약 2,300% CPU

워크스페이스의 `verify-benchmark-contract` 스킬은 `packages/benchmark-contract`와 듀얼 컨텍스트 라우팅 변경을 위한 절차다. 이번 변경은 naia-memory의 자체 품질 하네스이므로 해당 패키지 명령 대신 프로젝트의 관련 단위 테스트, 전체 테스트, 타입 검사와 결정론적 포맷 검사를 실행했다.

## 남은 공개 게이트

1. 현재 진행 중인 MIRACL 전체 코퍼스 실행을 완주하고 원본 LOCAL_PASS 영수증을 생성한다.
2. 운영자와 다른 신뢰 도메인의 실행자에게 고정 challenge를 전달한다.
3. 동일 데이터·프로토콜·구현·설정으로 독립 재실행하고 실제 서명 attestation과 실행 산출물을 회수한다.
4. 분리형 검증 봉투가 실제 증거에서 통과한 경우에만 공개 적격으로 표시한다.
5. 동일 입력·동일 평가 계약으로 글로벌 비교 엔진 영수증을 수집한 뒤 최종 경쟁력 보고서에 포함한다.

따라서 이번 단계는 “성능이 글로벌 최고임을 증명”한 것이 아니라, 앞으로 나온 성능 수치를 운영자 자기 관측만으로 공개 주장하지 못하게 하고 독립 재현 증거에 정확히 묶을 수 있게 만든 신뢰성 개선이다.
