#!/usr/bin/env python3
"""
모듈 임포트 테스트
리팩토링한 코드가 제대로 작동하는지 확인
"""

def test_imports():
    """모든 모듈이 제대로 임포트되는지 확인"""
    try:
        print("[TEST] Starting tests...")

        # Config
        from app.config import settings
        print(f"[PASS] Config loaded: {settings.SERVICE_NAME} v{settings.VERSION}")

        # Logger
        from app.core.logger import setup_logger
        logger = setup_logger("test")
        print("[PASS] Logger configured")

        # Models
        from app.models.room import Room
        print("[PASS] Models imported")

        # Services
        from app.services.stt.rtzr_client import RTZRWebSocketClient
        from app.services.stt.buffer import TranscriptBuffer
        from app.services.stt.text_corrector import TextCorrector
        from app.services.translation.openai_service import TranslationService
        from app.services.room_manager import RoomManager
        print("[PASS] Services imported")

        # API
        from app.api.v1.health import router
        from app.api.websocket import sio
        print("[PASS] API imported")

        # Main app
        from app.main import app
        print("[PASS] FastAPI app imported")

        print("\n[SUCCESS] All tests passed! Refactoring successful!")
        return True

    except ImportError as e:
        print(f"\n[ERROR] Import error: {e}")
        return False
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        return False


if __name__ == "__main__":
    test_imports()