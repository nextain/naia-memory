<!-- src-sha: b793da57e678056d -->
<!-- 자동 번역 미러 (M13-mirror). 원본: .agents/context/architecture.yaml -->

# 기억 아키텍처 (Memory Architecture)

## 기억 모델

**4가지 저장소 인지 기억 체계** (튤빙 분류법 + CLS 이론)

### 에피소드 기억 (삽화 기억)
- **생물학적 유추**: 해마(Hippocampus)
- **역할**: 시간정보가 포함된 사건을 전체 인코딩 맥락과 함께 저장
- **필드**: `id`, `content`, `summary`, `timestamp`, `importance`, `encodingContext`, `strength`

### 의미 기억 (semantic memory)
- **생물학적 유추**: 신피질(Neocortex)
- **역할**: 사실, 개체, 관계 저장
- **필드**: `id`, `content`, `source`, `confidence`, `lastVerified`

### 절차 기억 (procedural memory)
- **생물학적 유추**: 기저핵(Basal Ganglia)
- **역할**: 기술, 전략, 학습된 패턴 저장
- **필드**: `id`, `name`, `description`, `successRate`

### 작동 기억 (working memory)
- **생물학적 유추**: 전전두엽피질(Prefrontal Cortex)
- **역할**: 활성 맥락 (컨텍스트 관리자가 외부에서 관리)
- **주의**: 현재 모듈에서는 미구현

---

## 중요도 점수 계산

**모델**: CraniMem (2025) 3축 유틸리티 점수 매김

- **3가지 평가 축**: 중요도, 놀라움, 감정
- **출력**: 유틸리티 점수 (0.0–1.0)
- **저장 조건**: 유틸리티 점수 ≥ 임계값일 때만 저장
- **구현 위치**: `src/memory/importance.ts`

---

## 강도 감소 (Decay)

**모델**: 에빙하우스 망각곡선 (Ebbinghaus forgetting curve)

- **공식**: `strength = e^(-k * 경과_일수 / 안정성)`
- **회상 효과**: 회상이 안정성을 증가시킴 (간격 반복)
- **구현 위치**: `src/memory/decay.ts`

---

## 기억 재통합 (Reconsolidation)

**목적**: 새 입력 정보와 기존 기억 간 모순 감지

- **실행 시점**: 관련 기억 회상 시 작동
- **구현 위치**: `src/memory/reconsolidation.ts`

---

## 지식 그래프 (Knowledge Graph)

**목적**: 의미 기억을 위해 개체(entity)와 관계(relation) 추출

- **구현 위치**: `src/memory/knowledge-graph.ts`

---

## 임베딩 (Embeddings)

**설계**: EmbeddingProvider (임베딩 제공자) 인터페이스를 통한 추상화

### 지원하는 백엔드

| 백엔드 | 모델명 | 차원 | 필요 인증정보 |
|--------|--------|------|-------------|
| Gemini | gemini-embedding-001 | 3072 | `GEMINI_API_KEY` |
| Solar (업스테이지) | embedding-query/passage | 4096 | `UPSTAGE_API_KEY` |
| Qwen 3 | ollama (로컬) | 2048 | 불필요 |
| BGE-M3 | ollama (로컬) | 1024 | 불필요 |
| Gateway (Vertex AI) | text-embedding-004 | 768 | `GATEWAY_URL` + `GATEWAY_MASTER_KEY` |

**구현 위치**: `src/memory/embeddings.ts`

---

## 어댑터 (Adapters)

**인터페이스**: MemoryAdapter (`src/memory/types.ts`)

### 지원 구현체

| 어댑터 | 저장소 | API 키 필요 |
|--------|--------|-----------|
| local (로컬, 기본) | JSON + cosine + BM25 + KnowledgeGraph | 불필요 |
| sqlite (고성능, 진행중) | SQLite + FTS5/BM25 + sqlite-vec + R-Tree (worker 격리) | 불필요 |
| mem0 | mem0 오픈소스 백엔드 | 필요 |
