# naia-memory — Cognitive Architecture

학계 model 위에 naia 가 어떻게 구현되는지 mapping. 사용자 directive (보존
우선 + Background/Active brain 분리) 의 학계 정합 archive.

---

## 1. 4-store 아키텍처 (Tulving-CLS 정합)

| Store | 학계 model | 뇌 부위 | naia 구현 |
|---|---|---|---|
| **Episodic** | Tulving 1972, hippocampus-based fast learning | 해마 | `LocalAdapter.episode` |
| **Semantic** | Neocortical slow consolidation | 신피질 | `LocalAdapter.fact` |
| **Procedural** | Squire & Knowlton 1995 | 기저핵 / 소뇌 | `LocalAdapter.skill` (placeholder) |
| **Working** | Baddeley 1986 | 전전두피질 | naia-agent 책임 (외부) |

CLS (Complementary Learning Systems, McClelland 1995):
- 빠른 학습 (hippocampus = episodic) + 느린 통합 (neocortex = semantic)
- *수면 동안 transfer* — naia 의 `consolidation` cycle 정합

---

## 2. Encoding pipeline (Importance gating)

```
사용자 turn ("내 직업은 엔지니어야")
   ↓ memory.encode()
Episode (raw, 즉시 저장 — 단기)
   ↓ consolidate() — 30분마다 sleep cycle
   ↓
LLM fact extraction (turn 묶음 → atomic fact)
   ↓
Importance score (3축: importance × surprise × emotion)
   ↓ gate
   └─ 추출된 개별 사실을 보존 (일시적 도구 오류 등은 제외)
```

날짜와 주체가 있는 개인 경험은 일회성 업무 결과 요약과 구분한다.
기본 추출에서 연결 어미와 쉼표로 나눈 후속 명제에 다른 주체가 없으면 앞 명제의 1인칭 주체 근거를 물려받아 날짜 경험 예외에 사용한다. 다른 주체가 명시되면 상속하지 않는다. 일회성 작업 필터의 다른 조건은 그대로 유지한다.

학계 model:
- **Salience-driven encoding** — 중요한 것만 long-term consolidation
- **Surprise-modulated learning** (Schultz 1997, dopamine prediction error)
- **Emotion-enhanced memory** (LeDoux 1996, amygdala)

---

## 3. Retrieval (recall) — *꺼내기, 저장 X*

```
사용자 query → recall()
   ↓
1. Vector cosine (gemini-embedding-001 / bge-m3)
2. BM25 keyword
3. RRF fusion
4. KG spreading activation (entity 연결로 연관 fact 활성)
5. (R3 후) HyDE / cross-encoder re-ranking — issue #27
   ↓
top-K fact + episode (deepRecall 옵션)
```

학계 model:
- **Spreading activation** (Collins & Loftus 1975) — 한 entity 회상 시 연관 entity 활성
- **Dual-process** (Yonelinas 2002) — recollection (specific) + familiarity (gist)

---

### 사용한 기억의 강화

LocalAdapter와 Mem0Adapter는 검색 결과를 기본적으로 강화하지 않는다 (`touch: false`). 답에 실제 사용한 episode와 fact의 ID를 `MemorySystem.markUsed({ episodeIds, factIds })`에 전달하면 해당 항목만 강화한다. 중복 ID는 한 번만 처리하며, 알 수 없는 ID는 무시한다. 명시적으로 `touch: true`를 전달하면 검색 결과를 이전처럼 강화한다. Mem0의 강화 정보는 현재 어댑터 인스턴스의 메모리에 유지된다. 이 기능을 지원하지 않는 어댑터는 `markUsed` 호출 시 오류를 반환한다.

### 벡터 후보 제한

LocalAdapter의 일반 검색은 벡터 점수가 기준을 넘더라도 유사도 상위 50개만 벡터 경로의 후보로 인정한다. `vectorCandidateLimit`으로 조정할 수 있으며, 키워드·엔티티·감정 후보와 deep recall은 별도로 유지한다. 50은 성능 측정값이 아닌 조정 가능한 운영 기본값이다. 임베더가 없으면 기존 키워드 검색을 유지한다.

## 4. Reconsolidation (R2.5) — 모순 감지 + supersede

기본 추출기는 문장 경계와 한국어 연결 어미 뒤 쉼표, 영어의 `and`를 이용해 명제를 나눈다. 짧거나 서술이 불완전한 조각은 인접 명제에 붙인다. 각 명제에는 거주, 직업, 과거 직장, 일반 중 하나의 거친 선택 속성이 붙으며, 서로 다른 속성의 사실은 대체하지 않는다. 속성이 없는 기존 사실은 일반으로 취급한다. 명시적인 1인칭 이사는 같은 범위의 기존 1인칭 거주 사실을 대체한다. 이 분류는 간단한 휴리스틱으로, 언어의 모든 의미를 판별하지는 않는다.

직업 분류는 의사, 개발자, 디자이너, 교사처럼 정해진 소수의 직업 명사에 한국어 종결형이 붙은 표현과 영어 `I am a/an` 직업 표현도 인식한다.

### 명시적 삭제와 되살리기

묘비는 삭제 요청의 프로젝트와 당시 보관한 사실 ID를 함께 기록한다. 문구 대조는 같은 프로젝트의 사용자 주체 사실과 episode 본문에만 적용하며, 보관한 사실 ID와 그 원본 episode는 주체와 관계없이 제외한다. 다른 주체의 활성 사실은 일반 검색과 deep 검색에 남는다. 다른 프로젝트의 재발화는 묘비를 해제하지 않는다. 이전 형식의 묘비는 기존 전역 범위를 유지한다. 기본 추출기는 대상이 있는 긍정 명령형만 삭제로 인정하며 부정, 질문, 설명과 명령 전체의 인용은 거부한다. 검증기 없는 삭제 후보, 문구 필터와 자동 해제는 같은 주체 판정을 사용한다. 1인칭 근거가 없거나 가족·관계 등 다른 사람 표지가 있으면 사용자 주체로 인정하지 않는다. 후보가 여러 개면 삭제하지 않는다. 주체 판정은 제한된 휴리스틱이다.

기본 추출기는 명시적인 삭제·잊기 요청의 목적어나 인용 문구를 삭제 대상으로 추출한다. 검증기가 없으면 활성 사실에 대상이 영문 단어 경계 또는 한글 어절 시작과 조사 경계로 일치할 때만 삭제한다. 한 글자 대상은 자동 삭제하지 않으며 임베딩 유사도만으로 삭제하지 않는다. 검증기가 있으면 기존 검증 절차가 우선한다. 삭제된 사실은 보관 상태로 남고 대상 문구는 저장소의 묘비에 기록된다. 사실과 episode 검색 및 deep/history 검색은 묘비 문구를 포함하는 사용자 주체 항목을 제외한다. 삭제된 사실의 원본이거나 사용자 주체로 판정된 episode에 보존할 사실과 삭제할 값이 함께 있으면 episode 전체를 제외하며, 보존할 사실은 사실 저장소에서 별도로 검색한다. 원문은 영구 삭제하지 않는다. 같은 프로젝트에서 사용자 주체의 새 사실이 묘비 대상 문구를 포함하고 삭제된 사실과 같은 속성 꼬리표를 가질 때 해당 묘비가 제거된다. 삭제된 사실의 속성을 확인할 수 없으면 자동 해제하지 않는다. `MemorySystem.removeTombstone(target)`으로도 묘비를 제거할 수 있다. LocalAdapter가 이 동작을 지원하며 Mem0Adapter와 다른 어댑터에는 아직 묘비 지원이 없다.

### 현재 (v1)
fact `status: "active"` → `"superseded"` 변경. 검색 hide. 데이터 보존.

### 미래 (v2, #24)
chain pointer + bi-temporal validity:
```
사용자 직업 history:
  v1 [2026-01-01 ~ 2026-04-15]: 소프트웨어 엔지니어
  v2 [2026-04-15 ~ now]: 디자이너
  predecessor: v1 → v2
```
recall mode = `latest` / `history` / `at-time`.

학계 model:
- **Reconsolidation** (Nader 2000) — recall 시 memory labile 상태 → re-stable 됨
- **Update without erasure** — 옛 memory 보존, valid 기간 표시

---

## 5. Decay (Ebbinghaus)

`strength` 시간 따라 감소. 사용 표시 또는 명시적인 touch 검색 시 강화 (Hebbian).

사용자 directive (보존 우선) 적용:
- **현재 코드**: `shouldPrune` + splice (위반)
- **R3 변경 (#25)**: `shouldArchive` + status 변경 만, 데이터 영구 보존
- **임계 도달 시 (#29)**: cold-spill (1차) → strength-weighted forget (2차) → explicit GC (3차)

학계 model:
- **Ebbinghaus 망각 곡선 (1885)** — exponential decay
- **Synaptic pruning** — 안 쓰는 connection 약화 (그러나 영구 삭제 X)

---

## 6. R3+ — Background brain + Active brain (사용자 directive 2026-05-08)

### Background brain (naia-memory, #26)

```
Sleep cycle (30분마다 또는 idle):
  1. Replay-worthy fact 선정
     - recent + high importance + recent recall
     - 또는 사용자가 자주 회상한 fact
  2. Strength boost (recall priority 강화)
  3. KG spreading 으로 연관 fact 도 boost
  4. Spike detection — significant event 감지:
     - contradiction (R2.5)
     - high-importance + relevant
     - recall-failure-resolved
     - temporal-anchor ("1년 전 오늘")
     - cross-domain-analogy (KG bridging)
     - user-emotion-anniversary
     - repeated-fail
  5. SpikeEvent emit → naia-agent subscriber
```

학계 model:
- **Sharp-wave ripples** (Buzsáki 1996) — hippocampus 의 fast replay (100-200Hz)
- **Sleep-dependent consolidation** (Wilson & McNaughton 1994)
- **Default Mode Network** (Raichle 2001) — spontaneous reorganization

### Active brain (naia-agent, #26)

```
On spike event:
  1. Source monitor (LLM 판단):
     - "이 spike 가 진짜 현재 대화와 관련?"
     - 적절성 score 0-1
  2. Pragmatic gate (LLM 판단):
     - "지금 *말해야 한다* 가 자연스러운가?"
     - Grice maxim 정합
     - rate limit (너무 잦은 inject 방지)
  3. Active context inject:
     - approve 받은 spike → prompt 의 "recent insight"
     - 또는 next-turn 의 "아 그러고 보니, [...]"
```

학계 model:
- **Source monitoring framework** (Johnson 1993) — \"이게 진짜 메모리인가, 추측인가?\"
- **Gricean pragmatics** (Grice 1975) — 4 maxim (quality / quantity / relation / manner)
- **DMN ↔ task-positive switch** — 휴식 ↔ 활동

---

## 7. 책임 분리 — naia-memory ↔ naia-agent

| 차원 | naia-memory (Background) | naia-agent (Active) |
|---|---|---|
| **저장** | encode / consolidate | — |
| **회상 mechanism** | recall API + ranking | — |
| **자연어 의도 파악** | — | "어제" → timestamp, "history" → mode |
| **Reconsolidation 데이터** | chain + validity | — |
| **Reconsolidation 발화** | — | LLM 판단 + 적절성 |
| **Background replay** | sleep cycle + replay-worthy | — |
| **Spike detection** | rule-based emit | — |
| **Spike action** | — | source monitor + pragmatic gate |
| **Privacy 데이터** | project scope + irrelevant isolation | PII redaction + active context filter |
| **Daily 사용 측정** | snapshot + diff | survey + Likert eval |

공유 schema (`SpikeEvent` / `ActiveContext` / `SpikeAction` / `SubscribableMemory`)
는 현재 `src/memory/spike.ts` 에 정의되어 `@nextain/naia-memory` 에서 re-export 된다.
독립 `@nextain/agent-types` 패키지로 옮기는 것은 계획(naia-agent#27)이며 아직 ship 전.

---

## 8. 사용자 directive 5개 학계 정합

| Directive | 학계 model |
|---|---|
| 시간 연관 회상 + 장기기억 보존 | Reconsolidation (Nader 2000) + Bi-temporal data (Snodgrass 1992) |
| 모든 mechanism 삭제 보수적 | Synaptic pruning ≠ deletion (Olson 2014) |
| recall latency 수용 | Recollection > familiarity (Yonelinas 2002) — slow path 인정 |
| Background brain (replay + spike + priority) | CLS + Sharp-wave ripples + DMN |
| Active brain (source + pragmatic) | Source monitoring (Johnson 1993) + Gricean pragmatics |

---

## 9. 진짜 차별화 (cross-review 2026-05-08)

| | naia |
|---|---|
| Spike emit → Active brain inject | ✅ **진짜 새로움** (Letta/OpenClaw/mem0 모두 passive) |
| Preservation-first system-wide invariant | ✅ **부분 차별** (Zep facts only / LangMem default only) |
| Background consolidation 자체 | ❌ 재발명 (Letta sleeptime, OpenClaw Dreaming, mem0 summarizer) |
| CLS / sleep replay 자체 | ❌ 재발명 (2025-2026 wave) |
| Source monitor framing | ❌ 학계 relabel |

위험: mem0 의 \"97.8% junk\" → preservation-first 의 *retrieval ranking 강화 prerequisite*.

---

## 10. 참고 문헌

### Cognitive science
- Tulving E. (1972) Episodic and semantic memory
- McClelland JL, McNaughton BL, O'Reilly RC. (1995) Why there are complementary learning systems
- Nader K, Schafe GE, Le Doux JE. (2000) Fear memories require protein synthesis in the amygdala for reconsolidation after retrieval
- Wilson MA, McNaughton BL. (1994) Reactivation of hippocampal ensemble memories during sleep
- Buzsáki G. (1996) The hippocampo-neocortical dialogue
- Johnson MK, Hashtroudi S, Lindsay DS. (1993) Source monitoring
- Grice HP. (1975) Logic and conversation
- Raichle ME. (2001) A default mode of brain function
- Ebbinghaus H. (1885) Über das Gedächtnis

### AI / Memory systems (2025-2026 wave)
- SleepGate (arxiv 2603.14517)
- SCM Sleep-Consolidated Memory (openreview iiZy6xyVVE)
- NeuroDream (arxiv 2604.20943)
- SuRe surprise replay (arxiv 2511.22367)
- Letta sleep-time compute (UC Berkeley + Letta paper)
- OpenClaw Dreaming
- mem0 paper (arxiv 2504.19413)
- Zep paper (arxiv 2501.13956)
- LongMemEval (arxiv 2410.10813)
- Source monitoring (Johnson 1993, Yale)

---

## 11. 본 docs 의 위치

- 학계 model 의 archive
- naia 의 design 의 *학계 정합* reference
- 새 capability 추가 시 학계 정합 검증 ground

수정 시점:
- 새 학계 model 발견
- 새 capability 추가 시 model mapping
- cross-review 후 새 결론
