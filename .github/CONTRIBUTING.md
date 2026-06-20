<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Naia Memory에 기여하기

> Naia Memory는 AI 에이전트에게 **사람처럼 기억하는 능력**을 주는 인지 메모리 라이브러리(`@nextain/naia-memory`)입니다.
> 중요도에 따라 기억을 저장하고, 벡터 검색·키워드 검색·지식 그래프로 떠올리며, 에빙하우스 망각 곡선으로 오래된 기억을 자연스럽게 흐리게 합니다.
> Naia 오픈소스 플랫폼의 네 레포(naia-os 셸 · naia-agent 런타임 · naia-memory 기억 · naia-adk 설정) 중 **기억**을 맡습니다.
> 이 문서는 처음 오신 분이 "무엇을, 어떻게" 도울 수 있는지 안내합니다.

## 처음이라면 — 가장 빠른 첫 기여 (15분)

위에 "벡터 검색"·"에빙하우스 망각 곡선" 같은 말이 나와도 겁먹지 마세요. **첫 기여에는 인지과학을 몰라도 됩니다.**
오타·문서·번역·`docs/` 보강·예제 추가·타입 정리 같은 작은 변경은 아래의 Self-Rigor 기준(벤치마크 등)도, 네이티브 빌드도 필요 없습니다 — 이슈 하나면 됩니다.
**벤치마크(`pnpm benchmark`)는 검색·랭킹·저장의 *성능*을 바꾸는 변경에만 필요**합니다. 그 외에는 안 돌려도 됩니다.

> ⚠️ 코드를 빌드·테스트하려면 네이티브 모듈(`better-sqlite3`, `sqlite-vec`)을 컴파일해야 해서 OS별 빌드 도구가 필요합니다 — 아래 [5장](#5-개발-환경-준비) 참고. 문서·번역만 할 거라면 이 단계 없이 바로 가능합니다.

AI 코딩 도구(Cursor, Claude Code 등)를 쓰신다면, 이 폴더를 연 뒤 아래를 그대로 복사해 붙여 보세요:

> 이 저장소의 `.github/CONTRIBUTING.md`, `README.md`, `docs/cognitive-architecture.md` 를 읽고,
> 내가 30분 안에 끝낼 수 있는 'good first issue' 후보 3개를, 각각 어떤 파일을 고치면 되는지와
> 벤치마크가 필요한 변경인지 아닌지까지 함께 알려줘.

막히면 [Discord](https://discord.gg/FGYJN7auty)에서 물어보세요.

## 1. 누구의 허락도 필요 없습니다

먼저 저장소를 내려받습니다.

```bash
git clone https://github.com/nextain/naia-memory.git
cd naia-memory
```

그다음 사용하는 AI 코딩 도구(Claude Code, Cursor, GitHub Copilot, Gemini CLI 등)에서 이 폴더를 열고, 모국어로 이렇게 물어보세요.

> 이 프로젝트는 무엇이고, 제가 처음으로 도울 수 있는 일은 무엇인가요?

저장소의 [`.agents/`](../.agents/) 디렉토리에는 프로젝트의 설계·철학·규칙이 정리돼 있습니다. AI 도구가 이 내용을 읽고 **당신의 언어로** 설명해 줍니다.

막히면 [Discord](https://discord.gg/FGYJN7auty)에서 물어보세요. 가장 빠르게 도움을 받을 수 있습니다.

## 2. 어떤 언어로 참여해도 됩니다

- **이슈, 풀 리퀘스트(Pull Request, 이하 PR), 토론** — 어떤 언어로 써도 됩니다. 메인테이너가 AI 번역으로 읽습니다.
- **코드 주석, 커밋 메시지, [`.agents/`](../.agents/) 컨텍스트 파일** — 영어를 권장합니다. 영어 작성이 어렵다면 모국어로 제출해도 됩니다. 리뷰 과정에서 메인테이너가 영어 표현을 함께 다듬습니다.

## 3. 이 프로젝트의 핵심 — "스스로에게 엄격하기(Self-Rigor)"

메모리 시스템은 정답이 정해진 분야가 아닙니다. 그래서 이 프로젝트는 **남(다른 시스템)을 이기는 것보다, 우리 스스로 세운 기준을 정직하게 지키는 것**을 더 중요하게 봅니다. 기여할 때도 이 기준을 지켜 주세요.

- **근거 없는 숫자 금지** — 검색 가중치 같은 값은 "그럴듯해서"가 아니라 **실제 측정으로** 정해야 합니다.
- **규모로 검증** — 성능을 주장하려면 **최소 10만 건(100k) 규모**에서 측정합니다(여기서 10만 건은 저장된 기억 항목 수를 말합니다. 측정 시 질의 수와 실행 환경도 함께 적어 주세요). 작은 데이터에서만 빠른 것은 의미가 없습니다.
- **정직한 지연시간 보고** — 빠른 경로(Surface, 상위 기억만)와 전체 탐색(Deep, 전수 검색)의 속도를 **따로** 보고합니다. 평균 하나로 뭉뚱그리지 않습니다.

검색·랭킹·저장처럼 결과 품질이나 속도에 영향을 주는 변경은 **수치(벤치마크)를 함께** 올려 주세요.

## 4. 기여하는 방법

코드만 기여가 아닙니다. 아래 어느 한 곳에서 시작하면 됩니다.

| 기여 유형 | 난이도 | 시작 위치 |
|---|---|---|
| 번역 | 낮음 | [`.users/context/`](../.users/context/)에 언어 추가 (초벌은 자동 번역이 만들어 줍니다) |
| 버그 리포트 | 낮음 | [GitHub Issues](https://github.com/nextain/naia-memory/issues)에 재현 절차와 함께 등록 |
| 문서 개선 | 낮음 | [`docs/`](../docs/), [`.users/`](../.users/) |
| 측정·벤치마크 | 중간 | 새로운 데이터셋이나 언어로 회상 정확도·지연시간 측정 (`pnpm benchmark`) |
| 코드 / PR | 중간~높음 | 아래 [6. 코드 기여 절차](#6-코드-기여-절차) 참고 |
| 컨텍스트 개선 | 중간 | [`.agents/`](../.agents/) 의 설계·설명 다듬기 |

> **보안 취약점**은 공개 이슈에 올리지 말고, [보안 정책](SECURITY.md)에 따라 `security@nextain.io`로 비공개 제보해 주세요.

## 5. 개발 환경 준비 (코드를 빌드·테스트할 때만)

> 문서·번역만 할 거라면 이 장은 건너뛰어도 됩니다.

**공통 준비물**

- [Node.js](https://nodejs.org/) 20 이상, [pnpm](https://pnpm.io/) — 설치 후 `node -v`, `pnpm -v`로 확인.

**OS별 빌드 도구** — `better-sqlite3`·`sqlite-vec`가 설치 중 네이티브 모듈을 컴파일하므로 C/C++ 빌드 도구가 **필요합니다**(없으면 `pnpm install`이 실패합니다):

- **Windows** — [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)(“C++를 사용한 데스크톱 개발” 워크로드) + Python 3. (대안: 관리자 PowerShell에서 `npm install --global windows-build-tools`.)
- **macOS** — `xcode-select --install` (Xcode 명령줄 도구).
- **Linux (Ubuntu)** — `sudo apt install build-essential python3`.

**`pnpm install`이 실패한다면** — `gyp ERR!`, `node-gyp`, `cl.exe`/`MSB...`(Windows), `xcrun`(macOS), 또는 `better-sqlite3`/`sqlite-vec` 빌드 오류가 보이면, 위 OS별 빌드 도구가 빠진 것입니다. 빌드 도구를 설치한 뒤 `pnpm install`을 다시 실행하세요. 그래도 막히면 [Discord](https://discord.gg/FGYJN7auty)에 OS와 전체 오류 로그를 함께 올려 주세요.

**설치와 실행**

```bash
pnpm install      # 의존성 설치 (네이티브 모듈 빌드 포함)
pnpm build        # 타입스크립트 빌드 (tsc)
pnpm test         # 단위 테스트 (vitest)
pnpm typecheck    # 타입만 검사 (tsc --noEmit)
pnpm check        # 코드 스타일 검사 및 자동 정리 (biome check --write)
pnpm benchmark    # 회상 정확도·지연시간 벤치마크
```

## 6. 코드 기여 절차

1. 작업할 [이슈](https://github.com/nextain/naia-memory/issues)를 고르거나 새로 등록합니다.
2. 코드를 작성합니다.
3. 테스트(`pnpm test`)를 추가하고 통과시킵니다. 검색·랭킹·저장 관련 변경이면 **벤치마크 수치(`pnpm benchmark`)도 함께** 올립니다.
4. `pnpm check`로 코드 스타일을 정리합니다.
5. PR을 올립니다. 제목은 `type(scope): 설명` 형식으로 씁니다(예: `fix(recall): 시간 필터 오류 수정`).

**PR 체크리스트**

- [ ] 테스트를 포함했고 통과한다 (`pnpm test`)
- [ ] 검색/랭킹/저장 변경이라면 벤치마크 수치를 첨부했다
- [ ] `pnpm check`를 통과한다
- [ ] 커밋 메시지를 영어로, `type(scope): 요약` 형식으로 썼다

## 7. AI 도구 사용

AI 도구 사용을 환영하고 권장합니다. 사용했다면 커밋 메시지 끝에 어떤 도구를 썼는지 적어 주세요(권장, 필수는 아닙니다).

```
feat(recall): 시간 구간 질의 정확도 개선

Assisted-by: Claude Code
```

`Assisted-by:` 뒤에는 사용한 도구 이름을 적습니다 (예: `Claude Code`, `ChatGPT`, `Cursor`, `Gemini`).

## 8. 더 깊은 주제

- **인지 아키텍처** — 기억을 어떻게 저장·검색·망각하는지의 전체 설계: [`docs/cognitive-architecture.md`](../docs/cognitive-architecture.md)
- **연동 가이드** — naia-agent·naia-os와 어떻게 붙는지: [`docs/integration.md`](../docs/integration.md)
- **설계 문서** — 세부 설계 기록: [`docs/design/`](../docs/design/)

작업을 시작하려면 [GitHub Issues](https://github.com/nextain/naia-memory/issues)에 제안 이슈를 먼저 열거나 [Discord](https://discord.gg/FGYJN7auty)에서 문의해 주세요.

## 9. 보상

Naia Memory는 아직 초기 단계 오픈소스라 바운티나 보상 프로그램이 없습니다. 지금의 모든 기여는 자발적인 참여입니다.
프로젝트와 회사가 자리를 잡으면 기여자 보상(버그 바운티·기능 바운티)을 도입할 계획입니다. 작은 기여라도 진심으로 감사드립니다.

## 10. 라이선스

- **소스 코드** — [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **AI 컨텍스트** (`.agents/`, `.users/`) — [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

기여하시면 위 라이선스 조건에 동의하는 것으로 간주합니다.
