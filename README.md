# 모바일 정산기 Flask 실험판

## 설치

```bash
pip install -r requirements.txt
```

## 실행

```bash
.\run-local.ps1
```

PowerShell에서 프로젝트 전용 실행 스크립트를 사용할 수도 있습니다. 기본 포트는 5000이며, 포트를 바꾸려면 `-Port`를 지정합니다. 사용 중인 포트가 있으면 기존 프로세스를 표시하고 실행을 멈춥니다.

```powershell
.\run-local.ps1
.\run-local.ps1 -Port 5001
```

스크립트는 프로젝트 폴더를 기준으로 실행하고 `0.0.0.0`에 바인딩합니다. Python 코드는 Flask가 자동 재시작하고, HTML·CSS·JavaScript가 바뀌면 열린 모바일 페이지도 자동 새로고침합니다. 개발 서버는 대화형 디버거를 켜지 않습니다.

종료는 서버 콘솔에서 `Ctrl+C`를 누릅니다. 코드 수정만으로 서버를 직접 재시작할 필요는 없습니다. 서버를 다시 실행할 때는 `.\run-local.ps1`을 사용합니다.

Windows 로그인 때 자동 실행하려면 현재 사용자 권한으로 등록합니다. 로그인 시 프로젝트 서버 콘솔이 열리며, 그 창에서 `Ctrl+C`로 종료할 수 있습니다. 중지한 뒤 다시 실행할 때는 `.\run-local.ps1`을 사용합니다.

```powershell
.\dev-autostart.ps1
.\dev-autostart.ps1 -Action Remove
```

## 모바일 접속

PC와 폰을 같은 와이파이에 연결한 뒤, PC의 IPv4 주소를 확인합니다.

```bash
ipconfig
```

폰 브라우저에서 접속합니다. PC의 IPv4 주소는 네트워크 변경 시 달라질 수 있으므로 실행할 때 `ipconfig`로 다시 확인합니다.

```text
http://PC의_IP주소:5000
```

예시:

```text
http://192.168.1.2:5000 (PC의 현재 IPv4 주소로 바꿔 사용)
```

## 현재 실험판 특징

- Flask는 화면을 제공하는 서버 역할만 합니다.
- 정산 데이터는 브라우저 localStorage에 저장됩니다.
- 새로고침해도 데이터가 유지됩니다.
- 서버 DB는 아직 사용하지 않습니다.
- 기존 Streamlit 정산기의 단순 정산 로직을 유지합니다.

## Git 브랜치

- `main`: 운영 안정 버전. Render가 연결된 원격 브랜치는 Render 대시보드에서 확인합니다.
- `develop`: 로컬 개발 작업 브랜치.
- 개발은 `develop`에서 진행하고 검증이 끝난 변경만 `main`에 반영합니다.

```bash
git switch develop
git switch main
```

## Icons

This project uses icons from Lucide.

https://lucide.dev/

License: ISC License

https://github.com/lucide-icons/lucide/blob/main/LICENSE
