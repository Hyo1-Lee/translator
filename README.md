# Real-time Speech Translation Service

1대다 실시간 음성 번역 서비스 - 연사의 음성을 실시간으로 인식하고 번역하여 청중에게 제공하는 웹 애플리케이션.

## 주요 기능

- 🎤 **실시간 음성 인식** - 리턴제로(VITO) STT API를 활용한 정확한 한국어 음성 인식
- 🌐 **실시간 번역** - OpenAI GPT를 활용한 한국어→영어 번역
- 👥 **1대다 방송** - 연사 1명이 여러 청중에게 동시 전달
- 💾 **방 재입장 지원** - 연사가 새로고침해도 같은 방 유지 가능
- 📱 **반응형 UI** - 모바일/태블릿/데스크톱 모든 환경 지원
- 📝 **내보내기 기능** - 번역 내용을 텍스트 파일로 다운로드

## 기술 스택

### Backend (Node.js + TypeScript)
- **Fastify** - 고성능 웹 프레임워크
- **Socket.IO** - 실시간 양방향 통신
- **Prisma** - ORM (SQLite DB)
- **리턴제로 STT** - WebSocket 기반 실시간 음성 인식
- **OpenAI API** - 번역 서비스

### Frontend (Next.js 15)
- **React 19** - UI 라이브러리
- **Socket.IO Client** - 실시간 통신
- **Local Storage** - 설정 및 방 정보 저장

## 프로젝트 구조

```
translator/
├── backend/              # Node.js 백엔드 서버
│   ├── src/
│   │   ├── modules/     # 기능별 모듈
│   │   │   ├── room/    # 방 관리
│   │   │   ├── stt/     # 음성 인식 클라이언트
│   │   │   ├── translation/ # 번역 서비스
│   │   │   └── socket/  # 소켓 핸들러
│   │   └── index.ts     # 메인 서버
│   ├── prisma/          # 데이터베이스 스키마
│   └── package.json
├── frontend/            # Next.js 프론트엔드
│   ├── app/
│   │   ├── speaker/     # 연사 페이지
│   │   └── listener/    # 청취자 페이지
│   └── package.json
└── README.md
```

## 설치 및 실행

### 1. 환경 변수 설정

#### Backend (.env)
```env
# Server
NODE_ENV=development
PORT=5000

# Frontend
FRONTEND_URL=http://localhost:3000

# Return Zero STT API
RTZR_CLIENT_ID=your_client_id
RTZR_CLIENT_SECRET=your_client_secret
RTZR_API_URL=https://openapi.vito.ai

# OpenAI API
OPENAI_API_KEY=your_openai_api_key

# Database
DATABASE_URL="file:./dev.db"
```

#### Frontend (.env.local)
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
```

### 2. 백엔드 실행

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

### 3. 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

### 4. 접속
- 연사: http://localhost:3000/speaker
- 청취자: http://localhost:3000/listener

## 사용 방법

### 연사
1. `/speaker` 페이지 접속
2. 이름 입력
3. 방 코드 자동 생성 (6자리)
4. 녹음 시작 버튼 클릭
5. 방 코드를 청취자에게 공유

### 청취자
1. `/listener` 페이지 접속
2. 연사로부터 받은 방 코드 입력
3. 실시간으로 음성 인식 및 번역 내용 확인
4. 필요시 내보내기 버튼으로 다운로드

## 주요 개선 사항

### 연사 방 관리 시스템 개선
- **LocalStorage 활용**: 방 정보를 브라우저에 저장하여 새로고침해도 같은 방 유지
- **재입장 기능**: 연결이 끊겨도 같은 방 코드로 재입장 가능
- **새 방 만들기**: 필요시 새로운 방 생성 가능

### UX/UI 최적화
- **연결 상태 표시**: 실시간 서버 연결 상태 표시
- **마이크 레벨 표시**: 음성 입력 레벨 시각화
- **자동 스크롤**: 새 내용 추가시 자동 스크롤
- **글꼴 크기 조절**: 청취자가 읽기 편한 크기로 조절 가능
- **번역/원문 토글**: 필요에 따라 번역만 보기 또는 원문만 보기

### 코드 구조 개선
- **모듈화**: 기능별로 분리된 깔끔한 구조
- **TypeScript**: 타입 안정성 확보
- **최신 패키지**: 모든 의존성을 최신 버전으로 유지
- **단일 백엔드**: Node.js로 통합하여 유지보수 용이

## API 키 발급

### 리턴제로(VITO) STT
1. https://developers.rtzr.ai 접속
2. 회원가입 및 로그인
3. API 키 발급

### OpenAI
1. https://platform.openai.com 접속
2. API 키 발급

## 라이선스

MIT