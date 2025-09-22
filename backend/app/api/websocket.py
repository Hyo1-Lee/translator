"""
WebSocket/Socket.IO 핸들러 모듈
"""
import asyncio
import base64
import time
import uuid
from threading import Thread
from typing import Optional
import socketio
from app.core.logger import setup_logger
from app.services.room_manager import RoomManager
from app.services.stt.buffer import TranscriptBuffer
from app.services.translation.openai_service import TranslationService

logger = setup_logger(__name__)

# Socket.IO 서버 생성
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False
)

# 서비스 인스턴스
room_manager = RoomManager()
translation_service = TranslationService()


@sio.event
async def connect(sid, environ):
    """클라이언트 연결"""
    logger.info(f"✅ 클라이언트 연결: {sid}")
    await sio.emit('connected', {'status': 'connected'}, to=sid)


@sio.event
async def disconnect(sid):
    """클라이언트 연결 해제"""
    logger.info(f"❌ 클라이언트 연결 해제: {sid}")
    room_manager.cleanup_disconnected_user(sid)


@sio.event
async def create_room_from_nodejs(sid, data):
    """Node.js 백엔드로부터 방 생성 요청"""
    room_id = data.get('roomId')
    speaker_name = data.get('speakerName', 'Speaker')
    speaker_id = data.get('speakerId')

    logger.info(f"[{room_id}] Node.js로부터 방 생성 요청 - 연사: {speaker_name}")

    # 방 생성
    room = room_manager.create_room(speaker_id, speaker_name, room_id=room_id)

    # 이벤트 루프 저장용
    websocket_loop = None

    # TranscriptBuffer 콜백 정의
    async def on_buffered_transcript(korean_text: str, context: str):
        """버퍼링 후 처리된 텍스트를 받아 번역"""
        batch_id = str(uuid.uuid4())[:8]

        await sio.emit('transcript', {
            'roomId': room_id,
            'batchId': batch_id,
            'korean': korean_text,
            'english': '번역 중...',
            'timestamp': time.time(),
            'type': 'translation'
        }, to=sid)

        try:
            english_text = translation_service.translate_with_gpt(korean_text, context)

            if english_text and english_text != "Translation error":
                await sio.emit('transcript', {
                    'roomId': room_id,
                    'batchId': batch_id,
                    'korean': korean_text,
                    'english': english_text,
                    'timestamp': time.time(),
                    'type': 'translation'
                }, to=sid)
        except Exception as e:
            logger.error(f"[{room_id}] 배치 번역 오류: {e}")

    # 버퍼 생성 (WebSocket 루프 준비될 때까지 대기)
    pending_callbacks = []

    def sync_callback(korean_text: str, context: str):
        # WebSocket 루프가 준비될 때까지 최대 5초 대기
        max_wait = 5
        wait_time = 0
        while not websocket_loop and wait_time < max_wait:
            import time
            time.sleep(0.1)
            wait_time += 0.1

        if websocket_loop:
            asyncio.run_coroutine_threadsafe(on_buffered_transcript(korean_text, context), websocket_loop)
        else:
            # 그래도 준비되지 않으면 대기열에 저장
            pending_callbacks.append((korean_text, context))
            logger.warning(f"[{room_id}] WebSocket loop not ready after {max_wait}s, queued callback")

    transcript_buffer = TranscriptBuffer(room_id, sync_callback)
    room.transcript_buffer = transcript_buffer

    # STT 콜백 정의
    async def on_transcript(korean_text: str):
        """STT 결과 처리"""
        # Node.js 백엔드로 실시간 STT 텍스트 전송
        await sio.emit('transcript', {
            'roomId': room_id,
            'text': korean_text,
            'timestamp': time.time(),
            'type': 'stt'
        }, to=sid)

        # 버퍼에 텍스트 추가
        result = transcript_buffer.add_text(korean_text)

        if result:
            await on_buffered_transcript(result['korean_processed'], result['context'])

    # WebSocket 연결
    def run_async_websocket():
        nonlocal websocket_loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        websocket_loop = loop

        # 대기 중인 콜백 처리
        if pending_callbacks:
            for korean_text, context in pending_callbacks:
                asyncio.run_coroutine_threadsafe(on_buffered_transcript(korean_text, context), loop)
            pending_callbacks.clear()

        try:
            def sync_on_transcript(text):
                asyncio.run_coroutine_threadsafe(on_transcript(text), loop)

            loop.run_until_complete(
                room.stt_client.connect_websocket(sync_on_transcript)
            )
        except Exception as e:
            logger.error(f"[{room_id}] WebSocket 스레드 오류: {e}")
        finally:
            loop.close()

    thread = Thread(target=run_async_websocket)
    thread.daemon = True
    thread.start()

    room.thread = thread

    # WebSocket 연결 초기화를 위한 짧은 대기
    import time
    time.sleep(0.2)

    logger.info(f"[{room_id}] ✅ 방 생성 완료")


@sio.event
async def audio_stream(sid, data):
    """오디오 스트리밍 (Node.js 백엔드로부터)"""
    room_id = data.get('roomId')
    audio_base64 = data.get('audio')

    if not room_id or not audio_base64:
        return

    room = room_manager.get_room(room_id)
    if not room:
        return

    # STT 클라이언트로 오디오 전송
    if room.stt_client:
        try:
            audio_bytes = base64.b64decode(audio_base64)
            room.stt_client.add_audio(audio_bytes)
        except Exception as e:
            logger.error(f"[{room_id}] 오디오 처리 오류: {e}")