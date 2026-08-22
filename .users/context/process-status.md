# 프로세스 현황

> **SoT**: `.agents/context/process-status.json`
> 세션 시작/종료 시 SoT JSON과 이 파일을 동기화.

---

## 참조 링크

| 항목 | 위치 |
|------|------|
| 구조 명세 | [docs/project-structure.md](../../docs/project-structure.md) |
| 규칙 SoT | [.agents/context/agents-rules.json](../context/agents-rules.json) |
| 교훈 | [docs/lessons.md](../../docs/lessons.md) |
| 이슈 문서 | [.agents/progress/](../progress/) |

---

## 현재 작업

_(신규 이슈 시작 시 업데이트)_

**이슈**: [#39](https://github.com/nextain/naia-memory/issues/39)
**제목**: Conflict-aware structured facts with multilingual-safe retrieval
**상태**: in_progress

---

## SDLC 게이트

| 게이트 | 상태 | 산출물(deliverable) |
|--------|:----:|---------------------|
| P01 사용자시나리오 | done | `docs/user-scenarios.md` |
| P02 테스트시나리오 | done | `docs/user-scenarios.md` Test Coverage Map |
| P03 요구사항 | done | `docs/requirements.md` |
| P04 통합테스트 | done | model-free protocol v6 + SQLite/HNSW 100k evidence; 846 tests; OpenCode 적대리뷰 PASS (recovery mode, no formal CLEAN) |
| P05 완료 | pending | 독립 원어 보유셋, 봉인된 튜닝/검증 분리, 자원 영수증 및 동일 입력 글로벌 엔진 영수증 필요 |

마지막 업데이트: 2026-08-22 10:11 KST

---

## 세션 체크리스트

**시작 시**:
- [ ] `process-status.json` 읽기
- [ ] `current_work` 확인
- [ ] `last_updated` 갱신
- [ ] P01~P03 게이트 완료 확인 후 코딩 시작

**종료/커밋 전**:
- [ ] 완료된 게이트 status → done, deliverable 기재
- [ ] `last_updated` 갱신
- [ ] 이 파일 동기화
- [ ] `process-status.json` 커밋에 포함
