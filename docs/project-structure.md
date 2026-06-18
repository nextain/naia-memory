# 프로젝트 구조 명세

> **SoT**: `.agents/context/agents-rules.json` F12/F13
> 새 파일/폴더 생성 전 반드시 이 문서에서 등록 여부 확인.
> 등록되지 않은 리소스 → `scripts/enforce-root-structure.sh --fix`가 **삭제**.

---

## 허용된 루트 디렉토리 (F12 Registry)

| 디렉토리 | 목적 |
|---------|------|
| `.agents/` | AI 컨텍스트 SoT — rules, progress, reviews |
| `.claude/` | Claude Code 설정 |
| `.github/` | CI/CD 워크플로우 |
| `.users/` | Human-readable mirror (.agents/ 내용 반영) |
| `about-docs/` | **이 표준 repo 자체**에 대한 메타 문서 (설명·검증 ledger·실험). payload 아님 — project-create/migration 이 복제 제외 |
| `benchmark/` | 성능·정확도·자율성 벤치마크 |
| `bin/` | CLI 진입점 |
| `data-private/` | T3 보안 — 키/시크릿/개인정보. 디렉터리만 허용, 내용은 `.gitignore`(절대 추적 금지) |
| `docs/` | 정규 설계 문서 (하위: `design/` 설계, `reports/` 벤치 결과, `archive/` 보관, `progress/` 이슈별 진행) |
| `examples/` | 실행 가능한 예제 |
| `node_modules/` | 의존성 (gitignored, 자동 생성) |
| `packages/` | 소스 패키지 (pnpm-workspace.yaml 등록된 것만) |
| `quarantine/` | **보류 격리**(처분 6번째) — 방치 의심 자산 백업. 실물은 gitignore, `MANIFEST.json`/`README.md` 만 추적. `scripts/quarantine.mjs` 관리 (agents-rules `quarantine_policy`) |
| `READMES/` | 다국어 README |
| `reports/` | 벤치마크·실측 결과 산출물 (루트 레벨) |
| `scripts/` | 빌드·검증·운영 스크립트 (하위: `cron/` 주기적 배치 작업) |
| `src/` | 소스 코드 (하위: `memory/` 코어, `server/` 서빙, `utils/`, `test/` 하네스 테스트(.mjs), `__tests__/` 유닛, `benchmark/`) |

> 새 디렉토리 추가 시: `agents-rules.json` F12 → 이 표 → 사용자 승인 순서 필수.

---

## 허용된 루트 파일 (F13 Registry)

| 파일 | 목적 |
|------|------|
| `AGENTS.md` | AI 도구 진입점 — canonical SoT |
| `CLAUDE.md` | AGENTS.md mirror (Claude Code) |
| `GEMINI.md` | AGENTS.md mirror (Gemini CLI) |
| `OPENCODE.md` | AGENTS.md mirror (opencode) |
| `CODEX.md` | AGENTS.md mirror (Codex) |
| `MEMORY.md` | 세션 간 메모리 색인 |
| `.editorconfig` | 에디터 공통 설정 |
| `.gitignore` | Git 제외 규칙 |
| `.gitmodules` | 서브모듈 설정 |
| `LICENSE` | 라이선스 |
| `package.json` | 루트 workspace 패키지 설정 |
| `package-lock.json` | npm 잠금 파일 |
| `pnpm-workspace.yaml` | pnpm workspace 패키지 목록 |
| `pnpm-lock.yaml` | pnpm 잠금 파일 |
| `tsconfig.json` | TypeScript 프로젝트 참조 |
| `tsconfig.base.json` | 공통 tsconfig 기본값 |
| `tsconfig.typecheck.json` | 타입체크 전용 tsconfig (noEmit) |
| `vitest.config.ts` | vitest 테스트 설정 |
| `README.md` | 이 repo 소개 (복제 제외) |
| `README.ko.md` | 한국어 README |
| `CHANGELOG.md` | 변경 이력 |

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

`docs/` 아래 정규 문서는 이 표에 등록된 것만. 새 문서 추가: 이 표에 먼저 추가 → 사용자 승인 → 실제 파일 생성.

### 현존 문서

| 파일 | 역할 |
|------|------|
| `project-structure.md` | 이 파일 — 루트 구조·레지스트리 명세 |
| `README.md` | docs 허브 인덱스 |
| `cognitive-architecture.md` | 인지 아키텍처 설계 |
| `integration.md` | naia-agent 연동 계약 (연동 SoT) |
| `llm-roles.md` | LLM 역할 분담 |
| `threat-model.md` | 위협 모델 |
| `laptop-vllm-experiment.md` | 로컬 vLLM 실험 기록 |

### 하위 디렉터리

| 경로 | 역할 |
|------|------|
| `design/` | 설계 문서 (예: `sqlite-migration.md`) |
| `reports/` | 벤치마크·A/B 결과 (append-only) |
| `archive/` | 보관된 과거 벤치 이력 (append-only) |
| `progress/` | 이슈별 진행 산출물 (append-only) |

### SDLC 게이트 문서 (작업 착수 시 생성 — agents-rules `required_process_gate` P01~P05)

| 파일 | 역할 | 상태 |
|------|------|------|
| `user-scenarios.md` | 사용자 시나리오 + 테스트 커버리지 맵 (P01/P02) | 작업 착수 시 생성 |
| `requirements.md` | 기능/비기능 요구사항 (P03/P05) | 작업 착수 시 생성 |
| `glossary.md` | 도메인 용어사전 | 필요 시 |
| `lessons.md` | 교훈 — 규칙이 존재하는 이유 | 필요 시 |
| `ARCHITECTURE.md` | 시스템 아키텍처 (현재 `cognitive-architecture.md` 가 대용) | 선택 |

---

## 강제 실행

```bash
./scripts/enforce-root-structure.sh         # dry-run — 위반 목록 출력
./scripts/enforce-root-structure.sh --fix   # 미등록 항목 삭제
```
