# Naia Memory (formerly Alpha Memory)

**AI 에이전트용 인지 메모리 아키텍처** — 중요도 게이팅 인코딩, 벡터 검색, 지식 그래프, 에빙하우스 망각 곡선, 다국어 벤치마크 스위트.

[English](README.md) | [한국어](README.ko.md)

> **상태 (2026-05-08)** — `naia-agent` 통합 ship-ready.
> Phase A 한국어 R2.3 측정 완료: AI Hub 141 멀티세션 대화 위에서 **recall@20 cosine semantic = 76.8%**. mid-tier baseline 수준 (영어 mem0 67% / Letta 74% LoCoMo J-score 와 수치 대등). 같은 작업 분량 mem0 대비 **12배 빠름**.
> naia-agent / naia-os 통합 가이드: [`docs/integration.md`](docs/integration.md). 측정 상세: [issue #23](https://github.com/nextain/naia-memory/issues/23).

---

## Naia 생태계에서의 위치

Naia Memory는 Naia 오픈소스 AI 플랫폼 4개 레포 중 하나:

| Repo | 역할 |
|------|------|
| [naia-os](https://github.com/nextain/naia-os) | 데스크톱 셸 + OS 이미지 (호스트) |
| [naia-agent](https://github.com/nextain/naia-agent) | 런타임 엔진 (loop · tools · compaction) |
| [naia-adk](https://github.com/nextain/naia-adk) | 워크스페이스 포맷 + 스킬 라이브러리 |
| **naia-memory** (본 레포) | 메모리 구현체 |

### 의존성이 아닌 인터페이스

Naia Memory는 **`@nextain/agent-types` 의 `MemoryProvider` 계약을 충실 구현한 한 가지 구현체**:

- **투명** — 계약은 공개. 같은 계약을 구현한 어떤 메모리 시스템도 런타임 코드 변경 없이 교체 가능
- **비결합** — naia-memory는 naia-agent 런타임에 의존 X. naia-agent는 본 패키지를 인터페이스 뒤의 블랙박스로 처리
- **추상화** — Naia Memory를 다른 구현체(mem0, Letta 등)로 교체해도 Naia 생태계 다른 부분은 변경 X

Naia 의 광범위한 원칙: 레포는 **공개 인터페이스** 로 결합, 런타임 의존 X. 자세히는 [naia-agent README](https://github.com/nextain/naia-agent).

---

## 개요

Naia Memory는 인지 과학 영감 4-store 메모리 아키텍처 구현:

| Store | 뇌 비유 | 저장 내용 |
|-------|---------|-----------|
| **Episodic** | 해마 | 시간 표시된 이벤트 + 전체 맥락 |
| **Semantic** | 신피질 | 사실, 엔티티, 관계 |
| **Procedural** | 기저핵 | 스킬, 전략, 학습된 패턴 |
| **Working** | 전전두피질 | 활성 컨텍스트 (외부 관리) |

### 주요 기능

- **Importance gating** — 3축 점수 (importance × surprise × emotion) 로 저장 대상 필터링
- **Knowledge graph** — 엔티티/관계 추출 + 의미 회상용 spreading activation
- **Ebbinghaus decay** — 시간에 따라 메모리 강도 감소, 회상 시 강화
- **Reconsolidation (R2.5)** — consolidation 시 모순 필터; 오래된 사실 supersede
- **Bi-temporal recall (R2.3)** — 과거 시점 회상; 멀티세션 연속성
- **Pluggable adapters** — 벡터 백엔드 교체 (LocalAdapter / Mem0 / Qdrant)
- **다국어 벤치마크** — 한국어 (AI Hub 141 멀티세션) + 영어 (LoCoMo 예정)

---

## 동작 원리 (일반인 수준)

대부분 메모리 시스템 = "검색 엔진" (vector store) — 모두 저장 후 cosine 검색.

Naia 는 **사람 뇌에 가까움** — 중요한 것만 저장, 안 쓰면 잊음, 주기적으로 sleep cycle 동안 정리, 모순 발생 시 update.

| Mechanism | 뇌 비유 | 효과 |
|---|---|---|
| Importance gating | 선택적 주의 | 의미 없는 turn ("안녕") 필터링 |
| Sleep cycle (consolidation) | 수면 중 기억 정리 | 배치 fact 추출 (raw 대화 → atomic fact) |
| Ebbinghaus decay | 망각 곡선 | 오래된 안 쓰는 fact 자연 약화 |
| Reconsolidation | 모순 발생 시 update | "직장 옮겼어" 가 이전 직업 fact supersede |
| Knowledge graph + spreading | 연관 회상 | "라면" 으로 "친구" + "금요일" 활성 |

**Trade-off**:
- ✅ 빠름 (lazy batch consolidate, 60-turn 대화 ~2분)
- ✅ 저렴 ($0.005 / 100-turn 클라우드 모드)
- ✅ 인지 mechanism (단순 vector 검색 X)
- ❌ 절대 1등 X (영어 MemU 92% / MemMachine 85%)
- ❌ 일부 mechanism (decay curve, R2.5 자연 trigger) 는 unit 벤치로 검증 어려움; 통합 레벨 측정 필요

---

## 아키텍처

```
src/
├── memory/
│   ├── index.ts                # MemorySystem — 메인 오케스트레이터
│   ├── types.ts                # MemoryProvider 타입 계약
│   ├── importance.ts           # 3축 importance 점수
│   ├── decay.ts                # Ebbinghaus 망각 곡선
│   ├── reconsolidation.ts      # consolidation 시 모순 감지
│   ├── contradiction-filter.ts # R2.5 — heuristic / Gemini / vLLM 3개 provider
│   ├── knowledge-graph.ts      # 엔티티/관계 추출 + spreading activation
│   ├── embeddings.ts           # 4개 provider (OpenAI-compat / offline / HF / gateway)
│   ├── llm-fact-extractor.ts   # LLM 기반 atomic fact 추출
│   ├── usage-tracker.ts        # 측정마다 토큰 + cost 추적
│   └── adapters/
│       ├── local.ts            # JSON + cosine + BM25 + KG (default, 권장)
│       ├── mem0.ts             # mem0 OSS 백엔드 (stack-on-top hybrid)
│       └── qdrant.ts           # Qdrant 벡터 DB
└── benchmark/
    ├── aihub141/               # 한국어 R2.3 멀티세션 벤치 (Phase A)
    │   ├── loader.ts           # AI Hub 141 zip → conversations
    │   ├── scorer.ts           # recall@k, polarity-aware, hard match
    │   ├── run.ts              # entry — naia-local / no-memory / mem0 / naia-on-mem0
    │   ├── analyze.ts          # report → markdown 분석
    │   ├── reanalyze.ts        # report → multi-metric 재해석 (cost 0)
    │   └── embedding-reanalyze.ts  # report → cosine semantic recall
    └── comparison/             # legacy fact-bank.json (R5–R14, archived)
```

---

## 설치

```bash
npm install @nextain/naia-memory
# 또는
pnpm add @nextain/naia-memory
```

---

## 사용 예

```typescript
import {
  MemorySystem,
  LocalAdapter,
  OpenAICompatEmbeddingProvider,
  buildLLMFactExtractor,
} from "@nextain/naia-memory";

// 3가지 명시 주입 — env-var 매직 X
const embedder = new OpenAICompatEmbeddingProvider(
  baseURL, apiKey, "gemini-embedding-001", 3072,
);
const adapter = new LocalAdapter({
  storePath: "/path/to/store.json",
  embeddingProvider: embedder,
});
const factExtractor = buildLLMFactExtractor({
  apiKey, baseURL, model: "gemini-2.5-flash-lite",
});

const memory = new MemorySystem({ adapter, factExtractor });

// 저장
await memory.encode(
  { content: "디자인 회사로 직장 옮겼어", role: "user" },
  { project: "personal" },
);

// 회상
const result = await memory.recall("사용자 직업?", {
  project: "personal", topK: 10,
});
// result.facts: Fact[], result.episodes: Episode[]

// Sleep cycle (수동 또는 30분마다 자동)
await memory.consolidateNow();
```

naia-agent / naia-os 통합 가이드: [`docs/integration.md`](docs/integration.md) — wire-in 패턴, 설정 가능 파라미터, 2 prefab profile (cloud / local privacy) 의 SoT.

---

## 최신 벤치마크 — Phase A (2026-05-07)

**AI Hub 141 — 한국어 멀티세션 대화** (실제 사람이 작성한 자연 대화).
100 대화 × 4 세션, persona ground truth annotation.

### Recall metrics (naia-local)

| 지표 | 값 | 의미 |
|---|:-:|---|
| recall@5 (loose keyword) | 38.4% | top-5 ranking — daily LLM context budget |
| recall@10 (loose keyword) | 60.0% | mid-bound |
| **recall@20 (loose keyword)** | **69.1%** | 원래 보고 (topK ceiling 으로 inflated) |
| recall@20 (polarity-aware keyword) | 62.8% | 부정형 false positive 제외 |
| **recall@20 (cosine 0.7 semantic)** | **76.8%** | **정직한 신호 — semantic 보존** |
| recall@20 (hard substring) | 0.0% | naia 가 paraphrase — substring 미스는 *정상 동작* |

### Floor + 비교

| Adapter | recall@20 | conv 당 시간 | conv 당 비용 |
|---|:-:|:-:|:-:|
| naia-local | 69.1% (kw) / **76.8%** (cosine) | **~2분** | ~$0.005 |
| no-memory (절대 floor) | 0.0% | 0 | 0 |
| mem0 (1-conv smoke) | 70.6% (kw) | ~24분 (12x 느림) | ~$0.05+ |

### 외부 LoCoMo 영어 baseline (다른 metric — disclaim)

| System | LoCoMo J-score | 비고 |
|---|:-:|---|
| MemU | 92.1% | top tier |
| MemMachine | 84.9% | top tier |
| Letta | 74.0% | mid tier |
| **naia (한국어 cosine)** | **76.8%** | **수치 대등** |
| Mem0 | 67.0% | mid tier |
| OpenAI ChatGPT memory | 52.9% | lower tier |

**Caveat**: LoCoMo 는 LLM-as-judge J-score on QA, naia 는 recall@k on extracted facts. **직접 비교 disclaim**, 그러나 mid-tier 위치 일관.

상세 결과: [`reports/aihub141-r2-3-reanalysis-100conv.md`](reports/aihub141-r2-3-reanalysis-100conv.md), [issue #23](https://github.com/nextain/naia-memory/issues/23).

### Legacy 벤치마크 (archive)

R5-R14 의 `fact-bank.json` 결과 (R5 EN 84%, R6 KO 24.7% 등) → [`docs/archive/`](docs/archive/) 참고. Phase A 의 자연 대화 측정으로 대체. legacy fact-bank 는 합성 contradiction over-fit 문제 있음 (#22 retro).

---

## 벤치마크 실행

```bash
pnpm install

# Phase A — 한국어 R2.3 멀티세션 (AI Hub 141 dataset, 사용자가 별도 다운로드 필요)
GEMINI_API_KEY=xxx \
GATEWAY_URL=https://your-gateway GATEWAY_MASTER_KEY=xxx \
AIHUB_141_PATH=/path/to/aihub/141.한국어멀티세션대화/...
  pnpm exec tsx src/benchmark/aihub141/run.ts \
    --adapter=naia-local \
    --limit=100 --level=4 --topK=20

# Adapter: naia-local | no-memory | mem0 | naia-on-mem0
# Level:   2 / 3 / 4 (멀티세션 갯수)

# Multi-metric 재해석 (cost 0 — 기존 report 위에서)
pnpm exec tsx src/benchmark/aihub141/reanalyze.ts \
  reports/aihub141-r2-3-naia-local-*.json

# Embedding cosine semantic 재해석 (~$0.005 per report)
pnpm exec tsx src/benchmark/aihub141/embedding-reanalyze.ts \
  reports/aihub141-r2-3-naia-local-*.json
```

**Dataset**: [AI Hub 한국어 멀티세션 대화](https://www.aihub.or.kr/aihubdata/data/view.do?dataSetSn=71630) (NIA 라이선스 — 연구·교육용, 재배포 금지; loader-only commit 패턴, raw 데이터는 `AIHUB_141_PATH` env).

---

## 설정 — naia-agent 가 주입할 항목

Naia Memory 는 3가지 명시 주입 방식 (production path 에서 env-var 매직 X):

| 주입 | 제공 형태 | Default fallback |
|---|---|---|
| **Embedding provider** | `OpenAICompatEmbeddingProvider(baseURL, apiKey, model, dims)` 또는 `OfflineEmbeddingProvider`, `HuggingFaceEmbeddingProvider`, `NaiaGatewayEmbeddingProvider` | 없음 |
| **LLM fact extractor** | `buildLLMFactExtractor({ apiKey, baseURL, model })` | 없음 |
| **Contradiction filter (선택)** | `selectFilter({ provider: 'heuristic'\|'gemini'\|'vllm', ... })` | heuristic (LLM 없음) |

### 권장 prefab profile

**Profile A — 빠른 시작 (cloud)**:
- LLM: Gemini 2.5 Flash Lite (Vertex AI gateway 권장 — production rate limit 회피)
- Embedding: gemini-embedding-001 (3072d) 또는 vertex text-embedding-004 (768d)
- Filter: heuristic (off)
- 비용: ~$0.005 per 100 turn; daily 사용 시 월 ~$1-3

**Profile B — Local privacy (사용자 GPU)**:
- LLM: vLLM Gemma 4 E4B (port 8000, OpenAI-compatible)
- Embedding: vLLM `bge-m3` 또는 offline `multilingual-e5-large`
- Filter: vLLM Gemma 4 E4B
- 비용: GPU 전기료만

자세히는 [`docs/integration.md`](docs/integration.md) — `buildMemory(setting)` 참고 코드.

---

## Roadmap

### Done

- ✅ R1 안정화 (7 슬라이스) · R2 capability (4 슬라이스) · R3 한국어 튜닝
- ✅ Phase A — 한국어 R2.3 멀티세션 벤치 (AI Hub 141, 100 conv, **76.8% cosine**)
- ✅ MemoryProvider 8-capability interface 정합 (`@nextain/agent-types`)
- ✅ Cost tracking — 측정마다 usage + estimated USD report 에 기록
- ✅ Multi-metric scorer (keyword / polarity-aware / hard / embedding cosine)
- ✅ naia-agent 통합 ready — `pnpm smoke:naia-memory` 검증 완료

### 다음 — 벤치마크 framework

| Phase | 내용 | 비용 |
|---|---|---|
| **B-α** R2.5 contradiction filter framework | 합성 ledger + 3-axis scorer (recall / supersede precision / false positive) | ~400 LOC + ~$0.5 |
| ~~B-β R2.3 forgetting curve~~ | **Skip** — 컨텍스트 작은 모델 + 실시간 압축 작업과 결합. 별도 시점 |
| **B-γ** A/B mechanism 비교 | importance gating / KG spreading / naia-on-mem0 hybrid on/off | ~300 LOC + ~$1.5 |
| **B-δ** Generalizability — 다른 한국어 dataset | KLUE / KorQuAD subset | ~200 LOC + ~$1 |

### 미래 — 통합 레벨

**naia-memory + naia-agent 결합 후에만 검증 가능** 한 mechanism (unit 레벨 X):
- R2.3 자연어 시간 회상 ("어제" → timestamp 변환)
- R2.5 자연 update 감지 (자유 발화 흐름 안에서)
- Importance gating + emotion/surprise context 정확도
- Procedural memory (skill) — agent loop 안에서만 의미
- Daily 사용 ground (수개월 history) — naia-os 통합 후만 가능

이 항목들은 `naia-agent` / `naia-os` 의 별도 벤치 issue 에서 추적.

---

## 개발

```bash
pnpm install
pnpm exec tsc --noEmit  # 타입 체크
pnpm exec vitest run    # 유닛 테스트
```

---

## AI-Native Open Source

본 프로젝트는 AI-native 개발 철학으로 만들어집니다:

- **AI 컨텍스트는 1급 산출물** — `.agents/` 컨텍스트 파일을 코드와 함께 버전 관리
- **아키텍처 단위의 프라이버시** — 메모리는 로컬 저장. 서비스 제공자가 접근 X
- **AI 주권** — 사용자가 자신의 AI 메모리 소유
- **투명한 AI 협업** — AI 기여는 `Assisted-by:` git trailer 로 명시

`.agents/` 와 `.users/` 의 AI 컨텍스트는 [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 라이선스.

---

## License

Apache 2.0 — [LICENSE](LICENSE) 참고.

[Naia OS](https://github.com/nextain/naia-os) 의 일부, [Nextain](https://nextain.io) 제작.
