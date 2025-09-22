#!/usr/bin/env python3
"""
BridgeSpeak 개발 서버 실행 스크립트
"""
import uvicorn
from app.config import settings

if __name__ == "__main__":
    # 개발 모드 실행
    uvicorn.run(
        "app.main:socket_app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,  # 코드 변경 시 자동 재시작
        log_level="debug"  # 디버그 로그 활성화
    )