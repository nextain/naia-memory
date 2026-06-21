# #50 BGE-reranker 측정 결과 (2026-05-09)

#27 Step 3 cross-encoder (BGE-reranker) 의 5 conv CPU smoke 결과.
preservation-first 의 진짜 ranking 강화 path 검증. Step 1 sweep plateau 후
reviewer 1 권고 정합.

## Setup

- Model: `Xenova/bge-reranker-base` (multilingual XLM-RoBERTa, ~280MB)
  - 첫 호출 시 download 성공 (~/.cache/huggingface/hub/)
  - rerank failures: 0 (작동 verify)
- 환경: CPU (transformers.js)
- Dataset: AI Hub 141 Validation S4, 5 conv (seed=42 deterministic, 같은
  subset)

## 결과 (cosine 0.7 recall@K)

| Mode | recall@5 | recall@10 | recall@20 | 시간 | Cost |
|---|:-:|:-:|:-:|:-:|:-:|
| Reranker OFF (baseline) | 27.8% | 50.0% | 71.3% | 14분 | $0.0072 |
| **Reranker ON (BGE-base)** | **28.7%** | **45.4%** | **68.5%** | **11.5분** | **$0.0071** |
| **Δ** | +0.9pp | **-4.6pp** | **-2.8pp** | -2.5분 | -$0.0001 |

## 해석

### 1. Reranker 효과 = noise band 안 또는 약간 악화

- recall@5: +0.9pp (5 conv noise 안)
- recall@10/20: -4.6pp / -2.8pp (악화 — chain redundant 가설 정합)

### 2. Cross-review reviewer 1 가설 정확 검증

> R2.5 v2 chain + 보존 우선 통합 효과가 dominate. mode='latest' 가
> status='active' 만 노출 → MMR / threshold / cross-encoder 등 추가 ranking
> mechanism 이 *이미 chain 이 attribute 별 1개로 압축한 set* 위에서 작동
> → redundant.

#27 Step 1 (confidence threshold) sweep plateau + #50 (cross-encoder)
효과 미미 — *모든 ranking 강화 axis* 가 chain dominate 에 막힘.

### 3. Preservation-first 의 *짝* 가설 재검증

이번 세션 cross-review 의 \"preservation-first 가 retrieval-quality 강화 prerequisite\"
가설:
- mem0 \"97.8% junk\" 위험은 naia 와 무관 (76.8% cosine 강함)
- naia 의 *진짜 ranking 강화 axis 부재* — chain 위에서 추가 강화 X

→ #27 자체의 priority 재검토 필요. naia 의 *ranking 강화* 보다 *다른 path* (R4 Background brain, naia-os daily ground 등) 가 더 가치.

## 가능 원인 (추가 진단 필요)

| 가능성 | 검증 필요 |
|---|---|
| (1) chain dominate (가장 강한 가설) | reviewer 1 검증 ✓ |
| (2) bge-reranker-base 의 한국어 성능 약점 | bge-reranker-large 또는 v2-m3 시도 (Python BAAI 직접) |
| (3) ONNX quantization 정확도 손실 | FP32 또는 Python transformers 비교 |
| (4) 5 conv noise 큼 | 30 conv 측정 (CPU 3시간) — 그러나 (1) 가설 강하니 priority ↓ |

## 결론

**(3) 단계 완료** — #50 BGE-reranker mechanism wire + 측정 + archive.

Visible 효과 noise band 안. naia 의 retrieval 은 *전체 stack 통합 효과*
이고, 부품 추가 강화 (Step 1 / Step 5 / Step 3) 모두 redundant. naia 의
가치는 *fact extraction + chain + cosine* 의 통합.

다음 priority:
- **R4 Background brain (#26)** — 진짜 차별화 (cross-review 결론 \"spike emit channel = 진짜 새로움\")
- **#30 long-term framework** — naia-os 통합 후 daily ground 측정
- ❌ #27 추가 step (cross-encoder large / Python BAAI) — priority ↓

## 사용자 directive 정합

- (1) cleanup ✓ (commit `2a433cc`)
- (2) #28 Privacy Part 1 ✓ (commit `5fb5776`)
- (3) #50 측정 ✓ (본 archive)
- (4) R4 Background brain Step 1+2 ✓ (commit `7e04de8`)

이번 세션 4 단계 모두 진행. 단계별 review 통과.

## 누적 commits (push 차단 — 사용자 직접 push 필요)

- `d9c2022` #50 OfflineRerankerProvider implementation
- `2a433cc` archive cleanup
- `5fb5776` #28 Privacy Part 1
- `c7b389b` #50 reranker CLI option
- `a703bb7` #50 default model fix (v2-m3 → base)
- `7e04de8` R4 #26 Step 1+2 spike infrastructure

GitHub origin/main = `f39abcf` (sweep archive). 6 commits ahead.

```
git push origin main
```

으로 push 가능 (저장소 루트에서 실행).
