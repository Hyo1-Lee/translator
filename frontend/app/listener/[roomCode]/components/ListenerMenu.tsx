"use client";

import { useI18n } from "@/contexts/I18nContext";
import styles from "../listener.module.css";

interface ListenerMenuProps {
  isOpen: boolean;
  fontSize: string;
  autoScroll: boolean;
  showSaveButton: boolean;
  hasTrans: boolean;
  onFontSizeChange: (size: string) => void;
  onAutoScrollChange: (enabled: boolean) => void;
  onExport: () => void;
  onSave: () => void;
}

export default function ListenerMenu({
  isOpen,
  fontSize,
  autoScroll,
  showSaveButton,
  hasTrans,
  onFontSizeChange,
  onAutoScrollChange,
  onExport,
  onSave,
}: ListenerMenuProps) {
  const { t } = useI18n();

  if (!isOpen) return null;

  return (
    <div className={styles.dropdownMenu}>
      {/* Font Size */}
      <div className={styles.menuSection}>
        <div className={styles.menuLabel}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 7V4h16v3M9 20h6M12 4v16" />
          </svg>
          {t("listener.fontSize")}
        </div>
        <div className={styles.fontSizeButtons}>
          <button
            onClick={() => onFontSizeChange("small")}
            className={`${styles.fontSizeBtn} ${fontSize === "small" ? styles.active : ""}`}
          >
            {t("listener.fontSmall")}
          </button>
          <button
            onClick={() => onFontSizeChange("medium")}
            className={`${styles.fontSizeBtn} ${fontSize === "medium" ? styles.active : ""}`}
          >
            {t("listener.fontMedium")}
          </button>
          <button
            onClick={() => onFontSizeChange("large")}
            className={`${styles.fontSizeBtn} ${fontSize === "large" ? styles.active : ""}`}
          >
            {t("listener.fontLarge")}
          </button>
        </div>
      </div>

      <div className={styles.menuDivider} />

      {/* Auto Scroll Toggle */}
      <label className={styles.menuToggle}>
        <span>{t("listener.autoScroll")}</span>
        <input
          type="checkbox"
          checked={autoScroll}
          onChange={() => onAutoScrollChange(!autoScroll)}
        />
        <span className={styles.toggleSwitch} />
      </label>

      <div className={styles.menuDivider} />

      {/* Action Buttons */}
      <button onClick={onExport} className={styles.menuAction}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {t("common.export")}
      </button>

      {showSaveButton && (
        <button onClick={onSave} className={styles.menuAction} disabled={!hasTrans}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          {t("common.save")}
        </button>
      )}
    </div>
  );
}
