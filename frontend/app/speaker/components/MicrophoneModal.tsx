"use client";

import styles from "../speaker.module.css";

export interface MicrophoneDevice {
  deviceId: string;
  label: string;
  isDefault: boolean;
  isExternal: boolean;
}

interface MicrophoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  micDevices: MicrophoneDevice[];
  selectedMicId: string;
  currentMicLabel: string;
  useExternalMicMode: boolean;
  onExternalMicModeChange: (enabled: boolean) => void;
  onMicSelect: (device: MicrophoneDevice) => void;
  onRefresh: () => void;
}

export default function MicrophoneModal({
  isOpen,
  onClose,
  micDevices,
  selectedMicId,
  currentMicLabel,
  useExternalMicMode,
  onExternalMicModeChange,
  onMicSelect,
  onRefresh,
}: MicrophoneModalProps) {
  if (!isOpen) return null;

  const handleExternalMicToggle = () => {
    onExternalMicModeChange(!useExternalMicMode);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleExternalMicToggle();
    }
  };

  return (
    <div
      className={styles.micModalOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mic-modal-title"
    >
      <div className={styles.micModal}>
        {/* Handle bar for mobile */}
        <div className={styles.micModalHandle}>
          <div className={styles.micModalHandleBar}></div>
        </div>

        <div className={styles.micModalHeader}>
          <div className={styles.micModalTitle}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <h3 id="mic-modal-title">마이크 선택</h3>
          </div>
          <button
            onClick={onClose}
            className={styles.micModalCloseButton}
            aria-label="마이크 선택 닫기"
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

        <div className={styles.micModalBody}>
          {/* Current Mic Info */}
          <div className={styles.currentMicInfo}>
            <div className={styles.currentMicIcon}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              </svg>
            </div>
            <div className={styles.currentMicDetails}>
              <div className={styles.currentMicLabel}>현재 선택</div>
              <div className={styles.currentMicName}>{currentMicLabel}</div>
            </div>
          </div>

          {/* External Mic Mode Toggle */}
          <div className={styles.externalMicModeSection}>
            <div
              className={styles.externalMicModeToggle}
              onClick={handleExternalMicToggle}
              role="switch"
              aria-checked={useExternalMicMode}
              aria-label="외부 마이크 모드"
              tabIndex={0}
              onKeyDown={handleKeyDown}
            >
              <div
                className={`${styles.toggleSwitch} ${
                  useExternalMicMode ? styles.active : ""
                }`}
              ></div>
              <div className={styles.externalMicModeInfo}>
                <div className={styles.externalMicModeLabel}>
                  외부 마이크 모드
                </div>
                <div className={styles.externalMicModeDesc}>
                  핀마이크/블루투스 사용 시 켜주세요. 에코 제거와 노이즈
                  억제를 비활성화하여 더 선명한 음질을 제공합니다.
                </div>
              </div>
            </div>
          </div>

          {/* Mic List */}
          <div className={styles.micListSection}>
            <div className={styles.micListLabel}>사용 가능한 마이크</div>
            <div className={styles.micList}>
              {micDevices.length === 0 ? (
                <div className={styles.emptyMicList}>
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                  <p>마이크를 찾을 수 없습니다</p>
                  <span>마이크 권한을 허용하거나 장치를 연결해주세요</span>
                </div>
              ) : (
                micDevices.map((device) => (
                  <button
                    key={device.deviceId}
                    className={`${styles.micItem} ${
                      selectedMicId === device.deviceId ? styles.selected : ""
                    } ${device.isExternal ? styles.external : ""}`}
                    onClick={() => onMicSelect(device)}
                  >
                    <div className={styles.micItemIcon}>
                      {device.isExternal ? (
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <circle cx="18" cy="5" r="3" />
                        </svg>
                      ) : (
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        </svg>
                      )}
                    </div>
                    <div className={styles.micItemInfo}>
                      <div className={styles.micItemName}>{device.label}</div>
                      <div className={styles.micItemBadges}>
                        {device.isDefault && (
                          <span className={`${styles.micBadge} ${styles.default}`}>
                            기본
                          </span>
                        )}
                        {device.isExternal && (
                          <span className={`${styles.micBadge} ${styles.external}`}>
                            외부
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.micItemCheck}>
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            className={styles.micRefreshButton}
            aria-label="마이크 목록 새로고침"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            마이크 목록 새로고침
          </button>
        </div>
      </div>
    </div>
  );
}
