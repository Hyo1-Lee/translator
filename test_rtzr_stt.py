#!/usr/bin/env python3
import asyncio
import websockets
import json
import time
import requests
import pyaudio
import sys
import os
from threading import Thread
from queue import Queue

# RTZR API 설정
CLIENT_ID = os.getenv('RTZR_CLIENT_ID', '_M16Ky9zQYGubnsJBCUy')
CLIENT_SECRET = os.getenv('RTZR_CLIENT_SECRET', '3uK1qL3UynoOiis9CWJPL97MOqFh_G3ia02rIMFN')
API_BASE = "https://openapi.vito.ai"

class RTZRSTTTest:
    def __init__(self):
        self.client_id = CLIENT_ID
        self.client_secret = CLIENT_SECRET
        self._token = None
        self._sess = requests.Session()
        self.audio_queue = Queue()
        self.is_running = False

    def get_token(self):
        """토큰 발급"""
        print("🔑 토큰 발급 중...")
        try:
            resp = self._sess.post(
                f"{API_BASE}/v1/authenticate",
                data={  # form-data로 전송
                    "client_id": self.client_id,
                    "client_secret": self.client_secret
                }
            )
            resp.raise_for_status()
            token_data = resp.json()
            self._token = token_data["access_token"]
            print(f"✅ 토큰 발급 성공")
            return self._token

        except Exception as e:
            print(f"❌ 토큰 발급 실패: {e}")
            if hasattr(e, 'response'):
                print(f"Response: {e.response.text}")
            return None

    async def connect_websocket(self):
        """WebSocket 연결 및 스트리밍"""
        token = self.get_token()
        if not token:
            print("토큰을 가져올 수 없습니다")
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

        # Authorization 헤더
        headers = {
            "Authorization": f"bearer {token}"
        }

        try:
            print("🔌 WebSocket 연결 시도 중...")
            async with websockets.connect(ws_url, additional_headers=headers) as websocket:
                self.is_running = True
                print("✅ WebSocket 연결 성공!")
                print("🎤 마이크로 말해보세요... (Ctrl+C로 종료)")
                print("-" * 50)

                # 수신 및 송신 태스크 동시 실행
                receive_task = asyncio.create_task(self.receive_messages(websocket))
                send_task = asyncio.create_task(self.send_audio(websocket))

                await asyncio.gather(receive_task, send_task)

        except Exception as e:
            print(f"❌ WebSocket 연결 오류: {e}")
            self.is_running = False

    async def receive_messages(self, websocket):
        """WebSocket 메시지 수신"""
        try:
            while self.is_running:
                message = await websocket.recv()
                data = json.loads(message)

                # 모든 메시지 로그
                print(f"[디버그] 수신 메시지: {json.dumps(data, ensure_ascii=False)[:200]}")

                # partial 결과도 출력
                if data.get("alternatives"):
                    text = data["alternatives"][0].get("text", "").strip()
                    if text:
                        if data.get("final"):
                            print(f"📝 [최종] 인식된 텍스트: {text}")
                        else:
                            print(f"... [중간] {text}")

                # 에러 메시지 확인
                if data.get("error"):
                    print(f"❌ STT 에러: {data.get('error')}")

        except websockets.exceptions.ConnectionClosed:
            print("\n🔌 WebSocket 연결 종료")
        except Exception as e:
            print(f"❌ 메시지 수신 오류: {e}")
        finally:
            self.is_running = False

    async def send_audio(self, websocket):
        """오디오 데이터 전송"""
        try:
            sent_count = 0
            while self.is_running:
                if not self.audio_queue.empty():
                    audio_data = self.audio_queue.get()
                    await websocket.send(audio_data)
                    sent_count += 1
                    if sent_count % 50 == 0:  # 50개마다 로그
                        print(f"[디버그] 오디오 전송 중... ({sent_count} chunks sent, {len(audio_data)} bytes)")
                else:
                    await asyncio.sleep(0.01)

        except Exception as e:
            print(f"❌ 오디오 전송 오류: {e}")
        finally:
            self.is_running = False

    def record_audio(self):
        """마이크에서 오디오 녹음"""
        CHUNK = 1024
        FORMAT = pyaudio.paInt16
        CHANNELS = 1
        RATE = 16000

        p = pyaudio.PyAudio()

        # 마이크 장치 정보 출력
        print("\n🎤 사용 가능한 마이크 장치:")
        for i in range(p.get_device_count()):
            info = p.get_device_info_by_index(i)
            if info['maxInputChannels'] > 0:
                print(f"  [{i}] {info['name']}")

        stream = p.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RATE,
            input=True,
            frames_per_buffer=CHUNK
        )

        print("\n🎙️ 녹음 시작...")

        # 오디오 레벨 체크를 위한 변수
        import numpy as np
        record_count = 0

        try:
            while self.is_running:
                data = stream.read(CHUNK, exception_on_overflow=False)
                self.audio_queue.put(data)

                # 오디오 레벨 체크 (10번마다)
                record_count += 1
                if record_count % 10 == 0:
                    audio_array = np.frombuffer(data, dtype=np.int16)
                    max_val = np.max(np.abs(audio_array))
                    if max_val > 500:  # 소리가 감지되면
                        print(f"🔊 오디오 감지: Level {max_val}")

        except KeyboardInterrupt:
            print("\n⏹️ 녹음 중지...")
        finally:
            stream.stop_stream()
            stream.close()
            p.terminate()
            self.is_running = False

def main():
    print("=" * 50)
    print("RTZR STT WebSocket 테스트")
    print("=" * 50)

    tester = RTZRSTTTest()

    # 오디오 녹음 스레드 시작
    audio_thread = Thread(target=tester.record_audio)
    audio_thread.daemon = True
    audio_thread.start()

    # WebSocket 연결 및 실행
    try:
        asyncio.run(tester.connect_websocket())
    except KeyboardInterrupt:
        print("\n👋 테스트 종료")
        tester.is_running = False

if __name__ == "__main__":
    main()