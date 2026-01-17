"use client";

import { FRONTEND_URL } from "../types";
import styles from "../speaker.module.css";

interface QRModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  roomTitle: string;
  qrCodeUrl: string;
}

export default function QRModal({
  isOpen,
  onClose,
  roomId,
  roomTitle,
  qrCodeUrl,
}: QRModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className={styles.qrModalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div className={styles.qrModalContent}>
        <button
          onClick={onClose}
          className={styles.closeButton}
          aria-label="QR 코드 닫기"
        >
          ✕
        </button>
        <div className={styles.qrFullscreen}>
          <h1 id="qr-modal-title">{roomTitle || "번역 세션"}</h1>
          <p className={styles.roomCodeLarge}>{roomId}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCodeUrl} alt="Room QR Code" />
          <p className={styles.instruction}>
            QR 코드를 스캔하여 세션에 참여하세요
          </p>
          <p className={styles.urlText}>{`${FRONTEND_URL}/listener/${roomId}`}</p>
        </div>
      </div>
    </div>
  );
}
