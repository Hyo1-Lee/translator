"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/contexts/I18nContext";
import styles from "../listener.module.css";

interface PasswordModalProps {
  roomCode: string;
  onSubmit: (password: string) => void;
  error?: string;
}

export default function PasswordModal({
  roomCode,
  onSubmit,
  error: externalError,
}: PasswordModalProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(externalError || "");

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!password.trim()) {
      setPasswordError("비밀번호를 입력해주세요.");
      return;
    }
    setPasswordError("");
    onSubmit(password);
  };

  return (
    <main className={styles.main}>
      <div className={styles.modalOverlay} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
          <h2>🔒 {t("listener.passwordRequired")}</h2>
          <p>{t("listener.passwordRequiredDesc")}</p>
          <div className={styles.roomCodeBadge}>
            {t("listener.room")}: <strong>{roomCode}</strong>
          </div>
          <form onSubmit={handleSubmit}>
            <input
              type="password"
              placeholder={t("listener.passwordPlaceholder")}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              className={styles.input}
              autoFocus
            />
            {(passwordError || externalError) && (
              <p className={styles.error}>{passwordError || externalError}</p>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => router.push("/")}
                className={styles.cancelBtn}
              >
                {t("common.cancel")}
              </button>
              <button type="submit" className={styles.submitBtn}>
                {t("listener.enter")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
