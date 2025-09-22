"""
헬스 체크 및 상태 API
"""
from fastapi import APIRouter
from app.api.websocket import room_manager
from app.config import settings

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/status")
async def api_status():
    """서버 상태 조회"""
    return {
        'status': 'running',
        'service_name': settings.SERVICE_NAME,
        'version': settings.VERSION,
        'rooms': len(room_manager.rooms),
        'total_listeners': room_manager.get_total_listeners(),
        'stt_provider': 'ReturnZero WebSocket',
        'translation_provider': f'OpenAI {settings.OPENAI_MODEL}',
        'rooms_detail': room_manager.get_all_rooms_status()
    }


@router.get("/health")
async def health_check():
    """헬스 체크"""
    return {
        'status': 'healthy',
        'service': settings.SERVICE_NAME,
        'version': settings.VERSION
    }