"""
OpenAI GPT 번역 서비스 모듈
"""
from typing import Optional, Dict
from openai import OpenAI
from app.core.logger import setup_logger
from app.config import settings

logger = setup_logger(__name__)


class TranslationService:
    """OpenAI GPT 기반 번역 서비스"""

    def __init__(self):
        self.client = None
        self.translation_cache: Dict[str, str] = {}
        self.max_cache_size = settings.TRANSLATION_CACHE_SIZE

        # OpenAI 클라이언트 초기화
        if settings.OPENAI_API_KEY:
            try:
                self.client = OpenAI(api_key=settings.OPENAI_API_KEY)
                logger.info("✅ OpenAI 클라이언트 초기화 성공")
            except Exception as e:
                logger.error(f"❌ OpenAI 클라이언트 초기화 실패: {e}")

    def translate_with_gpt(self, korean_text: str, previous_context: str = "") -> Optional[str]:
        """GPT로 한국어를 영어로 번역 (교회 용어 특화 + STT 오류 수정 + 문맥 활용)"""
        if not korean_text:
            return None

        # 캐시 확인
        cache_key = korean_text
        if cache_key in self.translation_cache:
            logger.info('✨ 캐시에서 번역 반환')
            return self.translation_cache[cache_key]

        try:
            if not self.client:
                logger.warning('OpenAI API 키가 설정되지 않았습니다')
                return "Translation service unavailable"

            # 문맥 정보 포함한 프롬프트
            context_prompt = f"\n\nPrevious context (for reference only): {previous_context}" if previous_context else ""

            response = self.client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[
                    {
                        'role': 'system',
                        'content': self._get_system_prompt()
                    },
                    {
                        'role': 'user',
                        'content': self._get_user_prompt(korean_text, context_prompt)
                    }
                ],
                max_completion_tokens=10000
            )

            translated_text = response.choices[0].message.content.strip()

            # 한국어가 포함되어 있으면 오류 처리
            if self._contains_korean(translated_text):
                logger.warning(f"번역 결과에 한국어 포함됨: {translated_text[:50]}...")
                return "Translation error - please try again"

            # 캐시 저장
            self._add_to_cache(korean_text, translated_text)

            logger.info(f"번역 완료: {korean_text[:30]}... → {translated_text[:30]}...")
            return translated_text

        except Exception as e:
            logger.error(f'GPT 번역 오류: {e}')
            return "Translation error"

    def _get_system_prompt(self) -> str:
        """시스템 프롬프트 반환"""
        return """You are an expert Korean-to-English translator specialized in fixing Speech-to-Text misrecognition errors.

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

    def _get_user_prompt(self, korean_text: str, context_prompt: str) -> str:
        """사용자 프롬프트 반환"""
        return f"""Analyze this Korean STT output that likely contains recognition errors:

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

    def _contains_korean(self, text: str) -> bool:
        """텍스트에 한국어가 포함되어 있는지 확인"""
        return any(ord(char) >= 0xAC00 and ord(char) <= 0xD7A3 for char in text)

    def _add_to_cache(self, key: str, value: str):
        """캐시에 번역 결과 저장"""
        if len(self.translation_cache) >= self.max_cache_size:
            # 가장 오래된 항목 제거
            self.translation_cache.pop(next(iter(self.translation_cache)))
        self.translation_cache[key] = value