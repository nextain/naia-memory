# 사용자 시나리오와 테스트 커버리지

이 문서는 naia-memory의 LLM 인증 경계와 Mem0 에피소드 쓰기 멱등성을
V-model의 사용자 시나리오(UC)에서 검증 테스트까지 추적하는 기준 문서다.

## UC-MEM-AUTH-01 — LLM 전송 대상별 인증 분리

- **사용자**: Naia를 직접 provider 또는 Any-LLM gateway와 연결하는 운영자
- **목표**: 같은 fact extraction·compaction 기능을 사용하면서 목적지에 맞는
  인증 헤더 하나만 전송한다.
- **이유**: provider bearer credential과 gateway credential이 반대 경계로
  전파되거나 한 요청에 함께 노출되는 일을 막기 위해서다.
- **사전 조건**: 운영자가 명시적인 `baseURL`, `apiKey`, 모델과 인증 모드를
  유효한 설정으로 주입한다.
- **정상 흐름**:
  1. 기본 provider 모드는 `Authorization: Bearer <key>`만 만든다.
  2. `x-anyllm` 모드는 `X-AnyLLM-Key: Bearer <key>`만 만든다.
  3. fact extractor와 summarizer가 동일한 상호 배타 계약을 사용한다.
- **실패 방지 조건**: 사용하지 않는 인증 헤더는 요청에 존재하지 않으며,
  키 값은 로그·오류·추적 문서에 반사되지 않는다.

## UC-MEM-IDEMP-01 — 재시도 가능한 에피소드 저장

- **사용자**: 연속 발화·라디오 세션의 기억을 저장하는 Naia Agent
- **목표**: 동일한 결정적 episode ID가 재시도되거나 동시에 도착해도 Mem0에
  중복 사실을 만들지 않고 마지막 payload를 보존한다.
- **이유**: 프로세스 재시작, timeout 재시도, 동시 flush가 같은 DJ 선호 기억을
  여러 개로 증식시키거나 최신 내용을 잃지 않게 하기 위해서다.
- **사전 조건**: episode에는 안정적인 ID가 있고 Mem0가 `getAll`, `add`,
  `update` 계약을 제공한다.
- **정상 흐름**:
  1. 같은 episode ID가 없으면 metadata의 `episodeId`와 함께 한 번 추가한다.
  2. 이미 있으면 외부 Mem0 ID로 기존 항목을 갱신한다.
  3. 같은 프로세스의 동시 쓰기는 episode ID별로 직렬화한다.
  4. 로컬 mirror는 최종 성공 payload와 일치한다.
- **실패 방지 조건**: 실패한 write의 직렬화 상태는 정리되어 이후 재시도를
  막지 않으며, 서로 다른 episode ID는 불필요하게 하나의 전역 lock으로
  직렬화하지 않는다.

## UC-MEM-RETRIEVAL-01 — 긴 응답 오염 속 정확 기억 회상

- **사용자**: 누적 대화가 많은 환경에서 이전의 짧고 정확한 발화를 다시 찾는 Naia Agent
- **목표**: 임베딩이 활성화되어도 정확한 lexical 일치 episode를 top-5 안에서 회상한다.
- **정상 흐름**:
  1. 긴 `SYSTEM_ECHO` 유사 응답들이 높은 utility와 넓은 의미 벡터를 가진 상태로 누적된다.
  2. 더 낮은 utility의 짧은 user episode에 고유 문구가 저장된다.
  3. 해당 고유 문구로 recall하면 user episode가 top-5에 포함된다.
- **실패 방지 조건**: 긴 문서의 부분 일치나 strength가 정확한 짧은 episode의 관련성을 대체하지 않는다.

## Test Coverage Map

| UC | 테스트 파일 / 그룹 | 검증 계약 |
|----|--------------------|-----------|
| UC-MEM-AUTH-01 | `src/memory/__tests__/llm-auth.test.ts` / `OpenAI-compatible LLM auth` | fact extractor와 summarizer 각각에서 bearer·`X-AnyLLM-Key` 모드를 실행하고, 선택되지 않은 헤더가 없음을 확인한다. |
| UC-MEM-LLM-ROLE-01 | `src/memory/__tests__/llm-role-profile.test.ts` / `memory LLM role profile` | Defaults memory fact extraction and compaction to `sub`; permits only an explicit valid `memory` override and never exposes credentials or a runner. |
| UC-MEM-IDEMP-01 | `src/memory/__tests__/mem0-idempotency.test.ts` / `Mem0Adapter episode idempotency` | 재시작 후 같은 episode ID는 `add`하지 않고 `update`하며, 동시 재시도는 한 번 추가 후 마지막 payload로 갱신됨을 확인한다. 실패 뒤 같은 ID 재시도와 서로 다른 ID의 독립 실행도 검증한다. |
| UC-MEM-IDEMP-01 | `src/memory/__tests__/memory-system.test.ts` / memory write idempotency·flush | 상위 `MemorySystem` 경계에서 결정적 ID 재사용과 flush 가능한 write 계약을 확인한다. |
| UC-MEM-RETRIEVAL-01 | `src/memory/__tests__/episode-hybrid-ranking.test.ts` / LocalAdapter hybrid ranking | 결정적 embedding에서 높은 utility의 긴 오염 episode 12개가 있어도 정확한 `CONNECTION_OK` user episode가 top-5에 포함됨을 확인한다. |

모든 테스트는 실제 production builder/adapter를 호출한다. 네트워크와 Mem0 client만
결정론적 fake로 대체하며, 인증 헤더 조립과 episode write 분기는 mock하지 않는다.
