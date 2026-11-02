# 아키텍처

## 실행 환경

앱에는 로컬 개발용 Flask 경로와 운영용 정적 배포 경로가 있습니다. 두 환경 모두 실제 정산 계산과 상태 저장은 브라우저 JavaScript가 수행합니다.

```text
개발:   Flask → templates/index.html + static/
운영:   GitHub main → scripts/build_static.py → dist/ → Cloudflare Workers Static Assets
```

운영 사이트는 `https://mobile-settlement.sksalstjd.workers.dev/`입니다. 운영 호스팅은 Cloudflare Workers Static Assets이며, 기존 Render 서비스는 삭제됐습니다.

## Flask 개발 서버

`app.py`의 `create_app()`은 `/`에서 `templates/index.html`을 렌더링합니다. 별도의 사용자 정산 API나 서버 DB는 없습니다. `run-local.bat`은 같은 콘솔에서 `run-local.ps1`을 호출하는 더블클릭용 실행 래퍼이며, PowerShell 스크립트는 프로젝트 루트에서 `0.0.0.0`에 바인딩하고 기본 포트 5000으로 `app.py`를 실행합니다. Flask 자동 재시작은 개발 플래그가 켜졌을 때만 사용하며 대화형 디버거는 끕니다.

`SETTLE_DEV`가 `1`, `true`, `yes`, `on` 중 하나이고 `RENDER`가 참이 아닌 경우에만 개발 도구가 활성화됩니다.

- `GET /__dev/revision`: 템플릿과 CSS·JavaScript의 경로 및 내용으로 변경 지문을 반환합니다.
- `GET /__dev/png-review`: 고정 샘플을 실제 정산 코어와 PNG 렌더러로 확인하는 검수 페이지입니다.
- `static/dev-live-reload.js`: 변경 지문을 확인해 열린 개발 페이지를 새로고침합니다.

이 경로와 스크립트는 정적 운영 산출물에 포함되지 않습니다. PNG 검수 페이지는 사용자 저장 상태를 읽거나 수정하지 않습니다.

## 정적 빌드 및 Workers

`scripts/build_static.py`는 `templates/index.html`을 읽어 `url_for('static', ...)`를 `/static/...` 경로로 바꾸고 개발용 Live Reload Jinja 블록을 제거합니다. 미처리 Jinja 구문이나 필수 정적 경로 누락이 있으면 빌드를 실패시킵니다.

운영 리소스는 명시적 allowlist로 `dist/`에 복사합니다.

- `index.html`
- `static/style.css`
- `static/settlement-core.js`, `static/share-report.js`, `static/app.js`
- 실제 사용하는 SVG 이미지 3개

빌드는 새 임시 디렉터리를 완성한 뒤 `dist/`와 교체합니다. 따라서 이전 산출물의 잔여 파일을 유지하지 않습니다. `dist/`는 Git에서 제외됩니다.

`wrangler.jsonc`는 Worker 이름 `mobile-settlement`, 호환 날짜, `assets.directory: ./dist`, `not_found_handling: none`을 지정합니다. 별도 Worker 스크립트나 `ASSETS` 바인딩은 없습니다. 빌드 후 존재하지 않는 파일 경로는 자산 404로 처리합니다.

Cloudflare Workers Git 연동의 운영 브랜치는 GitHub `main`이고 빌드 명령은 `python scripts/build_static.py`입니다. Workers가 `wrangler.jsonc`를 사용해 빌드된 정적 자산을 배포합니다. 이 프로젝트는 브라우저 클라이언트 앱이므로 운영에 Flask 프로세스가 필요하지 않습니다.

## 브라우저 모듈과 데이터 흐름

`templates/index.html`에서 정산 코어, 공유 모듈, 앱 모듈 순서로 스크립트를 불러옵니다.

```text
static/settlement-core.js  상태 정규화·저장 헬퍼·정산 계산
static/share-report.js    공유 모델·TXT·Canvas PNG 렌더링
static/app.js              localStorage 연결·화면 상태·이벤트·DOM 렌더링
```

정산 코어와 공유 모듈은 브라우저 전역 및 CommonJS에서 사용할 수 있어 Node.js 테스트에서도 직접 검증합니다. `app.js`는 저장 상태를 읽고 입력·멤버·결제·대상자·결과 화면을 렌더링하며 사용자 동작을 정산 코어 함수로 연결합니다.

## 저장 구조 및 정산 정책

데이터는 브라우저 `localStorage` 키 `mobile_settle_flask_state_v2`에 스키마 버전 2 JSON으로 저장됩니다. 핵심 필드는 다음과 같습니다.

```js
{
  schemaVersion: 2,
  names: ["참여자 A", "참여자 B"],
  payments: [{
    id: "...",
    payer: "참여자 A",
    amount: 12000,
    place: "카페",
    participantMode: "default", // 또는 "custom"
    participants: null           // custom의 원래 선택 기록
  }],
  targets: { "참여자 A": true, "참여자 B": true },
  lastPayer: "참여자 A"
}
```

멤버·결제 정규화와 저장 결과는 `static/settlement-core.js`의 `normalizeStateData()`, `loadStateFromStorage()`, `saveStateToStorage()` 등이 처리합니다. 저장 실패를 호출자에게 반환해 화면 상태가 저장되지 않은 값으로 바뀌지 않도록 합니다. 읽을 수 없는 원본 데이터는 앱에서 recovery 키에 보관을 시도합니다.

`targets`는 전역 정산 대상 범위이고, `participantMode: "custom"` 결제의 `participants`는 그 결제에서 원래 선택한 사람 기록입니다. 전역 제외는 해당 기록을 삭제하지 않고 계산 시 교집합 필터로 적용합니다. 재포함 시 기존에 선택했던 사람만 돌아옵니다. 유효 부담자 수가 0명이 되는 변경을 차단하며, 사용자가 직접 custom 대상을 전역 대상과 같게 만들 때만 기본 정산으로 복귀합니다.

`calculateSettlement()`는 모든 기본 결제액을 먼저 합산해 전역 대상자에게 분배하고, custom 결제는 결제별 유효 대상자에게 따로 분배합니다. 금액은 양의 안전 정수로 검증합니다. 나눗셈의 나머지 1원은 멤버 순서상 앞의 대상자에게 배분합니다. 실제 결제액(`paid`)과 분담액(`owed`) 차이에서 송금 관계를 계산합니다. 계산 오류가 있으면 유효한 송금 결과로 취급하지 않습니다.

주요 상태 변경 함수는 `setGlobalTargets()`, `setCustomParticipants()`, `removeMember()`이고, 계산 진입점은 `calculateSettlement()`입니다.

## TXT 및 PNG 공유

`static/share-report.js`의 `buildShareModel()`은 정산 코어에서 계산한 결제 상세, `paid`, `owed`, balances, transfers를 공유용으로 구성하며 정산 알고리즘을 다시 구현하지 않습니다.

- `buildCopyText()`는 총 결제액, 모든 결제의 실제 부담자 집합과 각자의 실제 부담액이 같을 때만 1인당 부담액, 그리고 송금인별 최종 송금을 만듭니다. 결제별 상세 목록은 텍스트 결과에서 제외합니다.
- `createLayout()`은 정산 요약, 최종 송금, 정산 상세를 배치합니다. PNG 최소 논리 너비는 780px이며 콘텐츠가 더 필요하면 확장됩니다.
- 정산 상세는 모든 결제 열을 단일 매트릭스로 표시합니다. 각 행은 멤버 이름·실제 결제액, 정산액, 결제별 분담 순서입니다.
- 송금은 송금인 그룹 기준으로 표시하고 콘텐츠 너비와 그룹 사이 80 논리 px을 이용해 줄바꿈합니다. 송금인 그룹 수의 고정 상한은 없습니다.
- `renderReportCanvas()`는 Canvas 이미지를 그립니다. 기본 요청 배율은 최대 2이며, 총 출력 24,000,000픽셀 제한을 넘지 않도록 필요 시 배율을 낮춥니다. `createPngReport()`는 PNG Blob을 반환합니다.

결과 화면은 인라인 미리보기와 저장·닫기 동작을 제공합니다. TXT 복사 및 PNG 렌더링의 버튼 흐름은 `static/app.js`에서 연결됩니다.

## Origin별 저장과 데이터 이전

`localStorage`는 프로토콜·호스트·포트로 구분되는 origin별 저장소입니다. 따라서 localhost 개발 주소, 과거 Render 주소, Cloudflare 운영 주소는 서로 다른 저장 영역입니다. 이전 주소의 데이터를 새 주소에서 자동으로 읽거나 옮기지 않습니다. 서버 동기화나 자동 마이그레이션도 없습니다.

## 테스트 구성

`tests/input-ui.test.js`, `tests/settlement-core.test.js`, `tests/share-report.test.js`, `tests/static-build.test.js`는 Node.js 내장 테스트 러너로 실행합니다. Flask 동작 검사는 일부 테스트에서 Python subprocess와 Flask 테스트 클라이언트를 사용합니다. 전체 실행 명령은 `node --test tests/*.test.js`입니다.
