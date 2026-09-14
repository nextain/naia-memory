# Naia Memory P0 개선 실행 기록

작성일: 2026-09-05 · 대상: 내부 연구·개발 의사결정 · 상태: 1차 로컬 개선 완료 · 전체 P0 및 후속 연구는 진행 필요

## 범위와 실행 방식

사용자의 연구 현황 조사·개선계획 요청에 이어, Luna max가 구현하고 각 단계의 결정을 Astra가 검토하도록 지정한 후속 작업이다. 구현은 `gpt-5.6-luna`의 max 설정, 검토는 `gpt-6-astra`, 근거 확인·통합 판단은 부모 에이전트가 담당한다. 이 기록은 실제 협업과 로컬 검증을 설명하며, 별도의 공식 검토 인증이나 출시 승인을 의미하지 않는다.

첫 실행은 현황 보고서의 P0 중 로컬에서 바로 확인할 수 있는 테스트 환경 격리, SQLite 지원 범위의 명확화, 압축 실험 주장 정정에 집중했다. 후속 사용자 지시에 따라 근거가 부족한 6주 추정을 철회하고 측정·구현·검토 단계로 전환했다. 독립 원어민 평가, 실제 유료 LLM 평가, 전체 영어 코퍼스 실행은 별도 후속 과제다. 해당 연구를 이번 코드 수정으로 완료했다고 판단하지 않는다.

현황과 전체 개선계획: `projects/naia-memory/docs/reports/naia-memory-research-status-and-plan-2026-09-05.ko.md`. 아래 저장소 경로는 ADK 루트 기준이다.

## 후속 실행의 최신 기준

검색 최적화 후 부모가 직접 실행한 기본 검사는 **171파일·1,440개 모두 통과**했고, 전체 SQLite 검사는 **28개 중 23 통과·기존 parity 5개 실패**다. typecheck, 별도 JavaScript 빌드, 빌드된 strict vector 검색의 저장·재시작 probe도 통과했다. 전후 성능 측정과 보존된 원시 로그는 [성능 개선 실행 보고서](naia-memory-performance-stage-2026-09-05.ko.md)에 있다. 아래 1,431개 결과는 해당 최적화 직전의 기준이다.

사용자가 단계별 성능 개선을 지시한 뒤 실행 제한이 해제된 환경에서 기준 검사를 다시 실행했다. `pnpm exec vitest run --maxWorkers=2`는 **170파일·1,431개 모두 통과**했다(38.95초). `pnpm test:sqlite`는 **27개 중 22 통과·5 실패**로 기존 parity 실패가 남았다. 원문은 `/tmp/naia-memory-perf-stage-20260905-default-before.log`, `/tmp/naia-memory-perf-stage-20260905-sqlite-before.log`다.

기본 검사 9개 실패가 사라진 것은 환경 변경 후 재현 결과다. 이를 이번 검색 최적화의 효과나 별도 코드 수정의 효과로 집계하지 않는다. 아래의 제한된 환경에서 나온 실패 기록은 과거 실행 증거로 유지한다.

정식 review-preflight도 다시 시도했으나 기존 비추적 경로 `.cache/tools/trec_eval-ba38899/`에 대해 `untracked review path is unsafe`를 보고하며 종료 코드 1로 끝났다. 해당 경로는 이번 변경 대상이 아니므로 보존했다. 사용자 지정 Luna/Astra 검토와 공식 review-pass 인증은 계속 구분한다.

## 시작 상태와 재현 기준

- 로컬 HEAD: `80b95b4b75c8e913e83e660ea6255304edb5a197`.
- 검증 대상은 기존 미커밋 변경이 있는 작업 트리다. 다른 세션의 변경과 `src/memory/index.ts`의 기존 export 추가를 보존한다.
- 변경 후보 파일의 시작 사본과 해시: `/tmp/naia-memory-luna-astra-20260905-baseline/manifest.json`. 전체 저장소를 격리한 재현 패키지는 아니다.
- 기존 `src/memory/index.ts` SHA-256: `cbba6e09e52eba8bd847f662a8f9d5d5a344e481555c22d679d2e73535fc13ef`.

| 변경 전 검사 | 결과 | 해석 |
|---|---|---|
| `pnpm exec vitest run --maxWorkers=2` | 168파일 중 163 통과, 1,410개 중 1,399 통과·11 실패 | 이번 수정 이전의 기준 기록 |
| timestamp CLI·timestamp·public gate·throughput 4파일을 `--maxWorkers=1`로 분리 실행 | 23개 중 18 통과·5 실패 | 병렬 수 감소만으로 해결되지 않음 |
| Node에서 `--import tsx/esm`으로 `SqliteAdapter({dbPath: ':memory:'})` 시작·조회·종료 | 통과, 빈 사실 목록 | 이 경로의 시작 가능성만 입증. Vitest와 배포 빌드의 동작은 별도 확인 필요 |

기본 테스트의 실패 11개 중 trust-anchor CLI 6개에서는 실행 래퍼와 관련한 실패가 발생했다. 로그에는 `tsx` CLI의 임시 IPC 소켓 생성 단계의 `listen EPERM`과 별도 `spawnSync pnpm EPERM`이 확인된다. timestamp 테스트에서는 `spawnSync openssl EPERM`이 직접 관측됐다. 관련 CLI 요청 실패, timestamp 서명 검증 실패, throughput 자식 프로세스의 JSON 출력 실패는 동일한 원인이라고 단정하지 않는다. 실패를 건너뛰거나 성공으로 간주하지 않고 원래 검사와 함께 보존한다.

상세 로그: `/tmp/naia-memory-luna-astra-20260905-default-before.log`, `/tmp/naia-memory-luna-astra-20260905-isolated-before.log`. `/tmp` 경로는 이번 세션의 진단 기록이며 영구 보존을 보장하지 않는다.

## 단계별 결정과 검토

| 단계 | Astra 검토 | 통합 판단과 후속 조치 |
|---|---|---|
| 1. SQLite 테스트 저장 경로 | 사용자 홈 의존을 없애되 기존 smoke 19개와 parity 검증을 보존해야 함 | 수용. 테스트별 임시 디렉터리 사용, 종료 후 DB 부속 파일까지 정리 |
| 1. 워커 시작 문제 | 쓰기 가능한 경로에서 실패를 재현하기 전에 생산 코드의 로더를 바꾸지 말 것 | 수용. Node 시작 확인과 Vitest 실행을 구분하여 진단 |
| 1. 압축 실험 해석 | 정답 anchor를 참조하는 mock의 90%를 실제 LLM 성능이나 상한으로 표현할 수 없음 | 수용. 원래 보고서와 벤치마크 주석을 정정하고 역사적 결과 JSON은 유지 |
| 2. 미지원 기능 처리 | SQLite stub를 일괄 throw하면 공통 초기화·회상 호출까지 깨질 수 있음 | 수용. 호출자별 영향을 검토하고 지원 표·백업 오류의 최소 범위부터 결정 |
| 2. 테스트 구성 | smoke 통과와 기능 동등성을 혼동하지 말 것 | 수용. epoch smoke만으로 epoch 저장·추론 지원을 주장하지 않음 |
| 2. CLI 검사 실행기 | 실제 CLI 자식 프로세스와 검증 항목을 유지하면서 `tsx` CLI 래퍼를 제거할 수 있음 | 수용. 두 실행 지점을 `process.execPath --import tsx/esm` 방식으로 변경하고 6개 검증을 유지 |
| 2. 백업의 빈 성공 | export/import를 거부해도 메서드 존재에 의존하는 `supportsBackup()` 판정은 여전히 참 | 수용. 개선 범위를 빈 성공 차단으로 한정하고 지원 판정의 남은 문제를 명시 |
| 3. RTree 시간 범위 | 통합 과정에서 생성 시각은 현재로 설정되는데 fixture가 과거의 종료 시각만 지정함 | 수용. 수동 이력 fixture의 `validFrom`을 명시하고 저장된 시작·종료 시각을 확인. 생산 코드의 시간 처리 규칙은 유지 |

첫 구현 결과에서 `compact-bench.ts`에 남은 “upper-bound proxy” 표현은 부모 에이전트의 실제 diff 확인으로 수용하지 않았다. 정답을 참조하는 모의 측정을 상한으로 부를 근거가 없으므로 해당 표현을 제거하도록 재수정했다. 보고서의 “30~50%가 한계”라는 일반화도 동일한 합성 예제의 관측값으로 한정한다.

시간 범위 검사는 수동으로 구성한 유효기간 이력의 저장과 회상을 검증한다. 테스트 제목의 “Belief Consistency > 90%”도 실제 assertion의 범위에 맞춰 바꿨다. 이 수정은 자동 가치관 전환 기능이나 90% 정확도의 구현·입증을 의미하지 않는다.

## 1차 실행 당시 검증 — 환경 제한 해제 전

| 검사 | 결과 | 해석 |
|---|---|---|
| `pnpm exec vitest run --maxWorkers=2` | 170파일 중 165 통과·5 실패, 1,431개 중 1,422 통과·9 실패 | 기본 검사에 smoke 19개와 새 백업 검사 2개가 추가됐다. 전체 통과 조건은 미충족 |
| `pnpm test:sqlite` | 기존 5파일·27개 중 22 통과·5 실패 | smoke 19/19, parity 3/8. 전체 명령의 기존 검사 범위를 유지 |
| `pnpm exec vitest run src/benchmark/quality/semantic-competitive-qualification-trust-anchor-cli.test.ts --maxWorkers=1` | 6개 중 2 통과·4 실패 | 부모의 단독 실행에서도 기본 실행과 같은 실패 수. 병렬 수만의 문제로 단정할 수 없음 |
| `pnpm exec tsc --outDir .agents/work/luna-astra-p0-build-20260905` | 종료 코드 0 | 기존 `dist`를 덮어쓰지 않고 제품 설정으로 JavaScript 빌드 |
| `node --import tsx/esm /tmp/naia-memory-luna-astra-20260905-built-probe.mjs src/memory/index.ts` | 통과 | 소스에서 임시 DB 저장→종료→재시작→엄격한 프로젝트 범위의 회상 확인 |
| `node /tmp/naia-memory-luna-astra-20260905-built-probe.mjs .agents/work/luna-astra-p0-build-20260905/memory/index.js` | 통과, `execArgv: []` | 별도 빌드에서 같은 흐름 확인. TypeScript 로더 없는 워커 시작도 동작 |

두 probe 모두 `MemorySystem.exportBackup()`과 `importBackup()`의 거부 및 실패 전후 데이터 일치를 확인했다. 두 실행에서 `supportsBackup()` 결과는 여전히 `true`였다. 따라서 이번 변경은 잘못된 빈 성공을 차단한 것이며, 지원 여부 판정 자체를 바로잡지는 않았다. `provider.ts`의 별도 백업 판정 경로도 이번 개선 대상에 포함하지 않았다. 제품 설정으로 만든 로컬 출력의 동작 확인이며, 실제 npm 배포·다운로드 검증은 아니다.

최종 기본 검사 원문은 `/tmp/naia-memory-luna-astra-20260905-default-after-clean.log`에 있다. 최초 변경 후 실행에서는 별도 빌드에 생성된 `*.test.js` 7개가 추가 수집돼 177파일·1,477개로 늘었다. 이 실행은 전후 비교에서 제외했다. 부모가 생성한 빌드 300파일만 확인 후 `/tmp/naia-memory-luna-astra-20260905-build-artifact/`로 옮기고, 정상 수집 범위의 기본 검사를 다시 실행했다. 빌드·probe 원문은 같은 접두사의 `build.log`, `source-probe.log`, `built-probe.log`에 보관했다.

최종 기본 검사의 남은 실패:

| 파일·영역 | 실패 수 | 직접 관측과 남은 확인 |
|---|---:|---|
| trust-anchor CLI | 4/6 | `spawnSync .../node EPERM`과 기대한 오류 출력 부재. Node 로더 전환 후에도 이 환경에서 모두 해결되지 않음 |
| RFC3161 timestamp CLI | 1 | 자식 명령 종료 코드가 기대와 다름. 원인 전체를 단정하지 않음 |
| RFC3161 timestamp | 1 | `spawnSync openssl EPERM` |
| public gate 전체 경로 | 1 | timestamp 서명 또는 message imprint 검증 실패 |
| throughput A/B runner | 2 | 자식 stdout이 기대한 단일 JSON 기록으로 파싱되지 않음 |

실패를 제외하거나 기대값을 낮추지 않았다. SQLite 지원 범위의 통과와 기본 테스트 전체 성공을 구분하며, 원래 P0의 “지원 환경에서 기본 테스트 전체 통과”는 미완료로 유지한다.

전체 SQLite 검사 원문은 `/tmp/naia-memory-luna-astra-20260905-sqlite-all-after.log`, CLI 단독 실행 원문은 `/tmp/naia-memory-luna-astra-20260905-cli-isolated-after.log`다. SQLite의 남은 5개 실패는 epoch 2개, flashbulb 1개, semantic consolidation 1개, cross-domain analogy 1개다. 수동 이력의 유효기간 저장·history 회상 검사는 통과했다. 새 백업 검사는 기본 검사에 포함되며, 기존 `test:sqlite`의 5파일 묶음에는 포함하지 않는다.

Luna는 별도 표적 실행에서 SQLite 백업 거부 2개와 기존 LocalAdapter 백업 19개를 합쳐 21/21 통과, `pnpm typecheck` 통과, CLI 6/6 통과를 보고했다. 해당 실행은 별도 원시로그가 없어 세션 보고로 구분한다. CLI 6/6은 부모의 전체·단독 실행에서 재현되지 않았으며, 현재의 전체 성공 근거로 채택하지 않았다. 부모가 직접 확인한 JavaScript 빌드 통과는 벤치마크 설정을 포함하는 `pnpm typecheck` 전체 검사와 구분한다.

`git diff --check`는 부모가 다시 확인해 통과했다. 기존 `src/memory/index.ts` 해시는 시작 값과 같고, 역사적 `reports/quality/compact-compression.json`에는 Git 변경이 없다.

## 최종 검토와 남은 제한

Astra는 최종 실제 diff, 신규 백업 테스트, 문서, 부모의 기본·SQLite·CLI·소스/빌드 실행 원시로그와 probe를 읽고 코드 변경을 수용했다. 검토자가 직접 테스트를 실행한 것은 아니다(`runtime_observed: false`). CLI 실행기 전환, smoke/parity 분리, 백업의 빈 성공 차단, 시간 fixture 수정, 압축 주장 정정은 각각 근거와 한계를 확인했다.

문서에는 두 가지 수정을 요구했고 반영했다. 지원 표의 CLI 6/6 무조건 통과 주장은 부모 재현 결과와 분리했으며, 최초 현황 보고서의 빈 백업·5파일 제외 설명은 개선 전 상태임을 명시하고 최신 결과로 연결했다. 코드 수용은 CLI 환경 문제 해결이나 SQLite 기능 동등성의 승인을 의미하지 않는다.

Astra는 수정된 보고서·지원 표·실행 기록·진행 기록을 다시 확인하고 추가 수정 요구 없이 수용했다. 이 마지막 단계는 문서 검토이며 런타임 재실행은 없었다. 부모의 최종 문서 검사에서 로컬 링크 7개와 `git diff --check`를 확인했고 누락 링크나 공백 오류는 없었다.

정식 복잡도 사전 점검도 다음 명령으로 시도했다.

```text
node .agents/skills/review-pass/scripts/review-preflight.mjs --root projects/naia-memory --base 80b95b4b75c8e913e83e660ea6255304edb5a197 --json
```

결과는 `spawnSync git EPERM`, 종료 코드 1이었다. 유효한 JSON 결과가 생성되지 않아 복잡도 gate 완료나 면제를 주장하지 않는다. Luna가 수행한 구문·파일 존재·diff·해시 확인은 이 정식 검사와 다르다. 이번 기록은 사용자 지정 협업의 로컬 검토이며 공식 `review-pass` 인증은 아니다.

1차 구현 범위의 상세 지원 표: [SQLite 지원 범위 표](naia-memory-sqlite-support-matrix-2026-09-05.ko.md). 당시 남았던 기본 검사 9개 실패는 위의 후속 실행에서 재현되지 않았다. SQLite parity 5개 실패, 백업 지원 판정 불일치, 독립 사례·실제 모델 평가는 남아 있다.

## 후속 연구의 완료 조건

1. **P0 로컬 안정화:** 지원되는 저장·재시작·회상·배치 커밋/롤백·범위 격리·임베딩 식별을 재현하고, 미지원 기능과 환경 의존 실패를 명시한다.
2. **독립 사례 확보:** 언어별 원어민 사례와 개발자가 보지 않은 보유셋을 확보한다. 같은 사례 반복을 독립 표본 수에 합산하지 않는다.
3. **실제 대화 평가:** 기억 갱신·삭제 대상 재노출, 최종 답변 정확성, 요약의 사실 보존·환각·비용을 실제 모델로 측정한다. 입력 창과 판정 분모를 일치시킨다.
4. **실패 기반 개선:** 오류 유형별 수정 후 새 보유셋으로 확인한다. 결정론적 검색 성능, 기억 엔진의 기여, LLM 답변 성능을 각각 보고한다.
5. **확대 실행 판단:** 위 결과와 자원 예산이 확보된 뒤 영어 전체 코퍼스·추가 인덱스 최적화의 필요성을 결정한다.

후속 과제의 상세 우선순위와 단계별 종료 기준은 현황 보고서에 유지한다. 본 기록의 첫 실행 완료는 해당 전체 연구의 완료와 구분한다.
