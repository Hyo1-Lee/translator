  현재 사용 중인 STT 모델

  RTZR (ReturnZero VITO API) - .env:37에서 STT_PROVIDER=rtzr로 설정되어 있습니다.

  사용 가능한 STT 제공자

  1. rtzr - ReturnZero VITO API (현재 사용 중)
  2. openai - OpenAI Realtime API (gpt-4o-realtime-preview-2024-12-17)
  3. openai-whisper - OpenAI Whisper API (whisper-1)

  Config 값 (backend/.env)

  STT 관련 설정

  - STT_PROVIDER=rtzr - 현재 사용 중인 STT 제공자
  - STT_PROMPT_TEMPLATE=church - 현재 사용 중인 프롬프트 템플릿
  - OPENAI_VAD_THRESHOLD=0.5 - OpenAI VAD 임계값
  - OPENAI_VAD_SILENCE=500 - OpenAI VAD 침묵 감지 시간(ms)

  API 키

  - OPENAI_API_KEY - OpenAI API 키
  - RTZR_CLIENT_ID - RTZR 클라이언트 ID
  - RTZR_CLIENT_SECRET - RTZR 클라이언트 시크릿
  - RTZR_API_URL=https://openapi.vito.ai

  프롬프트 템플릿 종류

  backend/src/modules/stt/prompts/prompt-templates.ts에 정의되어 있습니다:

  1. church - 예수그리스도 휴기성도 교회 서비스용 (현재 사용 중)
    - 종교 용어, 성경 참조, 한국어 경어 처리에 최적화
  2. medical - 의료 상담용
    - 의학 용어, 약물명, 진단/치료 대화 처리
  3. legal - 법률 상담용
    - 법률 용어, 조항, 계약 관련 처리
  4. business - 비즈니스 미팅용
    - 비즈니스 용어, 재무 지표, 영어 외래어 처리
  5. tech - 기술/IT 토론용
    - 프로그래밍 용어, 프레임워크명, 기술 약어 처리
  6. education - 교육/강의용
    - 학술 용어, 교육 콘텐츠 처리
  7. general - 일반 대화용
    - 기본 한국어 대화 처리
  8. custom - 사용자 정의
    - GPT-4o-mini로 자동 최적화되는 커스텀 프롬프트 (prompt-templates.ts:251)

  주요 파일 위치

  - 설정 파일: backend/.env
  - STT 매니저: backend/src/modules/stt/stt-manager.ts
  - RTZR 클라이언트: backend/src/modules/stt/rtzr-client.ts
  - OpenAI Realtime: backend/src/modules/stt/openai-realtime-client.ts
  - OpenAI Whisper: backend/src/modules/stt/openai-whisper-client.ts
  - 프롬프트 템플릿: backend/src/modules/stt/prompts/prompt-templates.ts
  dd