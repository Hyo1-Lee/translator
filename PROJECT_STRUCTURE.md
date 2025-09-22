# BridgeSpeak - 프로젝트 구조

## 서비스 개요
**BridgeSpeak**는 실시간 1대다 동시통역 서비스입니다.

## 디렉토리 구조

```
translator/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                    # FastAPI 메인 엔트리
│   │   ├── config.py                  # 환경 설정
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   └── logger.py              # 로깅 설정
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── room.py                # Room 데이터 모델
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── stt/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── rtzr_client.py     # RTZR WebSocket 클라이언트
│   │   │   │   ├── buffer.py          # 텍스트 버퍼링
│   │   │   │   └── text_corrector.py  # STT 오류 보정
│   │   │   ├── translation/
│   │   │   │   ├── __init__.py
│   │   │   │   └── openai_service.py  # OpenAI GPT 번역
│   │   │   └── room_manager.py        # 방 관리 서비스
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── v1/
│   │   │   │   ├── __init__.py
│   │   │   │   └── health.py          # Health check API
│   │   │   └── websocket.py           # WebSocket/Socket.IO 핸들러
│   │   └── utils/
│   │       └── __init__.py
│   ├── .env                           # 환경 변수 (Git 제외)
│   ├── requirements.txt               # Python 의존성
│   ├── run.py                         # 프로덕션 실행 스크립트
│   ├── run_dev.py                     # 개발 실행 스크립트
│   └── unified_server.py              # (기존 코드 - 리팩토링 전)
│
├── frontend/
│   ├── index.html                     # 스피커 페이지
│   ├── listener.html                  # 리스너 페이지
│   └── styles.css                     # 스타일시트
│
├── .gitignore
├── README.md
└── PROJECT_STRUCTURE.md               # 이 문서
```

## 모듈 설명

### Core 모듈
- **config.py**: 환경 변수 및 설정 관리
- **logger.py**: 로깅 설정 및 유틸리티

### Services
- **STT 서비스**
  - `rtzr_client.py`: ReturnZero WebSocket STT 클라이언트
  - `buffer.py`: 문장 단위 텍스트 버퍼링 (4-5문장 배치 처리)
  - `text_corrector.py`: STT 오류 보정 (음성학적 오류 수정)

- **번역 서비스**
  - `openai_service.py`: OpenAI GPT 기반 한영 번역

- **방 관리**
  - `room_manager.py`: 방 생성, 관리, 삭제

### API
- **WebSocket**: Socket.IO 기반 실시간 통신
- **REST API**: 헬스 체크, 상태 조회

## 실행 방법

### 개발 환경
```bash
cd backend
pip install -r requirements.txt
python run_dev.py
```

### 프로덕션 환경
```bash
cd backend
pip install -r requirements.txt
python run.py
```

## 환경 변수 (.env)
```env
# ReturnZero STT API
RTZR_CLIENT_ID=your_client_id
RTZR_CLIENT_SECRET=your_client_secret

# OpenAI API
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-5-nano

# Server
PORT=4000
```

## API 엔드포인트

### REST API
- `GET /api/health`: 헬스 체크
- `GET /api/status`: 서버 상태 조회

### Socket.IO 이벤트
- `connect`: 클라이언트 연결
- `disconnect`: 클라이언트 연결 해제
- `create-room`: 방 생성 (스피커)
- `join-room`: 방 참가 (리스너)
- `audio-stream`: 오디오 스트리밍
- `stt-text`: STT 텍스트 전송
- `translation-batch`: 번역 배치 전송

## 기술 스택
- **Backend**: FastAPI, Socket.IO, Python 3.9+
- **STT**: ReturnZero WebSocket API
- **Translation**: OpenAI GPT
- **Frontend**: HTML5, JavaScript, WebRTC

## 향후 계획
1. **Phase 2**: Node.js Express 서비스 백엔드 추가
2. **Phase 3**: 사용자 인증 및 결제 시스템
3. **Phase 4**: 마이크로서비스 아키텍처 전환
4. **Phase 5**: 다중 언어 지원 확장