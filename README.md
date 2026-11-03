# 모바일 정산기

모임에서 여러 사람이 결제한 금액을 기록하고, 정산 대상과 결제별 정산 인원을 반영해 송금 결과를 계산하는 모바일 중심 웹 앱입니다. 데이터와 계산은 브라우저에서 처리하고 `localStorage`에 저장합니다.

## 주요 기능

- 멤버와 결제 내역의 추가, 수정, 삭제
- 기존 멤버의 추가 결제와 중복 멤버 등록 방지
- 결제내역만 비우기 및 전체 초기화의 앱 내 확인 절차
- 전체 결제를 기본 정산 대상자에게 나누는 일반 정산
- 필요한 결제만 정산 인원을 따로 지정하는 개별 정산
- 정산 결과와 최종 송금 관계 계산
- 간결한 TXT 복사와 결제별 정산 근거를 담은 PNG 생성·저장
- 브라우저 `localStorage` 저장 및 재방문 시 복원

## 운영 서비스

**https://mobile-settlement.sksalstjd.workers.dev/**

운영 호스팅은 Cloudflare Workers Static Assets입니다. GitHub `main` 브랜치에 연결된 Workers 빌드가 정적 사이트를 빌드하고 배포합니다. 기존 Render 서비스는 삭제되어 운영 주소나 대체 서버로 사용하지 않습니다.

## 로컬 개발

필요 환경은 Windows PowerShell, Python 3, 그리고 테스트 실행용 Node.js 18 이상입니다. 로컬 Flask 실행에는 Flask가 필요합니다.

```powershell
python -m pip install "Flask>=3.0.0"
```

`requirements.txt`에는 Gunicorn도 남아 있지만 `run-local.ps1`은 사용하지 않습니다. Gunicorn은 Windows에서 지원되지 않으며 현재 정적 운영 배포에도 필요하지 않습니다.

프로젝트 루트의 `run-local.bat`을 더블클릭해 실행합니다. 서버는 기본 포트 `5000`을 사용하고, 콘솔 창에서 로그를 확인할 수 있습니다. 창을 닫거나 `Ctrl+C`를 누르면 서버를 종료합니다. 포트가 이미 사용 중이면 기존 프로세스를 종료하지 않고 충돌 원인을 콘솔에 표시합니다.

PowerShell에서 직접 실행할 수도 있습니다.

```powershell
.\run-local.ps1
```

다른 포트를 지정하려면 PowerShell에서 `.\run-local.ps1 -Port 5001`을 사용합니다.

같은 Wi-Fi에 연결된 휴대폰에서 `http://PC의_IP주소:5000`으로 접속하세요. PC의 LAN 주소는 네트워크 환경에 따라 달라질 수 있으므로 `ipconfig`로 확인합니다.

실행 콘솔에서 `Ctrl+C`를 누르면 서버가 종료됩니다. Python 코드 변경은 Flask가 감지해 재시작하고, HTML·CSS·JavaScript 변경은 개발용 Live Reload가 열린 모바일 페이지를 새로고침합니다.

### Windows 로그인 자동 실행

현재 개발 PC에서는 시작프로그램의 `Mobile Settlement Dev Server.lnk`를 `Mobile Settlement Dev Server.lnk.disabled`로 바꿔 자동 실행을 해제했습니다. PC 부팅이나 로그인 때 서버가 자동으로 시작되지 않으며, 필요할 때 `run-local.bat`을 더블클릭합니다.

자동 시작을 다시 사용하려면 Windows 시작프로그램 폴더에서 바로가기 이름을 `.lnk.disabled`에서 `.lnk`로 복구하면 됩니다. 이 바로가기는 PC의 Windows 설정이며 Git 저장소 파일이 아닙니다.

## 정적 빌드와 Cloudflare 배포

정적 사이트 산출물은 다음 명령으로 생성합니다.

```powershell
python scripts/build_static.py
```

빌더는 `templates/index.html`의 실제 정적 리소스 경로를 변환하고 운영에 필요한 CSS, JavaScript, SVG만 `dist/`에 복사합니다. 개발용 Live Reload와 PNG 검수 페이지는 제외됩니다. 빌드는 준비된 임시 폴더에서 완료한 뒤 `dist/`로 교체하며, 반복 빌드 때 오래된 파일을 남기지 않습니다. `dist/`는 생성물이므로 `.gitignore`에 등록되어 Git에 포함되지 않습니다.

Cloudflare Workers Git 연동은 GitHub `main`을 운영 브랜치로 사용하고 빌드 명령은 `python scripts/build_static.py`입니다. Workers 연결 및 빌드 설정은 Cloudflare 프로젝트에서 관리합니다. 빌드 구조는 [ARCHITECTURE.md](ARCHITECTURE.md)를 참고하세요.

운영 배포에는 Flask 서버, 데이터베이스, 서버 API가 필요하지 않습니다. Flask와 개발 전용 라우트는 로컬 개발 환경에 남아 있습니다.

## 테스트

프로젝트 루트에서 전체 자동화 테스트를 실행합니다.

```powershell
node --test tests/*.test.js
```

Windows CRLF와 LF 체크아웃 모두에서 입력 UI 소스 파싱을 검증하도록 테스트가 줄바꿈을 정규화합니다.

## 프로젝트 구조

```text
app.py                       Flask 앱과 개발 전용 라우트
run-local.bat                더블클릭으로 시작하는 개발 서버 콘솔
run-local.ps1                Windows 로컬 개발 서버 실행
dev-autostart.ps1             Windows 로그인 자동 실행 등록·해제 도구
scripts/build_static.py       Cloudflare용 정적 산출물 생성
wrangler.jsonc                Workers 이름 및 정적 자산 설정
templates/index.html          입력·결과 화면의 원본 템플릿
templates/png-review.html     개발 전용 PNG 검수 화면
static/settlement-core.js    상태 처리와 정산 계산
static/app.js                 브라우저 상태·이벤트·화면 관리
static/share-report.js        TXT 공유 모델과 Canvas PNG 생성
static/dev-live-reload.js     로컬 개발용 변경 감지
static/png-review.js          개발용 PNG 샘플 검수
tests/                        Node.js 자동화 테스트
dist/                         Git에서 제외되는 생성 산출물
```

정산 데이터 흐름은 [ARCHITECTURE.md](ARCHITECTURE.md), 확정된 설계 근거는 [DECISIONS.md](DECISIONS.md), 완료 상태와 후속 검토는 [ROADMAP.md](ROADMAP.md)를 참고하세요.

## 데이터와 개인정보

정산 데이터는 현재 브라우저의 `localStorage`에만 저장됩니다. 운영 사이트와 예전 호스팅 주소는 서로 다른 origin이므로 저장 데이터가 자동 이전되지 않습니다. 서버 동기화나 자동 마이그레이션 기능은 없습니다.

## 아이콘 저작권

`static/images`의 SVG 아이콘은 Lucide에서 가져왔으며 ISC 라이선스가 적용됩니다. 자세한 내용은 [Lucide 라이선스](https://github.com/lucide-icons/lucide/blob/main/LICENSE)를 확인하세요.
