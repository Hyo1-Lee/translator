"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import Header from "@/components/Header";
import styles from "./dashboard.module.css";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

interface Room {
  id: string;
  roomCode: string;
  speakerName: string;
  status: string;
  createdAt: string;
  endedAt: string | null;
  roomSettings: {
    roomTitle?: string;
    targetLanguages: string;
    promptTemplate: string;
  } | null;
  _count?: {
    listeners: number;
    transcripts: number;
  };
}

interface SavedTranscript {
  id: string;
  roomCode: string;
  roomName: string | null;
  createdAt: string;
}

export default function Dashboard() {
  const { user, accessToken, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useI18n();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [savedTranscripts, setSavedTranscripts] = useState<SavedTranscript[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"rooms" | "transcripts">("rooms");

  const fetchDashboardData = useCallback(async () => {
    try {
      setIsLoading(true);

      const [roomsRes, statsRes, transcriptsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/v1/dashboard/rooms`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
        fetch(`${BACKEND_URL}/api/v1/dashboard/stats`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
        fetch(`${BACKEND_URL}/api/v1/dashboard/transcripts`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      ]);

      if (roomsRes.ok) {
        const data = await roomsRes.json();
        if (data.success) {
          setRooms(data.data);
        }
      }

      // Stats endpoint available but not used in UI yet
      if (statsRes.ok) {
        const data = await statsRes.json();
        // Future: Display stats in dashboard
        console.log("Dashboard stats:", data.data);
      }

      if (transcriptsRes.ok) {
        const data = await transcriptsRes.json();
        if (data.success) {
          setSavedTranscripts(data.data);
        }
      }
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user && accessToken) {
      fetchDashboardData();
    }
  }, [user, accessToken, fetchDashboardData]);

  const deleteRoom = async (roomId: string) => {
    if (
      !confirm(
        t("dashboard.confirmDelete") ||
          "Are you sure you want to delete this room?"
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/v1/dashboard/rooms/${roomId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        setRooms(rooms.filter((room) => room.id !== roomId));
        // Refresh stats
        fetchDashboardData();
      }
    } catch (error) {
      console.error("Failed to delete room:", error);
      alert("Failed to delete room");
    }
  };

  const saveSession = async (roomId: string, roomName: string) => {
    const customName = prompt("세션 이름을 입력하세요 (선택사항):", roomName);

    // User cancelled
    if (customName === null) return;

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/v1/dashboard/sessions/save`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            roomId,
            roomName: customName || roomName,
          }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        alert(data.message || "세션이 저장되었습니다!");
        // Refresh saved transcripts list
        fetchDashboardData();
      } else {
        alert(data.message || "세션 저장에 실패했습니다.");
      }
    } catch (error) {
      console.error("Failed to save session:", error);
      alert("세션 저장에 실패했습니다.");
    }
  };

  const downloadTranscript = async (transcriptId: string, roomName: string) => {
    try {
      // Fetch transcript details
      const response = await fetch(
        `${BACKEND_URL}/api/v1/dashboard/transcripts/${transcriptId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch transcript");
      }

      const data = await response.json();
      const transcriptsData = data.data.transcriptsData || [];

      // Format transcript content
      let content = `${roomName}\n`;
      content += `Room Code: ${data.data.roomCode}\n`;
      content += `Saved at: ${formatDate(data.data.createdAt)}\n`;
      content += `Total Transcripts: ${transcriptsData.length}\n`;
      content += "=".repeat(80) + "\n\n";

      transcriptsData.forEach(
        (
          item: {
            timestamp: string;
            korean: string;
            english: string;
            translations?: Record<string, string>;
          },
          index: number
        ) => {
          const timestamp = new Date(item.timestamp).toLocaleString("ko-KR");
          content += `[${index + 1}] ${timestamp}\n`;
          content += `KR: ${item.korean}\n`;
          content += `EN: ${item.english}\n`;

          // Add other translations if available
          if (item.translations && typeof item.translations === "object") {
            Object.entries(item.translations).forEach(([lang, text]) => {
              if (lang !== "en" && text) {
                content += `${lang.toUpperCase()}: ${text}\n`;
              }
            });
          }
          content += "\n";
        }
      );

      // Create and download file
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${roomName.replace(/[^a-zA-Z0-9가-힣]/g, "_")}_${
        data.data.roomCode
      }.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download transcript:", error);
      alert("다운로드에 실패했습니다.");
    }
  };

  const deleteTranscript = async (transcriptId: string) => {
    if (
      !confirm(
        t("dashboard.confirmDeleteTranscript") ||
          "Are you sure you want to delete this transcript?"
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/v1/dashboard/transcripts/${transcriptId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        setSavedTranscripts(
          savedTranscripts.filter((t) => t.id !== transcriptId)
        );
      }
    } catch (error) {
      console.error("Failed to delete transcript:", error);
      alert("Failed to delete transcript");
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return styles.statusActive;
      case "PAUSED":
        return styles.statusPaused;
      case "ENDED":
        return styles.statusEnded;
      default:
        return "";
    }
  };

  if (authLoading || !user) {
    return (
      <>
        <Header />
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>{t("common.loading")}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className={styles.main}>
        <div className={styles.container}>
          {/* Header */}
          <div className={styles.header}>
            <div>
              <h1 className={styles.title}>{t("dashboard.title")}</h1>
              <p className={styles.subtitle}>{t("dashboard.subtitle")}</p>
            </div>
            <button
              onClick={() => router.push("/speaker?forceNew=true")}
              className={styles.createButton}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t("dashboard.createRoom")}
            </button>
          </div>

          {/* Tabs */}
          <div className={styles.tabs}>
            <button
              className={activeTab === "rooms" ? styles.tabActive : styles.tab}
              onClick={() => setActiveTab("rooms")}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
              {t("dashboard.sessions")} ({rooms.length})
            </button>
            <button
              className={
                activeTab === "transcripts" ? styles.tabActive : styles.tab
              }
              onClick={() => setActiveTab("transcripts")}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              {t("dashboard.savedTranscripts")} ({savedTranscripts.length})
            </button>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className={styles.loadingContent}>
              <div className={styles.spinner}></div>
            </div>
          ) : (
            <>
              {/* Rooms Tab */}
              {activeTab === "rooms" && (
                <div className={styles.content}>
                  {rooms.length === 0 ? (
                    <div className={styles.empty}>
                      <svg
                        width="64"
                        height="64"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      </svg>
                      <h3>{t("dashboard.noRooms")}</h3>
                      <p>{t("dashboard.noRoomsDesc")}</p>
                      <button
                        onClick={() => router.push("/speaker?forceNew=true")}
                        className={styles.emptyButton}
                      >
                        {t("dashboard.createRoom")}
                      </button>
                    </div>
                  ) : (
                    <div className={styles.roomsGrid}>
                      {rooms.map((room) => (
                        <div key={room.id} className={styles.roomCard}>
                          <div className={styles.roomHeader}>
                            <div className={styles.roomCode}>
                              {room.roomCode}
                            </div>
                            <div
                              className={`${styles.status} ${getStatusColor(
                                room.status
                              )}`}
                            >
                              <span className={styles.statusDot}></span>
                              {room.status}
                            </div>
                          </div>

                          <div className={styles.roomBody}>
                            <h3 className={styles.roomTitle}>
                              {room.roomSettings?.roomTitle || room.speakerName}
                            </h3>
                            {room.roomSettings?.roomTitle && (
                              <p className={styles.roomSpeaker}>
                                Speaker: {room.speakerName}
                              </p>
                            )}
                            <div className={styles.roomMeta}>
                              <span className={styles.metaItem}>
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <circle cx="12" cy="12" r="10" />
                                  <polyline points="12 6 12 12 16 14" />
                                </svg>
                                {formatDate(room.createdAt)}
                              </span>
                            </div>
                          </div>

                          <div className={styles.roomActions}>
                            <button
                              onClick={() =>
                                router.push(`/speaker?room=${room.roomCode}`)
                              }
                              className={
                                room.status === "ENDED"
                                  ? styles.actionButton
                                  : styles.actionButtonPrimary
                              }
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                {room.status === "ENDED" ? (
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                                ) : (
                                  <>
                                    <circle cx="12" cy="12" r="10" />
                                    <polygon points="10 8 16 12 10 16 10 8" />
                                  </>
                                )}
                              </svg>
                              {room.status === "ENDED"
                                ? "기록 보기"
                                : room.status === "ACTIVE"
                                ? t("dashboard.resume")
                                : "재입장"}
                            </button>
                            {(room._count?.transcripts ?? 0) > 0 && (
                              <button
                                onClick={() =>
                                  saveSession(room.id, room.speakerName)
                                }
                                className={styles.actionButton}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                                  <polyline points="17 21 17 13 7 13 7 21" />
                                  <polyline points="7 3 7 8 15 8" />
                                </svg>
                                저장
                              </button>
                            )}
                            <button
                              onClick={() => deleteRoom(room.id)}
                              className={styles.actionButtonDanger}
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                              {t("common.delete")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Transcripts Tab */}
              {activeTab === "transcripts" && (
                <div className={styles.content}>
                  {savedTranscripts.length === 0 ? (
                    <div className={styles.empty}>
                      <svg
                        width="64"
                        height="64"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <h3>{t("dashboard.noTranscripts")}</h3>
                      <p>{t("dashboard.noTranscriptsDesc")}</p>
                    </div>
                  ) : (
                    <div className={styles.transcriptsList}>
                      {savedTranscripts.map((transcript) => (
                        <div
                          key={transcript.id}
                          className={styles.transcriptCard}
                        >
                          <div className={styles.transcriptIcon}>
                            <svg
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="16" y1="13" x2="8" y2="13" />
                              <line x1="16" y1="17" x2="8" y2="17" />
                            </svg>
                          </div>
                          <div className={styles.transcriptContent}>
                            <h3 className={styles.transcriptTitle}>
                              {transcript.roomName ||
                                `Room ${transcript.roomCode}`}
                            </h3>
                            <div className={styles.transcriptMeta}>
                              <span>Code: {transcript.roomCode}</span>
                              <span>•</span>
                              <span>{formatDate(transcript.createdAt)}</span>
                            </div>
                          </div>
                          <div className={styles.transcriptActions}>
                            <button
                              onClick={() =>
                                downloadTranscript(
                                  transcript.id,
                                  transcript.roomName ||
                                    `Room ${transcript.roomCode}`
                                )
                              }
                              className={styles.actionButton}
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              {t("dashboard.download")}
                            </button>
                            <button
                              onClick={() => deleteTranscript(transcript.id)}
                              className={styles.actionButtonDanger}
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
