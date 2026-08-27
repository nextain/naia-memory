# 구조화 사실 충돌 해소 설계

이 문서는 GitHub #39의 구현 계약이다. 목표는 한국어 문장 규칙을 보강하는 것이 아니라, 언어와 무관하게 **근거가 있는 경우에만** 동일 속성의 사실 변화를 연결하고 모든 원문·출처·시간 이력을 보존하는 것이다.

## 문제와 결정

현재 `Fact`는 `status`, `supersedes`, `successorId`, `validFrom/validTo`, `sourceEpisodes`를 이미 가진다. 그러나 후보 비교와 일부 다양성 처리는 원문 토큰·부정 표현·`content` 접두어에 의존한다. 이는 “이사했다”, “이제 … 쓰기로 했다” 같은 한국어 변화와 다른 언어의 문장 형식을 같은 신뢰도로 다룰 수 없다.

추가할 선택적 구조는 다음과 같다.

```ts
interface StructuredFact {
  subject: string;
  property: string;
  value: string;
  polarity: "affirmed" | "negated";
  cardinality: "single" | "multi";
  provenance: "extractor" | "caller";
}
```

이 구조는 원문을 대체하지 않는다. `content`, `sourceEpisodes`, 기존 생명주기 필드는 정본이며 `structured`는 비교 가능한 보조 주장이다.

## 쓰기 경로

1. 기존 추출기 또는 명시적 호출자가 원문과 선택적 `structured`를 제공한다.
   원문 episode를 저장하는 `encode` 단계는 구조가 없으므로 사실을 supersede하지 않는다.
2. subject/property/value는 Unicode NFC와 앞뒤·연속 공백 정리만 적용한 비교 키를 만든다. 형태소 분석, 언어 감지, 한국어 조사 제거, 언어별 예외는 하지 않는다.
3. 기존 후보와 새 후보가 모두 구조화되어 있고 subject/property가 같으며 양쪽 cardinality가 `single`, polarity가 `affirmed`이고 값이 다르면 supersede한다.
4. 나머지는 `keep`이다. 특히 다중값, 누락 필드, polarity 차이, 값 동일, 모호한 추출은 절대 자동 대체하지 않는다.
5. supersede는 기존 원문을 `superseded` 상태와 종료 시각으로 남기고 새 사실이 역방향 `supersedes`와 새 출처를 가진 별도 행을 만든다.

## 검색 경로

기본 `latest`는 현행 active 사실만 반환한다. `history`와 `at-time`은 기존 체인을 그대로 사용한다. 이 변경은 후보 정렬의 언어별 점수·임계값을 추가하지 않으며, 응답 생성·의도 해석·abstention도 맡지 않는다.

## 실패 시 안전성

| 실패 | 안전한 동작 |
| --- | --- |
| 구조화 추출 실패/누락 | 원문 그대로 저장, 기존 텍스트 검색으로 폴백 |
| 동일 대상이나 다른 속성 | 체인 연결 안 함 |
| 취미·언어 등 다중값 | 체인 연결 안 함 |
| 부정 주장 또는 추출 polarity 불일치 | 체인 연결 안 함 |
| 한국어 외 입력 | 동일 Unicode 정규화만 적용, 원문 보존 |

## 검증 계획

- 공개 한국어 진단은 회귀 감시용으로 유지한다.
- #39 전용 보류 케이스는 Korean 단일값 변경, 다중값, 동일 대상의 다른 속성, English/Japanese 폴백을 포함한다.
- 적대 검토는 (1) 잘못된 대체로 이력이 사라지는 경우, (2) 다중값을 단일값으로 오인하는 경우, (3) 구조 누락 언어에서 기존 검색이 깨지는 경우를 우선 확인한다.
- 채택 기준은 기존 단위·통합 검사 통과, 원문/출처 보존, 보류 케이스에서의 금지 사실 노출 비악화다.
