# naia-memory — Cognitive Architecture

학계 model 위에 naia 가 어떻게 구현되는지 mapping. 사용자 directive (보존
우선 + Background/Active brain 분리) 의 학계 정합 archive.

> **현재 progress 위치**: `.agents/progress/r3-cognitive-architecture-2026-05-08.md` (R3+ phase plan).

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
   ├─ score 높음 → fact 저장 (장기)
   └─ score 낮음 → episode 만 보존 (사용자 directive: 삭제 X)
```

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

## 4. Reconsolidation (R2.5) — 모순 감지 + supersede

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

`strength` 시간 따라 감소. 회상 시 강화 (Hebbian).

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
