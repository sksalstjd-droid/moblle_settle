# 모바일 정산기 Flask 실험판

## 설치

```bash
pip install -r requirements.txt
```

## 실행

```bash
python app.py
```

또는

```bash
flask --app app run --host=0.0.0.0 --port=5000 --debug
```

## 모바일 접속

PC와 폰을 같은 와이파이에 연결한 뒤, PC의 IPv4 주소를 확인합니다.

```bash
ipconfig
```

폰 브라우저에서 접속:

```text
http://PC의_IP주소:5000
```

예시:

```text
http://192.168.0.23:5000
```

## 현재 실험판 특징

- Flask는 화면을 제공하는 서버 역할만 합니다.
- 정산 데이터는 브라우저 localStorage에 저장됩니다.
- 새로고침해도 데이터가 유지됩니다.
- 서버 DB는 아직 사용하지 않습니다.
- 기존 Streamlit 정산기의 단순 정산 로직을 유지합니다.
