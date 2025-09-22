"""
STT 텍스트 보정 모듈
음성 인식 오류 수정 및 문장 구조 보완
"""
from typing import Dict
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class TextCorrector:
    """STT 텍스트 오류 보정"""

    def __init__(self):
        # 음성학적 오류 패턴 정의 (교회 문맥)
        self.phonetic_corrections = {
            # 교회 핵심 용어 오인식
            '성심': '성신',  # Holy Ghost
            '성인': '성신',
            '성식': '성신',
            '감정': '간증',  # testimony
            '간정': '간증',
            '간점': '간증',
            '구조': '구주',  # Savior
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
            '측복': '축복',  # blessing
            '축보': '축복',
            '축볼': '축복을',
            '칠례': '침례',  # baptism
            '협게': '회개',  # repentance
            '회계': '회개',
            '속제': '속죄',  # atonement
            '속재': '속죄',
            # 연음/발음 오류
            '미듬': '믿음',  # faith
            '미드믈': '믿음을',
            '미들': '믿음',
            '가치': '같이',  # together (context dependent)
            '바들': '받을',  # receive
            '바즐': '받을',
            '바다': '받다',
            '이슬': '있을',  # will be
            '이즐': '있을',
            '가즐': '갖을',  # have
            '가질': '갖을',
            # 일반 오류
            '하난님': '하나님',  # God
            '한나님': '하나님',
            '하눈님': '하나님',
            '하나님게서': '하나님께서',
            '하나님에서': '하나님께서',
            '말슴': '말씀',  # words/sermon
            '말씸': '말씀',
            '사랑한니다': '사랑합니다',
            '그램': '그럼',  # then/so
        }

        # 누락된 조사 및 구조 복원
        self.text_fixes = {
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
            '감사 드립니다': '감사드립니다',
            '예수그리스도': '예수 그리스도',
        }

    def fix_text(self, text: str, context: str, room_id: str = "") -> str:
        """음성학적 STT 오류 및 불완전한 텍스트 보정"""
        text = text.strip()

        # 음성학적 오류 수정
        for wrong, correct in self.phonetic_corrections.items():
            if wrong in text:
                text = text.replace(wrong, correct)
                if room_id:
                    logger.info(f"[{room_id}] 음성 오류 수정: {wrong} → {correct}")

        # 누락된 조사 및 구조 복원
        for wrong, correct in self.text_fixes.items():
            if wrong in text:
                text = text.replace(wrong, correct)
                if room_id:
                    logger.info(f"[{room_id}] 구조 수정: {wrong} → {correct}")

        # 특별한 경우 처리
        if text == '그래서가' or text == '그래서 가':
            text = '그래서 우리가'

        # 주어 누락 확인 및 보완
        if not any(subj in text for subj in ['저', '우리', '그', '이', '여러분', '형제', '자매']):
            # 동사로 시작하는 짧은 문장
            if len(text) < 15 and any(verb in text for verb in ['합니다', '입니다', '드립니다', '됩니다']):
                # 문맥에서 주어 찾기
                if context and ('저는' in context or '저가' in context):
                    text = '저는 ' + text
                elif context and ('우리' in context):
                    text = '우리는 ' + text
                if room_id:
                    logger.info(f"[{room_id}] 주어 복원: '{text}'")

        return text