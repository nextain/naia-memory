# 메모리 인증·멱등성 V-model 추적표

이 문서는 이번 통합 범위의 요구사항(REQ)→사용 시나리오(UC)→
시나리오 테스트(TEST-S)→기능 설계(SPEC)→기능 테스트(TEST-F)를
한 줄씩 연결한다. 상세 행위와 비기능 요구사항은
[요구사항](./requirements.md)과 [사용자 시나리오](./user-scenarios.md)가 정본이다.

| REQ | UC | TEST-S | SPEC | TEST-F | 상태 |
|---|---|---|---|---|---|
| REQ-MEM-001: 기본 provider는 `Authorization: Bearer` 단일 헤더 | UC-MEM-AUTH-01 | TEST-S-MEM-001: fact extractor·summarizer 기본 모드 | SPEC-MEM-001: 모드별 상호 배타 헤더 생성 | TEST-F-MEM-001: `src/memory/__tests__/llm-auth.test.ts` | Pass |
| REQ-MEM-002: AnyLLM gateway는 `X-AnyLLM-Key: Bearer` 단일 헤더 | UC-MEM-AUTH-01 | TEST-S-MEM-002: fact extractor·summarizer `x-anyllm` 모드 | SPEC-MEM-001 | TEST-F-MEM-001 | Pass |
| REQ-MEM-003: 결정적 episode ID 재시도는 중복 add 없이 갱신 | UC-MEM-IDEMP-01 | TEST-S-MEM-003: 재시작 후 재시도·flush 후 reopen | SPEC-MEM-002: 존재 ID update + 결정적 ID 재사용 | TEST-F-MEM-002: `mem0-idempotency.test.ts`, `memory-system.test.ts` | Pass |
| REQ-MEM-004: 한 프로세스의 동일 ID 동시 쓰기와 실패 대기중 재시도를 직렬화 | UC-MEM-IDEMP-01 | TEST-S-MEM-004: same-ID concurrent last-write·선행 실패 후 queued retry·different-ID 독립성 | SPEC-MEM-003: episode ID별 Promise tail, rejected predecessor 복구, finally cleanup | TEST-F-MEM-003: `src/memory/__tests__/mem0-idempotency.test.ts` | Pass |

## 보장 경계

- `SPEC-MEM-003`은 **단일 Node.js 프로세스 안**의 동일 episode ID만 직렬화한다.
- 서로 다른 프로세스 사이의 atomic uniqueness를 주장하지 않는다. 그 경계는
  외부 저장소/API의 멱등 키·원자적 upsert 계약이 별도로 담당해야 한다.
- AnyLLM와 기본 Bearer를 동시에 보내지 않는다. 선택되지 않은 헤더의
  부재까지 테스트한다.
