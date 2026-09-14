# Naia Memory 두 번째 성능 개선

작성일: 2026-09-05 · 상태: 구현·집중 검증·endpoint 측정 완료, 기본 활성화 보류 · Luna max 구현 / Astra 단계별 검토

첫 개선 후 남은 strict deep 지연의 원인을 구분하고 다음 개선을 검증한다. 기준 A는 [첫 개선](naia-memory-performance-stage-2026-09-05.ko.md)이 끝난 소스다. 10만 건 고정 DB와 앞선 실행의 증거를 그대로 보존한다.

## 병목 진단

같은 DB에서 15개 질의로 워밍업한 뒤 15회 측정했다. strict deep endpoint p50은 998.13ms, exact vector worker 호출의 중앙값은 981.41ms, 최종 facts 호출의 중앙값은 0.527ms였다. 각 중앙값은 서로 더하거나 비용 비율로 해석하지 않는다. worker 호출은 SQL, 가상 테이블 접근, BLOB 행 변환, 거리 계산, 메시지 전달을 모두 포함한다.

직접 readonly 연결로 동일 후보 SQL의 iterator와, 미리 메모리에 올린 행의 거리 계산을 분리해 추가 진단했다. deep 90,000개 후보의 iterator 중앙값은 945.17ms, 물질화 후 거리 계산은 70.71ms, 결합 실행은 913.99ms였다. surface 후보는 9,000개였다. 이 값은 서로 다른 캐시·메모리 접근 조건이며, 직접 연결의 cache 설정은 제품의 64MB 설정과도 다르다. 단일 질의·5회 진단이므로 제품 성능 개선율의 근거로 사용하지 않는다.

다음 후보를 SQL·행 취득 경로에서 찾는 데에는 충분한 근거다. surface SQL은 active facts 인덱스를 먼저 읽고 hot vector를 개별 조회하며, deep SQL은 vector 전체 스캔 뒤 facts를 기본 키로 조회한다. 프로젝트 인덱스나 JOIN 변경은 거리 동점의 원래 순회 순서를 바꿀 수 있어 우선 적용하지 않았다.

초기 프로파일의 배열 참조는 후속 warmup 기록으로 오염되었다. 원시 배열을 호출 시점에 복사하도록 하네스를 수정하고 다시 측정한 `profile-A-fixed.json`만 사용한다.

## 앞선 전체 범위 deep 대조 경로 재검사

이 비교의 A/B는 **1차 개선 전/후**다. 두 번째 개선의 A/B와 구분한다. 앞선 검색 모드의 영향을 줄이기 위해 프로세스마다 unscoped deep 하나만 실행했다. 15회 워밍업과 180회 측정을 세 쌍 직렬로 실행했다. 순서는 A1 → B1 → B2 → A2 → A3 → B3이다.

| 실행별 수치의 중앙값 | 1차 개선 전 | 1차 개선 후 | 변화 |
|---|---:|---:|---:|
| p50 | 80.69ms | 80.83ms | 0.17% 증가 |
| p95 | 129.93ms | 135.94ms | 4.63% 증가 |
| 최대 지연 | 161.46ms | 162.40ms | 0.59% 증가 |

p50의 실행 간 범위는 A 80.44–89.05ms / B 80.51–81.14ms, p95는 A 127.43–134.78ms / B 129.95–136.63ms다. 공유 호스트의 세 쌍 측정이므로 p50 차이가 작다는 사실과 p95 회귀 가능성이 남았다는 사실을 구분한다. 모든 경로의 무영향을 주장하지 않는다.

540회 대응 호출의 ID·순서·relevanceScore가 정확히 일치했다. 같은 15개 질의의 반복이며 의미 정확도 평가가 아니다. DB 전후 해시와 행 수·generation도 불변이었다.

## 두 번째 개선 endpoint A/B 측정

두 번째 개선의 A는 `mmapSizeBytes` 생략(기본값 0), B는 `mmapSizeBytes=268435456`(256MiB 요청)으로 고정했다. 같은 100,000건·384차원 DB에서 네 모드(`strict-surface`, `strict-deep`, `unscoped-surface`, `unscoped-deep`)를 세 쌍 직렬로 실행했고, 순서는 normal → reverse → normal이었다. 각 모드·실행은 timed 60개이며, 아래 집계는 세 실행의 run-level percentile 중앙값이다. 표의 변화율은 `(B-A)/A`이고 양수는 B가 느려진 경우다.

| 모드 | p50 A → B (ms) | p50 변화율 | p95 A → B (ms) | p95 변화율 |
|---|---:|---:|---:|---:|
| strict-surface | 186.286 → 208.902 | **+12.14%** | 278.096 → 254.047 | -8.65% |
| strict-deep | 685.983 → 725.161 | **+5.71%** | 1,172.906 → 918.223 | **-21.71%** |
| unscoped-surface | 5.696 → 5.538 | -2.76% | 25.490 → 23.311 | -8.55% |
| unscoped-deep | 80.882 → 59.234 | -26.77% | 144.003 → 139.375 | -3.21% |

세 쌍의 편차와 run-level 범위는 다음과 같다. 각 쌍의 변화율도 같은 부호 규칙을 사용한다.

| 모드·지표 | 1쌍 | 2쌍 | 3쌍 | A 범위 (ms) | B 범위 (ms) |
|---|---:|---:|---:|---:|---:|
| strict-surface · p50 | -8.74% | -9.15% | +15.06% | 181.552–235.384 | 169.238–214.815 |
| strict-surface · p95 | -4.04% | -18.93% | +32.02% | 192.429–295.262 | 239.370–266.859 |
| strict-deep · p50 | -22.44% | -28.56% | +5.71% | 673.249–972.619 | 480.988–754.354 |
| strict-deep · p95 | -17.80% | -13.26% | -27.67% | 1,058.550–1,223.807 | 885.137–964.119 |
| unscoped-surface · p50 | -25.63% | +6.26% | +12.09% | 4.941–6.598 | 4.907–6.052 |
| unscoped-surface · p95 | -8.55% | -9.35% | +262.79% | 6.372–26.145 | 23.117–23.701 |
| unscoped-deep · p50 | -15.53% | -27.41% | +30.68% | 44.826–81.601 | 58.579–68.319 |
| unscoped-deep · p95 | +1.52% | -3.21% | +21.13% | 80.845–144.666 | 97.926–146.866 |

정확성 측면에서는 735개 대응 호출의 ID·순서·relevanceScore가 모두 일치했고, 반환 facts 수는 실행마다 10, query coverage는 1이었다. A/B DB SHA-256도 `6825406b56e917362292267a89db35a1cd7a244aaed13d1ec277f4928aa9c673`로 같았다. 이는 검색 결과와 DB 보존을 확인하지만 의미 품질이나 실제 대화 효용을 평가한 결과는 아니다.

집계상 strict p50은 surface가 12.14%, deep가 5.71% 느려졌다. strict-deep p95는 1,172.906ms에서 918.223ms로 21.71% 낮아졌고 세 쌍 모두 감소했지만, pair 3에서는 네 모드의 p50이 모두 악화됐다. unscoped-deep p95도 pair 1과 pair 3에서 악화됐다. 따라서 이번 결과를 전반적 향상이나 안정적 개선으로 판정하지 않는다. mmap은 기본값 0인 opt-in으로 유지하고 기본 활성화 승격은 보류한다.

p99는 timed 샘플 60개에서 최대값과 같으므로 안정적인 꼬리 지연 보증에 사용할 수 없다. 예를 들어 집계 strict-deep p99는 1,268.811 → 956.874ms로 낮아졌지만 unscoped-deep p99는 153.922 → 157.049ms로 높아졌다. RSS snapshot은 strict-surface 약 6.52%, 나머지 세 모드 약 32.34~32.73% 증가했으나, 전체 DB hash용 Buffer와 앞선 모드의 상태를 포함한 프로세스 RSS이며 mode-local 검색 heap이나 실제 mapped byte가 아니다. 공유 데스크톱에서 측정했으므로 이 값만으로 mmap의 메모리 비용을 확정하지 않는다.

## 구현과 적용 조건

연결별 SQLite `mmap_size`를 선택 옵션으로 구현했다. `SqliteAdapterOptions.mmapSizeBytes`의 기본값은 **0(비활성)**이며, 잘못된 값은 디렉터리 생성과 worker 시작 전에 거부한다. 유한한 비음수 safe integer만 허용한다. 실제 검색을 수행하는 worker 연결에 설정하며, 환경에서 상한이 낮거나 0만 지원해도 일반 SQLite 읽기를 계속한다. SQL·거리 계산·행 순서·스키마는 변경하지 않았다.

```ts
import { MemorySystem, SqliteAdapter } from "@nextain/naia-memory";

const adapter = new SqliteAdapter({
  dbPath: "./memory.db",
  embeddingProvider,
  mmapSizeBytes: 256 * 1024 * 1024,
});
const memory = new MemorySystem({ adapter });
await memory.init();
```

`embeddingProvider`는 호출자가 구성한 공급자다. 설정은 연결마다 필요하므로 재시작할 때도 전달한다. 생략하거나 0으로 설정한 경로에 이번 옵션의 개선율을 적용해서는 안 된다.

SQLite는 매핑할 수 없는 페이지를 일반 읽기로 처리하며, 설정 상한은 DB 파일별 매핑 주소공간의 한도다. 실제 heap/RSS의 사전 할당량이 아니다. 지원 여부와 실제 적용값은 환경에 따라 달라진다. 실제 mapped I/O fault의 복구나 Windows 파일 축소까지 이번 Linux 검증으로 보장하지 않는다. [SQLite 공식 설명](https://www.sqlite.org/mmap.html), [mmap_size 설정](https://www.sqlite.org/pragma.html#pragma_mmap_size).

Luna max가 구현과 집중 테스트를 수행하고 Astra가 설계·코드·테스트를 검토했다. 초기 직접 연결 진단은 세 쌍 중 한 쌍에서 악화되고 실행 간 편차가 커, 제품 개선율로 사용하지 않았다. 부모가 동결한 A/B 소스로 같은 10만 건 DB의 제품 endpoint를 측정했으며, 원시 결과는 `/tmp/naia-memory-stage2-20260905/endpoint-summary.json`과 `endpoint-manifest.json`에 보존돼 있다.

Astra 권고로 점수의 유한성·timed 반환 10개 검증을 추가했다. WAL 테스트는 충분한 mapping cap와 checkpoint된 baseline을 제품 worker로 읽은 뒤 커밋 전/후 가시성을 검사하며, cap 밖 읽기는 별도 작은 cap DB를 checkpoint·재시작한 뒤 확인한다. PRAGMA가 행을 반환하지 않는 메모리 DB도 정상 처리한다.

## 검증 상태와 다음 우선순위

후속 단계에서 원시 자료와 선택 A/B 소스를 [프로젝트 내 증거 묶음](../../reports/perf/sqlite-mmap-ab-20260905/)에 보존하고 endpoint 735회·앞선 대조 540회를 재검산했다. 수정 전 기본 검사 1,463개는 모두 통과하여 아래 종전 9개 실패는 현재 환경에서 재현되지 않았다. 전체 원인을 환경 결함으로 단정하거나 테스트를 수정하지 않는다. SQLite 검사는 smoke 30개와 parity 3개 통과, 기존 parity 5개 실패다. 최신 제품 경로 수정과 후속 계획은 [3단계 기록](naia-memory-stage3-2026-09-05.ko.md)을 따른다.

집중 검증은 `sqlite-mmap.test.ts`와 기존 `sqlite-smoke.test.ts`를 합쳐 43/43 통과했고, 프로젝트 typecheck도 종료 코드 0이었다. 루트 전체 `pnpm test`는 `/tmp/naia-memory-stage2-20260905/validation-default.log`에 종료 코드 1로 기록됐다. 172개 파일 중 167개, 1,463개 테스트 중 1,454개가 통과했고 5개 파일·9개 테스트가 실패했다. 로그의 실패는 RFC 3161 timestamp 검증, semantic trust-anchor/public-gate CLI의 `spawnSync node` `EPERM`과 그에 따른 stderr 기대값, throughput A/B 자식 receipt/identity 검증에 집중돼 있으며 mmap 집중 경로의 실패로 보고되지는 않았다. 이 실행은 manifest에 종료 시각이 기록된 완료 실행이므로 전체 테스트 녹색이나 릴리스 인증으로 해석하지 않는다.

다음 개선은 연구 현황 문서의 지원 범위·실행 기준·독립 평가 순서를 따른다.

1. **P0 — SQLite 제품 경로와 지원 범위를 먼저 고정한다.** 현재 `sqlite.ts`에는 `decay`, `associate`, procedural 학습, epoch, `consolidate`가 미완성 상태이고 backup `export/import`는 명시적 미지원 오류다. 지원 범위 표를 기준으로 배포 패키지 import, 저장→재시작→회상, 갱신·archive·격리 경로를 확인한다. 재현되지 않은 CLI 실패에 대한 코드 수정은 보류하고 실제 백업 지원 판정과 provider 호출의 불일치를 우선 수정한다.
2. **P1 — mmap 후속 성능은 측정 조건을 분리한 뒤 한 병목만 고른다.** mode별 새 프로세스, 실제 `PRAGMA mmap_size` 적용값, 단계별 RSS, worker의 iterator·BLOB 변환·거리 계산·메시지 전달을 분리해 재측정한다. 반복해서 재현되는 비용만 대상으로 삼고 SQL·스캔 순서·스키마 보존 조건을 유지한다.
3. **P1 — 제품 경로가 고정되면 독립 기억·대화 효용을 평가한다.** 최신·오래된·삭제 대상·변화 없음 사례를 보유셋으로 분리하고, 기억 없음·단순 검색·Naia 경로와 실제 LLM 답변의 정확성·오회상·토큰·비용·지연을 함께 판정한다. 이 결과가 다음 성능 후보의 사용자 효용을 판단하는 기준이 된다.

정식 review-pass 인증을 주장하지 않는다. 앞선 preflight의 기존 비추적 cache 경로 문제는 보존하며, 이번 기록은 사용자 지정 Luna/Astra 협업과 실제 측정 증거에 관한 것이다.
