"""
BridgeSpeak 서비스 설정 모듈
환경 변수 및 전역 설정 관리
"""
import os
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()


class Settings:
    """애플리케이션 설정"""

    # 서비스 정보
    SERVICE_NAME = "BridgeSpeak"
    VERSION = "1.0.0"
    DESCRIPTION = "Real-time Multi-language Interpretation Service"

    # 서버 설정
    HOST = "0.0.0.0"
    PORT = int(os.getenv('PORT', 4000))
    DEBUG = False
    CORS_ORIGINS = ["*"]

    # API Keys
    RTZR_CLIENT_ID = os.getenv('RTZR_CLIENT_ID')
    RTZR_CLIENT_SECRET = os.getenv('RTZR_CLIENT_SECRET')
    RTZR_API_URL = os.getenv('RTZR_API_URL', 'https://openapi.vito.ai')

    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
    OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-5-nano')

    # URLs
    FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:3000')
    BACKEND_URL = os.getenv('BACKEND_URL', 'http://localhost:4000')

    # 웹소켓 설정
    WS_HEARTBEAT_INTERVAL = 30
    WS_MAX_CONNECTIONS = 1000

    # 버퍼 설정
    BUFFER_TARGET_SENTENCES = 4
    BUFFER_MAX_SENTENCES = 5
    BUFFER_PARTIAL_TIMEOUT = 2.0
    BUFFER_SENTENCE_TIMEOUT = 4.0

    # 캐시 설정
    TRANSLATION_CACHE_SIZE = 100

    # 로깅 설정
    LOG_LEVEL = "INFO"
    LOG_FORMAT = "%(asctime)s - %(levelname)s - %(message)s"


# 설정 인스턴스
settings = Settings()