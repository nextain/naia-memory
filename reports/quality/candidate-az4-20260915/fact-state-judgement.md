# az4 사실 상태 판정 (1차 지표)

판정은 2026-09-15 11:32 KST에 했다. 판정 모델 단계는 아직 끝나지 않았고 score.json은 열지 않았다. 목록은 `listing-az4.txt`(`supersession-precision-20260915/analyze.py`)이며, 삭제 대상은 capture의 activeState와 삭제 검증 영수증을 함께 보고 판정했다. 판정자는 az5와 같은 작성자(Claude)이고 같은 규칙을 썼다.

## 유효 조건

추출 재생은 42/42로 적중했고 실제 추출 호출은 0건이었다. 삭제 검증 호출은 7건으로, 등록한 무효 조건(7건이 아니면 무효)을 통과했다.

capture-meta의 extractionFailures에는 2건이 기록되었다. 추출 호출이 실패한 것은 아니다. 진단 커밋(cb0f19e)이 근거 검증에서 거부한 삭제 연산을 실패 콜백으로 보고한 것으로, en-05(`target-not-in-episode`)와 en-14(`target-lacks-value-and-identity`)다. 두 사례 모두 사전 등록에서 "도달 불가"로 예측했다. 이렇게 집계되는 방식은 사전 등록에 적지 않았으므로 편차로 기록한다. 이 2건은 사전 등록의 추출 실패 분류(invalid-json, http 등) 어디에도 속하지 않는다.

## 검증기 결과

| 사례 | 후보 경로 | 후보 수 | 검증기 | 결과 |
|---|---|---|---|---|
| ko-05 | string-exact | 1 | 승인 | "사용자 창고 출입 암호: 달빛상자" archived |
| ja-05 | string-exact | 1 | 승인 | "架空の貸金庫の合言葉: 『青い風車』" archived |
| ko-14 | structured-label | 1 | 승인 | 솔 프로젝트 배포 채널 archived, 숲 프로젝트 유지 |
| ja-14 | structured-label | 1 | 승인 | 波企画 배신 형식 archived, 山企画 유지 |
| ko-06 | structured | 1 | 승인 | 토요일 도예 archived, 일요일 사진 유지 |
| en-06 | structured | 1 | 승인 | 월요일 어학 수업 archived |
| ja-06 | structured | 1 | 승인 | 화요일 서예 archived, 목요일 요리 유지 |

oversized 결과와 sibling-values>1 거부는 0건이었다.

## 사전 등록 예측과의 대조

등록한 예측은 모두 맞았다.

- 도달한 사례는 예측한 7건 그대로였고, 경로 태그도 예측과 같았다.
- 새로 archive된 사실은 예측한 4건(ko-05, ja-05, ko-14, ja-14)이다.
- en-05와 en-14의 대상 사실은 활성으로 남았다.
- ko-05의 두 번째 문자열 사실("사용자 창고 출입 암호(테스트용): 가상 암호")은 활성으로 남았다.
- 다른 프로젝트의 사실(숲, 山企画)도 활성으로 남았다.
- 06 계열의 archive 3건은 az5b와 같다.
- 잘못된 archive는 0건이다.
- 대체로 인한 은퇴 목록은 az5b와 같다. 목록 비교에서 차이는 새 archive 4건뿐이었다.

gold `deleted` 명제를 기준으로 보면, archive된 사례는 az5b의 3/9에서 az4의 7/9가 되었다. 9는 05·06·14 계열 9사례다. 남은 2건(en-05, en-14)은 추출 쪽 원인이다.
