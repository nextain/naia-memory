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
| FR-MEM-RETRIEVAL-2 | 회상 순위는 관련도로 정하고 strength는 동점일 때만 쓴다. 자주 회상된 기억이 더 잘 맞는 기억을 앞지르지 않아야 하며, 일화·사실 경로가 같은 규칙(`compareByRelevanceThenStrength`)을 따른다 (nextain/naia-memory#51). | UC-MEM-RETRIEVAL-02 | Done |
| FR-MEM-RETRIEVAL-3 | 회상 반복 가중은 상한(`MAX_RECALL_MULTIPLIER` 2.0)을 가진다. strength를 크기로 읽는 모든 소비처(context-budget, mem0, sqlite hot tier, 감쇠)는 이 상한을 거친 값을 받는다 (nextain/naia-memory#51). | UC-MEM-RETRIEVAL-02 | Done |
| FR-MEM-RETRIEVAL-4 | strength는 회상 후보 자격의 전제가 아니다. `minStrength` 기본값은 0이며, 감쇠했다는 이유만으로 의미상 맞는 일화가 후보에서 빠지지 않는다 (nextain/naia-memory#51). | UC-MEM-RETRIEVAL-02 | Done |
| FR-MEM-RETRIEVAL-5 | 회상된 일화와 사실은 원 코사인 `vectorScore`를 함께 반환한다. 질의 벡터나 저장 벡터가 없으면 0이 아니라 부재로 표시해 호출자가 fail-closed 판단을 할 수 있다 (nextain/naia-memory#51). | UC-MEM-RETRIEVAL-02 | Done |
| FR-MEM-RETRIEVAL-6 | `touch: false` 조회는 `recallCount`·`lastAccessed`·`strength`를 바꾸지 않고 저장소 파일도 쓰지 않으며, 반환 항목과 순서는 `touch: true`와 같다. 내부 후보 점검(재공고화·통합 중복 확인)은 `touch: false`를 쓴다 (nextain/naia-memory#51). | UC-MEM-RETRIEVAL-02 | Done |
| FR-MEM-EMBED-HEAL-1 | 오프라인 임베딩 모델 첫 로드 전 고정 기본 리비전의 ONNX 파일 크기를 사전 검증(`OFFLINE_MODEL_FILE_BYTES`)하여 잘린 캐시를 사전 삭제하고 다음 기동 시 수동 조치 없이 정상 다운로드로 자가 복구해야 한다. 로드 중 손상 오류 발생 시에는 transformers.js 3.8.1의 프로세스 오염(`src/backends/onnx.js:153,157`)을 고려하여 캐시를 삭제하고 프로세스 재시작을 안내해야 한다 (nextain/naia-shell#681). | UC-MEM-EMBED-HEAL-01 | Done |
| FR-MEM-EMBED-HEAL-2 | 캐시 디렉터리 삭제는 `env.cacheDir` 내부의 해당 모델·리비전 경로로 엄격히 한정되어야 하며 비어있는 cacheDir나 범위 밖 대상은 절대 삭제하지 않아야 한다 (nextain/naia-shell#681). | UC-MEM-EMBED-HEAL-01 | Done |
| FR-MEM-EMBED-HEAL-3 | 임베딩 모델 초기화 실패 시 영구적으로 거부된 상태로 남지 않고 `initPromise`를 정리하여 후속 호출에서 재시도할 수 있어야 한다 (nextain/naia-shell#681). | UC-MEM-EMBED-HEAL-01 | Done |
| FR-MEM-REINDEX-DIAG-1 | `LocalAdapter`의 자동 재색인(`startAutoReindex`) 실패 시 예외를 삼키지 않고 원인 메시지를 보존하여 `getEmbeddingReindexError()`로 노출해야 한다 (nextain/naia-shell#681). | UC-MEM-EMBED-HEAL-01 | Done |

## 비기능 요구사항

| ID | 요구 | UC | 상태 |
|----|------|----|------|
| NFR-MEM-SEC-1 | 선택되지 않은 인증 헤더는 요청에 존재하지 않아야 하며 한 요청에 두 인증 모드를 함께 전송하지 않아야 한다. | UC-MEM-AUTH-01 | Done |
| NFR-MEM-IDEMP-1 | episode write 직렬화 상태는 성공·실패 뒤 정리되어 무한 증가하거나 후속 재시도를 막지 않아야 한다. | UC-MEM-IDEMP-01 | Done |
| NFR-MEM-IDEMP-2 | 직렬화 범위는 episode ID별이어야 하며 서로 다른 ID의 쓰기를 전역 lock으로 결속하지 않아야 한다. | UC-MEM-IDEMP-01 | Done |
| NFR-MEM-RETRIEVAL-1 | episode의 strength는 관련성을 대체하지 않는 제한된 tie-breaker여야 한다. | UC-MEM-RETRIEVAL-01 | Done |
| NFR-MEM-RETRIEVAL-2 | 회상 점수(`vectorScore`·`relevanceScore`)는 반환 사본에만 붙고 저장된 일화·사실 객체에 영속되지 않는다 (nextain/naia-memory#51). | UC-MEM-RETRIEVAL-02 | Done |
| NFR-MEM-LLM-ROLE-1 | A resolved profile must not contain API-key values and must not select or execute a model runner. | UC-MEM-LLM-ROLE-01 | Done |

## V-model 추적

| 요구사항 | 코드 | 검증 테스트 |
|----------|------|-------------|
| FR-MEM-AUTH-1, FR-MEM-AUTH-2, FR-MEM-AUTH-3, NFR-MEM-SEC-1 | `src/memory/llm-fact-extractor.ts`, `src/memory/llm-summarizer.ts` | `src/memory/__tests__/llm-auth.test.ts` |
| FR-MEM-LLM-ROLE-1, FR-MEM-LLM-ROLE-2, NFR-MEM-LLM-ROLE-1 | `src/memory/llm-role-profile.ts` | `src/memory/__tests__/llm-role-profile.test.ts` |
| FR-MEM-IDEMP-1, FR-MEM-IDEMP-2, FR-MEM-IDEMP-3 | `src/memory/adapters/mem0.ts` | `src/memory/__tests__/mem0-idempotency.test.ts`, `src/memory/__tests__/memory-system.test.ts` |
| NFR-MEM-IDEMP-1, NFR-MEM-IDEMP-2 | `src/memory/adapters/mem0.ts`의 episode ID별 `episodeWrites` lifecycle | `src/memory/__tests__/mem0-idempotency.test.ts` |
| FR-MEM-RETRIEVAL-1, NFR-MEM-RETRIEVAL-1 | `src/memory/adapters/local.ts` | `src/memory/__tests__/episode-hybrid-ranking.test.ts` |
| FR-MEM-RETRIEVAL-2, FR-MEM-RETRIEVAL-3 | `src/memory/decay.ts`, `src/memory/adapters/local-episode.ts`, `src/memory/adapters/local-semantic-search.ts` | `src/memory/__tests__/decay.test.ts`, `src/memory/__tests__/recall-strength.test.ts`, `src/memory/__tests__/recall-strength-store.integration.test.ts`, `src/benchmark/quality/recall-strength-loop.ts` |
| FR-MEM-RETRIEVAL-4, FR-MEM-RETRIEVAL-5, FR-MEM-RETRIEVAL-6, NFR-MEM-RETRIEVAL-2 | `src/memory/adapters/local-episode.ts`, `src/memory/adapters/local-semantic-search.ts`, `src/memory/adapters/mem0.ts`, `src/memory/memory-system-core.ts`, `src/memory/memory-system-consolidation.ts`, `src/memory/types.ts` | `src/memory/__tests__/recall-strength.test.ts`, `src/memory/__tests__/recall-strength-store.integration.test.ts` |
| FR-MEM-EMBED-HEAL-1, FR-MEM-EMBED-HEAL-2, FR-MEM-EMBED-HEAL-3 | `src/memory/embeddings.ts` | `src/memory/__tests__/offline-model-cache-healing.test.ts` |
| FR-MEM-REINDEX-DIAG-1 | `src/memory/adapters/local.ts`, `src/memory/types.ts`, `src/memory/memory-system-core.ts` | `src/memory/__tests__/embedding-space-migration.test.ts`, `src/memory/__tests__/embedding-reindex-diagnostics.test.ts` |

P04 증거: 핵심 계약 30/30, 전체 393/393, typecheck·build·F13 구조·문서
그래프·진입점 mirror·용어 검사 통과(2026-07-21).

P04 증거(2026-09-22, Windows win-rtx4060, nextain/naia-shell#681): typecheck·build 통과. 전체 vitest 1482건 중 1431 통과·50 실패·1 건너뜀. 실패 50건은 모두 src/benchmark/quality 27개 파일의 기존 Windows 환경 요인(심볼릭 링크 EPERM, CRLF 체크아웃으로 인한 해시 고정 불일치, /proc·openssl 부재)이며 이번 변경 파일을 import 하지 않는다. #681 테스트(offline-model-cache-healing 10/10, embedding-reindex-diagnostics, embedding-space-migration, embeddings, local-load-failure) 통과. 통합 시험: 실제 잘린 17,817,930바이트 모델 캐시와 실제 저장소 사본으로 사전 검사 삭제 → 561,768,762바이트 재다운로드 → 재색인 완료 → 벡터 회상 3건 → 1024차원 저장 8/8 통과 (영수증: alpha-adk tmp/naia-memory-knowledge-link-20260922/receipts/).

P04 증거(2026-09-23, Windows, nextain/naia-memory#51): typecheck·build 통과. 전체 vitest 1504건 중 1451 통과·50 실패·3 건너뜀. 실패 50건은 기준 커밋 19d092f와 파일·항목 목록이 같은 src/benchmark/quality 27개 파일의 기존 Windows 환경 요인이다. 새 시험 recall-strength 16건과 decay 추가 4건 통과. 변경 전 제품 코드에 새 시험을 돌리면 recall-strength 16건 중 11건이 실패한다(나머지 5건은 호환 고정: 명시 minStrength, 보관 일화의 deepRecall, 기본 강화, 임베딩 없을 때 vectorScore 부재, 재저장). 실 저장소 사본 재생(`NAIA_MEM51_FIXTURE`, 635 일화·45 질의·multilingual-e5-large q8 CPU, 3회 반복) 2/2 통과. 벤치마크 `src/benchmark/quality/recall-strength-loop.ts`(fact-bank-v2 310개, e5-large q8 CPU, 같은 파일로 변경 전후 실행): 한국어 계약 hit@1 — 중요도·나이가 다양할 때 2/16 → 10/16, 반복 회상 이력 주입 시 2/16 → 10/16, 질의 241건 누적 후 0/16 → 10/16; 질의 템플릿 68건 hit@1 — 3/68 → 18/68, 2/68 → 18/68, 1/68 → 17/68. 모든 사실이 같은 강도인 기존 조건(uniform)은 변경 전후 동일(11/16, 24/68).

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
