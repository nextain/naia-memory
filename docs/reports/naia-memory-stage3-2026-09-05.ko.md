# Naia Memory 단계 3 — 백업 지원 판정과 제품 경로

작성일: 2026-09-05 · 상태: 구현·실행 검증·Astra 검토 완료 · Luna max 구현 / Astra 단계별 검토

## 이번 결정

2단계 mmap은 기본값 0을 유지한다. 10만 건 실험에서 strict 검색 p50이 surface +12.14%, deep +5.71% 악화했고 실행 간 결과가 섞였다. strict deep p95의 감소만으로 기본 활성화하지 않는다. 다음 성능 실험은 모드별 프로세스와 메모리 측정을 분리해야 한다. 상세 수치와 한계는 [2단계 보고서](naia-memory-performance-stage2-2026-09-05.ko.md)에 보존한다.

이번 단계는 확인된 제품 결함을 먼저 수정했다. SQLite는 백업 메서드가 존재하지만 실제로는 미지원 오류를 내므로, 메서드 존재만 보는 `MemorySystem.supportsBackup()`이 true를 반환했다. provider는 LocalAdapter의 `export/import`와 다른 메서드명을 찾아 지원되는 백업도 호출하지 못했다. 새 메모리 엔진이나 백업 형식을 추가할 필요 없이 지원 판정과 호출을 일치시킬 수 있다.

## 단계별 확인

1. 수정 전 기본 검사는 172파일·1,463개 모두 통과했다. 2단계의 종전 9개 실패는 현재 환경에서 재현되지 않았다. 전체 원인이 환경 문제라고 확정하지 않으며 해당 테스트를 바꾸지 않는다.
2. 수정 전 SQLite 검사는 38개 중 33개 통과, 기존 parity 5개 실패였다. epoch 2개, flashbulb 1개, semantic consolidation 1개, cross-domain analogy 1개는 구현이 별도로 필요한 영역이다. 백업 수정의 성공 기준에서 숨기거나 제외해 전체 지원으로 표시하지 않는다.
3. Luna max는 선택적 adapter 지원 플래그와 기존 provider 오류 호환을 제안했다. Astra는 메서드 두 개의 함수 여부 확인, 기존 어댑터·외부 provider fallback, 백업 외 capability 비간섭을 조건으로 설계를 수용했다.
4. UC-MEM-03과 MEM-FR-04를 먼저 기록하고 구현·회귀 검증을 완료했다. 잘못된 비밀번호로 복원할 때 대상 데이터가 유지되는지도 확인했다.
5. 추가 확인에서 문서에 설명된 NaiaMemoryProvider가 패키지 루트에서 export되지 않는 문제를 발견했다. Astra 검토 후 memory-system-api에서 provider와 options 타입을 공개했다. 기존 변경이 있는 index.ts는 보존했다.
6. Astra의 구현 검토에서 외부 provider fallback과 메서드 하나만 존재하는 경우의 테스트 보강을 요청받아 Luna가 반영했다. production 6개·테스트 3개 파일의 읽기 검토에는 필수 수정 사항이 남지 않았다.

## 실행 결과

| 확인 | 수정 전 | 수정 후 |
|---|---|---|
| 기본 테스트 | 172파일·1,463개 통과 | 172파일·1,473개 통과 |
| 전체 SQLite 테스트 | 33 통과·5 실패 | 33 통과·같은 5 실패 |
| 백업 집중 테스트 | — | 3파일·50개 통과 |
| 타입 검사·별도 JS 빌드 | — | 통과 |
| 패키지 루트 공개 타입 검사 | — | 통과 |
| 빌드 패키지 백업·재시작 검사 | — | 통과 |
| 빌드 SQLite mmap·strict vector 재시작 검사 | — | 통과 |

실제 package.json의 exports를 사용하는 `@nextain/naia-memory` import에서 Local provider의 암호화 왕복, 잘못된 암호의 대상 데이터 보존, 복원 후 재시작을 확인했다. SQLite는 system/provider/isCapable 모두 미지원으로 판별하며, 거부 후 기존 사실과 추가 저장 사실이 재시작 뒤에도 유지됐다. 외부 provider의 기존 메서드 기반 fallback, gate의 this 보존, 백업 외 capability 비간섭도 검사했다.

mmap 검사는 빌드된 JS worker의 256 MiB 설정과 strict surface/deep 결과의 프로젝트 격리를 확인한 소규모 정확성 검사다. 새 성능 측정이 아니며, 이번 백업 수정에 검색 속도 개선 수치를 부여하지 않는다.

[3단계 검증 증거](../../reports/validation/backup-path-20260905/README.md)에 수정 전후 로그, 9개 변경 파일의 전후 사본·patch, 현재 src archive, 실행 명령·해시를 보존했다. 기존 작업이 포함된 소스이며 깨끗한 릴리스나 독립 인증으로 표시하지 않는다. Astra는 현재 소스 515개와 검토 파일 9개, SQLite 실패 이름·assertion의 전후 동일성, 보존 파일 50개 해시와 archive 일치를 확인했고 문서까지 필수 수정 없이 수용했다. 검토자는 앱·테스트를 재실행하지 않고 소스·로그·해시를 검토했다.

## 2단계 증거 보존 보완

기존 영속 디렉터리에 README만 있고 원시 결과는 `/tmp`에 남아 있었음을 발견했다. [영속 증거 묶음](../../reports/perf/sqlite-mmap-ab-20260905/)에 원시 결과·집계기·선택 소스 archive와 해시를 보존했다. endpoint 735회, 앞선 1단계 대조 실험 540회 대응 결과가 동일하고 저장된 집계 전체와 일치함을 재검산했다.

Astra는 A 118개/B 119개 보존 파일의 해시와 원본 일치를 확인했다. 원시 manifest에 들어간 Vitest 캐시는 archive에서 제외됐으므로 archive만으로 전체 원시 manifest 해시를 재구성할 수 없다는 한계를 README와 receipt에 명시했다. 당시 검증 로그가 최종 빌드 성공의 증거가 아니라는 점도 정정했다. 공식 review-pass 인증은 아니다.

## 결과에 따른 후속 순서

기간 추정 대신 단계별 통과 조건으로 진행한다. 백업 경로 검증을 마친 뒤에는 모드별 새 프로세스에서 strict deep의 worker 행 읽기·BLOB 변환·거리 계산 비용과 unscoped 대조 경로의 꼬리 지연을 분리 측정한다. 고정 10만 건 이상 데이터, 동일 질의·검색 순서·유한 점수, DB 불변 조건에서 반복되는 병목만 다음 구현 후보로 채택한다.

SQLite parity 5개는 저장 의미가 명확한 기능부터 별도 설계·테스트로 다룬다. 의미 품질과 실제 대화 효용은 독립 보유셋과 실제 답변 평가가 필요하다. 현재 합성 검색 지연 수치로 이를 대신하거나 SQLite 전체 지원·릴리스 완료를 선언하지 않는다.
