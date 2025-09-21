#!/usr/bin/env python3
"""
통합 백엔드 서버 - STT, 번역, 실시간 스트리밍
"""
import asyncio
import websockets
import json
import time
import requests
import os
import base64
import logging
from threading import Thread, Timer
from queue import Queue
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from openai import OpenAI
import random
import string
import uuid
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

# 로깅 레벨 설정 (INFO만 표시)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# 환경 변수 (하드코딩 제거)
RTZR_CLIENT_ID = os.getenv('RTZR_CLIENT_ID')
RTZR_CLIENT_SECRET = os.getenv('RTZR_CLIENT_SECRET')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-5-nano')
API_BASE = "https://openapi.vito.ai"

# OpenAI 클라이언트
openai_client = None
if OPENAI_API_KEY:
    try:
        openai_client = OpenAI(api_key=OPENAI_API_KEY)
        logger.info("✅ OpenAI 클라이언트 초기화 성공")
    except Exception as e:
        logger.error(f"❌ OpenAI 클라이언트 초기화 실패: {e}")

# 번역 캐시
translation_cache = {}

def translate_with_gpt(korean_text, previous_context=""):
    """GPT로 한국어를 영어로 번역 (교회 용어 특화 + STT 오류 수정 + 문맥 활용)"""
    if not korean_text:
        return None

    # 캐시 키는 현재 텍스트만 사용 (문맥은 변하므로)
    cache_key = korean_text
    if cache_key in translation_cache:
        logger.info('✨ 캐시에서 번역 반환')
        return translation_cache[cache_key]

    try:
        if not openai_client:
            logger.warning('OpenAI API 키가 설정되지 않았습니다')
            return "Translation service unavailable"

        # 문맥 정보 포함한 프롬프트
        context_prompt = f"\n\nPrevious context (for reference only): {previous_context}" if previous_context else ""

        response = openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {
                    'role': 'system',
                    'content': """You are an expert Korean-to-English translator specialized in fixing Speech-to-Text misrecognition errors.

CRITICAL: Output ONLY the English translation. No Korean, no explanations.

KEY INSIGHT: Korean STT often misrecognizes words as phonetically similar but contextually wrong words. Your job is to identify these errors and translate the INTENDED meaning.

COMMON STT MISRECOGNITION PATTERNS:

1. PHONETIC CONFUSION (sounds similar but wrong word):
   - 성신→성심/성인 (should be Holy Ghost)
   - 간증→감정/간정 (should be testimony)
   - 구주→구조/국주 (should be Savior)
   - 형제님→형재님/현제님 (should be Brother)
   - 와드→워드/왔드 (should be Ward)
   - 성찬→성찰/생산 (should be Sacrament)
   - 신권→신관/신원 (should be Priesthood)
   - 말씀→말슴/말씀 (should be words/talk)
   - 축복→측복/축보 (should be blessing)
   - 하나님→하난님/한나님 (should be God)

2. DROPPED SYLLABLES/WORDS (fast speech):
   - "그래서가" → "그래서 우리가" (missing 우리)
   - "저 생각합니다" → "저는 생각합니다" (missing 는)
   - "예수 그리스도" → "예수 그리스도의" (missing 의)
   - "교회 갑니다" → "교회에 갑니다" (missing 에)
   - "말씀 드립니다" → "말씀드립니다" or "말씀을 드립니다"

3. LIAISON/CONNECTED SPEECH ERRORS:
   - 믿음을→미듬을/미드믈 (should be faith)
   - 같이→가치/가티 (should be together)
   - 받을→바들/바즐 (should be receive)
   - 있을→이슬/이즐 (should be will be)
   - 갖을→가즐/가질 (should be have)

4. CONTEXT CLUES FOR CHURCH SETTING:
   - If you see 형제/자매, it's likely a church talk
   - Common phrases: "사랑하는 형제 자매 여러분" → "Dear brothers and sisters"
   - "하나님 아버지" → "Heavenly Father" (not just "God Father")
   - "예수 그리스도의 이름으로" → "In the name of Jesus Christ"
   - "간증드립니다" → "I testify" (not "I give emotion")

5. SEMANTIC COHERENCE CHECK:
   - If a word makes NO SENSE in context, find the phonetically similar word that DOES
   - Example: "성심이 우리를 인도하십니다" → "The Holy Ghost guides us" (성심→성신)
   - Example: "감정을 드립니다" in church → "I bear my testimony" (감정→간증)
   - Example: "구조께서 우리를 사랑하십니다" → "The Savior loves us" (구조→구주)

PROCESS:
1. Read the Korean text
2. Identify words that seem wrong for the context
3. Find phonetically similar words that make sense
4. Restore dropped particles/words if needed
5. Translate the CORRECTED meaning to natural English

REMEMBER: Trust context over literal text. If it sounds wrong, it probably IS wrong."""
                },
                {
                    'role': 'user',
                    'content': f"""Analyze this Korean STT output that likely contains recognition errors:

RAW STT OUTPUT: {korean_text}
{context_prompt}

INSTRUCTIONS:
1. This is speech-to-text output that often misrecognizes similar-sounding words
2. Look for words that don't make semantic sense in context
3. Replace them with phonetically similar words that DO make sense
4. Common error: church terms misrecognized as similar-sounding common words
5. After fixing the errors, translate to natural English
6. OUTPUT ONLY THE ENGLISH TRANSLATION

Example: If you see "감정을 드립니다" in a church context, it's likely "간증드립니다" (I testify)"""
                }
            ],
            max_completion_tokens=10000
        )

        translated_text = response.choices[0].message.content.strip()

        # 혹시 한국어가 포함되어 있으면 영어 부분만 추출
        if any(ord(char) >= 0xAC00 and ord(char) <= 0xD7A3 for char in translated_text):
            logger.warning(f"번역 결과에 한국어 포함됨: {translated_text[:50]}...")
            # 영어만 필터링하거나 다시 번역 시도
            return "Translation error - please try again"

        # 캐시 저장 (최대 100개)
        if len(translation_cache) > 100:
            translation_cache.pop(next(iter(translation_cache)))
        translation_cache[korean_text] = translated_text

        logger.info(f"번역 완료: {korean_text[:30]}... → {translated_text[:30]}...")
        return translated_text

    except Exception as e:
        logger.error(f'GPT 번역 오류: {e}')
        return "Translation error"

class RTZRWebSocketClient:
    """RTZR WebSocket STT 클라이언트"""
    def __init__(self, client_id, client_secret, room_id):
        self.client_id = client_id
        self.client_secret = client_secret
        self.room_id = room_id
        self._token = None
        self._sess = requests.Session()
        self.ws = None
        self.audio_queue = Queue()
        self.is_running = False
        self.on_transcript = None
        self.connection_ready = False

    def get_token(self):
        """토큰 발급"""
        if self._token is None or self._token.get("expire_at", 0) < time.time():
            try:
                resp = self._sess.post(
                    f"{API_BASE}/v1/authenticate",
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

    async def connect_websocket(self, on_transcript):
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
            async with websockets.connect(ws_url, additional_headers=headers) as websocket:
                self.ws = websocket
                self.is_running = True
                self.connection_ready = True
                logger.info(f"[{self.room_id}] ✅ STT WebSocket 연결됨")

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
                        logger.info(f"[{self.room_id}] 📝 인식: {text}")
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
                    if sent_count % 100 == 0:
                        logger.info(f"[{self.room_id}] 🎤 오디오 처리 중...")
                else:
                    await asyncio.sleep(0.01)
                    empty_count += 1

        except Exception as e:
            logger.error(f"[{self.room_id}] 오디오 전송 오류: {e}")
        finally:
            self.is_running = False

    def add_audio(self, audio_data):
        """오디오 데이터를 큐에 추가"""
        if self.connection_ready:
            self.audio_queue.put(audio_data)

    def disconnect(self):
        """연결 종료"""
        self.is_running = False
        self.connection_ready = False
        if self.ws:
            asyncio.create_task(self.ws.close())

# 방 관리
rooms = {}  # room_id -> {speaker_sid, listeners: set(), speaker_name, stt_client, thread, buffer, context, timer}

# 버퍼 및 컨텍스트 관리 클래스
class TranscriptBuffer:
    def __init__(self, room_id, callback):
        self.room_id = room_id
        self.callback = callback

        # 버퍼 관리
        self.current_sentences = []  # 현재 모인 완전한 문장들
        self.partial_text = ""  # 아직 완성되지 않은 텍스트
        self.context_history = []  # 최근 번역된 내용 (문맥 유지)

        # 타이머
        self.timer = None

        # 설정값 (4-5문장으로 변경)
        self.TARGET_SENTENCES = 4  # 4문장마다 처리
        self.MAX_SENTENCES = 5  # 최대 5문장까지 모음
        self.PARTIAL_TIMEOUT = 2.0  # 부분 텍스트 대기 시간 (초)
        self.SENTENCE_TIMEOUT = 4.0  # 문장 대기 시간 (초)

        # 문장 끝 패턴 (한국어 특성 반영)
        self.sentence_endings = {
            # 평서문 종결어미
            '다', '니다', '습니다', '합니다', '입니다', '됩니다',
            '어요', '아요', '에요', '예요', '어', '아', '지', '죠', '거든', '걸',
            '는데', '네', '군', '구나', '란다', '렴', '마', '자', '라',
            # 의문문 종결어미
            '까', '니', '나', '가', '냐', '느냐', '는가', '을까', '을까요',
            # 명령문/청유문 종결어미
            '세요', '십시오', '라', '어라', '거라', '자', '시다',
            # 감탄문 종결어미
            '구나', '군요', '네요', '는구나', '는군요',
            # 구어체
            '음', '슴', '심', '임'
        }

    def add_text(self, text):
        """STT 텍스트 추가 및 처리"""
        if not text or not text.strip():
            return None

        text = text.strip()
        logger.info(f"[{self.room_id}] 📝 STT 수신: '{text}'")

        # 기존 타이머 취소
        if self.timer:
            self.timer.cancel()
            self.timer = None

        # 부분 텍스트와 합치기
        if self.partial_text:
            text = self.partial_text + " " + text
            self.partial_text = ""

        # 문장 분리 시도
        sentences, remaining = self._split_into_sentences(text)

        # 완성된 문장들 추가
        if sentences:
            self.current_sentences.extend(sentences)
            logger.info(f"[{self.room_id}] 📚 문장 감지: {len(sentences)}개, 총 {len(self.current_sentences)}개")

        # 남은 텍스트 저장
        if remaining:
            self.partial_text = remaining
            logger.info(f"[{self.room_id}] 🔄 부분 텍스트: '{remaining}'")

        # 처리 조건 확인
        should_process = False

        # 조건 1: 목표 문장 수(4문장) 도달
        if len(self.current_sentences) >= self.TARGET_SENTENCES:
            logger.info(f"[{self.room_id}] ✅ {self.TARGET_SENTENCES}문장 도달 → 처리")
            should_process = True

        # 조건 2: 최대 문장 수(5문장) 초과
        elif len(self.current_sentences) >= self.MAX_SENTENCES:
            logger.info(f"[{self.room_id}] ⚠️ 최대 {self.MAX_SENTENCES}문장 초과 → 강제 처리")
            should_process = True

        # 처리하기
        if should_process:
            return self._process_sentences()

        # 처리하지 않고 타이머 설정
        if self.current_sentences:
            # 문장이 있으면 더 긴 대기
            self.timer = Timer(self.SENTENCE_TIMEOUT, self._timeout_flush)
            self.timer.start()
            logger.info(f"[{self.room_id}] ⏰ {self.SENTENCE_TIMEOUT}초 타이머 시작")
        elif self.partial_text:
            # 부분 텍스트만 있으면 짧은 대기
            self.timer = Timer(self.PARTIAL_TIMEOUT, self._timeout_flush)
            self.timer.start()
            logger.info(f"[{self.room_id}] ⏱️ {self.PARTIAL_TIMEOUT}초 타이머 시작")

        return None

    def _split_into_sentences(self, text):
        """텍스트를 문장 단위로 분리"""
        sentences = []
        current = ""

        words = text.split()

        for i, word in enumerate(words):
            current += word

            # 문장 끝인지 확인
            is_sentence_end = False

            # 구두점 체크 (. ! ?)
            if word.endswith(('.', '!', '?')):
                is_sentence_end = True
            else:
                # 한국어 종결어미 체크
                for ending in self.sentence_endings:
                    if word.endswith(ending):
                        # 다음 단어가 있으면 확인 (보조사가 붙을 수 있음)
                        if i + 1 < len(words):
                            next_word = words[i + 1]
                            # 보조사나 접속사가 아니면 문장 끝
                            if not any(next_word.startswith(p) for p in ['는', '도', '만', '까지', '부터', '라고', '고', '며', '면서']):
                                is_sentence_end = True
                                break
                        else:
                            # 마지막 단어면 문장 끝
                            is_sentence_end = True
                            break

            if is_sentence_end:
                sentences.append(current.strip())
                current = ""
            elif current:
                current += " "

        # 남은 텍스트
        remaining = current.strip() if current else ""

        return sentences, remaining

    def _process_sentences(self):
        """모인 문장들 처리"""
        if not self.current_sentences and not self.partial_text:
            return None

        # 처리할 텍스트 준비
        sentences_to_process = self.current_sentences.copy()

        # 부분 텍스트가 있으면 마지막에 추가
        if self.partial_text:
            sentences_to_process.append(self.partial_text)
            self.partial_text = ""

        # 합치기
        full_text = " ".join(sentences_to_process)

        # 문맥 가져오기
        context = " ".join(self.context_history[-3:]) if self.context_history else ""

        # 오류 보정
        processed_text = self._fix_incomplete_text(full_text, context)

        # 히스토리 업데이트
        self.context_history.append(processed_text)
        if len(self.context_history) > 5:
            self.context_history.pop(0)

        # 버퍼 초기화
        self.current_sentences.clear()

        logger.info(f"[{self.room_id}] 🎯 처리 완료: {len(sentences_to_process)}문장 → '{processed_text[:50]}...'")

        return {
            'korean_processed': processed_text,
            'context': context
        }

    def _timeout_flush(self):
        """타임아웃 시 강제 처리"""
        logger.info(f"[{self.room_id}] ⏰ 타임아웃 - 강제 처리")
        result = self._process_sentences()
        if result and self.callback:
            self.callback(result['korean_processed'], result['context'])

    def _fix_incomplete_text(self, text, context):
        """음성학적 STT 오류 및 불완전한 텍스트 보정"""
        text = text.strip()

        # 음성학적 오류 패턴 정의 (교회 문맥)
        phonetic_corrections = {
            # 교회 핵심 용어 오인식
            '성심': '성신',  # Holy Ghost
            '성인': '성신',
            '성식': '성신',
            '감정': '간증',  # testimony
            '간정': '간증',
            '간점': '간증',
            '구조': '구주',  # Savior
            '국주': '구주',
            '국주': '구주',
            '형재': '형제',  # Brother
            '현제': '형제',
            '형재님': '형제님',
            '자미': '자매',  # Sister
            '자배': '자매',
            '워드': '와드',  # Ward
            '왔드': '와드',
            '원드': '와드',
            '성찰': '성찬',  # Sacrament
            '생산': '성찬',
            '성차': '성찬',
            '신관': '신권',  # Priesthood
            '신원': '신권',
            '신권': '신권',
            '측복': '축복',  # blessing
            '축보': '축복',
            '축볼': '축복을',
            '침례': '침례',  # baptism
            '침례': '침례',
            '칠례': '침례',
            '협게': '회개',  # repentance
            '회계': '회개',
            '속제': '속죄',  # atonement
            '속재': '속죄',
            '예수 그리스도': '예수 그리스도',  # Jesus Christ
            '예수그리스도': '예수 그리스도',
            # 연음/발음 오류
            '미듬': '믿음',  # faith
            '미드믈': '믿음을',
            '미들': '믿음',
            '가치': '같이',  # together
            '가치': '가치',  # value (문맥 확인 필요)
            '바들': '받을',  # receive
            '바즐': '받을',
            '바다': '받다',
            '이슬': '있을',  # will be
            '이즐': '있을',
            '있습': '있습',
            '가즐': '갖을',  # have
            '가질': '갖을',
            '가져': '가져',
            # 일반 오류
            '하난님': '하나님',  # God
            '한나님': '하나님',
            '하눈님': '하나님',
            '하나님께서': '하나님께서',
            '하나님게서': '하나님께서',
            '하나님에서': '하나님께서',
            '말슴': '말씀',  # words/sermon
            '말씸': '말씀',
            '사랑합니다': '사랑합니다',  # love
            '사랑한니다': '사랑합니다',
            '그램': '그럼',  # then/so
            '그래': '그럼'
        }

        # 음성학적 오류 수정
        for wrong, correct in phonetic_corrections.items():
            if wrong in text:
                text = text.replace(wrong, correct)
                logger.info(f"[{self.room_id}] 음성 오류 수정: {wrong} → {correct}")

        # 누락된 조사 및 구조 복원
        text_fixes = {
            '교회 갑니다': '교회에 갑니다',
            '교회 왔습니다': '교회에 왔습니다',
            '저 생각': '저는 생각',
            '우리 하나님': '우리의 하나님',
            '우리 구주': '우리의 구주',
            '예수 그리스도 이름으로': '예수 그리스도의 이름으로',
            '말씀 드리겠습니다': '말씀드리겠습니다',
            '간증 드립니다': '간증드립니다',
            '축복 받을': '축복을 받을',
            '성신 통해': '성신을 통해',
            '감사 드립니다': '감사드립니다'
        }

        for wrong, correct in text_fixes.items():
            if wrong in text:
                text = text.replace(wrong, correct)
                logger.info(f"[{self.room_id}] 구조 수정: {wrong} → {correct}")

        # 결합 오류 수정
        if text == '그래서가' or text == '그래서 가':
            text = '그래서 우리가'
        if text.startswith('드리') and not any(s in text for s in ['드립니다', '드릴', '드려']):
            # "드리겠습니다" 보다 "말씀드리겠습니다"가 더 적합한 경우
            if '드리겠습니다' in text and '말씀' not in text and '간증' not in text:
                # 문맥에서 확인
                if context and ('교회' in context or '형제' in context or '자매' in context):
                    text = text.replace('드리겠습니다', '말씀드리겠습니다')

        # 주어 누락 확인 및 보완
        if not any(subj in text for subj in ['저', '우리', '그', '이', '여러분', '형제', '자매']):
            # 동사로 시작하는 짧은 문장
            if len(text) < 15 and any(verb in text for verb in ['합니다', '입니다', '드립니다', '됩니다']):
                # 문맥에서 주어 찾기
                if context and ('저는' in context or '저가' in context):
                    text = '저는 ' + text
                elif context and ('우리' in context):
                    text = '우리는 ' + text
                logger.info(f"[{self.room_id}] 주어 복원: '{text}'")

        return text

def generate_room_id():
    """랜덤 방 ID 생성"""
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))

@socketio.on('connect')
def handle_connect():
    logger.info(f"✅ 클라이언트 연결: {request.sid}")
    emit('connected', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"❌ 클라이언트 연결 해제: {request.sid}")

    # 스피커가 나간 경우
    for room_id, room in list(rooms.items()):
        if room['speaker_sid'] == request.sid:
            # STT 클라이언트 정리
            if room.get('stt_client'):
                room['stt_client'].disconnect()

            # 모든 리스너에게 알림
            socketio.emit('speaker-disconnected', room=room_id)
            del rooms[room_id]
            logger.info(f"[{room_id}] 방 종료")

        elif request.sid in room['listeners']:
            # 리스너가 나간 경우
            room['listeners'].discard(request.sid)
            leave_room(room_id)

            # 스피커에게 리스너 수 업데이트
            socketio.emit('listener-count', {
                'count': len(room['listeners'])
            }, room=room['speaker_sid'])

@socketio.on('create-room')
def handle_create_room(data):
    """방 생성 (스피커)"""
    room_id = generate_room_id()
    speaker_name = data.get('name', 'Speaker')

    logger.info(f"[{room_id}] 방 생성 - 연사: {speaker_name}")

    # STT 클라이언트 생성
    stt_client = RTZRWebSocketClient(RTZR_CLIENT_ID, RTZR_CLIENT_SECRET, room_id)

    # TranscriptBuffer 생성
    def on_buffered_transcript(korean_text, context):
        """버퍼링 후 처리된 텍스트를 받아 번역 (4-5문장 배치)"""
        logger.info(f"[{room_id}] 버퍼 처리 완료 (배치): {korean_text[:50]}...")

        # 배치 ID 생성
        batch_id = str(uuid.uuid4())[:8]

        # 즉시 원문 배치를 보냄 (번역 중 상태)
        socketio.emit('translation-batch', {
            'batchId': batch_id,
            'korean': korean_text,
            'english': '번역 중...',
            'timestamp': time.time()
        }, room=room_id)

        # 번역을 별도 스레드에서 처리
        def translate_async():
            try:
                # GPT로 번역 (문맥 포함, 4-5문장 한번에)
                english_text = translate_with_gpt(korean_text, context)

                if english_text and english_text != "Translation error":
                    # 번역 완료된 배치 업데이트
                    socketio.emit('translation-batch', {
                        'batchId': batch_id,
                        'korean': korean_text,
                        'english': english_text,
                        'timestamp': time.time()
                    }, room=room_id)
                    logger.info(f"[{room_id}] 배치 번역 완료: {english_text[:50]}...")
                else:
                    socketio.emit('translation-batch', {
                        'batchId': batch_id,
                        'korean': korean_text,
                        'english': '(번역 실패)',
                        'timestamp': time.time()
                    }, room=room_id)
            except Exception as e:
                logger.error(f"[{room_id}] 배치 번역 오류: {e}")
                socketio.emit('translation-batch', {
                    'batchId': batch_id,
                    'korean': korean_text,
                    'english': '(번역 오류)',
                    'timestamp': time.time()
                }, room=room_id)

        Thread(target=translate_async, daemon=True).start()

    # TranscriptBuffer 인스턴스 생성
    transcript_buffer = TranscriptBuffer(room_id, on_buffered_transcript)

    # 방 정보 저장
    rooms[room_id] = {
        'speaker_sid': request.sid,
        'listeners': set(),
        'speaker_name': speaker_name,
        'stt_client': stt_client,
        'transcript_buffer': transcript_buffer,
        'thread': None
    }

    join_room(room_id)

    # STT 콜백 - 버퍼로 전달 및 실시간 표시
    def on_transcript(korean_text):
        logger.info(f"[{room_id}] STT 원본 텍스트: {korean_text}")

        # 실시간 STT 텍스트를 즉시 전송 (왼쪽 패널용)
        socketio.emit('stt-text', {
            'text': korean_text,
            'timestamp': time.time()
        }, room=room_id)

        # 버퍼에 텍스트 추가 (번역 배치 처리용)
        result = transcript_buffer.add_text(korean_text)

        if result:
            # 버퍼가 4-5문장을 모았으면 번역 처리
            on_buffered_transcript(result['korean_processed'], result['context'])

    # WebSocket 연결을 별도 스레드에서 실행
    def run_async_websocket():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            loop.run_until_complete(stt_client.connect_websocket(on_transcript))
        except Exception as e:
            logger.error(f"[{room_id}] WebSocket 스레드 오류: {e}")
        finally:
            loop.close()

    thread = Thread(target=run_async_websocket)
    thread.daemon = True
    thread.start()

    rooms[room_id]['thread'] = thread

    emit('room-created', {'roomId': room_id})
    logger.info(f"[{room_id}] ✅ 방 생성 완료")

@socketio.on('join-room')
def handle_join_room(data):
    """방 참가 (리스너)"""
    room_id = data.get('roomId')

    if room_id not in rooms:
        emit('error', {'message': '방을 찾을 수 없습니다.'})
        return

    room = rooms[room_id]
    room['listeners'].add(request.sid)
    join_room(room_id)

    emit('room-joined', {
        'roomId': room_id,
        'speakerName': room['speaker_name']
    })

    # 스피커에게 리스너 수 업데이트
    socketio.emit('listener-count', {
        'count': len(room['listeners'])
    }, room=room['speaker_sid'])

    logger.info(f"[{room_id}] 청중 참가 (총 {len(room['listeners'])}명)")

@socketio.on('audio-stream')
def handle_audio_stream(data):
    """오디오 스트리밍 (스피커로부터)"""
    room_id = data.get('roomId')
    audio_base64 = data.get('audio')

    if not room_id or room_id not in rooms:
        return

    room = rooms[room_id]

    # 스피커인지 확인
    if room['speaker_sid'] != request.sid:
        return

    # STT 클라이언트로 오디오 전송
    if room.get('stt_client') and audio_base64:
        try:
            audio_bytes = base64.b64decode(audio_base64)
            room['stt_client'].add_audio(audio_bytes)
        except Exception as e:
            logger.error(f"[{room_id}] 오디오 처리 오류: {e}")

@app.route('/api/status')
def api_status():
    """서버 상태"""
    status = {
        'status': 'running',
        'rooms': len(rooms),
        'total_listeners': sum(len(room['listeners']) for room in rooms.values()),
        'stt_provider': 'ReturnZero WebSocket',
        'translation_provider': 'OpenAI GPT-3.5'
    }

    # 각 방의 상태
    room_status = []
    for room_id, room in rooms.items():
        room_status.append({
            'room_id': room_id,
            'listeners': len(room['listeners']),
            'stt_connected': room['stt_client'].connection_ready if room.get('stt_client') else False
        })
    status['rooms_detail'] = room_status

    return jsonify(status)

@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy'})

if __name__ == '__main__':
    logger.info("=" * 50)
    logger.info("🚀 교회 실시간 번역 서버 시작")
    logger.info("📍 포트: 4000")
    logger.info("🎤 STT: ReturnZero WebSocket (실시간)")
    logger.info("📦 배치: 4-5문장씩 번역")
    logger.info("🌐 번역: OpenAI GPT-5-nano")
    logger.info("=" * 50)
    socketio.run(app, host='0.0.0.0', port=4000, debug=False)