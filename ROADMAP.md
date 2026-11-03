# 진행 상태 및 후속 검토

완료는 현재 구현과 자동화 테스트, 실제 운영 검수로 확인된 항목입니다. 후속 검토는 아직 구현되지 않은 기능의 약속이 아닙니다.

## 완료

- 모바일 입력·결과 화면과 브라우저 `localStorage` 기반 저장·복원
- 멤버와 결제 내역의 추가·수정·삭제
- 기본 정산과 결제별 custom 정산 인원 지정
- 전역 대상자 필터와 custom 선택 기록 보존
- 부담 인원 0명 방지, 금액 검증, 정수 원 단위 분배 및 송금 상계
- 송금인 중심 TXT 공유와 조건부 1인당 부담액 표시
- Canvas PNG 공유, 콘텐츠 기반 너비, 단일 정산 상세 매트릭스
- 결제별 정산 인원 접기·펼치기 UX와 키보드·접근성 지원
- Windows CRLF·LF 모두에서 동작하는 입력 UI 테스트 소스 정규화
- Flask 로컬 개발 서버와 Live Reload 유지
- 개발 서버의 Windows 로그인 자동 실행 해제, 수동 실행 방식으로 전환
- Python 정적 빌드와 Cloudflare Workers Static Assets 설정
- GitHub `main` 기반 Cloudflare Workers 자동 빌드·배포
- Cloudflare HTTPS 운영 주소 공개 및 삼성 인터넷 실사용 검수
- 기존 Render 서비스 삭제

## 후속 검토

- 실제 사용에서 발견되는 모바일 입력·정산 인원 패널·공유 UX 문제 확인
- 인원과 결제 건수가 많은 PNG의 모바일 판독성 추가 확인
- 개인별 정산 차액을 유지하면서 송금 건수를 최적화할 수 있는지 검토
- 배포 전 자동화 테스트 실행을 배포 흐름에 연계할지 검토
- 불필요한 레거시 코드와 의존성 정리 후보 검토
- 필요성이 확인될 경우 `app.js` 모듈화 검토

## 현재 운영 및 개발 경로

- 운영: `https://mobile-settlement.sksalstjd.workers.dev/`
- 운영 배포 기준: GitHub `main`; Workers 빌드 명령 `python scripts/build_static.py`; 자산 경로 `./dist`
- 로컬 개발: 프로젝트 루트에서 `run-local.bat` 더블클릭; PowerShell 대체 실행은 `.\run-local.ps1` 사용
- Render 서비스는 삭제됐으며 현재 운영이나 대체 호스팅에 포함되지 않습니다.

정적 호스팅으로의 이전 여부는 이미 결정되고 배포됐습니다. Cloudflare Pages나 다른 플랫폼으로의 추가 전환은 현재 계획에 없습니다.
