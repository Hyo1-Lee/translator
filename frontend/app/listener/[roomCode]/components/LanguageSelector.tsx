"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import styles from "./LanguageSelector.module.css";

interface LanguageSelectorProps {
  selectedLanguage: string;
  availableLanguages: string[];
  languageMap: Record<string, string>;
  onLanguageChange: (lang: string) => void;
}

// 언어별 국기 이모지 매핑
const FLAG_MAP: Record<string, string> = {
  en: "🇺🇸",
  ja: "🇯🇵",
  zh: "🇨🇳",
  "zh-TW": "🇹🇼",
  es: "🇪🇸",
  fr: "🇫🇷",
  de: "🇩🇪",
  ru: "🇷🇺",
  ar: "🇸🇦",
  pt: "🇧🇷",
  vi: "🇻🇳",
  th: "🇹🇭",
  id: "🇮🇩",
  hi: "🇮🇳",
  ur: "🇵🇰",
};

export default function LanguageSelector({
  selectedLanguage,
  availableLanguages,
  languageMap,
  onLanguageChange,
}: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 클라이언트 마운트 확인 (Portal용)
  useEffect(() => {
    setMounted(true);
  }, []);

  // 열릴 때 body 스크롤 막기
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  const handleSelect = (lang: string) => {
    onLanguageChange(lang);
    setIsOpen(false);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const currentFlag = FLAG_MAP[selectedLanguage] || "🌐";
  const currentName = languageMap[selectedLanguage] || selectedLanguage;

  const dropdownContent = isOpen && (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.dropdown} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dropdownHeader}>
          <div className={styles.handle} />
          <span className={styles.dropdownTitle}>번역 언어 선택</span>
        </div>
        <div className={styles.languageList}>
          {availableLanguages.map((lang) => (
            <button
              key={lang}
              onClick={() => handleSelect(lang)}
              className={`${styles.languageItem} ${
                lang === selectedLanguage ? styles.selected : ""
              }`}
            >
              <span className={styles.itemFlag}>{FLAG_MAP[lang] || "🌐"}</span>
              <span className={styles.itemName}>{languageMap[lang] || lang}</span>
              {lang === selectedLanguage && (
                <svg
                  className={styles.checkIcon}
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className={styles.container}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`${styles.trigger} ${isOpen ? styles.active : ""}`}
        aria-label="언어 선택"
        aria-expanded={isOpen}
      >
        <span className={styles.flag}>{currentFlag}</span>
        <span className={styles.langName}>{currentName}</span>
        <svg
          className={`${styles.chevron} ${isOpen ? styles.rotated : ""}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {mounted && createPortal(dropdownContent, document.body)}
    </div>
  );
}
