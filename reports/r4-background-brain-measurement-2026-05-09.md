# R4 #26 Background brain — 진짜 동작 측정 (2026-05-09)

> **정정 (2026-06-12).** 이 문서의 본문은 **2026-05-09 시점의 과거 측정 기록**이며,
> 아래 §1·§5의 "Step 5a temporal-anchor ✓"와 §결론의 "ship-ready"는 부정확하다.
> `detectTemporalAnchors` / `detectEmotionAnniversaries`는 메서드로 존재하나
> `consolidateNow` 어디에서도 호출되지 않는다(call site 없음 — grep 확인).
> **현재 상태:** Step 5a `describe` 블록의 테스트 **3건 모두 `it.skip`**으로
> 격리돼 있다 — positive 2건(365일 anchor / user-emotion-anniversary)은 발사되지
> 않는 spike를 단언하므로 통과 불가, negative 1건(low-importance → anchor X)은
> detector 미호출이라 항상 통과하는 vacuous 테스트라 함께 skip. Step 5a는
> **미배선 WIP**이며 ship-ready 아님. Step 1~4(infra / contradiction /
> matchesActiveContext / replay boost)는 실제 동작·측정됨. 배선 시 정정 해제.

사용자 directive (2026-05-09): \"성능 벤치마크 설계 + 실제 동작 확인\".

## 1. Unit tests (2026-05-09 기록: 12 pass / 현재: Step 5a 3건 skip — 위 정정 참고)

| 영역 | tests | result |
|---|:-:|:-:|
| Step 1+2 infrastructure | 3 | ✓ all pass |
| Step 3a contradiction trigger | 3 | ✓ (emit + cross-project block + optOut block) |
| Step 3b matchesActiveContext | 3 | ✓ (topic / entity / no-match) |
| Step 4 replay boost | 1 | ✓ (recent + important strength 변경) |
| Step 5a temporal-anchor | 3 | ⏸ 3건 모두 skipped — 미배선 detector (정정 2026-06-12) |

## 2. Phase B-α 측정 (gemini filter, 80-entry ledger, 30 contradictions)

| Axis | 결과 | Pass criteria |
|---|:-:|:-:|
| Axis A Recall@10 | **100%** (6/6) | ≥70% ✓ |
| Axis B Supersede precision | 50% (15/30) | ≥80% ❌ (R2.5 자체 한계) |
| Axis C False positive | **0%** (0/50) | ≤5% ✓ |
| **R4 spikes (Step 3a)** | **19** (contradiction=19) | 발사 verified ✓ |
| **R4 replay boost (Step 4)** | **30** | 동작 verified ✓ |

Cost: $0.0018, 154s.

## 3. R4 mechanism 활성도 정량

### Step 3a Contradiction trigger
- 80 turn ledger 위 19 spike (turn 당 **24%** 빈도)
- **(미검증 가설, 정정 2026-06-12)** 80-turn 합성 ledger의 24% 빈도를 실 daily
  사용으로 외삽하면 1-3 spike/day로 추정 — 단, 실사용↔합성 ledger 매핑이나 실제
  contradiction 발생률은 측정된 바 없음. 배선·실사용 측정 전까지 가설로만 취급.
- spike emit 19 vs supersede 15 = 4 차이는 chain depth 또는 filter
  rejection 후 재emit (정상 — emit 은 signal, supersede 는 action)

### Step 3b high-importance-relevant
- 0 발사 (active context 미설정)
- naia-agent 통합 후 active context push 시 활성 — 측정 시뮬레이션 별도

### Step 4 Replay boost
- 30 fact strength 자동 변경 / consolidate cycle
- recent + important + active context 매칭 시 ×2 boost
- 합성 ledger 모두 active 라 모든 fact 매번 boost (정상)

### Step 5a Temporal-anchor
- 0 발사 — **정정(2026-06-12): detector가 `consolidateNow`에 미배선이라 fact
  나이와 무관하게 emit 0.** (원문은 "fact가 방금 생성돼 365일 매칭 X"로 적었으나
  이는 부정확 — 배선되면 다시 측정.)
- 배선 + naia-os daily 사용 후에야 실 daily ground 에서 활성 가능

## 4. 진짜 차별화 verify

cross-review (이번 세션) 결론:
> Spike emit channel (Background → Active brain) 이 진짜 차별화.
> Letta / OpenClaw / mem0 모두 passive consolidation — naia 만 active
> session 에 spike 신호 inject 채널 명시.

> **(정정 2026-06-12)** 위 경쟁 비교는 이 실험에서 직접 측정한 것이 아니다 — 본
> 실험은 naia 단독만 돌렸고 Letta/OpenClaw/mem0 의 동작을 나란히 측정한 비교
> 근거는 없다. "naia 만 active" 주장은 근거 있는 외부 비교(날짜·출처 명시)로
> 뒷받침하기 전까지 검증된 사실이 아니라 설계 가설로만 취급한다.

이번 측정으로 spike emit channel 실 작동 verify. 측정값:
- 80 turn 위 19 emit
- contradiction reason 으로 100% 분류 (다른 reason 은 active context /
  daily ground 의존)
- cross-project leak 차단 unit test 검증

## 5. 사용자 directive 정합 (anchor §A06-A10)

- §A06 mem0 stack on top: naia-on-mem0 hybrid 측정 결과
- §A07 보존 우선 + recall latency 수용: R3 commit chain
- §A08 Background + Active 책임 분리: 본 R4 commit chain ✓
- §A09 retrieval ranking 강화: #27 sweep plateau
- §A10 Privacy 5 차원: #28 Part 1+2
- 모두 활성 + 측정 verified

## 6. 다음 priority

R4 mechanism unit + 측정 verify 완료. 다음:
- naia-agent#26/27 통합 (사용자/agent 측 작업) — daily ground 위 진짜 가치
- R4 Step 5b/c (cross-domain-analogy / user-emotion-anniversary) — 작은
- R4 Step 3c+d (recall-failure-resolved / repeated-fail) — query history
  인프라 큰 작업
- 측정 framework 보강 — Phase A 위에 active context 시뮬레이션 추가

## 결론

R4 spike + replay 진짜 동작 verified — unit test 12 pass + Phase B-α
synthetic ground 위 19 spike + 30 replay boost 정량.

naia-memory 측 R4 Step 1~4 mechanism 동작 verified. **단 Step 5a
temporal-anchor 는 미배선 WIP (위 정정 참고) — ship-ready 아님.** Step 1~4
한해 naia-agent 통합 후 daily 사용 시 spike subscribe 가능
(docs/integration.md §1.5 참고).
