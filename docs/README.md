# 문서 색인 (docs)

이 디렉터리의 진입점(허브). 모든 큐레이트 문서는 여기서 도달 가능해야 한다
(문서 고립 방지 — `scripts/check-doc-graph.mjs` 가 강제). 루트 `AGENTS.md`(=CLAUDE/GEMINI/OPENCODE/CODEX)
가 프로젝트 진입점이고, 이 파일은 `docs/` 내부 색인이다.

## 표준·구조 (하네스)

- [용어집](./glossary.md) — 요구사항·메모리 계약에서 사용하는 약어와 식별자
- [프로젝트 구조 표준](./project-structure.md) — F12/F13 루트 화이트리스트, 디렉터리 규약
- [위협 모델](./threat-model.md) — 보안 경계, 시크릿 격리(T3), 추적 금지 경로
- [LLM 역할 분담](./llm-roles.md) — 작은(라이트) 모델 ↔ 큰 모델 분담, 단일 CLI 어댑터, 검출 계층

## 설계·아키텍처 (naia-memory)

- [인지 아키텍처](./cognitive-architecture.md) — 4-store brain-inspired 메모리, dual-process retrieval
- [반응 신호](./reaction-signal.md) — 대화 반응으로 기억 강도를 보정하는 신호 계약
- [통합 가이드](./integration.md) — `@nextain/naia-memory` 라이브러리 연동 (naia-agent/naia-os)
- [사용자 시나리오](./user-scenarios.md) — V-model UC와 테스트 커버리지 맵
- [요구사항](./requirements.md) — 인증 헤더 분리·Mem0 멱등성 요구사항과 검증 상태
- [V-model 추적표](./v-model.md) — 인증·멱등성 REQ→UC→TEST-S→SPEC→TEST-F 정공·역추적
- [SQLite 마이그레이션 설계](./design/sqlite-migration.md) — sqlite-vec/FTS5/R-Tree 하이브리드 스토리지
- [구조화 사실 충돌 해소 설계](./design/conflict-aware-structured-facts.md) — 원문 보존형 구조화 사실·다국어 안전 폴백·검증 계약
- [노트북 vLLM 실험](./laptop-vllm-experiment.md) — 로컬 임베딩/추론 서빙 실측
- [벤치마크 리포트 색인](./reports/README.md) — R-시리즈 정확도/지연 벤치마크 + [A/B 테스트 가이드](./reports/ab-testing-guide.md)

## 사용자·요구사항

- [사용자 시나리오](./user-scenarios.md) — 벤치마크 증거와 구조화 사실 충돌 해소의 사용자 가치·테스트 매핑
- [요구사항](./requirements.md) — 벤치마크 재현성·한국어 검색 계약·구조화 사실 충돌 해소 조건

## 작업 기록 / 벤치마크 런 / 이력 (면제 dir)

연대기성 작업 기록은 상호 링크 의무가 없다(`check-doc-graph` 고립 검사 면제):
- `docs/progress/` — 날짜별 진행·검토 메모 (append-only ledger)
- `docs/reports/` — R-시리즈 벤치마크 런 결과 (재현 가능 산출물; 큐레이트 색인은 위 `reports/README.md`)
- `docs/archive/` — 종료된 벤치마크 이력 (r5-r14 등)

## 주기 검증

구조·문서·미러 이탈은 결정론 스크립트가 검출한다. 마이그레이션 완료 후
`scripts/verify-watch.sh start`(또는 `cron`)로 백그라운드 주기 검증 — 검출·보고만 자동, 수정은 사람/큰 모델 게이트.
자세히: [LLM 역할 분담](./llm-roles.md) 의 "디텍트 계층".
