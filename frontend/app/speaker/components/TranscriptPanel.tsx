"use client";

import { Transcript, TARGET_LANGUAGES } from "../types";
import { getDisplayText } from "@/lib/text-display";
import styles from "../speaker.module.css";
import { RefObject } from "react";

interface TranscriptPanelProps {
  transcripts: Transcript[];
  targetLanguages: string[];
  enableTranslation: boolean;
  selectedLanguage: string | null;
  onLanguageSelect: (language: string | null) => void;
  translationListRef: RefObject<HTMLDivElement | null>;
}

export default function TranscriptPanel({
  transcripts,
  targetLanguages,
  enableTranslation,
  selectedLanguage,
  onLanguageSelect,
  translationListRef,
}: TranscriptPanelProps) {
  const filteredTranscripts = transcripts.filter((item) => {
    // Hide STT blocks - only show translations
    if (item.type === "stt") return false;

    // Hide partial translations
    if (item.type === "translation" && item.isPartial) return false;

    // Filter by selected language
    if (selectedLanguage === null) return true;
    if (item.type === "translation" && item.targetLanguage) {
      return item.targetLanguage === selectedLanguage;
    }
    // Old translation-batch format
    return true;
  });

  return (
    <div className={styles.rightPanel}>
      <div className={styles.translationHeader}>
        <h3>실시간 번역</h3>
        <span className={styles.translationCount}>
          {transcripts.length} 항목
        </span>
      </div>

      {/* Language Filter Tabs */}
      {enableTranslation && targetLanguages.length > 0 && (
        <div className={styles.languageTabs}>
          <button
            className={`${styles.languageTab} ${
              selectedLanguage === null ? styles.active : ""
            }`}
            onClick={() => onLanguageSelect(null)}
          >
            전체
          </button>
          {targetLanguages.map((langCode) => {
            const lang = TARGET_LANGUAGES.find((l) => l.code === langCode);
            return (
              <button
                key={langCode}
                className={`${styles.languageTab} ${
                  selectedLanguage === langCode ? styles.active : ""
                }`}
                onClick={() => onLanguageSelect(langCode)}
              >
                {lang?.name || langCode}
              </button>
            );
          })}
        </div>
      )}

      <div className={styles.translationContent} ref={translationListRef}>
        {transcripts.length === 0 ? (
          <div className={styles.emptyState}>
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p>{`녹음을 시작하면 \n실시간 번역이 여기에 표시됩니다`}</p>
          </div>
        ) : (
          <div className={styles.translationList}>
            {filteredTranscripts.map((item, index) => (
              <div key={index} className={styles.translationCard}>
                {item.targetLanguage ? (
                  // New translation-text format
                  <div className={styles.translationCardContent}>
                    {item.isPartial && (
                      <div className={styles.translationBadge}>진행 중...</div>
                    )}

                    <div className={styles.translationTexts}>
                      {item.originalText && (
                        <>
                          <p className={styles.koreanTextLarge}>
                            {getDisplayText(item.originalText)}
                          </p>
                          <div className={styles.divider}></div>
                        </>
                      )}
                      <p
                        className={`${styles.englishTextLarge} ${
                          item.isPartial ? styles.partialText : ""
                        }`}
                      >
                        {getDisplayText(item.text || "")}
                        {item.isPartial && (
                          <span className={styles.partialIndicator}> ...</span>
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  // Old translation-batch format
                  <div className={styles.translationCardContent}>
                    <div className={styles.translationBadge}>번역</div>
                    <div className={styles.translationTexts}>
                      <p className={styles.koreanTextLarge}>
                        {getDisplayText(item.korean || "")}
                      </p>
                      <div className={styles.divider}></div>
                      <p className={styles.englishTextLarge}>
                        {getDisplayText(item.english || "")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
