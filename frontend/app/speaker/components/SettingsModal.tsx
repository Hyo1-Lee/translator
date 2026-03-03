"use client";

import { RoomSettings, SESSION_PRESETS, SOURCE_LANGUAGES, TARGET_LANGUAGES } from "../types";
import styles from "../speaker.module.css";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  roomSettings: RoomSettings;
  onSettingsChange: (settings: RoomSettings) => void;
  onSave: () => void;
  onCreate: () => void;
  showAdvancedSettings: boolean;
  onToggleAdvanced: () => void;
  saveAsDefault: boolean;
  onSaveAsDefaultChange: (value: boolean) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  roomId,
  roomSettings,
  onSettingsChange,
  onSave,
  onCreate,
  showAdvancedSettings,
  onToggleAdvanced,
  saveAsDefault,
  onSaveAsDefaultChange,
}: SettingsModalProps) {
  if (!isOpen) return null;

  const updateSettings = (partial: Partial<RoomSettings>) => {
    onSettingsChange({ ...roomSettings, ...partial });
  };

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 id="settings-modal-title">
            {roomId ? "세션 설정" : "새 세션 시작"}
          </h2>
          <button
            onClick={onClose}
            className={styles.closeModalButton}
            aria-label="설정 닫기"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.modalBody}>
          {/* Session Type - Preset Cards */}
          <div className={styles.settingGroup}>
            <label>세션 유형</label>
            <div className={styles.presetGrid}>
              {SESSION_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`${styles.presetCard} ${
                    roomSettings.sessionType === preset.value
                      ? styles.presetCardActive
                      : ""
                  }`}
                  onClick={() => updateSettings({ sessionType: preset.value })}
                >
                  <span className={styles.presetIcon}>{preset.icon}</span>
                  <span className={styles.presetLabel}>{preset.label}</span>
                  <span className={styles.presetDesc}>{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Source Language Setting */}
          <div className={styles.settingGroup}>
            <label>출발 언어</label>
            <select
              value={roomSettings.sourceLanguage}
              onChange={(e) =>
                updateSettings({ sourceLanguage: e.target.value })
              }
              className={styles.select}
            >
              {SOURCE_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          {/* Target Languages - Chip/Pill Selection */}
          <div className={styles.settingGroup}>
            <label>번역 언어 (다중 선택 가능)</label>
            <div className={styles.languageChipGrid}>
              {TARGET_LANGUAGES.filter(
                (lang) => lang.code !== roomSettings.sourceLanguage
              ).map((lang) => {
                const isSelected = roomSettings.targetLanguages.includes(lang.code);
                return (
                  <button
                    key={lang.code}
                    type="button"
                    className={`${styles.languageChip} ${isSelected ? styles.languageChipActive : ""}`}
                    onClick={() => {
                      const newLangs = isSelected
                        ? roomSettings.targetLanguages.filter((l) => l !== lang.code)
                        : [...roomSettings.targetLanguages, lang.code];
                      updateSettings({ targetLanguages: newLangs });
                    }}
                  >
                    {lang.name}
                  </button>
                );
              })}
            </div>
            {roomSettings.targetLanguages.length === 0 && (
              <p className={styles.settingHint}>
                최소 1개 이상의 번역 언어를 선택해주세요.
              </p>
            )}
          </div>

          {/* Custom Environment Description */}
          <div className={styles.settingGroup}>
            <label>상황 설명 (선택)</label>
            <textarea
              value={roomSettings.customEnvironmentDescription || ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val.length <= 200) {
                  updateSettings({ customEnvironmentDescription: val });
                }
              }}
              className={styles.textarea}
              placeholder={
                roomSettings.sessionType === "church"
                  ? "예: 주일 예배 설교. 성경 말씀 중심. 구주, 성역, 구속, 성전 등의 용어가 자주 나옴"
                  : roomSettings.sessionType === "lecture"
                  ? "예: 대학 운영체제 강의. 프로세스, 스레드, 커널 등 CS 용어가 자주 나옴"
                  : roomSettings.sessionType === "meeting"
                  ? "예: 분기 마케팅 전략 회의. ROI, KPI, 전환율 등의 용어가 자주 나옴"
                  : "예: 어떤 상황인지, 어떤 내용이 나올지, 자주 쓰이는 용어 등"
              }
              rows={2}
            />
            <p className={styles.settingHint}>
              구체적인 상황/맥락, 예상되는 내용, 자주 나올 용어 등을 적으면 번역 정확도가 높아집니다.
              <span style={{ float: "right" }}>
                {(roomSettings.customEnvironmentDescription || "").length}/200
              </span>
            </p>
          </div>

          {/* Session Name (Optional) */}
          <div className={styles.settingGroup}>
            <label>세션 이름 (선택)</label>
            <input
              type="text"
              value={roomSettings.roomTitle}
              onChange={(e) => updateSettings({ roomTitle: e.target.value })}
              className={styles.input}
              placeholder="예: 주일 예배, 월례 회의"
            />
          </div>

          {/* Save as Default Checkbox (only for new rooms) */}
          {!roomId && (
            <div className={styles.checkboxRow}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={saveAsDefault}
                  onChange={(e) => onSaveAsDefaultChange(e.target.checked)}
                />
                <span>다음에도 이 설정 사용</span>
              </label>
            </div>
          )}

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            className={styles.advancedToggle}
            onClick={onToggleAdvanced}
          >
            <span>{showAdvancedSettings ? "▼" : "▶"} 고급 설정</span>
          </button>

          {/* Advanced Settings (Collapsed by default) */}
          {showAdvancedSettings && (
            <div className={styles.advancedSettings}>
              <div className={styles.advancedRow}>
                <div className={styles.checkboxRow}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={roomSettings.enableStreaming}
                      onChange={(e) =>
                        updateSettings({ enableStreaming: e.target.checked })
                      }
                    />
                    <span>스트리밍 번역</span>
                  </label>
                </div>

                <div className={styles.compactInputGroup}>
                  <label>최대 청취자</label>
                  <input
                    type="number"
                    value={roomSettings.maxListeners}
                    onChange={(e) =>
                      updateSettings({
                        maxListeners: parseInt(e.target.value) || 100,
                      })
                    }
                    className={styles.compactInput}
                    min="1"
                    max="1000"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className={styles.modalActions}>
            <button onClick={onClose} className={styles.cancelButton}>
              {roomId ? "닫기" : "취소"}
            </button>
            <button
              onClick={roomId ? onSave : onCreate}
              className={roomId ? styles.createButton : styles.ctaButton}
            >
              {roomId ? "설정 저장" : "시작하기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
