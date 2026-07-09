---
session_id: e14912ec-25e3-46fa-b815-6f01896e1a8c
topic: "#5 인지 속성 벤치 (소뇌: 기억·성격·무의식)"
date: 2026-07-04
status: in-progress
---

# #5 인지 속성 벤치 — naia-memory 소뇌 역할 정량화

이전 루프(perf/quality/compact)는 `perf-bench-continuation-2026-07-04.md`.
이 파일 = /goal의 핵심인 **인지 속성**(감쇠·재응고·consolidation·무의식) 벤치.

## 왜 (understand)
docs/cognitive-architecture.md가 4속성 정의. 유닛테스트(decay/reconsolidation/
semantic-consolidation/r4-background-brain)는 있으나 **행동 정량 벤치 부재**.
"객관적+체감가능"(/goal) = "중요한 건 오래 남고, 사소한 건 잊고, 떠올리면 강해진다"를 수치로.

## 감쇠 모델 (decay.ts)
`strength = importance × e^(-λ_eff×daysSinceAccess) × (1+recallCount×0.2)`
- `λ_eff = 0.08 × (1 - importance×0.85)` — 중요도↑ → 감쇠↓
- PRUNE_THRESHOLD=0.05, 회상 시 clock 리셋 + boost
- 결정론적·무의존 → 빠른 루프 가능

## 스코프 (첫 벤치 = 인지 retention)
1. **중요도별 half-life / 생존일수** — importance 0.1~0.9별 strength 50% 도달일 + prune 도달일
2. **회상 강화** — 회상 K회 시 생존 연장 (spacing/Hebbian 효과 정량)
3. **망각 판별력** — T={7,30,90,180}일에 중요 fact 보존 & 사소 fact 망각 precision/recall + 순위 상관
4. 산출: `reports/cognitive/retention.json` + 사람용 리포트, 망각곡선 표

## 플랜 (순차)
- Phase C1: retention 벤치 (decay, 결정론) ← 지금
- Phase C2: 재응고(reconsolidation) 벤치 — 모순 supersede precision/recall (LLM 의존 여부 확인 후)
- Phase C3: consolidation/spike (무의식) — 가능 범위 확인

## Phase C1 — 인지 retention 벤치 (2026-07-04) ✅
`src/benchmark/cognitive/retention-bench.ts` (결정론, 무의존). 산출 `reports/cognitive/retention.json`.

**1) 중요도별 생존**: imp 0.9=154일 / 0.7=82 / 0.5=51 / 0.3=31 / 0.1=10일. half-life 37↔10일. → "중요=오래 보존" 정량 ✅
**2) 회상 강화**: recallCount 0→10 생존 51→74일(multiplier). day30 회상 시 day31 강도 **7.2×**(clock reset). → "떠올리면 강해진다" ✅
**3) 망각 판별력** (50 중요 vs 50 사소):
| day | AUC | 중요보존% | 사소망각% |
|---|---|---|---|
| 7 | 1.0 | 100 | 0 |
| 30 | 1.0 | 100 | 68 |
| 90 | 1.0 | 66 | 100 |
| 180 | 0.66 | **0** | 100 |

**핵심 finding(교정)**: 회상/replay 없으면 ~5-6개월 내 중요 기억도 strength가 prune 임계(<0.05) 아래로 → **단, `decay()`는 splice 안 하고 `status='archived'`로만 전환(데이터 영구보존, 기본회상서 hide). 진짜 삭제는 #29 GC로만(미구현).** 즉 "삭제·망각"이 아니라 "active recall 이탈(복구가능)". day180 중요 0% 활성보존.
- **긴장(교정)**: 삭제는 없음(이미 보존우선 준수). 남는 이슈=**활성 회상 유지가 오롯이 replay에 의존**. → C3에서 replay가 중요 기억 clock을 실제로 리셋하는지 검증.
- **루크 방향(2026-07-04)**: (1) 감쇠율·기간을 설정 옵션으로(현재 하드코딩 상수) + 정리(schedule)해 볼 수 있게 (2) 진짜 삭제는 storage 부족시만 — 지우면 복구불가 (3) archived를 **장기기억 보관소(cold archive)로 백업** (4) 크로스레포: naia-agent RAG·naia-kb-compiler RAG·naia-memory 장기기억을 유기적으로 연결 고민.
- day30 지점은 이상적(중요 100% 보존, 사소 68% 망각) = 잘 튜닝된 단기 구간.

## 진행 로그
- 2026-07-04: 커밋(38a60ac). #5 착수, decay 이해, C1 스코프.
- 2026-07-04: C1 retention 벤치 완료(위 결과). 핵심 finding=replay 없으면 6개월내 전부 망각 → C3 결합 검증 필요.
