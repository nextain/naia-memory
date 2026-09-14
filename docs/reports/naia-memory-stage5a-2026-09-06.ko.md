# 단계 5A: SQLite 시간 검색과 감정 회상

작성일: 2026-09-06 · 개발·측정: Luna max · 설계·검토: Astra

SQLite의 epoch 등록·조회와 시점 검색, 강한 감정의 기억을 찾는 flashbulb 회상을 보완했다. Astra는 첫 검토에서 열린 시간 구간의 의미 차이를 발견해 보류했고, 수정된 소스와 원시 결과를 검토한 뒤 **5A 범위 수용**으로 판정했다. SQLite 전체 기능 동등성 판정은 아직 아니다.

epoch는 워커 transaction으로 저장되고 재시작 후에도 조회된다. 명시적 `atTimestamp`가 우선하며, epoch 이름은 대소문자를 구분하지 않고 찾는다. 시간 구간 검색은 R-Tree 후보를 원래 정수 timestamp로 다시 검사하고, 같은 base ID에서는 구간과 겹치는 최신 버전 하나를 선택한다. 종료 시점이 없는 epoch는 검색 시작 시점의 단일 시각을 SQL 후보 선택과 버전 선택에 함께 사용한다.

flashbulb 후보는 긍정·부정 양쪽의 강한 감정을 포함하며, 벡터나 키워드 일치가 없어도 검색할 수 있다. 활성 상태와 엄격한 프로젝트 범위를 함께 적용한다.

| 검사 | 수정 후 결과 | 해석 |
|---|---:|---|
| SQLite smoke | 35/35 통과 | 기존 30개와 새 회귀 5개 |
| 별도 SQLite parity | 6/8 통과 | 이전 3/8에서 epoch 2개와 flashbulb 1개 해결 |
| 기존 검사만 집계 | 36/38 통과 | 별도 두 실행의 기존 사례 합계 |
| 새 검사 포함 집계 | 41/43 통과 | 전체 기본 suite 재실행 수치가 아님 |
| TypeScript 검사 | 통과 | 원시 로그에 진단 없음 |

현대 밀리초 timestamp에서 구간 양끝 포함과 양끝 밖 1ms 제외, 다른 프로젝트 제외, 닫힌 구간의 재시작 후 동일 결과를 확인했다. 열린 구간에서는 미래 사실과 구간 이전에 끝난 사실의 제외를 확인했다. 열린 구간 질의 자체의 재시작 반복 검사는 이번 증거에 포함되지 않는다.

검사 보존은 **5A 시작 시 캡처한 소스**를 기준으로 확인했다. 새 smoke 5개를 제거하면 캡처한 이전 파일과 바이트가 일치하고 epoch·flashbulb 검사 파일도 유지된다. 이전부터 존재한 작업 디렉터리 변경까지 Git HEAD와 동일하다는 뜻은 아니다.

남은 실패는 semantic consolidation과 cross-domain analogy다. 다음 5B에서 지식 그래프·연관 회상, 감쇠, procedural memory, episode 전체 상태, migration과 대기 중 쓰기 완료를 구현하고 기존 38개 전체 통과 및 Local/SQLite 상태·재시작 비교를 확인한다. SQLite 암호화 백업은 후속 5C의 원자적 복원 검증 전까지 미지원이다.

근거: [Astra 최종 검토](../../reports/validation/stage5a-sqlite-parity-20260906/astra-review-final.md), [첫 보류 검토](../../reports/validation/stage5a-sqlite-parity-20260906/astra-review-initial.md), [smoke 원시 결과](../../reports/validation/stage5a-sqlite-parity-20260906/after-open-epoch-smoke.log), [parity 원시 결과](../../reports/validation/stage5a-sqlite-parity-20260906/after-open-epoch-parity.log), [TypeScript 결과](../../reports/validation/stage5a-sqlite-parity-20260906/after-open-epoch-typecheck.log), [5B 설계 검토](../../reports/validation/remaining-plan-20260905/astra-stage5b-map-review.md).
