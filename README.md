# Naia Memory

[한국어](README.md) · [English](README.en.md) · [문서 색인](docs/README.md)

AI 에이전트가 사람처럼 기억하게 만드는 라이브러리입니다. 대화가 오갈 때마다 모든 문장을 그대로 벡터로 저장하는 대신, 사람의 기억을 흉내 냅니다. 중요한 것만 남기고, 한동안 꺼내 쓰지 않은 기억은 서서히 흐려지며, 다시 떠올린 기억은 오히려 또렷해집니다. 앞뒤가 안 맞는 사실이 들어오면 옛 기억을 새 사실로 갱신합니다.

그리고 그 기억은 사용자의 컴퓨터 안에 남습니다. 서비스 제공자에게 대화를 넘겨 원격 서버에서 기억을 관리하는 방식이 아니라, 로컬 파일이나 로컬 데이터베이스에 저장하고 사용자가 소유합니다.

## 무엇을 하는가

에이전트와 사용자가 나눈 대화를 받아서 두 가지 일을 합니다. 하나는 저장(encode)이고, 하나는 회상(recall)입니다.

저장할 때는 들어온 발화가 기억할 만한지 먼저 따집니다. "안녕" 같은 의미 없는 인사는 걸러지고, "디자인 회사로 직장을 옮겼어" 처럼 중요한 정보는 남습니다. 그 판단은 세 가지 축의 점수로 이뤄집니다. 얼마나 중요한 내용인지(importance), 기존에 알던 것과 얼마나 다른 새로운 정보인지(surprise), 감정이 실렸는지(emotion)입니다.

회상할 때는 질문을 받아 관련 기억을 찾아 돌려줍니다. 이때 단순히 벡터 유사도 하나만 보지 않습니다. 뜻이 비슷한 것을 찾는 의미 검색(코사인 유사도)과 단어가 겹치는 것을 찾는 키워드 검색(BM25)을 함께 돌리고, 서로 다른 두 순위를 하나로 합칩니다(RRF, Reciprocal Rank Fusion). 여기에 지식 그래프로 연관된 기억을 끌어오고(spreading activation), 마지막으로 비슷한 결과가 중복되지 않도록 다양성을 확보합니다(MMR, Maximal Marginal Relevance).

가장 단순한 사용법은 이렇습니다.

```typescript
import {
  MemorySystem,
  LocalAdapter,
  OpenAICompatEmbeddingProvider,
  HeuristicContradictionFilter,
  buildLLMFactExtractor,
} from "@nextain/naia-memory";

// 임베딩 provider 와 fact 추출기를 명시적으로 주입합니다.
// 숨은 환경변수 매직 없이, 무엇을 쓰는지 코드에 드러냅니다.
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

const memory = new MemorySystem({
  adapter,
  factExtractor,
  // 모순 판정 필터도 명시적으로 넣습니다. 규칙 기반 필터는 외부 LLM 을
  // 부르지 않습니다. 이 줄을 빼면 라이브러리가 환경변수(GEMINI_API_KEY 등)를
  // 보고 필터를 자동으로 골라, 기본 상태에서도 판정이 외부로 나갈 수 있습니다.
  contradictionFilter: new HeuristicContradictionFilter(),
});

// 저장
await memory.encode(
  { content: "디자인 회사로 직장 옮겼어", role: "user" },
  { project: "personal" },
);

// 회상
const result = await memory.recall("사용자 직업?", {
  project: "personal",
  topK: 10,
});
// result.facts: 추출된 사실 목록
// result.episodes: 원본 대화 조각 목록
```

`MemorySystem` 은 저장과 회상, 그리고 뒤에서 도는 정리 작업을 총괄하는 엔진입니다. 위 예제처럼 직접 써도 되고, naia-agent 같은 상위 런타임에 붙일 때는 아래 "계약 뒤에 숨는 구조"에서 설명하는 `MemoryProvider` 계약을 씁니다.

정리 작업은 사람의 수면과 비슷합니다. 대화가 쌓이는 동안에는 원본을 그대로 두었다가, 나중에 한 번에 몰아서 원본 대화를 짧고 단단한 사실 조각으로 추출합니다.

```typescript
// 지금 바로 한 번 정리
await memory.consolidateNow();

// 또는 백그라운드 타이머로 주기 실행 (기본 30분).
// 타이머는 자동으로 켜지지 않습니다. 호스트가 명시적으로 켭니다.
memory.startConsolidation();
// 끄기: memory.stopConsolidation()
```

## 특징

**뇌를 본뜬 기억 구조.** 기억을 성격이 다른 저장소로 나눠 담습니다. 시간이 찍힌 사건을 맥락과 함께 담는 일화 기억(episodic, 해마에 비유)과, 거기서 추출한 사실과 관계를 담는 의미 기억(semantic, 신피질에 비유)이 핵심입니다. 여기에 반복해서 성공한 방법을 학습하는 절차 기억(procedural, 기저핵에 비유)의 기초 형태와, 지금 다루는 활성 맥락을 뜻하는 작업 기억(working, 전전두피질에 비유)이 있습니다. 일화·의미 기억은 완성되어 실제로 동작하고, 절차 기억은 스킬 성공/실패 집계 수준의 초기 형태이며, 작업 기억은 라이브러리가 저장하지 않고 상위 런타임이 관리합니다.

**중요도 게이팅.** 앞서 말한 세 축(중요도, 새로움, 감정) 점수로 저장 대상을 거릅니다. 모든 발화를 저장하지 않기 때문에 저장소가 잡음으로 부풀지 않습니다.

**망각 곡선과 강화.** 에빙하우스 망각 곡선을 따라 기억의 강도가 시간에 따라 줄어듭니다. 오래 안 쓴 사실은 자연히 약해지고, 반대로 회상할 때마다 그 기억의 수명이 늘어납니다. 자주 떠올리는 기억일수록 오래 남습니다.

**재응고와 모순 감지.** 정리 과정에서 새 사실이 기존 사실과 충돌하는지 봅니다. "직장을 옮겼어" 라는 발화가 들어오면 이전 직업 사실을 옛 것으로 밀어냅니다(supersede). 충돌 판정은 교체 가능한 필터로 합니다. 필터를 지정하지 않으면 라이브러리가 환경변수를 보고 자동으로 고릅니다. 로컬 vLLM 주소(`VLLM_REASONING_BASE`)가 있으면 vLLM, 없고 `GEMINI_API_KEY` 가 있으면 Gemini 를 부르며, 둘 다 없을 때만 규칙 기반(heuristic)으로 떨어집니다. 규칙 기반만 별도 LLM 호출이 없으므로, `GEMINI_API_KEY` 가 설정된 환경에서는 기본 상태에서도 모순 판정이 외부 LLM 으로 나갈 수 있습니다. 판정을 로컬에 묶어 두려면 위 예제처럼 규칙 기반 필터를 직접 주입하거나 로컬 vLLM 을 쓰면 됩니다.

**지식 그래프.** 엔티티와 관계를 뽑아 그래프로 잇습니다. "라면" 을 떠올리면 함께 등장했던 "친구", "금요일" 로 활성이 번져(spreading activation) 연관 기억을 함께 회상합니다.

**하이브리드 검색.** 회상은 의미 검색(코사인)과 키워드 검색(BM25)을 RRF 로 합치고, 지식 그래프 연관과 MMR 다양성 확보를 더한 결과입니다. 이 위에 선택적으로 cross-encoder 재순위(reranker)를 얹을 수 있으나, 기본 reranker 는 순위를 바꾸지 않는 no-op 이고 실제 cross-encoder 모델은 호출하는 쪽에서 주입합니다.

**교체 가능한 저장 백엔드.** 저장 로직은 `MemoryAdapter` 하나의 인터페이스 뒤에 있어 백엔드를 갈아 끼울 수 있습니다. 자세한 구성은 아래 구조를 참고하세요.

**프라이버시는 아키텍처 수준.** 기억 자체는 로컬 파일이나 로컬 데이터베이스에 저장되고 사용자가 소유합니다. 다만 임베딩, 사실 추출, 요약, 모순 판정은 구성에 따라 외부 모델을 부를 수 있습니다. 어떤 provider 를 쓸지는 라이브러리가 숨겨서 정하지 않고 호출하는 쪽이 명시적으로 주입하거나 환경변수로 고르므로, 무엇이 밖으로 나가는지가 코드에 드러납니다. 대화를 한 글자도 밖으로 내보내지 않으려면 임베딩·추출·요약은 로컬 모델로 붙이고, 모순 판정은 규칙 기반이나 로컬 vLLM 으로 두면 됩니다.

## 왜 이렇게 만들었나

대부분의 메모리 시스템은 사실상 검색 엔진입니다. 들어온 것을 전부 벡터로 저장하고 코사인 유사도로 꺼냅니다. 그러면 저장소가 무한히 커지고, 잡음이 쌓이고, 오래되어 틀린 정보와 최신 정보가 같은 자격으로 섞입니다.

Naia Memory 의 목표는 벤치마크에서 완벽한 회상 점수로 1등 하는 것이 아닙니다. 사람의 기억을 닮는 것입니다. 사람은 모든 것을 기억하지 않습니다. 중요한 것을 남기고, 안 쓰면 잊고, 자주 떠올리면 또렷해지고, 사실이 바뀌면 갱신합니다. 이 성질들이 오래 함께 지내는 에이전트에게는 완벽한 기록보다 더 쓸모 있다고 봅니다.

흐름으로 요약하면 이렇습니다. 발화가 들어오면 중요도 채점기(importance.ts)가 세 축 점수를 매겨 저장 여부를 정하고, 저장된 원본은 정리 단계에서 사실 추출기(llm-fact-extractor.ts)를 거쳐 의미 기억으로 옮겨지며, 회상 요청이 오면 어댑터(adapters/local.ts)가 코사인·BM25·지식 그래프·MMR 를 엮어 순위를 만들어 돌려줍니다. 그동안 망각 곡선(decay.ts)이 안 쓰는 기억의 강도를 계속 낮춥니다.

## 구조

```
src/
├── memory/
│   ├── index.ts                # MemorySystem — 저장·회상·정리 총괄 엔진 (패키지 진입점)
│   ├── provider.ts             # NaiaMemoryProvider — MemoryProvider 계약 구현체 (소비자용 래퍼)
│   ├── provider-types.ts       # MemoryProvider 계약 + capability 인터페이스 + isCapable() 감지
│   ├── lite-provider.ts        # LiteMemoryProvider — 8G tier 경량 구현
│   ├── types.ts                # MemoryAdapter 저장 계약 + 도메인 타입 (Episode/Fact/Skill 등)
│   ├── importance.ts           # 중요도·새로움·감정 3축 채점
│   ├── decay.ts                # 에빙하우스 망각 곡선, 회상 시 강화
│   ├── reconsolidation.ts      # 정리 시 모순 감지·supersede
│   ├── contradiction-filter.ts # 모순 판정 필터 (heuristic / Gemini / vLLM 선택)
│   ├── knowledge-graph.ts      # 엔티티·관계 추출 + spreading activation
│   ├── reranker.ts             # cross-encoder 재순위 (기본 no-op, cross-encoder 는 주입)
│   ├── embeddings.ts           # 임베딩 provider 4종 (OpenAI 호환 / offline / HF / gateway)
│   ├── llm-fact-extractor.ts   # 원본 대화 → 원자적 사실 추출
│   ├── llm-summarizer.ts       # 컨텍스트 압축 요약기
│   └── adapters/
│       ├── local.ts            # JSON + 코사인 + BM25 + 지식 그래프 (완성·기본값)
│       ├── sqlite.ts           # SQLite 백엔드 (진행 중, 아래 참고)
│       ├── mem0.ts             # mem0 백엔드 (벤치마크 전용, 미공개)
│       └── qdrant.ts           # Qdrant 벡터 DB 백엔드
├── server/                     # Express HTTP 래퍼 (라이브러리를 REST 로 노출, port 9876)
└── benchmark/
    ├── aihub141/               # 한국어 멀티세션 회상 벤치 (AI Hub 141)
    └── comparison/             # 다른 시스템(mem0/Letta 등)과 비교 어댑터
```

### 무엇을 import 할지

패키지 진입점(`@nextain/naia-memory`)이 내보내는 것은 `MemorySystem`(엔진), `LocalAdapter`·`SqliteAdapter`·`QdrantAdapter`(저장 백엔드), `LiteMemoryProvider`(경량 구현), 임베딩 provider 들, `buildLLMFactExtractor`, 그리고 `MemoryProvider` 계약 타입입니다. 혼자 붙여 쓰고 실험할 때는 위 예제처럼 `MemorySystem` 을 직접 쓰는 것이 가장 간단합니다.

### 계약 뒤에 숨는 구조

naia-agent 같은 상위 런타임은 `MemorySystem` 을 직접 부르지 않고 `MemoryProvider` 계약(`provider-types.ts`)만 봅니다. 이 계약을 충실히 구현한 것이 `NaiaMemoryProvider`(`provider.ts`)로, 내부적으로 `MemorySystem` 에 위임합니다. 계약만 같으면 mem0 나 Letta 같은 다른 구현체로 갈아 끼워도 런타임 코드는 그대로입니다. 즉 naia-agent 는 메모리 구현을 인터페이스 뒤의 블랙박스로만 다룹니다.

8GB 급 작은 환경을 위한 `LiteMemoryProvider` 도 같은 계약을 구현합니다. 무거운 정리·지식 그래프·워커 스레드를 얹지 않고, SQLite 에 사실을 append-only 로 저장한 뒤 주입된 임베더로 brute-force 코사인 회상만 합니다.

### 저장 백엔드의 현재 상태

기본값이자 완성된 백엔드는 `LocalAdapter` 입니다. JSON 파일에 저장하고 메모리 안에서 코사인·BM25·지식 그래프를 돌립니다. 데스크톱이나 1인 사용자, 수만 건 규모의 사실까지를 겨냥합니다. naia-agent 가 실제로 연동하는 경로도 이쪽입니다.

`SqliteAdapter` 는 진행 중입니다. 저장과 키워드 회상, 벡터 회상(sqlite-vec), 그리고 자주 쓰는 사실을 따로 모아 빠르게 찾는 표면(hot) 티어까지는 동작합니다. 다만 감정 게이팅, 시점 앵커링, 지식 그래프 연관, 통찰 추출 같은 인지 기능은 아직 `LocalAdapter` 수준에 이르지 못했습니다. 그래서 지금 완성되어 기본으로 쓰이는 경로는 `LocalAdapter` 이고, `SqliteAdapter` 는 대규모 확장을 위한 성능 경로로 다듬는 중입니다.

FTS5·sqlite-vec·R-Tree 를 묶어 인지 기능까지 `LocalAdapter` 와 같은 수준으로 끌어올리는 것이 남은 목표입니다.

## Naia 생태계에서의 위치

Naia Memory 는 Naia 오픈소스 AI 플랫폼을 이루는 네 개 레포 중 하나로, 기억을 담당합니다.

- [naia-os](https://github.com/nextain/naia-os) — 데스크톱 셸과 OS 이미지 (호스트)
- [naia-agent](https://github.com/nextain/naia-agent) — 대화 루프·도구·컨텍스트 압축 런타임
- [naia-adk](https://github.com/nextain/naia-adk) — 워크스페이스 포맷과 스킬 라이브러리
- **naia-memory** (이 레포) — 기억 구현체

네 레포는 런타임 의존이 아니라 공개 인터페이스로 결합합니다. Naia Memory 는 naia-agent 런타임에 의존하지 않고, naia-agent 는 이 패키지를 `MemoryProvider` 계약 뒤의 블랙박스로만 다룹니다.

## 설치와 시작

```bash
pnpm add @nextain/naia-memory
# 또는
npm install @nextain/naia-memory
```

소스에서 개발할 때는 이렇게 합니다.

```bash
pnpm install
pnpm exec tsc --noEmit   # 타입 체크
pnpm exec vitest run     # 유닛 테스트
```

처음 코드를 읽는다면 `src/memory/index.ts`(엔진)와 `src/memory/provider-types.ts`(소비자 계약)부터 보면 전체 그림이 잡힙니다. 상위 런타임에 붙이는 방법은 [통합 가이드](docs/integration.md)에, 뇌를 본뜬 저장 구조의 설계 배경은 [인지 아키텍처](docs/cognitive-architecture.md)에 있습니다. 문서 전체 색인은 [docs/README.md](docs/README.md)를 보세요.

## 로드맵과 평가

### 어떻게 재보고 있나

라이브러리가 표방하는 성질이 실제로 성립하는지 확인하는 벤치마크가 있습니다.

한국어 회상 벤치(`src/benchmark/aihub141/`)는 AI Hub 141 한국어 멀티세션 대화 데이터로 회상 정확도를 잽니다. 사람이 쓴 자연스러운 대화 100건을 여러 세션에 걸쳐 넣고, 나중에 던진 질문에 관련 사실을 얼마나 되살리는지 recall@k 로 측정합니다. 원본 데이터는 NIA 라이선스 때문에 재배포할 수 없어서 레포에는 데이터 로더와 채점기만 커밋되어 있고, 데이터는 사용자가 직접 받아 `AIHUB_141_PATH` 로 넘겨야 재현됩니다. 데이터셋을 직접 받은 뒤 이렇게 돌립니다.

```bash
AIHUB_141_PATH=/path/to/aihub/141... \
GEMINI_API_KEY=xxx \
  pnpm exec tsx src/benchmark/aihub141/run.ts \
    --adapter=naia-local --limit=100 --level=4 --topK=20
```

다른 메모리 시스템(mem0/Letta 등)과 나란히 재보는 비교 어댑터는 `src/benchmark/comparison/` 에 있습니다.

### 벤치마크 숫자를 읽을 때

다른 시스템의 공개 점수(예: 영어 LoCoMo 데이터셋의 판정 점수)와 이 라이브러리의 한국어 recall@k 를 나란히 놓고 순위를 매기고 싶은 유혹이 있는데, 두 값은 측정 대상도 언어도 채점 방식도 다르므로 그렇게 읽으면 안 됩니다. 대략의 위치를 가늠하는 참고일 뿐 등수가 아닙니다. 목표 자체가 완벽한 회상 점수가 아니라 사람 같은 기억이므로, recall@k 나 지연 같은 대리 지표는 방향을 보는 신호이지 그 자체가 북극성은 아닙니다.

### 앞으로

- 모순 필터 정확도를 재는 프레임워크(회상률, supersede 정밀도, 오탐률 3축)
- 기억별 성질을 켜고 끄며 비교하는 A/B 측정
- 다른 한국어 데이터셋으로 일반화 확인

망각의 자연 발생, 자유 발화 흐름 속의 모순 감지, 절차 기억 같은 성질은 naia-agent·naia-os 와 결합한 통합 환경에서만 제대로 검증됩니다. 이 항목들은 해당 레포의 통합 벤치에서 추적합니다.

## AI-Native 오픈소스

이 프로젝트는 AI 컨텍스트를 1급 산출물로 다룹니다. `.agents/` 의 컨텍스트 파일을 코드와 함께 버전 관리하고, AI 기여는 `Assisted-by:` git trailer 로 명시합니다. 기억은 로컬에 저장되어 사용자가 소유합니다. 임베딩·사실 추출·요약·모순 판정에 외부 모델을 붙이지 않는 한, 대화가 서비스 제공자의 서버로 넘어가지 않습니다.

`.agents/` 와 `.users/` 의 AI 컨텍스트는 [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 라이선스입니다.

## 라이선스

Apache License 2.0 — [LICENSE](LICENSE) 참고. [Nextain](https://nextain.io) 제작, [Naia OS](https://github.com/nextain/naia-os) 의 일부입니다.
