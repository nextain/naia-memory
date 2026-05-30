# LLM 역할 분담 표준 (작은 모델 ↔ 큰 모델)

> 프로젝트의 스크립트·동기화·검증 작업에 어떤 모델을 쓰고, 무엇을 시키고 안 시키는지의 표준.
> 동기: 작은 모델에 판단·수정을 맡기면 **맥락 소실**로 정합성이 깨진다 (큰 위험). 역할을 명확히 가른다.

## 역할 분담 (불변 원칙)

| 모델 | 하는 일 | 안 하는 일 |
|------|---------|-----------|
| **작은 모델** (라이트 — haiku / gemini-flash-lite / glm-flash) | **번역**(.agents→.users 미러), **생성**(보일러플레이트·초안), **문제점 지적**(검출·리포트) | **수정·판단 금지** — 무엇을 어떻게 고칠지 결정하지 않는다 |
| **큰 모델** (메인 — Opus/Sonnet 급, 사용자가 대화하는 CLI 의 주 모델) | **수정·판단**(작은 모델이 지적한 문제를 직접 고침), 설계 결정 | 단독 수정 금지 (아래 cross-check) |

**핵심**:
- 작은 모델 = "여기 이상함" 까지 (지적). 고치는 건 큰 모델.
- **큰 모델이 고칠 때도 반드시 cross-check** — 단독 수정 금지. 다른 모델/관점의 적대 검토를 거친다.
- **맥락 소실 = 큰 위험** — 작은 모델에 수정을 위임하면 전체 맥락을 잃고 국소 변경으로 정합성을 깬다.

## 실행 환경 가정 (단계별)

| 단계 | 가정 | sub(작은 모델) 호출 |
|------|------|---------------------|
| **지금 — 프로젝트 레벨** | **단일 CLI** (claude / codex / gemini 중 하나) | 그 CLI 의 headless + 라이트 모델 |
| **나중 — naia-agent** | **다중 CLI + 다중 API key** | naia-agent 가 main/sub 라우팅 (이 어댑터를 라우터로 교체) |

### 단일 CLI 호출 방식 (검증됨 2026-05-30)

| CLI | headless | 라이트 모델 지정 | 동기화 스크립트 env |
|-----|----------|------------------|---------------------|
| **claude** | `claude -p` (prompt via stdin) | `--model haiku` | `MIRROR_LLM_CLI=claude MIRROR_SUB_MODEL=haiku` |
| **gemini** | `gemini -p "<prompt>"` | `-m gemini-3.1-flash-lite` (작은 모델 — flash 아닌 flash-lite) | `MIRROR_LLM_CLI=gemini` |
| **codex** | `codex exec "<prompt>"` | `-c model=<계정 가능 모델>` | `MIRROR_LLM_CLI=codex` (ChatGPT 계정 모델 제약 주의) |

> 기본값: claude 코드 환경이면 `claude -p --model haiku`. `scripts/mirror-translate.mjs` 가 위 env 로 분기.

## 디텍트 계층 (명백한 오류는 LLM 없이 즉시 잡힘)

오류 규모에 따라 **싼 것부터** 잡는다. 큰/명백한 오류는 결정론 스크립트가 즉시 디텍트하므로 모델이 불필요.

| 계층 | 무엇을 잡나 | 수단 | 비용 |
|------|------------|------|------|
| **1. 결정론 검사** (LLM 무) | **구조 틀림**(F12/F13 위반·미등록 dir), 미러 stale(해시 불일치), doc 고립, CI 증거/SDLC 위반 | `enforce-root-structure.sh`, `mirror-translate --check`, `check-doc-graph.mjs`, `ci-verify-*.mjs`, `src/test/*.test.mjs` | 0 (즉시) |
| **2. 작은 모델** | 1계층이 못 잡는 미묘한 것 — 용어 위반, 어색한 번역, 의미 불일치 **지적** | check-terminology + 작은 모델 | 낮음 |
| **3. 큰 모델 + cross-check** | 1·2 가 지적한 것 **수정·판단** | 메인 모델 (적대 검토 동반) | 높음 (필요할 때만) |

> 원리: **어느 정도 큰 오류는 1계층(결정론)에서 디텍트**된다 — 구조가 틀리면 즉시 안다.
> 모델(특히 큰 모델)은 결정론으로 못 잡는 미묘한 영역에만 투입. 싼 검사를 먼저, 비싼 판단을 마지막에.

## 작업별 모델 배정

| 작업 | 모델 | 도구 |
|------|------|------|
| `.agents`→`.users` 미러 번역 | 작은 모델 | `scripts/mirror-translate.mjs` |
| doc 고립 검출 (지적) | 스크립트(LLM 무) / 필요시 작은 모델 | `scripts/check-doc-graph.mjs` |
| 용어 위반 지적 | 작은 모델 | `scripts/check-terminology.mjs` |
| 구조/CI 검증 (지적) | 스크립트(LLM 무) | `ci-verify-*.mjs`, `enforce-root-structure.sh` |
| 지적된 문제 **수정** | **큰 모델 + cross-check** | (사람/메인 모델) |

## 검증
- `src/test/llm-roles.test.mjs` — mirror-translate 어댑터가 env 로 CLI/모델 분기하는지, 하드코딩(특정 모델 직타) 없는지.
