# 사용자 시나리오

## UC-BENCH-01 — 운영자가 한국어 검색 성능을 신뢰할 수 있게 비교한다

운영자는 `naia-memory`가 한국어 사용자 사실을 어떤 조건에서 회상하는지와, 이전 실행·경쟁 엔진 결과가 공정하게 비교 가능한지를 확인하고 싶다. 실행 결과에는 코드 리비전, 데이터셋 무결성, 검색 설정, 실행 환경, 실제 생성 시각이 남아야 한다. 단일 숫자가 아니라 조사·어미·복합어·의미 재표현·부정 충돌·시간성·개체 구분·무관 질의의 실패 유형별 결과를 확인한다.

## UC-BENCH-02 — 개발자가 개선을 과적합 없이 검증한다

개발자는 고정된 공개 한국어 평가 세트와 별도의 보류 세트를 사용해 검색 로직 변경 전후를 재실행한다. 검색 계층은 후보 문서를 반환할 뿐 응답 또는 abstention 결정을 하지 않는다. 범주별 가중치나 임계값을 조정하지 않고 하나의 동일한 설정으로 모든 질의를 평가한다.

## Test Coverage Map

| 사용자 시나리오 | 검증 대상 | 테스트/실행 |
| --- | --- | --- |
| UC-BENCH-01 | 결과 영수증의 시각·리비전·데이터셋 해시·환경 누락 방지 | `src/benchmark/**` 검증 및 생성 벤치마크 결과 |
| UC-BENCH-01 | 한국어 실패 유형과 기대/금지 후보 라벨의 구조 | `BENCH_VALIDATE_ONLY=1 pnpm exec tsx src/benchmark/quality/korean-retrieval-contract.ts` |
| UC-BENCH-02 | 동일 설정으로 전체 범주를 평가하고 retrieval만 채점 | `BENCH_SEARCH_MODE=rrf|vector-only pnpm exec tsx src/benchmark/quality/korean-retrieval-contract.ts` |
