# 프로젝트 구조 명세

> **SoT**: `.agents/context/agents-rules.json` F12/F13
> 새 파일/폴더 생성 전 반드시 이 문서에서 등록 여부 확인.
> 등록되지 않은 리소스 → `scripts/enforce-root-structure.sh --fix`가 **삭제**.

---

## 허용된 루트 디렉토리 (F12 Registry)

> SoT 정합: 아래 표는 `.agents/context/agents-rules.json` `F12.allowed_root_dirs`
> 를 그대로 미러한다. enforce-root-structure.sh 는 **agents-rules.json** 을 읽는다 —
> 표가 SoT 가 아니라 미러임에 유의. (whitelist 이므로 목록 항목이 항상 실재하지는
> 않는다 — 예: `bin/`·`packages/`·`about-docs/` 는 허용되나 본 repo 엔 아직 없음.)

| 디렉토리 | 목적 |
|---------|------|
| `.agents/` | AI 컨텍스트 SoT — rules, progress, reviews |
| `.claude/` | Claude Code 설정 |
| `.github/` | CI/CD 워크플로우 |
| `.users/` | Human-readable mirror (.agents/ 내용 반영) |
| `READMES/` | 다국어 README |
| `about-docs/` | **이 표준 repo 자체**에 대한 메타 문서 (설명·검증 ledger·실험). payload 아님 — project-create/migration 이 복제 제외 |
| `benchmark/` | 성능·정확도·자율성 벤치마크 |
| `bin/` | CLI 진입점 |
| `data-private/` | T3 보안(키/시크릿/개인정보) — 디렉터리는 허용하되 내용은 `.gitignore` (절대 추적 금지) |
| `docs/` | 정규 설계 문서 (이 표에 등록된 것만, 하위: `progress/` 이슈별 진행 산출물) |
| `examples/` | 실행 가능한 예제 |
| `node_modules/` | 의존성 (gitignored, 자동 생성) |
| `packages/` | 소스 패키지 (pnpm-workspace.yaml 등록된 것만) |
| `quarantine/` | **보류 격리**(처분 6번째) — 방치 의심 자산 백업. 실물은 gitignore, `MANIFEST.json`/`README.md` 만 추적. `scripts/quarantine.mjs` 관리 (agents-rules `quarantine_policy`) |
| `reports/` | 벤치마크/측정 산출물 (per-run report) |
| `scripts/` | 빌드·검증·운영 스크립트 (하위: `cron/` 주기적 배치 작업) |
| `src/` | 소스 코드 (하위: `memory/` 메인 소스, `__tests__/` 테스트, `benchmark/`) |

> 새 디렉토리 추가 시: `agents-rules.json` F12 → 이 표 → 사용자 승인 순서 필수.

---

## 허용된 루트 파일 (F13 Registry)

> SoT 정합: 아래 표는 `.agents/context/agents-rules.json` `F13.allowed_root_files`
> 를 그대로 미러한다 (whitelist — 항목이 항상 실재하지는 않음; 예: `.gitmodules`·
> `tsconfig.base.json`·`pnpm-workspace.yaml`·`CHANGELOG.md` 는 허용되나 본 repo 엔
> 아직 없음).

| 파일 | 목적 |
|------|------|
| `.editorconfig` | 에디터 공통 설정 |
| `.env.example` | 환경변수 템플릿 (실제 키 없음 — 통합/벤치 셋업 참고) |
| `.gitignore` | Git 제외 규칙 |
| `.gitmodules` | 서브모듈 설정 |
| `AGENTS.md` | AI 도구 진입점 — canonical SoT |
| `CHANGELOG.md` | 변경 이력 |
| `CLAUDE.md` | AGENTS.md mirror (Claude Code) |
| `CODEX.md` | AGENTS.md mirror (Codex) |
| `GEMINI.md` | AGENTS.md mirror (Gemini CLI) |
| `LICENSE` | 라이선스 |
| `MEMORY.md` | 프로젝트 메모리 인덱스 |
| `OPENCODE.md` | AGENTS.md mirror (opencode) |
| `README.en.md` | 영어 README |
| `README.md` | 이 repo 소개 (한국어 entry) |
| `package-lock.json` | npm 잠금 파일 |
| `package.json` | 패키지 설정 |
| `pnpm-lock.yaml` | pnpm 잠금 파일 |
| `pnpm-workspace.yaml` | pnpm workspace 패키지 목록 |
| `tsconfig.base.json` | 공통 tsconfig 기본값 |
| `tsconfig.json` | TypeScript 프로젝트 설정 |
| `tsconfig.typecheck.json` | 타입체크 전용 tsconfig (`pnpm run typecheck`) |
| `vitest.config.ts` | vitest 설정 |

> 새 파일 추가 시: `agents-rules.json` F13 → 이 표 → 사용자 승인 순서 필수.

---

## 등록된 패키지 (Package Registry)

`packages/` 아래 패키지는 `pnpm-workspace.yaml`에 등록된 것만 생성 가능.

새 패키지 추가 절차:
1. `pnpm-workspace.yaml` 먼저 수정
2. `agents-rules.json` 패키지 목록 업데이트
3. 이 표에 추가
4. 사용자 승인 후 실제 폴더/파일 생성

| 패키지 디렉토리 | npm name | 계층 | 설명 |
|--------------|----------|------|------|
| _(프로젝트에서 정의)_ | — | — | — |

---

## 정규 문서 (Doc Registry)

`docs/` 큐레이트 문서의 색인 SoT 는 [`docs/README.md`](./README.md) (허브 —
`scripts/check-doc-graph.mjs` 가 고립 방지 강제). 아래는 그 색인의 미러다.

새 문서 추가 절차:
1. `docs/README.md` 색인에 먼저 링크 추가 (고립 검사 통과)
2. 이 표에 추가
3. 사용자 승인 후 실제 파일 생성

| 파일 | 역할 |
|------|------|
| `README.md` | docs 색인 허브 (진입점) |
| `project-structure.md` | 이 파일 — F12/F13 루트 화이트리스트, 구조 명세 |
| `threat-model.md` | 보안 경계, 시크릿 격리(T3), 추적 금지 경로 |
| `llm-roles.md` | 작은↔큰 모델 분담, CLI 어댑터, 검출 계층 |
| `cognitive-architecture.md` | 4-store brain-inspired 메모리, dual-process retrieval |
| `integration.md` | `@nextain/naia-memory` 연동 가이드 (naia-agent/naia-os) |
| `design/sqlite-migration.md` | SQLite (sqlite-vec/FTS5/R-Tree) 하이브리드 스토리지 설계 |
| `laptop-vllm-experiment.md` | 로컬 임베딩/추론 서빙 실측 |
| `reports/README.md` | 벤치마크 리포트 색인 (R-시리즈 + A/B 가이드) |

> 면제(고립 검사 제외) dir: `docs/progress/` (날짜별 진행 메모), `docs/reports/`
> (R-시리즈 벤치 런 산출물), `docs/archive/` (종료된 벤치 이력).

---

## 강제 실행

```bash
./scripts/enforce-root-structure.sh         # dry-run — 위반 목록 출력
./scripts/enforce-root-structure.sh --fix   # 미등록 항목 삭제
```
