#!/usr/bin/env python3
"""
BridgeSpeak - 실시간 다국어 동시통역 서비스
메인 FastAPI 애플리케이션
"""
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio

from app.config import settings
from app.core.logger import setup_logger
from app.api.v1.health import router as health_router
from app.api.websocket import sio

# 로거 설정
logger = setup_logger(__name__)

# FastAPI 앱 생성
app = FastAPI(
    title=settings.SERVICE_NAME,
    description=settings.DESCRIPTION,
    version=settings.VERSION
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 라우터 등록
app.include_router(health_router)

# Socket.IO를 FastAPI에 통합
socket_app = socketio.ASGIApp(sio, app)


@app.on_event("startup")
async def startup_event():
    """애플리케이션 시작 시 실행"""
    logger.info("=" * 50)
    logger.info(f"🚀 {settings.SERVICE_NAME} 서버 시작")
    logger.info(f"📍 포트: {settings.PORT}")
    logger.info(f"🎤 STT: ReturnZero WebSocket (실시간)")
    logger.info(f"📦 배치: {settings.BUFFER_TARGET_SENTENCES}-{settings.BUFFER_MAX_SENTENCES}문장씩 번역")
    logger.info(f"🌐 번역: OpenAI {settings.OPENAI_MODEL}")
    logger.info("=" * 50)


@app.on_event("shutdown")
async def shutdown_event():
    """애플리케이션 종료 시 실행"""
    logger.info(f"🛑 {settings.SERVICE_NAME} 서버 종료")


if __name__ == "__main__":
    # 개발 모드로 실행
    uvicorn.run(
        "app.main:socket_app",  # Socket.IO 통합 앱 사용
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
        log_level="info"
    )