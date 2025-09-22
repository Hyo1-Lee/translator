#!/usr/bin/env python3
"""
BridgeSpeak 서버 실행 스크립트
"""
import uvicorn
from app.config import settings

if __name__ == "__main__":
    # 프로덕션 모드 실행
    uvicorn.run(
        "app.main:socket_app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,  # 프로덕션에서는 reload 비활성화
        log_level="info"
    )