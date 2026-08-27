# Naia Memory

[한국어](README.md) · [English](README.en.md) · [문서 색인](docs/README.md)

AI 에이전트가 사람처럼 기억하게 만드는 라이브러리입니다. 대화가 오갈 때마다 모든 문장을 그대로 벡터로 저장하는 대신, 사람의 기억을 흉내 냅니다. 중요한 것만 남기고, 한동안 꺼내 쓰지 않은 기억은 서서히 흐려지며, 다시 떠올린 기억은 오히려 또렷해집니다. 앞뒤가 안 맞는 사실이 들어오면 옛 기억을 새 사실로 갱신합니다.

그리고 그 기억은 사용자의 컴퓨터 안에 남습니다. 서비스 제공자에게 대화를 넘겨 원격 서버에서 기억을 관리하는 방식이 아니라, 로컬 파일이나 로컬 데이터베이스에 저장하고 사용자가 소유합니다.

## 먼저, Naia Memory 를 관통하는 질문

### 한마디로 무엇인가

**Naia Memory 는 에이전트가 사용자와 함께 겪은 사건과 거기서 배운 사실을 선택적으로 저장하고, 잊고, 강화하고, 갱신하는 로컬 우선 장기기억 계층입니다.**

단순한 대화 로그나 벡터 검색 DB가 아닙니다. 원본 대화인 **일화 기억**과 그 대화에서 추출한 **의미 기억**을 나누고, 기억마다 중요도와 수명을 부여해 시간이 지나도 지금 유효한 기억이 먼저 떠오르게 합니다.

### 어떻게 잊지 않는가

정확히 말하면 Naia Memory 는 **모든 것을 잊지 않는 시스템이 아니라, 잘 잊어서 필요한 것을 오래 남기는 시스템**입니다. 여기에는 서로 다른 두 층이 있습니다.

1. **데이터의 지속성:** 선택된 기억은 메모리가 아니라 로컬 저장소에 기록되므로 프로세스나 세션을 종료해도 남습니다.
2. **기억의 지속성:** 중요한 발화만 저장하고, 일화를 재사용 가능한 사실로 정리하며, 회상한 기억은 강화합니다. 반대로 오래 쓰지 않은 기억은 망각 곡선에 따라 약해지고, 바뀐 사실은 재응고 과정에서 최신 사실로 교체됩니다.

따라서 “사용자가 디자인 회사로 옮겼다”는 사실은 디스크에만 남는 것이 아니라, 이후 직업 관련 질문에 회상되고, 반복해서 쓰이면 더 오래 유지되며, 다시 이직했다는 근거가 들어오면 과거 사실이 최신 사실을 방해하지 않도록 밀려납니다.

### 메인 LLM, 메모리 LLM, 임베딩과 모듈은 어떻게 동작하는가

메인 LLM과 메모리 LLM은 서로 대화하는 두 에이전트가 아닙니다. **메인 LLM은 사용자에게 답하는 주체**이고, **메모리 LLM은 기억을 정리하는 좁은 내부 작업자**입니다.

```text
사용자 발화
   │
   ▼
naia-agent ── 회상 질의 ──▶ 임베딩·키워드·그래프 검색
   │                              │
   │         관련 기억 문맥 ◀─────┘
   ▼
메인 LLM ───────────────────────▶ 사용자 답변
   │
   └── 대화 저장 ──▶ 중요도 게이트 ──▶ 일화 기억
                                           │
                              메모리 LLM의 사실 추출·요약
                                           │
                                           ▼
                          의미 기억·재응고·로컬 저장소
```

- **메인 LLM:** 회상된 기억을 문맥으로 받아 추론하고 답하며 도구를 사용합니다.
- **메모리 LLM:** 쌓인 일화에서 원자적 사실을 추출하고, 컨텍스트 압축 시 요약을 다듬습니다. 설정하지 않으면 휴리스틱 사실 추출과 결정론적 요약으로 축소 운용됩니다.
- **임베딩 모델:** 발화와 기억을 벡터로 바꿔 표현이 달라도 뜻이 가까운 기억을 찾습니다. 임베딩을 쓰지 않아도 키워드 검색은 동작합니다.
- **결정론적 모듈:** 중요도 게이팅, BM25·RRF·MMR 순위 결합, 망각, 회상 강화, 모순 후보 처리와 저장 수명주기를 맡습니다.
- **저장 어댑터:** 실제 기억을 JSON, SQLite 또는 Qdrant 같은 저장소에 기록합니다.

메모리 LLM이나 임베딩 provider가 외부 서비스라면 해당 처리 입력은 외부로 나갈 수 있습니다. 완전한 로컬 운용이 필요하면 로컬 모델 또는 휴리스틱 경로를 선택해야 합니다.

### 기억은 어디에 저장되는가

Naia 제품에서 기억의 정본은 **현재 활성화된 ADK의 `naia-settings` 아래**에 둡니다. naia-agent가 기본 로컬 어댑터를 사용할 때의 경로는 다음과 같습니다.

```text
<NAIA_ADK_PATH>/naia-settings/memory/store.json
```

제품의 로컬 기억 경로는 naia-agent가 소유하며, 셸이나 환경변수가 다른 로컬 경로로 돌리지 못합니다. 사용자가 명시적으로 선택한 Qdrant 같은 외부 backend만 저장 어댑터 경계의 예외입니다.

라이브러리를 naia-agent 없이 단독으로 사용하고 `storePath`도 주지 않은 경우에는 `~/.naia/memory/naia-memory.json`을 사용합니다. 즉 **라이브러리의 독립 실행 폴백**과 **Naia 제품의 ADK 소유 경로**는 의도적으로 다릅니다. Naia 제품 호스트는 확인된 기존 workspace identity·memory store·compiled KB를 새 경계로 호환 복사하며, 새 경로에 파일이 이미 있으면 그 파일을 정본으로 유지합니다. 원본은 롤백을 위해 자동 삭제하지 않습니다.

### 다른 장기기억과 무엇이 다른가

아래 비교는 Hermes나 OpenClaw 전체가 아니라 **기본 장기기억 계층만** 대상으로 합니다.

| 기준 | Naia Memory | Hermes 기본 메모리 | OpenClaw 기본 메모리 |
|---|---|---|---|
| 기본 표현 | 구조화된 일화·사실·관계와 검색 인덱스 | `MEMORY.md`·`USER.md`의 제한된 큐레이션 항목 | `USER.md`·`MEMORY.md`·날짜별 Markdown 기록 |
| 저장 방식 | 매 턴 저장 후보를 중요도로 걸러 일화로 남기고, 정리 주기에 사실로 응고 | 모델이 memory 도구로 추가·교체·삭제; 외부 provider를 별도 결합 가능 | 모델이 명시적으로 Markdown에 기록; 선택적 검색 인덱스 사용 |
| 회상 방식 | 매 턴 질의별 하이브리드 검색과 그래프 확장 후 문맥 주입 | 기본 파일은 세션 시작 시 고정 스냅샷; 외부 provider는 턴별 prefetch 가능 | 핵심 파일·최근 일지를 문맥에 싣고, 필요 시 의미·키워드 검색 |
| 시간에 따른 변화 | 중요도 게이트, 망각 감쇠, 회상 강화, 응고·재응고가 핵심 수명주기 | 기본 파일은 작고 명시적으로 큐레이션하는 방식 | 사람이 읽고 수정할 수 있는 파일과 일지·정리 작업 중심 |
| 설계 중심 | “무엇을 언제 잊고 갱신할 것인가” | “작고 명시적인 프로필·노트를 어떻게 유지할 것인가” | “투명한 Markdown 기록을 어떻게 축적하고 검색할 것인가” |

Hermes는 외부 memory provider 플러그인을 붙이면 의미 검색이나 사용자 모델링을 추가할 수 있으므로, 위 표는 그 provider들의 기능을 Hermes 기본 메모리의 고유 기능으로 간주하지 않습니다. OpenClaw도 검색과 장기기억 승격 기능을 확장하고 있으므로 차이는 파일 형식 자체보다 **Naia Memory가 망각·강화·재응고를 저장 엔진의 기본 수명주기로 둔다는 점**에 있습니다.

비교 근거: [Hermes Persistent Memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md), [Hermes 파일 역할](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/which-file-does-what.md), [Hermes MemoryProvider 계약](https://github.com/NousResearch/hermes-agent/blob/main/agent/memory_provider.py), [OpenClaw Memory overview](https://docs.openclaw.ai/concepts/memory).

### 개발 수준은 어느 정도인가

현재는 **핵심 로컬 경로는 실제 naia-agent에 통합되어 동작하고, 대규모 저장 경로와 평가 체계는 고도화 중인 단계**입니다.

| 영역 | 현재 수준 |
|---|---|
| 일화·의미 기억 저장과 회상 | 구현·운용 경로 존재 |
| 중요도 게이트, 망각, 회상 강화, 응고·재응고 | 구현됨 |
| LocalAdapter(JSON) | 기본이자 가장 완성된 경로 |
| naia-agent 매 턴 회상·저장, 메모리 LLM·임베딩 선택 | 통합됨 |
| 절차 기억 | 성공·실패 집계와 교정 회상의 초기 단계 |
| 작업 기억 | naia-memory가 영속하지 않고 상위 런타임이 관리 |
| SQLite 대규모 경로 | 저장·검색 일부 동작, LocalAdapter 기능 동등성은 진행 중 |
| 한국어 장기기억 품질·대규모 지연 검증 | 벤치 하네스는 있으나 공개 재현 결과와 운영 기준 축적 중 |

그러므로 “개념 검증뿐인 프로젝트”는 아니지만, 모든 백엔드가 같은 기능을 제공하거나 대규모 운영 검증까지 끝난 완제품이라고 말할 단계도 아닙니다.

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

**프라이버시는 아키텍처 수준.** 기억 자체는 로컬 파일이나 로컬 데이터베이스에 저장되고 사용자가 소유합니다. 다만 임베딩, 사실 추출, 요약, 모순 판정은 구성에 따라 외부 모델을 부를 수 있습니다. 구조화된 기억 삭제를 활성화하면, 최대 32개 후보의 구조화된 값(value)이 정확한 삭제 대상을 승인·선택하도록 별도 verifier endpoint에 전달됩니다. API 서버는 `DELETE_VERIFIER_API_KEY`, extractor와 다른 `DELETE_VERIFIER_BASE_URL`, `DELETE_VERIFIER_MODEL`, `DELETE_VERIFIER_PROVIDER`를 모두 명시한 경우에만 이 경로를 활성화하고, 아니면 삭제를 fail-closed로 거부합니다. 어떤 provider 를 쓸지는 라이브러리가 숨겨서 정하지 않고 호출하는 쪽이 명시적으로 주입하거나 환경변수로 고르므로, 무엇이 밖으로 나가는지가 코드에 드러납니다. 대화를 한 글자도 밖으로 내보내지 않으려면 임베딩·추출·요약·삭제 verifier는 로컬 모델로 붙이고, 모순 판정은 규칙 기반이나 로컬 vLLM 으로 두면 됩니다.

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

Naia Memory는 사용자와 함께 쌓이는 **누구(WHO)의 기억**, naia-kb-compiler는 출처를 가진 **무엇(WHAT)의 지식**, naia-persona는 반복적으로 검증된 **어떻게(HOW) 행동하고 말할지**를 맡습니다.

| 프로젝트 | 맡는 것 | 동작 시점 | Naia Memory와의 관계 |
|---|---|---|---|
| [naia-agent](https://github.com/nextain/naia-agent) | 대화 루프, 메인 LLM, 도구, 컨텍스트 압축 | 실시간 | 매 턴 전에 기억을 회상해 메인 LLM 문맥에 넣고, 답변 뒤 대화를 저장합니다. 메모리 LLM·임베딩·저장 어댑터의 설정과 실행 권한도 호스트로서 배선합니다. |
| **naia-memory** | 개인의 사건·사실·관계와 그 수명주기 | 실시간 저장·회상, 유휴 시 정리 | 동적으로 바뀌는 개인 장기기억의 정본입니다. |
| [naia-kb-compiler](https://github.com/nextain/naia-kb-compiler) | 문서·URL 같은 출처를 검증 가능한 `kb.json`으로 컴파일 | 주로 오프라인 | 메모리를 저장하는 곳이 아닙니다. 출처·인용·승격 규칙이 필요한 안정된 지식을 별도 저장하고, agent가 `search`·`ask` 도구로 필요할 때 가져옵니다. |
| [naia-persona](https://github.com/nextain/naia-persona) | 말투·선호·행동 패턴을 모델 어댑터로 학습·평가·승격 | 느린 오프라인 주기 | 메모리 원문 전체를 바로 학습하지 않습니다. 동의, PII 정리, 중복 제거, 품질 검증을 통과한 파생 샘플만 후보로 사용하고 사람의 승인 뒤 persona adapter로 승격합니다. |
| [naia-adk](https://github.com/nextain/naia-adk) | 워크스페이스 포맷, 설정·스킬·지식의 소유 경계 | 상시 | 제품 메모리 파일의 소유 루트입니다. 활성 ADK의 `naia-settings/memory` 아래에 기억을 둡니다. |
| [naia-shell](https://github.com/nextain/naia-shell) | 데스크톱 셸과 사용자 접점 | 실시간 | 사용자 입력과 설정 UI를 제공하지만 기억 판단과 저장 로직은 agent와 memory가 담당합니다. |

```text
사용자 ↔ shell ↔ naia-agent의 메인 LLM
                    ├─ push/prefetch ↔ naia-memory       (개인의 동적 기억)
                    └─ search/ask    → naia-kb-compiler  (출처 기반 지식)

naia-memory의 동의된 기록 ── 정제·검증 ──▶ naia-kb-compiler
                                             │
                                             ▼
                                  naia-persona 학습 후보
                                             │
                                      평가·사람의 승인
                                             ▼
                                     persona adapter
```

기억과 지식은 같은 저장소로 합치지 않습니다. “사용자가 오늘 새 직장으로 옮겼다”는 즉시 naia-memory에서 회상할 수 있지만, 공식 회사 정책 문서는 출처와 함께 kb-compiler가 관리합니다. “사용자는 간결한 답을 선호한다”는 사실도 먼저 메모리 문맥으로 즉시 적용하며, 오랜 기간 반복되고 동의·검증된 행동 패턴만 naia-persona의 느린 학습 대상으로 넘어갑니다.

각 프로젝트의 개발 수준도 분리해서 봐야 합니다. 이 README의 앞선 성숙도 표는 naia-memory 자체의 상태이며, naia-kb-compiler와 naia-persona의 파이프라인 성숙도를 대신 보증하지 않습니다.

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

망각의 자연 발생, 자유 발화 흐름 속의 모순 감지, 절차 기억 같은 성질은 naia-agent·naia-shell 와 결합한 통합 환경에서만 제대로 검증됩니다. 이 항목들은 해당 레포의 통합 벤치에서 추적합니다.

## AI-Native 오픈소스

이 프로젝트는 AI 컨텍스트를 1급 산출물로 다룹니다. `.agents/` 의 컨텍스트 파일을 코드와 함께 버전 관리하고, AI 기여는 `Assisted-by:` git trailer 로 명시합니다. 기억은 로컬에 저장되어 사용자가 소유합니다. 임베딩·사실 추출·요약·모순 판정에 외부 모델을 붙이지 않는 한, 대화가 서비스 제공자의 서버로 넘어가지 않습니다.

`.agents/` 와 `.users/` 의 AI 컨텍스트는 [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 라이선스입니다.

## 라이선스

Apache License 2.0 — [LICENSE](LICENSE) 참고. [Nextain](https://nextain.io) 제작, [naia-shell](https://github.com/nextain/naia-shell) 을 포함한 Naia 스택의 일부입니다.
