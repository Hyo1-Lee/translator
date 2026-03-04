/**
 * TranslationService + SessionService 번역 품질 테스트
 *
 * 실행: npx ts-node --skip-project test-translation.ts
 * (--skip-project: rootDir=src 제약 우회)
 */

import dotenv from 'dotenv';
dotenv.config();

import { TranslationService, TranslationResult } from './src/modules/translation/translation-service';
import { SessionService } from './src/services/session-service';

const TEST_SENTENCES = [
  '오늘은 몰멍평에 대해 간정을 나누고 싶습니다',
  '구쥬 예수 그리스도의 석죄는 우리 모두를 위한 것입니다',
  '주작 스미스는 첫번째 시현을 통해 하나님을 보았습니다',
  '성심의 인도를 받아 올바른 선택을 해야 합니다',
  '선지차의 말씀을 따르면 축복을 받게 됩니다',
  '성차식에서 빵과 물을 나누며 구주를 기억합니다',
  '니파이는 큰 신앙으로 바다를 건너 약속의 땅에 도착했습니다',
  '앨마는 회개의 중요성을 가르치며 많은 사람을 침례주었습니다',
  '성교사들은 전 세계에 복음을 전하고 있습니다',
  '우리가 간중을 나눌 때 성신의 힘으로 진리를 느낄 수 있습니다',
];

const TARGET_LANGUAGES = ['en', 'ja', 'zh'];
const ROOM_CODE = 'test-room';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('GEMINI_API_KEY 필요');
    process.exit(1);
  }

  console.log(`문장: ${TEST_SENTENCES.length}개, 언어: ${TARGET_LANGUAGES.join(', ')}\n`);

  const translationService = new TranslationService({
    apiKey,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    correctionModel: process.env.GEMINI_CORRECTION_MODEL || 'gemini-2.0-flash',
  });

  const sessionService = new SessionService();

  let totalLatency = 0;
  let successCount = 0;

  for (let i = 0; i < TEST_SENTENCES.length; i++) {
    const sentence = TEST_SENTENCES[i];
    sessionService.addSegment(ROOM_CODE, sentence);

    const context = {
      summary: sessionService.getSummary(ROOM_CODE),
      recentSourceText: sessionService.getRecentContext(ROOM_CODE),
      recentTranslationHistory: sessionService.getRecentTranslationHistory(ROOM_CODE),
    };

    const start = Date.now();
    const result = await translationService.translate(sentence, TARGET_LANGUAGES, 'ko', context);
    const latency = Date.now() - start;
    totalLatency += latency;

    if (result) {
      successCount++;
      console.log(`[${i + 1}] 원문: ${sentence}`);
      console.log(`    보정: ${result.sourceText}`);
      for (const lang of TARGET_LANGUAGES) {
        console.log(`    ${lang}: ${result.translations[lang] || '(누락)'}`);
      }
      console.log(`    (${latency}ms)\n`);

      sessionService.updateCorrectedSegment(ROOM_CODE, result.sourceText);
      sessionService.addTranslationHistory(ROOM_CODE, result.translations);

      if (sessionService.shouldRegenerateSummary(ROOM_CODE)) {
        const fullContext = sessionService.getFullContext(ROOM_CODE);
        const summary = await translationService.generateSummary(
          fullContext,
          sessionService.getSummary(ROOM_CODE)
        );
        if (summary) {
          sessionService.updateSummary(ROOM_CODE, summary);
        }
      }
    } else {
      console.log(`[${i + 1}] 원문: ${sentence}`);
      console.log(`    번역 실패 (${latency}ms)\n`);
    }
  }

  const avg = TEST_SENTENCES.length > 0 ? Math.round(totalLatency / TEST_SENTENCES.length) : 0;
  console.log(`번역 완료: ${successCount}/${TEST_SENTENCES.length} 성공, 총 ${totalLatency}ms (평균 ${avg}ms)`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
