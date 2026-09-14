# Naia Memory 단계 4 — 추가 벡터 최적화 후보 기각

2026-09-06. Luna max 구현·측정, Astra 원시 증거 재집계·검토. 이 문서는 단계 4의 판정이며, 진행 중인 SQLite 기능·품질·앱 통합 전체의 완료 보고서가 아니다.

추가 후보를 기각하고 직전 구현을 유지했다. strict deep 지연 개선이 사전 기준인 10%에 못 미쳤고, unscoped deep p95는 허용한 5%보다 더 악화했다. 성능 결과가 불리한 후보를 제품에 남기거나 추가 반복으로 유리한 결과를 고르지 않았다.

## 비교 조건과 결과

- 동일한 합성 100,000 facts, 384차원 DB. main 90,000개, foreign 9,000개, 무소속 1,000개이며 hot은 총 10,000개다.
- mmap 기본값 0, warm cache. strict/unscoped × surface/deep 4모드, 균형 A/B 3쌍, 모드별 독립 프로세스로 총 24회 순차 실행했다.
- 실행별 warmup 15회 뒤 timed 60회. 각 실행의 p50/p95를 구하고, 각 A/B 쌍의 `(B/A − 1) × 100` 중앙값을 판정에 사용했다. 양수는 느려졌음을 뜻한다.

| 모드 | p50 변화 | p95 변화 |
|---|---:|---:|
| strict deep | −2.405% | +0.192% |
| unscoped deep | −4.876% | +6.852% |
| strict surface | +1.601% | −0.433% |
| unscoped surface | +3.232% | +0.004% |

strict deep은 p50 또는 p95가 10% 이상 개선되어야 한다. 다른 지표는 5% 이내 악화 조건이며, unscoped deep p95의 세 쌍은 +6.852%, −16.275%, +7.302%였다. strict deep p95 한 쌍의 +10.493% 악화를 ‘반복적 10% 초과 회귀’로 부풀리지 않는다. 위 두 주요 기준 미달만으로 기각하며 반복을 연장하지 않는다.

대응 timed 응답 720개와 scope probe 60개는 ID·순서·점수가 정확히 일치했다. 관측된 scope leak은 0이다. 24개 실행에서 서로 다른 PID, 종료 코드 0, DB SHA256·개수·generation·WAL 불변 및 동결 소스·하네스 해시 일치를 확인했다.

whole-process peak RSS/PSS의 strict deep 쌍별 변화 중앙값은 +1.319%/+1.497%, 개별 최대 증가율은 2.054%였다. 이는 heap 측정이 아니다. 같은 PID의 worker RSS를 중복 합산하지 않았다.

## 무엇을 남기고 되돌렸나

후보는 primitive 배열 heap과 Float32 직접 view로 allocation을 줄이는 시도였다. 진단은 SQLite iterator/BLOB 취득 비용이 주요 병목임을 시사했으나, 최종 endpoint에서 채택할 만한 개선으로 이어지지 않았다. 진단의 독립 구성요소 중앙값을 합산하거나 비용 비율로 해석하지 않는다.

`sqlite-vector-search.ts`의 단계 4 후보 차이만 동결 기준 A로 되돌렸다. 앞선 exact top-N 최적화와 mmap 기본값 0은 유지한다. Astra가 발견한 malformed ArrayBuffer 길이 호환성 차이도 후보 제거와 함께 사라졌으므로 후보만을 위한 후속 수정을 제품에 적용하지 않는다.

최초 실행기는 snapshot 경로 오류로 질의 전 실패했다. 그 기록을 보존하고 별도 campaign2로 실행했다. 최초 집계의 `pairedMedians`는 A와 B 각각의 중앙값 비율로 계산되어, 사전 판정에 필요한 쌍별 비율 중앙값과 달랐다. 정정 집계는 [기계 판독용 corrected JSON](../../reports/perf/sqlite-vector-stage4-ab-20260905/stage4-summary-campaign2-corrected.json)으로 보존했으며, [Astra의 정정 집계 검토](../../reports/perf/sqlite-vector-stage4-ab-20260905/corrected-summary-review.md)가 원시 기록과의 일치를 확인했다. 최초 파일은 그대로 보존한다.

## 증거와 범위

원시 JSON·로그·프로세스 메모리 표본·실행기·동결 소스·거절된 후보는 [단계 4 증거 폴더](../../reports/perf/sqlite-vector-stage4-ab-20260905/)에 있다. DB SHA256은 `6825406b56e917362292267a89db35a1cd7a244aaed13d1ec277f4928aa9c673`이다. Astra 검토는 보존된 기록과 경량 재집계에 대한 것으로, 앱이나 벤치마크를 재실행한 검토가 아니다. 공식 review-pass 인증도 아니다.

이 결과는 해당 합성 데이터·공유 호스트·warm-cache 조건의 검색 지연과 결과 동등성 근거다. 기억 답변 품질, 실제 LLM 압축 품질, 대규모 공개 벤치마크 경쟁력이나 앱 동작을 증명하지 않는다. 앞선 단계와 기준 환경이 달라 개선율을 누적하지 않는다.

다음 실행은 SQLite epoch/flashbulb/시간 구간 검색, KG·procedural·episode 영속화, 실제 암호화 백업이다. 별도 Luna max가 고정된 다국어 기억·실제 LLM 압축 평가를 준비하고 Astra가 검토한다.
