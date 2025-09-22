"""
텍스트 버퍼링 및 문장 분리 모듈
"""
from typing import List, Tuple, Optional, Callable, Dict
from threading import Timer
from app.core.logger import setup_logger
from app.config import settings
from app.services.stt.text_corrector import TextCorrector

logger = setup_logger(__name__)


class TranscriptBuffer:
    """텍스트 버퍼 및 문장 관리"""

    def __init__(self, room_id: str, callback: Callable[[str, str], None]):
        self.room_id = room_id
        self.callback = callback

        # 버퍼 관리
        self.current_sentences: List[str] = []  # 현재 모인 완전한 문장들
        self.partial_text: str = ""  # 아직 완성되지 않은 텍스트
        self.context_history: List[str] = []  # 최근 번역된 내용 (문맥 유지)

        # 타이머
        self.timer: Optional[Timer] = None

        # 설정값
        self.TARGET_SENTENCES = settings.BUFFER_TARGET_SENTENCES
        self.MAX_SENTENCES = settings.BUFFER_MAX_SENTENCES
        self.PARTIAL_TIMEOUT = settings.BUFFER_PARTIAL_TIMEOUT
        self.SENTENCE_TIMEOUT = settings.BUFFER_SENTENCE_TIMEOUT

        # 텍스트 보정기
        self.text_corrector = TextCorrector()

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

    def add_text(self, text: str) -> Optional[Dict[str, str]]:
        """STT 텍스트 추가 및 처리"""
        if not text or not text.strip():
            return None

        text = text.strip()
        # logger.debug(f"[{self.room_id}] STT 수신: '{text}'")

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
            # logger.debug(f"[{self.room_id}] 문장 감지: {len(sentences)}개, 총 {len(self.current_sentences)}개")

        # 남은 텍스트 저장
        if remaining:
            self.partial_text = remaining
            # logger.debug(f"[{self.room_id}] 부분 텍스트: '{remaining}'")

        # 처리 조건 확인
        should_process = False

        # 조건 1: 목표 문장 수 도달
        if len(self.current_sentences) >= self.TARGET_SENTENCES:
            # logger.debug(f"[{self.room_id}] {self.TARGET_SENTENCES}문장 도달")
            should_process = True

        # 조건 2: 최대 문장 수 초과
        elif len(self.current_sentences) >= self.MAX_SENTENCES:
            # logger.debug(f"[{self.room_id}] 최대 {self.MAX_SENTENCES}문장 초과")
            should_process = True

        # 처리하기
        if should_process:
            return self._process_sentences()

        # 처리하지 않고 타이머 설정
        if self.current_sentences:
            # 문장이 있으면 더 긴 대기
            self.timer = Timer(self.SENTENCE_TIMEOUT, self._timeout_flush)
            self.timer.start()
            # logger.debug(f"[{self.room_id}] {self.SENTENCE_TIMEOUT}초 타이머 시작")
        elif self.partial_text:
            # 부분 텍스트만 있으면 짧은 대기
            self.timer = Timer(self.PARTIAL_TIMEOUT, self._timeout_flush)
            self.timer.start()
            # logger.debug(f"[{self.room_id}] {self.PARTIAL_TIMEOUT}초 타이머 시작")

        return None

    def _split_into_sentences(self, text: str) -> Tuple[List[str], str]:
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

    def _process_sentences(self) -> Optional[Dict[str, str]]:
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
        processed_text = self.text_corrector.fix_text(full_text, context, self.room_id)

        # 히스토리 업데이트
        self.context_history.append(processed_text)
        if len(self.context_history) > 5:
            self.context_history.pop(0)

        # 버퍼 초기화
        self.current_sentences.clear()

        # logger.debug(f"[{self.room_id}] 처리 완료: {len(sentences_to_process)}문장")

        return {
            'korean_processed': processed_text,
            'context': context
        }

    def _timeout_flush(self):
        """타임아웃 시 강제 처리"""
        # logger.debug(f"[{self.room_id}] 타임아웃 - 강제 처리")
        result = self._process_sentences()
        if result and self.callback:
            self.callback(result['korean_processed'], result['context'])