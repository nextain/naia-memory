# 사용자 시나리오

## UC-BENCH-01 — 운영자가 한국어 검색 성능을 신뢰할 수 있게 비교한다

운영자는 `naia-memory`가 한국어 사용자 사실을 어떤 조건에서 회상하는지와, 이전 실행·경쟁 엔진 결과가 공정하게 비교 가능한지를 확인하고 싶다. 실행 결과에는 코드 리비전, 데이터셋 무결성, 검색 설정, 실행 환경, 실제 생성 시각이 남아야 한다. 단일 숫자가 아니라 조사·어미·복합어·의미 재표현·부정 충돌·시간성·개체 구분·무관 질의의 실패 유형별 결과를 확인한다.

## UC-BENCH-02 — 개발자가 개선을 과적합 없이 검증한다

개발자는 고정된 공개 한국어 평가 세트와 별도의 보류 세트를 사용해 검색 로직 변경 전후를 재실행한다. 검색 계층은 후보 문서를 반환할 뿐 응답 또는 abstention 결정을 하지 않는다. 범주별 가중치나 임계값을 조정하지 않고 하나의 동일한 설정으로 모든 질의를 평가한다.

## UC-BENCH-03 — 검증자가 독립 다국어 데이터셋의 출처를 확인한다

검증자는 게시자의 “독립 작성” 표기만 신뢰하지 않고 데이터셋 해시에 결박된 저자 서명과 언어별 원어민 검수 서명을 확인한다. 한국어 검수자의 유효한 서명이라도 영어 검수 증거로 제출되면 공개 비교를 승인하지 않는다.

## UC-MEM-01 — 사용자가 바뀐 단일값 사실을 현재값과 이력으로 모두 신뢰한다

사용자는 “성수동에 산다” 뒤 “판교로 이사했다”처럼 같은 대상·속성의 값이 바뀌었을 때, 최신 회상에서는 판교만 우선 보되 이력 회상에서는 두 원문과 각 출처를 추적할 수 있기를 원한다. 추출기가 대상·속성을 확실히 식별하지 못하면 시스템은 어떤 원문도 자동으로 대체하지 않는다.

## UC-MEM-02 — 다국어 입력이 한국어 전용 규칙으로 훼손되지 않는다

운영자는 한국어를 첫 검증 언어로 사용하되 영어·일본어 등 다른 언어의 원문도 동일한 보존 모델로 저장되기를 원한다. 언어별 정규식이나 순위 상수에 기대지 않고, 구조화 근거가 없는 입력은 기존 텍스트 검색으로 안전하게 폴백해야 한다.

## Test Coverage Map

| 사용자 시나리오 | 검증 대상 | 테스트/실행 |
| --- | --- | --- |
| UC-BENCH-01 | 결과 영수증의 시각·리비전·데이터셋 해시·환경 누락 방지 | `src/benchmark/**` 검증 및 생성 벤치마크 결과 |
| UC-BENCH-01 | 한국어 실패 유형과 기대/금지 후보 라벨의 구조 | `BENCH_VALIDATE_ONLY=1 pnpm exec tsx src/benchmark/quality/korean-retrieval-contract.ts` |
| UC-BENCH-02 | 동일 설정으로 전체 범주를 평가하고 retrieval만 채점 | `BENCH_SEARCH_MODE=rrf|vector-only pnpm exec tsx src/benchmark/quality/korean-retrieval-contract.ts` |
| UC-BENCH-03 | 데이터셋 저자·언어별 원어민 검수의 신뢰 키, 서명, 목록 일치 | `src/benchmark/quality/public-evidence-review.test.ts` — provenance forgery and cross-language trust attacks |
| UC-MEM-01 | 동일 subject/property의 단일값 변경만 supersede하고 원본·출처·시간 체인을 보존 | `src/memory/__tests__/memory-system.test.ts` — Korean current/history, ambiguity, multi-value cases |
| UC-MEM-02 | 구조화 추출이 없는 비한국어 사실은 기존 검색·저장을 유지하고, 구조가 있으면 언어 중립 비교로 체인 연결 | `src/memory/__tests__/memory-system.test.ts` — English/Japanese fallback and normalized-key cases |
