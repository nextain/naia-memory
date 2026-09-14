# Naia Memory SQLite 지원 범위 표

작성일: 2026-09-05 · 대상: 로컬 P0 구현 검토

**후속 결과(2026-09-06):** 아래 표는 3단계까지의 기록이다. [5A 보고서](naia-memory-stage5a-2026-09-06.ko.md)에서 epoch·시점 검색·flashbulb 보완이 Astra 검토를 통과했다. 별도 smoke 35/35와 parity 6/8이며, 기존 사례만 합치면 36/38이다. 아래 epoch 미지원과 flashbulb 미완료 항목은 5A 결과로 갱신되었다. KG·consolidation 등 나머지 기능과 SQLite 백업은 후속 단계 검증 중이다.

이 표는 이번 단계에서 소스와 격리된 SQLite 테스트로 확인한 범위를 기록한다. SQLite를
LocalAdapter와 완전히 동등하다고 선언하거나 후속 연구를 완료했다는 뜻은 아니다.
parity 테스트는 별도 명령으로 유지하며 실패를 숨기지 않는다.

strict scope 검색 최적화의 결과는 [성능 개선 실행 보고서](naia-memory-performance-stage-2026-09-05.ko.md), mmap 선택 옵션은 [2단계 보고서](naia-memory-performance-stage2-2026-09-05.ko.md), 최신 백업 지원 판정과 패키지 검증은 [3단계 보고서](naia-memory-stage3-2026-09-05.ko.md)에 있다. 3단계 수정 후 기본 검사는 172파일·1,473개 모두 통과했고, 전체 SQLite 검사는 smoke 30/30과 parity 3/8을 합쳐 33/38이다. smoke는 벡터 검색의 프로젝트 격리와 active/hot·superseded·archived 상태의 surface/deep/history 처리를 포함한다.

| 표면 | 현재 판단 | 근거와 제한 |
|---|---|---|
| 사실 저장·`getAll()`·키워드 회상 | 확인 | `sqlite-smoke.test.ts`의 30개 smoke 검사. 각 테스트는 임시 디렉터리의 SQLite 파일을 사용한다. |
| 동시 upsert와 실패한 batch 롤백 | 확인 | smoke에서 동시 제출의 영속성과 잘못된 행이 포함된 batch의 전체 롤백을 확인한다. |
| 구조화된 사실 metadata와 엄격한 project 범위 | 확인 | smoke의 round-trip, 사실·episode scope, 비정상 embedding 및 FTS 검사가 근거다. |
| 대규모 후보·벡터 수명주기·embedding 공간 식별 | 확인 | smoke의 1,000건 초과 검색, inactive index, 문서 전처리, 차원·공간 불일치 및 명시적 reindex 검사를 통과한 범위다. |
| 수동으로 만든 과거 validity chain의 history 회상 | 부분 확인 | `daily-ground-benchmark.test.ts`가 predecessor의 `validFrom/validTo`를 저장 후 확인하고 history 회상을 검사한다. `createdAt`은 보존하며 production 시간 정책이나 clamp는 바꾸지 않았다. |
| epoch 등록·epoch 조회의 실제 adapter 지원 | 미지원 | `SqliteAdapter.upsertEpoch/getEpochs`는 아직 동작을 제공하지 않는다. smoke의 날짜 범위 회상 검사는 유지하지만 epoch 지원의 증거로 사용하지 않는다. |
| flashbulb·semantic consolidation parity | 미완료 | 네 parity 파일을 `pnpm test:sqlite:parity`로 별도 실행한다. 실패를 skip하거나 green으로 바꾸지 않았고, 무차별 stub throw도 추가하지 않았다. |
| SQLite semantic `decay`·`associate` | 미구현 | `semantic.decay()`는 현재 `0`을 반환하고 `associate()`는 no-op이다. 수명 감쇠나 연관 강화의 SQLite 동등성은 확인하지 않았다. |
| SQLite procedural memory | 미지원 | `getSkill()`은 `null`, `getReflections()`는 빈 목록을 반환하며 `recordOutcome()`·`learnFromFailure()`는 no-op이다. |
| SQLite hubs·knowledge graph | 미지원/빈 상태 | `getHubs()`는 `{}`, `getKGState()`는 `emptyKGState()`를 반환한다. 노드·간선 테이블이 있어도 해당 adapter API의 읽기·갱신 동작은 구현 범위로 확인하지 않았다. |
| SQLite adapter `consolidate()` | 미지원/빈 결과 | 현재 `{ episodesProcessed: 0, factsCreated: 0, factsUpdated: 0, memoriesPruned: 0, associationsUpdated: 0 }`를 반환한다. semantic consolidation parity 실패와 함께 후속 구현 대상으로 남긴다. |
| SQLite 직접 backup `export/import` | 미지원 명시 | 빈 성공값 대신 명시적인 rejection을 반환한다. 직접 adapter 호출, 실패 import 전후 데이터 보존, rejection 후 adapter 재사용을 검사한다. |
| `MemorySystem.exportBackup/importBackup` (SQLite) | 미지원 명시 | 지원 판정에서 거부한다. 실패 import 전후 데이터와 adapter 재사용을 확인한다. 직접 adapter 메서드의 명시적 rejection도 유지한다. |
| `MemorySystem.supportsBackup()` (SQLite) | 불일치 수정 | SQLite는 `backupSupported = false`를 선언한다. MemorySystem은 명시적 미지원과 export/import 두 함수의 존재 여부를 함께 검사한다. |
| provider의 `exportBackup/importBackup` 경로 | 호출 경로 수정 | MemorySystem의 공개 API로 위임한다. SQLite provider의 `supportsBackup`와 `isCapable`은 false이며 기존 provider 동기 오류는 유지한다. LocalAdapter 암호화 왕복과 잘못된 비밀번호에서 데이터 보존을 검증한다. |
| trust-anchor CLI subprocess | 현재 환경에서 통과 | 실행 제한 해제 후 부모의 기본 검사에서 6/6 통과했다. `/tmp/naia-memory-perf-stage-20260905-default-before.log`의 전체 1,431/1,431 통과에 포함된다. 앞선 제한 환경의 2/6 결과는 과거 실행 기록에 유지하며 환경 변화와 코드 효과를 구분한다. |
| LocalAdapter 암호화 backup | provider 공개 경로 검증 | 백업 집중 50개와 빌드된 패키지 루트 import에서 암호화 왕복, 잘못된 암호의 데이터 보존, 복원 후 재시작을 확인했다. SQLite 지원의 증거로 대체하지 않는다. |

## R-Tree와 fixture 조건

SQLite 시간 R-Tree는 `min_ts <= max_ts`를 요구한다. 일일 benchmark는 실제 과거 chain을
수동으로 구성하므로 predecessor의 `validFrom`을 `now - 30일`, `validTo`를
`now - 15일`로 명시하고, consolidation에서 생성된 원래 `createdAt`은 유지한다. 저장 후
두 값을 다시 읽어 확인한다. 이 수정은 fixture의 시간 관계를 명확히 하는 것이며, 생산 코드의
시간 clamp나 정책 변경이 아니다.

## 실행 경로

```text
pnpm test:sqlite:smoke --maxWorkers=1
pnpm test:sqlite:parity --maxWorkers=1
pnpm exec vitest run src/memory/__tests__/sqlite-backup-unsupported.test.ts src/memory/__tests__/backup.test.ts --maxWorkers=1
pnpm typecheck
```

앞선 P0 단계에서 Luna는 표적 실행의 smoke 19/19, backup rejection과 기존 Local backup 회귀 21/21,
`pnpm typecheck` 통과를 보고했다. 이 실행의 별도 원시 로그는 남기지 않았으며, 부모가 직접
확인한 결과는 [P0 실행 기록](naia-memory-p0-execution-2026-09-05.ko.md)을 기준으로 한다.
trust-anchor CLI는 앞선 제한 환경에서 부모의 격리·기본 검사 모두 2/6 통과였고,
실행 제한 해제 후 부모의 기본 검사에서는 6/6 통과했다. 당시 원문은 위 표의 로그에 있으며 최신 전체 실행은 [3단계 증거](../../reports/validation/backup-path-20260905/README.md)에 보존했다. parity는 4파일 8개 중
3개 통과·5개 실패로 남았고, 실패는 epoch 2개, flashbulb 1개, semantic consolidation
1개, cross-domain analogy 1개다. daily benchmark만 따로 실행했을 때는 3개 중 2개가
통과했으며, R-Tree predecessor interval 검증을 포함한 history 검사는 통과하고
cross-domain analogy가 실패했다.

전체 SQLite WIP 묶음은 기존 `pnpm test:sqlite` 명령을 유지한다. 기본 suite에서는 smoke와
backup 회귀가 포함되고, parity 네 파일은 별도 명령으로 남는다. 변경 전 기본 suite와
격리 실행 로그는 부모 실행 기록의 기준 경로(`/tmp/naia-memory-luna-astra-20260905-default-before.log`,
`/tmp/naia-memory-luna-astra-20260905-isolated-before.log`)에 보존되어 있다. 이번 단계의
표적 실행 결과와 환경 의존 오류는 부모가 작성하는
[P0 실행 기록](naia-memory-p0-execution-2026-09-05.ko.md)에 명령별로 기록한다.

실제 LLM 요약, 독립 원어민 평가, 전체 corpus 실행 및 실제 배포 환경 검증은 이 표의 확인
범위에 포함하지 않는다. 부모 실행 기록에는 로컬 제품 설정의 JS 빌드 산출물에서 source/built
package의 저장·재시작·회상 probe가 통과한 결과가 별도로 연결된다.
