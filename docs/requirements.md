# LLM 인증 분리·Mem0 멱등성 요구사항

범위는 naia-memory의 OpenAI-compatible fact extractor/summarizer 인증 헤더와
Mem0 episode write 경계다. 인증 모드 선택은 호출자가 명시하며, memory 계층은
자격증명의 의미를 추론하거나 두 경계에 동시에 전송하지 않는다.

## 기능 요구사항

| ID | 요구 | UC | 상태 |
|----|------|----|------|
| FR-MEM-AUTH-1 | 기본 인증 모드는 `Authorization: Bearer <key>`만 전송해야 한다. | UC-MEM-AUTH-01 | Done |
| FR-MEM-AUTH-2 | `x-anyllm` 인증 모드는 `X-AnyLLM-Key: Bearer <key>`만 전송해야 한다. | UC-MEM-AUTH-01 | Done |
| FR-MEM-AUTH-3 | fact extractor와 summarizer는 같은 상호 배타 헤더 계약을 적용해야 한다. | UC-MEM-AUTH-01 | Done |
| FR-MEM-LLM-ROLE-1 | `expert`, `main`, `sub` are development tiers; memory fact extraction and compaction must default to `sub`. | UC-MEM-LLM-ROLE-01 | Done |
| FR-MEM-LLM-ROLE-2 | `memory` is a functional override, not a fourth tier, and must resolve completely without cyclic inheritance. | UC-MEM-LLM-ROLE-01 | Done |
| FR-MEM-IDEMP-1 | Mem0에 동일한 `metadata.episodeId`가 없으면 episode를 한 번 추가해야 한다. | UC-MEM-IDEMP-01 | Done |
| FR-MEM-IDEMP-2 | 동일 episode ID가 이미 영속화되어 있으면 새 항목을 추가하지 않고 기존 외부 ID를 갱신해야 한다. | UC-MEM-IDEMP-01 | Done |
| FR-MEM-IDEMP-3 | 동일 episode ID의 동시 쓰기는 직렬화하고 마지막 성공 payload를 로컬 mirror와 Mem0에 보존해야 한다. | UC-MEM-IDEMP-01 | Done |
| FR-MEM-RETRIEVAL-1 | LocalAdapter의 embedding 기반 episode 검색은 길이 정규화된 lexical 신호를 함께 사용하고 관련성을 우선해야 한다. 정확한 짧은 episode가 광범위하고 strength가 높은 긴 응답에 밀려 top-5에서 사라지지 않아야 한다. | UC-MEM-RETRIEVAL-01 | Done |

## 비기능 요구사항

| ID | 요구 | UC | 상태 |
|----|------|----|------|
| NFR-MEM-SEC-1 | 선택되지 않은 인증 헤더는 요청에 존재하지 않아야 하며 한 요청에 두 인증 모드를 함께 전송하지 않아야 한다. | UC-MEM-AUTH-01 | Done |
| NFR-MEM-IDEMP-1 | episode write 직렬화 상태는 성공·실패 뒤 정리되어 무한 증가하거나 후속 재시도를 막지 않아야 한다. | UC-MEM-IDEMP-01 | Done |
| NFR-MEM-IDEMP-2 | 직렬화 범위는 episode ID별이어야 하며 서로 다른 ID의 쓰기를 전역 lock으로 결속하지 않아야 한다. | UC-MEM-IDEMP-01 | Done |
| NFR-MEM-RETRIEVAL-1 | episode의 strength는 관련성을 대체하지 않는 제한된 tie-breaker여야 한다. | UC-MEM-RETRIEVAL-01 | Done |
| NFR-MEM-LLM-ROLE-1 | A resolved profile must not contain API-key values and must not select or execute a model runner. | UC-MEM-LLM-ROLE-01 | Done |

## V-model 추적

| 요구사항 | 코드 | 검증 테스트 |
|----------|------|-------------|
| FR-MEM-AUTH-1, FR-MEM-AUTH-2, FR-MEM-AUTH-3, NFR-MEM-SEC-1 | `src/memory/llm-fact-extractor.ts`, `src/memory/llm-summarizer.ts` | `src/memory/__tests__/llm-auth.test.ts` |
| FR-MEM-LLM-ROLE-1, FR-MEM-LLM-ROLE-2, NFR-MEM-LLM-ROLE-1 | `src/memory/llm-role-profile.ts` | `src/memory/__tests__/llm-role-profile.test.ts` |
| FR-MEM-IDEMP-1, FR-MEM-IDEMP-2, FR-MEM-IDEMP-3 | `src/memory/adapters/mem0.ts` | `src/memory/__tests__/mem0-idempotency.test.ts`, `src/memory/__tests__/memory-system.test.ts` |
| NFR-MEM-IDEMP-1, NFR-MEM-IDEMP-2 | `src/memory/adapters/mem0.ts`의 episode ID별 `episodeWrites` lifecycle | `src/memory/__tests__/mem0-idempotency.test.ts` |
| FR-MEM-RETRIEVAL-1, NFR-MEM-RETRIEVAL-1 | `src/memory/adapters/local.ts` | `src/memory/__tests__/episode-hybrid-ranking.test.ts` |

P04 증거: 핵심 계약 30/30, 전체 393/393, typecheck·build·F13 구조·문서
그래프·진입점 mirror·용어 검사 통과(2026-07-21).

## 벤치마크 및 구조화 기억 요구사항

| ID | 요구 | 상태 |
|----|------|------|
| BENCH-FR-01 | 결과에 벤치마크 시계, Git 상태, 데이터셋 SHA-256, 검색·임베딩 설정, Node·OS 정보를 포함한다. | Done |
| BENCH-FR-02 | 조사·어미·복합어·의미 재표현·부정 충돌·시간성·개체 구분·무관 질의를 포함한 한국어 검색 계약을 유지한다. | Done |
| BENCH-FR-03 | 동일 데이터셋·질의·판정·후보 수·하드웨어 조건만 직접 비교하고 나머지는 참고 수치로 구분한다. | Done |
| BENCH-FR-04 | 공개 데이터셋은 데이터셋 해시에 결박된 저자 서명과 언어별 원어민 검수 서명을 검증한다. | Done |
| BENCH-NFR-01 | 모든 평가 범주에 하나의 전역 검색 설정을 사용하고 질의별 예외를 금지한다. | Done |
| MEM-FR-01 | 원문과 `sourceEpisodes`를 정본으로 유지하면서 선택적 구조화 사실과 추출 provenance를 보관한다. | Done |
| MEM-FR-02 | 확실한 단일값 충돌만 비파괴 supersession 체인으로 연결하고 모호하거나 다중값인 사실은 자동 대체하지 않는다. | Done |
| MEM-FR-03 | Unicode·공백 정규화만 공통 적용하고 구조화 근거가 없는 다국어 원문은 기존 경로로 안전하게 폴백한다. | Done |
| MEM-NFR-01 | memory는 현재·이력 후보를 반환하며 자연어 응답·의도·abstention 판단은 상위 계층에 둔다. | Done |

구현 및 검증 추적은 `src/memory/structured-facts.ts`,
`src/memory/structured-mutation-policy.ts`, `src/memory/structured-duplicate-reconciliation.ts`,
`src/memory/__tests__/structured-*.test.ts`, `src/benchmark/quality/**`에 연결된다.
