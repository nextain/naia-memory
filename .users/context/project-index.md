<!-- src-sha: 3cbc0bae3c31262b -->
<!-- 자동 번역 미러 (M13-mirror). 원본: .agents/context/project-index.yaml -->

# Naia 메모리: 기술 명세 (v6.0)

## 핵심 철학: 자가 검증
- **임의값 금지**: 모든 검색 가중치는 실증적으로 도출
- **규모 검증**: 성능 주장 시 최소 100,000건 이상의 사실 집합(fact corpus) 필요
- **정직한 응답속도**: 표면 계층(Tier 1)과 전체 스캔(Full scan) 메트릭을 별도로 보고

## 구현 상세

### 1. 하이브리드 저장소 엔진
- **관계형**: SQLite 3 (better-sqlite3) — 메타데이터 및 일화적 저장소(episodic storage)
- **키워드 검색**: FTS5 (Full Text Search 5)와 BM25 순위 알고리즘으로 정확 일치 회수(recall)
- **벡터**: `sqlite-vec` (vec0) — 의미 유사성(semantic similarity) 검색 (완전 선형 스캔 방식)
- **시간 정보**: R-Tree 색인으로 특정 시점(point-in-time) 및 구간 쿼리를 O(log N) 복잡도로 처리

### 2. 비동기 아키텍처 (v6.0)
- **워커 격리(Worker Isolation)**: 모든 데이터베이스 입출력을 전용 Node.js 워커 스레드로 이동
- **논블로킹**: 대규모 검색 또는 쇠퇴 순환(decay cycle) 중 메인 스레드(UI) 정지 방지
- **메시지 프로토콜**: 명령 기반 통신 및 단조 증가 ID 추적(monotonic ID tracking)

### 3. 단계별 검색 전략
- **계층 1 (표면)**: 강도/중요도 기준 상위 10,000건 사실 (목표: 25ms 이하)
- **계층 2 (심층)**: 전체 집합 스캔 (O(N) 선형 스캔 병목)

## 측정된 벤치마크 (100,000건 사실 기준)

| 항목 | 데이터셋 | 결과 |
|:---|:---|:---|
| 표면 계층 검색 응답속도 | 10k 핫/100k 전체 | **9.74ms** |
| 심층 검색 응답속도 | 100k 전체 스캔 | **약 80ms** |
| 백업 처리량 | 10,000건 레코드 | 4.3MB (암호화) |
| 데이터 무결성 | 이중 시간축(Bi-temporal) 범위 | 100% 정확도(Precision) |

## 해결된 주요 장애물 (대립적 검증 방식)

- **P0-1 (Claude)**: 100,000개 행에 대한 전체 정렬 문제 in RRF (상호 순위 융합, Reciprocal Rank Fusion). 구체화된 공통 테이블 식(Materialized CTEs) 방식으로 해결
- **P0-2 (Gemini/Codex)**: 이중 시간축 컨텍스트 오염. 제어식 관련성 필터(gated relevance filters)로 해결
- **P1-1 (Gemini/Codex)**: 백업 메모리 부족(OOM) 위험. 분할 직렬화(chunked serialization)로 해결

## 현재 기술 부채 (v6.0)

1. **선형 스캔**: 심층 검색이 선형적으로 성능 저하; 1,000,000건 이상 사실에는 ANN (근사 최근접 이웃, Approximate Nearest Neighbor, HNSW) 필요
2. **메모리 지식그래프**: 전체 지식그래프를 메모리에 로드; 점진적/스트리밍 로드 필요
3. **JavaScript 오버헤드**: 워커 메시지 전달이 약 2ms 오버헤드 추가; Rust 계층 FFI (외부 함수 인터페이스) 최적화 가능성 있음

## 프로젝트 구조

### 핵심 파일
- `src/memory/` — 메모리 시스템 핵심 (메모리시스템 클래스, 어댑터, 타입, R2.5 필터, 사용량 추적)
- `src/benchmark/aihub141/` — 한국어 R2.3 멀티세션 벤치마크 (Phase A) — 로더, 채점자, 실행, 분석, 재분석, 임베딩 재분석
- `src/benchmark/comparison/` — 레거시 사실 집합(fact-bank.json) 벤치마크 (R5–R14, 보관됨)
- `src/test/` — 자가 신뢰 하네스(self-trust harness) 단위 테스트 (*.test.mjs) — 강화 중 (2026-05-30)
- `scripts/` — 빌드·검증 + 자가 신뢰 하네스 (강제/검증 감시/격리/CI 검증/목록 생성/미러) — 강화 중 (2026-05-30)
- `reports/` — R 시리즈 벤치마크 산출물 (고유 등록 F12) — 대용량 실행 JSON은 .gitignore
- `docs/integration.md` — naia-agent (나이아 에이전트) 통합 SoT (표준 정보 소스, Source of Truth; 인터페이스 + 파라미터 + buildMemory 샘플)
- `docs/reports/` — 생성된 벤치마크 보고서 (커밋된 요약본만)
- `.agents/context/` — AI 최적화 컨텍스트 (영어, YAML/JSON)
- `.agents/progress/` — SoT 계획 + 의사결정 행렬 + Phase A 결과
- `.users/context/` — 사람이 읽기 쉬운 미러 (동일 구조)

## 격리 상태 (강화 2026-05-30) — 방치 의심 자산 백업

방치 가능성이 있는 자산을 컨텍스트에 등록하여 인지 가능하도록 함.

| 항목 | 설명 |
|:---|:---|
| 매니페스트 | `quarantine/MANIFEST.json` — 강제 추적 (비어있지 않으면 백업 자산 존재) |
| 관리 도구 | `scripts/quarantine.mjs` — 추가/확인/목록/복구/연장/삭제 |
| **api-server** | 방치 중인 AI A/B 실험 플레이스홀더 서버 (1건 커밋, 빌드 미연결). 재검토 예정: 2026-08-30 |
| **memory-service** | 방치 중인 TypeScript HTTP 래퍼 플레이스홀더 (2건 커밋, 빌드 미연결). 재검토 예정: 2026-08-30 |
| 주의 | 만료 시 자동 압축(비파괴), 삭제는 권한 사용자 결정 (SessionStart quarantine-notice.js) |

## 진입점

- `README.md`
- `README.ko.md`
- `docs/integration.md` — naia-agent / naia-os 통합을 위한 SoT
- `.agents/context/project-index.yaml`
- `.agents/progress/r2-bench-trust-2026-05-07.md` — 현재 SoT 계획

## Phase A 상태

**데이터셋**: AI Hub 141 한국어 멀티세션 대화 (100건 대화 × 4회차 세션, S4 검증)

**메트릭**: 페르소나(사용자 성격) 정답 기준 검색 재현율(recall@k)

### 성능 점수

| 항목 | 점수 |
|:---|:---|
| 키워드 검색 재현율 @5 | 0.384 |
| 키워드 검색 재현율 @10 | 0.600 |
| 키워드 검색 재현율 @20 | 0.691 (원본 — topK 상한선으로 부풀려짐) |
| 극성 인식 (거짓양성 제외) @20 | 0.628 |
| 코사인 유사도 0.7 이상 @20 | 0.768 (정직한 의미 신호) |
| 메모리 없음 (기저선) | 0.000 |

### 외부 시스템과의 비교 (LoCoMo)

| 시스템 | 점수 | 비고 |
|:---|:---|:---|
| mem0 | 0.67 | 영어 LoCoMo J-점수 (다른 메트릭 — 면책) |
| Letta | 0.74 | — |
| Zep | 0.66 | 0.66–0.75 범위 논란 |
| MemU | 0.92 | — |
| MemMachine | 0.85 | — |

### 동일 데이터셋에서의 비교

| 항목 | 결과 |
|:---|:---|
| mem0 연기 테스트 (1개 대화, 키워드) | 0.706 (1개 대화만, 노이즈 높음) |
| Naia 로컬 대화당 최소값 | 2분 |
| mem0와의 상대 비교 | 24분 대비 12배 빠름 |

**대화당 비용**: USD 0.005

## 다음 경로

### Phase B-Alpha
- **제목**: R2.5 모순 필터 프레임워크
- **계획**: 합성 원장(synthetic ledger) 생성기 + 3축 채점자 (재현율/대체 정확도/거짓양성)
- **코드량**: 약 400줄
- **예상 비용**: 약 USD 0.5

### Phase B-Beta
- **제목**: R2.3 망각 곡선
- **상태**: **건너뜀** (사용자 지시 2026-05-08) — 컨텍스트 압축 작업과 결합됨

### Phase B-Gamma
- **제목**: A/B 메커니즘 비교 (중요도/지식그래프/하이브리드)
- **코드량**: 약 300줄
- **예상 비용**: 약 USD 1.5

### Phase B-Delta
- **제목**: 일반화 가능성 — KLUE / KorQuAD 부분집합
- **코드량**: 약 200줄
- **예상 비용**: 약 USD 1

### 통합 수준
- **제목**: naia-agent + naia-memory 검증 가능 메커니즘만
- **항목**: R2.3 자연어 시간축 검색, R2.5 자동 업데이트 감지, 전체 컨텍스트를 활용한 중요도, 절차적 메모리, 일상 사용 정답
- **위치**: naia-agent / naia-os 벤치마크 이슈에서 추적

## 어댑터 (비교 벤치마크)

| ID | 파일 | 설명 |
|:---|:---|:---|
| naia | `src/benchmark/comparison/adapter-naia.ts` | Naia Memory — 이 프로젝트 |
| mem0 | `src/benchmark/comparison/adapter-mem0.ts` | mem0 오픈소스 — 벡터 검색 + LLM 중복 제거 |
| sillytavern | `src/benchmark/comparison/adapter-sillytavern.ts` | SillyTavern — vectra + transformers.js |
| letta | `src/benchmark/comparison/adapter-letta.ts` | Letta (구 MemGPT) |
| zep | `src/benchmark/comparison/adapter-zep.ts` | Zep CE (Community Edition) |
| openclaw | `src/benchmark/comparison/adapter-openclaw.ts` | OpenClaw |
| sap | `src/benchmark/comparison/adapter-sap.ts` | Super Agent Party — mem0 + FAISS/ChromaDB |
| jikime-mem | `src/benchmark/comparison/adapter-jikime-mem.ts` | Jikime Memory |
| no-memory | `src/benchmark/comparison/adapter-no-memory.ts` | 기저선 — 메모리 시스템 없음 |

## 프로젝트 메타데이터

- **프로젝트**: naia-memory
- **설명**: AI 에이전트용 인지 메모리 아키텍처 — Naia OS의 일부
- **저장소**: nextain/naia-memory
- **라이선스**: Apache-2.0
- **상위 프로젝트**: nextain/naia-os
- **상태**: 출시 준비 완료 (2026-05-08) — naia-agent 통합 준비 완료
- **이슈**: #23
