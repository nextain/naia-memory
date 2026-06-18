# naia-memory 계약 유효성 + 컨텍스트/문서 정합화 (2026-06-18)

"session_id": "538a7d59-8040-4594-b553-ee3b1fbb0892"

## 목표 (사용자 directive)

naia-memory 프로젝트가 (1) 계약에 전부 유효, (2) 컨텍스트 정리, (3) 문서 싹 정리된
상태가 되도록 하고, 크로스리뷰로 확인 후 커밋·푸시.

## 1. 계약 유효성 — GREEN 으로 수정 (코드 9파일)

baseline 실측 결과 `typecheck`(exit 2)와 비-sqlite 타입 13건이 RED. 전부 **테스트가
타입에서 드리프트** + 소스 2건. 수정:

| 파일 | 수정 | 사유 |
|------|------|------|
| `src/memory/__tests__/importance.test.ts` | `MemoryInput`에서 `encodingContext` 제거 | `encodingContext`는 `Episode`에만 존재, `scoreImportance`(MemoryInput)는 안 읽음 — stale 픽스처 |
| `consolidation-primitives.test.ts` / `contract-tests.test.ts` / `memory-system.test.ts`(3곳) | `ExtractedFact.maxEmotion` 추가 | 타입이 `maxEmotion: number` 필수화. episode 파생 extractor는 `ep.importance.emotion`(honest), 독립 픽스처는 0.5(중립) |
| `memory-system.test.ts` | `Parameters<typeof MemorySystem>` → `ConstructorParameters` | 클래스 생성자에는 `ConstructorParameters` (`Parameters`는 `never` 유발) |
| `src/__tests__/test-component-speed.ts` / `test-gated-speed.ts` | `.map((r: any) => …)` | `better-sqlite3 .all()` 반환 unknown 명시 |
| `src/memory/adapters/sqlite.ts` | `rowToEpisode`: `ImportanceScore` 4필드 + Episode 미영속 필드(summary/recallCount/lastAccessed/strength) honest 복원 | sqlite episodes 스키마는 utility+emotion만 영속 → 미저장 축은 0/기본값, 컬럼 fallback 우선 |
| `src/memory/adapters/sqlite-worker.ts` | `../ko-normalize.ts` 유지(주석 추가) | `new Worker(URL('./sqlite-worker.ts'))`로 런타임 .ts 로드 → worker 내부 import는 .ts 필수(.js 로 바꾸면 worker 행) |
| `tsconfig.typecheck.json` | `allowImportingTsExtensions: true`(noEmit 전용, 사유 주석) | 위 worker .ts import를 타입체크에서 수용 — 제외가 아니라 유효화 |

검증:
- `npm run typecheck` → **exit 0, 0 errors**
- `npm test`(vitest + verify:harness) → **exit 0, 0 failed** (전 suite)
- 전체 게이트(structure/charter/sdlc/completion/terminology) → **전부 exit 0**

### SqliteAdapter native 제외분 (사유와 함께 분리)

`npm run test:sqlite`(RUN_SQLITE 게이트)의 sqlite-smoke 1건 등은 worker 타임아웃으로
**사전(HEAD 원본)부터 실패** — 기본 `npm test`에서 의도적으로 제외(RUN_SQLITE 미설정).
LocalAdapter가 1차 경로, SqliteAdapter는 native 보조. 이 정리에서 새로 깨뜨리지 않았음
(HEAD 원본 sqlite-smoke = 671ms 1-fail, 내 수정 후도 213ms 1-fail로 동일 — 행 아님).

## 2. 컨텍스트/문서 SoT 정합화 (charter 3파일 — CHARTER_APPROVED, 사용자 승인 2026-06-18)

| 파일 | 변경 |
|------|------|
| `.agents/context/agents-rules.json` | `phase.current: R2` → `R4-break-point` (R1✓R2✓R3✓#27✓, R4=naia-agent 통합 대기). progress의 `r3-*`/`r4-*`가 증거 |
| `docs/project-structure.md` | F12 표: `data-private/`·`reports/` 추가, `src/` 하위설명 정정(main/test→memory/server/utils/test/__tests__/benchmark), `docs/` 하위 명시. F13 표: `MEMORY.md`·`README.ko.md`·`.editorconfig`·`tsconfig.typecheck.json`·`vitest.config.ts`·`package-lock.json` 추가, SoT 미포함 `README.template.md` 제거. Doc Registry: 죽은 "AGENTS.md 정규 디자인 문서 표" 포인터 제거 → 현존 문서 + 하위 디렉터리 + SDLC 게이트 문서(P01~P05 착수 시 생성)로 재구성 |
| `.agents/context/process-status.json` | idle → 이 세션 기록(update_rule 정합) |

루트 미등록 추적 디렉터리 없음 확인(`memory-sillytavern-stable`/`coverage`/`dist` = 전부 gitignored).
엔트리 미러(AGENTS=CLAUDE=GEMINI) byte-identical 확인. `.users/` 미러는 sync 스크립트로 동기화.

## 3. 크로스리뷰 (open-loop, SoT=ground truth)

**라운드1 (codex)** — 4건 지적, 전부 수정:
- [hi] worker `.ts` import 가 typecheck config 에만 수용됨 → `npm run build`(tsc) TS5097. **수정**: tsconfig.json 에서 sqlite-worker.ts emit 제외 → build exit 0.
- [med] rowToEpisode 미영속 기본값 fabrication → **주석 강화**(복원불가 placeholder, ranking/decay 신뢰금지 명시).
- [med] agents-rules `resource_registry.docs` 가 죽은 "AGENTS.md 표" 참조 → docs/project-structure.md Doc Registry 만 참조하도록 **수정**.
- [lo] F13 note 의 `README.template.md` 잔존 → `README.ko.md` 로 **수정**.

**라운드2 (codex + Claude 적대 서브에이전트, 수렴)** — 잔여는 전부 **SqliteAdapter pre-existing native 한계**(내 변경이 유발 아님, 목표 A/B 무관):
- [hi] dist 빌드의 SqliteAdapter worker URL 이 미emit `.ts` 지목 → *dist 에서 SqliteAdapter 비동작*. build green 이 이를 가릴 수 있음 → **숨기지 않도록 sqlite.ts worker spawn + tsconfig 에 ⚠️ 한계 명시**(LocalAdapter 가 1차/패키지 경로). 근본 해소(worker .js emit + 경로 분기)는 별도 작업.
- [med] rowToEpisode 기본값이 green 게이트로 미검증(sqlite 스위트 RUN_SQLITE 제외) → 주석으로 한계 명시(코드 동작 변경 없음).
- [med] process-status `issue_doc` 가 untracked 이 파일 지목 → **커밋에 이 progress 문서 포함**으로 해소.

### SqliteAdapter 알려진 한계 (native 제외분 — 사유와 함께 분리)
1. `RUN_SQLITE` 스위트 사전 실패(worker 타임아웃 등) — 기본 `npm test` 에서 제외.
2. dist 빌드에서 worker(.ts) 미emit → published dist 의 SqliteAdapter 비동작. 소스 실행(tsx/vitest)만 동작.
3. sqlite episodes 스키마 미영속 필드(summary/recallCount/lastAccessed/strength/importance·surprise 축)는 rowToEpisode 가 placeholder 로 복원 — ranking/decay 신뢰 금지.
→ 프로덕션/패키지 소비는 **LocalAdapter**(전 필드 영속, 1차 경로) 사용.

## 검증 최종 (커밋 직전)

- `npm run typecheck` exit 0 / `npm run build` exit 0 / `npm test` exit 0(0 failed) / `enforce-root-structure.sh` exit 0
- ci-verify {structure,charter(CHARTER_APPROVED=1),sdlc,completion,terminology} exit 0
- 미러(AGENTS=CLAUDE=GEMINI byte-identical, .users/context/*.md src-sha 동기화)

## 상태: 크로스리뷰 2라운드 완료 — 커밋·푸시 진행
