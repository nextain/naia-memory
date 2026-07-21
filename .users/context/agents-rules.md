<!-- src-sha: 1c16a1d82f2a6ec8 -->
<!-- 수동 검증 미러. 원본: .agents/context/agents-rules.json -->

# naia-memory 작업 규칙

이 문서는 `.agents/context/agents-rules.json`의 사람용 한국어 미러다. 충돌할
경우 JSON 원본이 기준이다.

## 핵심 금지 규칙

- 새 `MemoryProvider`나 `MemoryEngine`을 만들지 않는다. 공용 agent-types의
  인터페이스를 사용한다.
- mem0 소스를 fork/vendor하거나 naia-memory 소스와 융합하지 않는다. mem0는
  교체 가능한 adapter다.
- 자연어 의도 분석, 응답 여부 판단, 시간 자연어 분석은 naia-agent 책임이다.
- 범주별 가중치·임계값으로 benchmark에 과적합하지 않는다.
- 원문 개인정보나 API key 값을 로그·오류에 남기지 않는다.
- 승인되지 않은 헌장 변경, F12/F13 미등록 루트 자원 생성, P01~P05 생략,
  process status 미갱신을 금지한다.
- 시크릿·토큰·음성·얼굴 같은 T3 자료는 추적 경로에 두지 않는다.

## 고정된 설계 결정

- `MemoryProvider`는 `@nextain/agent-types`의 정의를 사용한다.
- 선택 기능은 capability pattern으로 제공한다.
- Local, Mem0, Qdrant adapter 구조를 유지한다.
- mem0 위에 독립 계층을 쌓으며 코드베이스를 결합하지 않는다.

## 헌장과 자원 등록

- 헌장 파일은 `AGENTS.md`, 각 도구 진입점, agents rules, process status,
  project structure다. 변경에는 사용자 명시 승인이 필요하다.
- 새 루트 디렉터리는 F12, 새 루트 파일은 F13에 먼저 등록한다.
- F12 허용 디렉터리: `.agents`, `.claude`, `.github`, `.users`, `READMES`,
  `about-docs`, `benchmark`, `bin`, `data-private`, `docs`, `examples`,
  `node_modules`, `packages`, `quarantine`, `reports`, `scripts`, `src`.
- F13에는 설정·잠금·README·라이선스·TypeScript 파일과 `AGENTS.md`,
  `AGENTS.en.md`, `CLAUDE.md`, `CODEX.md`, `GEMINI.md`, `OPENCODE.md`가
  등록되어 있다.
- 구조 검사는 `scripts/enforce-root-structure.sh`를 사용한다. `--fix`는
  미등록 자원을 삭제하므로 승인된 수정 때만 사용한다.

## 격리 보관 정책

방치 의심 자산은 즉시 삭제하지 않고 `quarantine/`에 보존한다. 기본 보존은
3개월이며 만료 자동 처리는 비파괴 압축까지만 허용한다. 삭제·연장·복구는
사용자가 결정한다.

## P01~P05 V-model 절차

1. P01: `docs/user-scenarios.md`에 사용자·목표·이유를 담은 UC를 작성한다.
2. P02: 같은 문서의 Test Coverage Map에 테스트 파일과 그룹을 연결한다.
3. P03: `docs/requirements.md`에 Pending 기능/비기능 요구사항을 작성한다.
4. P04: 통합 테스트나 검증 스크립트의 객관 증거를 남긴다.
5. P05: 검증 뒤 요구사항을 Done으로 바꾸고 process status를 완료한다.

세션 시작에는 process status, agents rules, project structure 순서로 읽고,
세션 종료에는 JSON과 이 사람용 미러를 동기화한다.

## Self-trust 검사

- enforcement level은 `enforced`다.
- production source가 바뀌면 user scenarios와 requirements가 필요하다.
- 완료 선언에는 테스트·검토·산출물 같은 객관 증거가 필요하다.
- 용어집은 `docs/glossary.md`이며 금지 신조어와 미정의 약어를 검사한다.
