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
