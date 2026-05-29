# Naia Memory — LoCoMo 벤치마크 보고서

**날짜**: 2026-04-28
**평가자**: Gemini 2.5 Flash (answerer + judge)
**대상**: LoCoMo-10 (Snap Research, ACL 2024) — conv 0~5 (885문항)

---

## 1. 테스트 환경

| 항목 | 설정 |
|------|------|
| 시스템 | Naia Memory v0.1.4 (독자 엔진, LocalAdapter) |
| 임베딩 | gemini-embedding-001 (3072d) via Gemini API |
| LLM | gemini-2.5-flash (fact extraction + answer generation + judge) |
| 저장소 | JSON 파일 (in-memory) |
| 검색 | vector cosine similarity (default) |
| 서버 | Express, lazy consolidation |
| 벤치마크 | LoCoMo-10 공식 평가 파이프라인 |

## 2. 아키텍처 확인

**크로스 리뷰 결과**: Naia Memory는 **100% 독자 구현**. mem0 코드 0줄.

```
Naia Memory = LocalAdapter(자체 JSON + cosine + BM25 + KG)
            + LLM fact extraction (Gemini)
            + Ebbinghaus decay
            + Contradiction detection (keyword)
            + Context budget allocator
```

서버(`naia-memory-api.ts`)는 mem0 **REST 프로토콜만 호환**.

## 3. Keyword Hit 사전 검증 (conv 0, 199문항)

| 시스템 | 정확도 | 비고 |
|--------|--------|------|
| **Naia Memory** | **171/199 (85.9%)** | LocalAdapter |
| **mem0 library** | **156/199 (78.4%)** | mem0 Python SDK 직접 |

Naia Memory가 mem0 순정보다 +7.5pp 우세. 검색 엔진 자체는 mem0보다 우수.

## 4. LoCoMo 공식 결과 (LLM Judge, top-200)

### conv 0 (152문항)

| 카테고리 | top-10 | top-50 | top-200 |
|----------|--------|--------|---------|
| single-hop | 8.6% | 10.0% | 34.3% |
| temporal | 0% | 0% | 8.1% |
| multi-hop | 12.5% | 18.8% | **50.0%** |
| open-domain | 53.8% | **69.2%** | **84.6%** |
| **Overall** | **11.2%** | **14.5%** | **35.5%** |

### conv 1+2 (233문항)

| 카테고리 | top-200 |
|----------|---------|
| single-hop | 15.4% |
| temporal | 0% |
| multi-hop | 19.0% |
| open-domain | 62.5% |
| **Overall** | **14.2%** |

### conv 3+4+5 (500문항)

| 카테고리 | top-10 | top-50 | top-200 |
|----------|--------|--------|---------|
| single-hop | 0.7% | 0.7% | 2.5% |
| temporal | 0% | 0% | 0% |
| multi-hop | 4.1% | 6.1% | 11.2% |
| open-domain | 6.2% | 6.2% | 9.4% |
| **Overall** | **1.6%** | **2.0%** | **4.2%** |

### conv 0~5 통합 (885문항)

| 카테고리 | top-200 | 문항수 |
|----------|---------|--------|
| open-domain | 35.2% | 53 |
| multi-hop | 20.4% | 172 |
| single-hop | 10.6% | 480 |
| temporal | 1.7% | 180 |
| **Overall** | **12.2%** | **885** |

## 5. vs mem0 논문

| | Naia Memory (conv 0-5) | mem0 논문 (conv 0-9) |
|--|---|---|
| Overall | **12.2%** | **91.6%** |

## 6. 핵심 발견: 데이터 누적에 따른 성능 붕괴

| 구간 | Overall (top-200) | 서버 응답시간 |
|------|---|---|
| conv 0 | **35.5%** | ~0.5s/query |
| conv 1+2 | **14.2%** | ~2s/query |
| conv 3+4+5 | **4.2%** | ~5s/query |

conv가 진행될수록 성능이 급락.

## 7. 근본 원인 분석

### 7.1 ★ 치명적 버그: 검색 결과가 쿼리에 무관

**모든 질문이 동일한 검색 결과를 반환**:

```
conv0_q0 "When did Caroline go to LGBTQ support group?" → top-20: A, B, C...
conv0_q1 "When did Melanie paint a sunrise?"            → top-20: A, B, C... (동일)
conv0_q2 "What fields would Caroline pursue?"           → top-20: A, B, C... (동일)
```

**top-20 overlap = 20/20** (100%). 서로 다른 질문이 완전히 같은 결과를 반환.

**원인**: 두 가지 버그의 결합.

#### 버그 A: score 유실 (local.ts:586)

```typescript
// LocalAdapter.search() 반환
return scored.map((s) => s.fact);  // score 버림, Fact만 반환
```

`Fact` 타입에 `relevanceScore` 필드가 있으나(`types.ts:121`), search()에서 설정하지 않음.

#### 버그 B: 가짜 선형 점수 (naia-memory-api.ts:108)

```typescript
score: f.relevanceScore ?? 1 - i * (1 / (result.facts.length + 1))
```

`f.relevanceScore`가 항상 `undefined` → `score = 1 - rank/201`. 실제 cosine similarity가 아닌 **순위 기반 가짜 점수**.

#### 결과: 순위가 의미 없음

LocalAdapter는 내부적으로 cosine similarity로 정렬하나, score를 버리고 반환. 서버는 받은 순서 그대로 1.0, 0.995, 0.990... 할당. **결과적으로 쿼리와 무관하게 항상 같은 결과**.

### 7.2 temporal 1.7%의 원인

- Fact에 **세션 날짜 메타데이터**가 보존되지 않음
- "yesterday", "last week" 등 상대 표현이 절대 날짜로 변환되지 않음
- temporal 180문항 중 3개만 정답
- Fact extraction 프롬프트에 날짜 정규화 지시 없음

### 7.3 Answer generation 갭

검색 결과에 정답 단어가 포함된 비율:

| 구간 | answer in top-200 | LLM judge 정답률 | 갭 |
|------|---|---|---|
| conv 0 | 76% | 35.5% | **40.5pp** |
| conv 1+2 | 60% | 14.2% | **45.8pp** |
| conv 3+4+5 | 69% | 4.2% | **64.8pp** |

정답 정보가 검색 결과에 **있음에도** LLM가 정답을 생성하지 못함. 원인:
1. **노이즈 비율**: 200개 결과 중 정답 관련 fact가 1-2개뿐 → LLM가 매몰
2. **정답 형식 불일치**: "yesterday" vs "7 May 2023" → judge가 오답 처리
3. **정보 손실**: fact extraction이 원문의 뉘앙스를 잃음

### 7.4 데이터 누적 붕괴의 진짜 원인

| 구간 | unique facts | top-20 overlap | 정답률 |
|------|---|---|---|
| conv 0 | 188 | 20/20 | 35.5% |
| conv 1+2 | 351 | 19/20 | 14.2% |
| conv 3+4+5 | 473-703 | 15-20/20 | 4.2% |

검색이 쿼리를 반영하지 않으니 fact가 많아질수록 **노이즈 비율만 증가**. 이것이 붕괴의 주원인.

## 8. 개선 대안 (크로스 리뷰)

### ★ Priority 0 (즉시 수정, 버그 픽스)

#### A. 검색 score 버그 수정

**문제**: `local.ts:586`에서 score를 버리고 `naia-memory-api.ts:108`에서 가짜 점수 할당.

**수정안**:
1. `local.ts` search()에서 `relevanceScore`를 Fact에 설정 후 반환
2. `naia-memory-api.ts`에서 `f.relevanceScore` 사용 (fallback은 유지)

**예상 효과**: 검색 결과가 쿼리에 의존하게 됨 → **open-domain 84.6% 유지, 다른 카테고리 대폭 개선 예상**

**리스크**: 없음. 순수 버그 수정.

**크로스 리뷰**:
| 검토자 | 판정 | 근거 |
|--------|------|------|
| 데이터 분석 | **CONFIRMED** | top-20 overlap 20/20, score = 1-rank/201 |
| 아키텍처 | **CONFIRMED** | Fact에 relevanceScore 필드 있으나 미설정 |
| 코드 리뷰 | **CONFIRMED** | local.ts:586 map으로 score 버림 |

#### B. 날짜 정규화 (Temporal Fix)

**문제**: "yesterday" → "7 May 2023" 변환 없음 → temporal 1.7%.

**수정안**:
1. fact extraction 프롬프트에 세션 날짜 제공: "This conversation took place on {date}. Normalize temporal expressions."
2. 검색 결과 메타데이터에 세션 날짜 포함

**예상 효과**: temporal 1.7% → **30-50%** (180문항 중 50-90개)

**리스크**: LLM이 날짜를 잘못 변환할 수 있음. 검증 필요.

**크로스 리뷰**:
| 검토자 | 판정 | 근거 |
|--------|------|------|
| 데이터 분석 | **CONFIRMED** | temporal 실패 사례 100%가 상대 날짜 표현 |
| 아키텍처 | **WEAK APPROVE** | LLM 의존도 증가, 파이프라인 복잡화 |
| 대안 | Parser-based가 더 안정적일 수 있음 |

### Priority 1 (단기, 1-3일)

#### C. Recency-Weighted Retrieval (STM/LTM 계층)

**문제**: 703개 fact가 평등하게 경쟁 → 최근 대화의 fact가 노이즈에 묻힘.

**수정안**: 검색 시 recency 가중치 추가.
```
finalScore = vectorScore × α + recencyBoost × β + entityBoost × γ
recencyBoost = exp(-λ × age_hours)
```

| 계층 | 범위 | 가중치 |
|------|------|--------|
| Working | 현재 세션 | 1.0 |
| Short-term | 최근 24h | 0.8 |
| Long-term | 24h+ | 0.5 × (1 + frequency/10) |

**예상 효과**: conv 3-5 성능 4.2% → **15-25%** (최근 대화 fact 우선 검색)

**리스크**: LoCoMo는 멀티-hop 질문도 포함 → 오래된 fact가 필요한 경우 성능 하락 가능. 하지만 현재 4.2%이므로 net positive.

**크로스 리뷰**:
| 검토자 | 판정 | 근거 |
|--------|------|------|
| 데이터 분석 | **STRONG APPROVE** | conv 진행에 따른 붕괴가 주원인 |
| 아키텍처 | **APPROVE** | 인간 기억 모델에 부합 (Tulving) |
| 벤치마크 | **CAUTION** | 카테고리별 가중치 금지 (anti-overfitting). 범용 α만 허용 |

#### D. Answer Generation 프롬프트 개선

**문제**: 정답이 검색 결과에 있는데도 LLM가 정답 생성 실패 (40-65pp 갭).

**수정안**:
1. 프롬프트에 "Extract the specific answer from the memories. Do NOT say you don't know if the answer is present."
2. top-200 대신 **top-20**만 LLM에 전달 (노이즈 감소)
3. 검색 결과를 relevance score 순으로 정렬 (현재 무작위)

**예상 효과**: answer generation 갭 40-65pp → **15-25pp**로 축소

**리스크**: top-20 제한이 정답을 제외시킬 수 있음. P0 수정 후 재측정 필요.

**크로스 리뷰**:
| 검토자 | 판정 | 근거 |
|--------|------|------|
| 데이터 분석 | **APPROVE** | 200개 중 정답 fact가 1-2개 → 노이즈 매몰 |
| 아키텍처 | **APPROVE** | Context budget allocator와 일치 |
| 대안 | Reranker 모델 도입도 고려 |

### Priority 2 (중기, 1-2주)

#### E. JSON → SQLite 마이그레이션

**문제**: 전체 fact를 메모리에 로드, 선형 탐색.

**수정안**: `better-sqlite3`로 마이그레이션. 임베딩은별도 파일 유지.

**예상 효과**: 검색 속도 5-10x 개선, 메모리 사용량 대폭 감소

**리스크**: low (SQLite는 file-based, 배포 복잡도 최소)

#### F. Query Decomposition (Multi-hop)

**문제**: multi-hop 질문에서 1차 검색 결과로 2차 검색 불가.

**수정안**: LLM가 복합 질문을 서브쿼리로 분해 → 순차 검색 → 결과 결합.

**예상 효과**: multi-hop 20.4% → **40-60%**

**리스크**: LLM 호출 1회 추가 (latency/cost). 복합 질문이 아닌 경우 오버헤드.

### 개선 효과 예상

| 대안 | 예상 효과 | 난이도 | 우선순위 |
|------|----------|--------|----------|
| **A. score 버그 수정** | 12.2% → **40-55%** | 1시간 | **P0** |
| **B. 날짜 정규화** | temporal 1.7% → **30-50%** | 반나절 | **P0** |
| **C. recency 가중치** | conv 3-5: 4.2% → **15-25%** | 1-2일 | P1 |
| **D. answer gen 개선** | 갭 40-65pp → **15-25pp** | 1일 | P1 |
| E. SQLite 마이그레이션 | 속도 5-10x | 1주 | P2 |
| F. query decomposition | multi-hop 2-3x | 1주 | P2 |

**P0만 수정해도 12.2% → 40-55% 예상** (mem0 논문 91.6%의 절반 수준).

---

*보고서 생성: 2026-04-28*
*conv 0-5 evaluate 완료. conv 6-9는 predict만 완료 (미평가).*
