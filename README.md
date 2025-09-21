# 교회 실시간 번역 시스템

실시간 한국어→영어 번역 시스템 (예수 그리스도 후기 성도 교회 용어 특화)

## 기능
- 🎤 실시간 음성 인식 (RTZR WebSocket STT)
- 🌐 GPT 기반 번역 (교회 용어 정확도 향상)
- 👥 다중 청중 지원
- 💻 웹 기반 인터페이스
- 📱 모바일 지원

## 프로젝트 구조

```
translator/
├── backend/
│   ├── unified_server.py    # 통합 Python 백엔드 서버
│   ├── requirements.txt     # Python 패키지
│   └── .env                # 환경 변수 (API 키)
├── church-translator/       # Next.js 프론트엔드
│   ├── app/
│   │   ├── page.js        # 메인 페이지
│   │   ├── speaker/       # 연사 페이지
│   │   └── listener/      # 청중 페이지
│   └── package.json
├── test_rtzr_stt.py        # STT 테스트 코드
└── start_server.bat        # 서버 실행 스크립트
```

## 설치

### 1. 백엔드 (Python)
```bash
cd backend
pip install -r requirements.txt
```

### 2. 프론트엔드 (Next.js)
```bash
cd church-translator
npm install
```

### 3. 환경 변수 설정
`backend/.env` 파일에 API 키 설정:
```env
RTZR_CLIENT_ID=your_rtzr_client_id
RTZR_CLIENT_SECRET=your_rtzr_client_secret
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-3.5-turbo
```

## 실행

### 1. 백엔드 서버 (포트 4000)
```bash
cd backend
python unified_server.py
```
또는
```bash
start_server.bat
```

### 2. 프론트엔드 (포트 3000)
```bash
cd church-translator
npm run dev
```
또는
```bash
start_frontend.bat
```

## 사용법

### 연사 (Speaker)
1. http://localhost:3000 접속
2. "연사로 시작" 클릭
3. 방 코드 확인 (자동 생성)
4. 마이크 권한 허용
5. "시작" 버튼 클릭하여 녹음 시작
6. 한국어로 말하기

### 청중 (Listener)
1. http://localhost:3000 접속
2. 연사가 제공한 방 코드 입력
3. "청중으로 참가" 클릭
4. 실시간으로 원문(한국어)과 번역(영어) 확인

## 테스트

### STT 단독 테스트
```bash
python test_rtzr_stt.py
```

## 기술 스택

### Backend
- **Python**: Flask, Flask-SocketIO
- **STT**: ReturnZero WebSocket API
- **Translation**: OpenAI GPT API
- **Real-time**: Socket.IO

### Frontend
- **Framework**: Next.js 14
- **UI**: React
- **Styling**: CSS Modules
- **Audio**: Web Audio API

## 주요 기능

### 실시간 음성 인식
- RTZR WebSocket을 통한 실시간 스트리밍
- 16kHz PCM 오디오 포맷
- 노이즈 제거 및 에코 캔슬링

### 교회 용어 특화 번역
- GPT 모델 사용
- LDS 교회 전문 용어 정확도 향상
- 번역 캐싱으로 성능 최적화

### 실시간 통신
- WebSocket 기반 양방향 통신
- 자동 재연결
- 다중 청중 동시 지원

## 문제 해결

### 마이크가 작동하지 않을 때
- 브라우저 마이크 권한 확인
- HTTPS 환경에서 실행 권장
- Chrome/Firefox/Safari 최신 버전 사용

### STT가 인식되지 않을 때
- 마이크 볼륨 확인
- 조용한 환경에서 테스트
- `test_rtzr_stt.py`로 API 연결 테스트

### 번역이 느릴 때
- OpenAI API 키 확인
- 네트워크 연결 확인
- 캐싱 활성화 확인

## 배포

### Vercel (프론트엔드)
```bash
cd church-translator
vercel
```

### 백엔드 서버
- AWS EC2, Google Cloud 등에 배포
- 최소 사양: 2 CPU, 8GB RAM
- Python 3.8+ 필요

## 라이선스

교육 및 비영리 목적으로 자유롭게 사용 가능