"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import styles from "./Header.module.css";

export default function Header() {
  const { user, logout } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push("/");
    setShowUserMenu(false);
  };

  // Don't show header on login page
  if (pathname === "/login") {
    return null;
  }

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        {/* Logo */}
        <Link href="/" className={styles.logo}>
          <div className={styles.logoIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"
                fill="url(#gradient)"
                opacity="0.2"
              />
              <path
                d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"
                stroke="url(#gradient)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" fill="url(#gradient)" />
              <defs>
                <linearGradient id="gradient" x1="2" y1="2" x2="22" y2="22">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className={styles.brandName}>ECHO</span>
        </Link>

        {/* Language Switcher */}
        <div className={styles.langSwitcher}>
          <button
            onClick={() => setLocale(locale === "ko" ? "en" : "ko")}
            className={styles.langButton}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            {locale === "ko" ? "한국어" : "English"}
          </button>
        </div>

        {/* User Menu */}
        <div className={styles.userSection}>
          {user ? (
            <div className={styles.userMenu}>
              <button
                className={styles.userButton}
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <div className={styles.avatar}>
                  {user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                </div>
                <span className={styles.userName}>
                  {user.name || user.email}
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={
                    showUserMenu ? styles.chevronUp : styles.chevronDown
                  }
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {showUserMenu && (
                <>
                  <div
                    className={styles.backdrop}
                    onClick={() => setShowUserMenu(false)}
                  />
                  <div className={styles.dropdown}>
                    <div className={styles.dropdownHeader}>
                      <div className={styles.userEmail}>{user.email}</div>
                    </div>
                    <div className={styles.dropdownDivider} />
                    <Link
                      href="/dashboard"
                      className={styles.dropdownItem}
                      onClick={() => setShowUserMenu(false)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                      </svg>
                      {t("common.dashboard")}
                    </Link>
                    <div className={styles.dropdownDivider} />
                    <button
                      className={styles.dropdownItem}
                      onClick={handleLogout}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      {t("common.logout")}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className={styles.authButtons}>
              <Link href="/login" className={styles.loginButton}>
                {t("common.login")}
              </Link>
              <Link href="/login" className={styles.signupButton}>
                {t("login.signUp")}
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
