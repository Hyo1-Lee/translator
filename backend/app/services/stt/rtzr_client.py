"""
RTZR WebSocket STT 클라이언트 모듈
"""
import asyncio
import websockets
import json
import time
import requests
from queue import Queue
from typing import Optional, Callable
from app.core.logger import setup_logger
from app.config import settings

logger = setup_logger(__name__)


class RTZRWebSocketClient:
    """RTZR WebSocket STT 클라이언트"""

    def __init__(self, room_id: str):
        self.client_id = settings.RTZR_CLIENT_ID
        self.client_secret = settings.RTZR_CLIENT_SECRET
        self.api_base = settings.RTZR_API_URL
        self.room_id = room_id
        self._token = None
        self._sess = requests.Session()
        self.ws = None
        self.audio_queue = Queue()
        self.is_running = False
        self.on_transcript = None
        self.connection_ready = False
        self.pending_audio = []  # WebSocket 연결 전 임시 버퍼

    def get_token(self) -> Optional[str]:
        """토큰 발급"""
        if self._token is None or self._token.get("expire_at", 0) < time.time():
            try:
                resp = self._sess.post(
                    f"{self.api_base}/v1/authenticate",
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret
                    }
                )

                if resp.status_code != 200:
                    logger.error(f"토큰 발급 실패: {resp.status_code}")
                    return None

                resp.raise_for_status()
                token_data = resp.json()

                self._token = {
                    "access_token": token_data["access_token"],
                    "expire_at": time.time() + 86400
                }
                logger.info(f"[{self.room_id}] ✅ RTZR 토큰 발급 성공")
                return self._token["access_token"]

            except Exception as e:
                logger.error(f"[{self.room_id}] ❌ 토큰 발급 실패: {e}")
                return None

        return self._token["access_token"]

    async def connect_websocket(self, on_transcript: Callable[[str], None]):
        """WebSocket 연결 및 스트리밍"""
        self.on_transcript = on_transcript
        token = self.get_token()

        if not token:
            logger.error(f"[{self.room_id}] 토큰을 가져올 수 없습니다")
            return

        # WebSocket URL 구성
        config = {
            "sample_rate": "16000",
            "encoding": "LINEAR16",
            "use_itn": "true",
            "use_disfluency_filter": "true",
            "use_profanity_filter": "false",
            "use_punctuation": "true",
            "use_word_timestamp": "false"
        }

        params = "&".join([f"{k}={v}" for k, v in config.items()])
        ws_url = f"wss://openapi.vito.ai/v1/transcribe:streaming?{params}"

        headers = {
            "Authorization": f"bearer {token}"
        }

        try:
            async with websockets.connect(ws_url, extra_headers=headers) as websocket:
                self.ws = websocket
                self.is_running = True
                logger.info(f"[{self.room_id}] ✅ STT WebSocket 연결됨")

                # 잠시 대기 후 연결 준비 완료 표시
                await asyncio.sleep(0.5)
                self.connection_ready = True

                # 연결 완료 후 pending_audio 처리
                if self.pending_audio:
                    logger.info(f"[{self.room_id}] 대기 중이던 오디오 {len(self.pending_audio)}개 처리 시작")
                    for audio_data in self.pending_audio:
                        self.audio_queue.put(audio_data)
                    self.pending_audio.clear()

                # 수신 및 송신 태스크 동시 실행
                receive_task = asyncio.create_task(self.receive_messages())
                send_task = asyncio.create_task(self.send_audio())

                await asyncio.gather(receive_task, send_task)

        except Exception as e:
            logger.error(f"[{self.room_id}] ❌ WebSocket 연결 오류: {e}")
        finally:
            self.is_running = False
            self.connection_ready = False

    async def receive_messages(self):
        """WebSocket 메시지 수신"""
        try:
            while self.is_running and self.ws:
                message = await self.ws.recv()
                data = json.loads(message)

                # STT 결과 처리
                if data.get("alternatives"):
                    text = data["alternatives"][0].get("text", "").strip()
                    if text and data.get("final"):
                        # logger.debug(f"[{self.room_id}] 인식: {text}")
                        if self.on_transcript:
                            self.on_transcript(text)

                # 에러 메시지 확인
                if data.get("error"):
                    logger.error(f"[{self.room_id}] ❌ STT 에러: {data.get('error')}")

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            logger.error(f"[{self.room_id}] 메시지 수신 오류: {e}")
        finally:
            self.is_running = False

    async def send_audio(self):
        """오디오 데이터 전송"""
        try:
            sent_count = 0
            empty_count = 0

            while self.is_running and self.ws:
                if not self.audio_queue.empty():
                    audio_data = self.audio_queue.get()
                    await self.ws.send(audio_data)
                    sent_count += 1
                    empty_count = 0

                    # 주기적으로 상태 표시
                    # if sent_count % 100 == 0:
                    #     logger.debug(f"[{self.room_id}] 오디오 처리 중...")
                else:
                    await asyncio.sleep(0.01)
                    empty_count += 1

        except Exception as e:
            logger.error(f"[{self.room_id}] 오디오 전송 오류: {e}")
        finally:
            self.is_running = False

    def add_audio(self, audio_data: bytes):
        """오디오 데이터를 큐에 추가"""
        if self.connection_ready:
            self.audio_queue.put(audio_data)
        else:
            # WebSocket 연결 전이면 pending_audio에 저장
            self.pending_audio.append(audio_data)
            # if len(self.pending_audio) % 10 == 0:  # 10개마다 로그
            #     logger.debug(f"[{self.room_id}] Buffering audio while connecting... ({len(self.pending_audio)} chunks)")

    def disconnect(self):
        """연결 종료"""
        self.is_running = False
        self.connection_ready = False
        if self.ws:
            asyncio.create_task(self.ws.close())