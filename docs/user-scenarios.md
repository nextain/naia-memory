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

## UC-MEM-EMBED-HEAL-01 — 손상된 오프라인 임베딩 모델 캐시 자가 복구

- **사용자**: 첫 기동 또는 네트워크 중단 이후 Naia Memory를 사용하는 사용자 및 Naia Agent
- **목표**: 첫 모델 다운로드가 중단되어 ONNX 파일이 잘리거나 손상되어도 장기 기억이 영구 비활성화되지 않고, 다음 기동 시 정상 기억 회상을 수행한다.
- **이유**: transformers 캐시에 잘린 모델 파일이 잔존할 경우, 첫 파이프라인 로드 전 고정 크기 사전 검증(pre-flight)으로 잘린 캐시를 자동 삭제하여 다음 기동 시 수동 조치 없이 자가 복구하기 위해서다 (nextain/naia-shell#681). transformers.js 3.8.1은 세션 생성 실패 시 전역 `wasmInitPromise`를 오염시키므로(`src/backends/onnx.js:153,157`), 로드 중 손상 오류가 발생하면 캐시를 삭제하고 프로세스 재기동을 요청한다.
- **사전 조건**: 캐시 디렉터리에 손상되었거나 잘린 모델 파일이 존재한다.
- **정상 흐름**:
  1. `OfflineEmbeddingProvider.init()`에서 첫 파이프라인 생성 전 사전 검증(`purgeTruncatedModelCache`)을 수행하여, 고정 기본 리비전의 ONNX 파일 크기가 기대 바이트 수(`OFFLINE_MODEL_FILE_BYTES`)와 다를 경우 손상된 캐시 디렉터리를 사전 삭제한다.
  2. 파이프라인 생성(`create()`) 시 정상적으로 온전한 모델 파일이 다운로드되고 로드된다.
  3. 만약 로드 중 손상 오류(`isCorruptModelError`)가 발생할 경우, 인프로세스 재시도 대신 캐시 디렉터리를 삭제하고 프로세스 재시작을 요청하는 오류를 throw하여 다음 기동에서 깨끗하게 복구되도록 한다.
  4. 이후 회상(`recall()`)과 저장(`save()`)이 정상 동작하여 사용자가 기억을 회상할 수 있다.
- **실패 방지 조건**:
  1. 캐시 디렉터리 삭제는 `env.cacheDir` 내부의 해당 모델/리비전 디렉터리로 엄격히 한정되며 상위 디렉터리나 다른 모델 파일은 절대 삭제하지 않는다.
  2. 비정상 캐시 검출 시 `initPromise`를 정리하여 후속 호출이 잠기지 않도록 한다.
  3. 자동 재색인 실패 시 실제 원인 메시지가 `getEmbeddingReindexError()`로 보존된다.

## Test Coverage Map

| UC | 테스트 파일 / 그룹 | 검증 계약 |
|----|--------------------|-----------|
| UC-MEM-AUTH-01 | `src/memory/__tests__/llm-auth.test.ts` / `OpenAI-compatible LLM auth` | fact extractor와 summarizer 각각에서 bearer·`X-AnyLLM-Key` 모드를 실행하고, 선택되지 않은 헤더가 없음을 확인한다. |
| UC-MEM-LLM-ROLE-01 | `src/memory/__tests__/llm-role-profile.test.ts` / `memory LLM role profile` | Defaults memory fact extraction and compaction to `sub`; permits only an explicit valid `memory` override and never exposes credentials or a runner. |
| UC-MEM-IDEMP-01 | `src/memory/__tests__/mem0-idempotency.test.ts` / `Mem0Adapter episode idempotency` | 재시작 후 같은 episode ID는 `add`하지 않고 `update`하며, 동시 재시도는 한 번 추가 후 마지막 payload로 갱신됨을 확인한다. 실패 뒤 같은 ID 재시도와 서로 다른 ID의 독립 실행도 검증한다. |
| UC-MEM-IDEMP-01 | `src/memory/__tests__/memory-system.test.ts` / memory write idempotency·flush | 상위 `MemorySystem` 경계에서 결정적 ID 재사용과 flush 가능한 write 계약을 확인한다. |
| UC-MEM-RETRIEVAL-01 | `src/memory/__tests__/episode-hybrid-ranking.test.ts` / LocalAdapter hybrid ranking | 결정적 embedding에서 높은 utility의 긴 오염 episode 12개가 있어도 정확한 `CONNECTION_OK` user episode가 top-5에 포함됨을 확인한다. |
| UC-MEM-EMBED-HEAL-01 | `src/memory/__tests__/offline-model-cache-healing.test.ts`, `src/memory/__tests__/embedding-reindex-diagnostics.test.ts` | 고정 크기 사전 검증(pre-flight)을 통한 잘린 캐시 삭제, 온전한 캐시 보존, guard 검증, 로드 실패 시 캐시 삭제 및 재기동 안내 throw, initPromise 정리, 그리고 auto-reindex 실패 원인 노출을 확인한다 (nextain/naia-shell#681). |

모든 테스트는 실제 production builder/adapter를 호출한다. 네트워크와 Mem0 client만
결정론적 fake로 대체하며, 인증 헤더 조립과 episode write 분기는 mock하지 않는다.

## UC-BENCH-01 — 운영자가 검색 성능을 재현 가능하게 비교한다

운영자는 코드 리비전, 데이터셋 무결성, 검색 설정, 실행 환경과 실제 생성 시각이
결박된 결과로 한국어·다국어 회상 성능과 실패 유형을 확인한다. 직접 비교 조건이
맞지 않는 외부 엔진 수치는 참고 자료로만 취급한다.

## UC-BENCH-02 — 개발자가 과적합 없이 개선을 검증한다

개발자는 고정 공개 세트와 별도 보류 세트에 동일한 전역 설정을 적용한다. memory는
후보 검색만 평가하며 응답 생성과 abstention 판단은 섞지 않는다.

## UC-BENCH-03 — 검증자가 공개 데이터셋 출처를 확인한다

검증자는 데이터셋 해시에 결박된 저자 서명과 언어별 원어민 검수 서명을 확인하며,
다른 언어의 서명을 재사용한 증거는 승인하지 않는다.

## UC-MEM-01 — 바뀐 사실을 현재값과 이력으로 모두 신뢰한다

사용자는 같은 대상·속성의 단일값이 바뀌면 최신 값을 우선 회상하면서도 이전 원문,
출처와 유효 기간을 추적할 수 있다. 구조가 모호하거나 다중값이면 자동 대체하지 않는다.

## UC-MEM-02 — 다국어 원문이 언어별 규칙으로 훼손되지 않는다

운영자는 한국어뿐 아니라 영어·일본어 등도 같은 보존 모델로 저장한다. 구조화 근거가
없으면 기존 텍스트 저장·검색 경로로 안전하게 폴백한다.

| UC | 추가 검증 |
|----|-----------|
| UC-BENCH-01, UC-BENCH-02 | `src/benchmark/**` 계약·영수증·동일 설정 검증 |
| UC-BENCH-03 | `src/benchmark/quality/public-evidence-review.test.ts` |
| UC-MEM-01, UC-MEM-02 | `src/memory/__tests__/structured-*.test.ts`, `src/memory/__tests__/memory-system.test.ts` |
