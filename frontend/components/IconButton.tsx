"use client";

import { ReactNode, ButtonHTMLAttributes } from "react";
import styles from "./IconButton.module.css";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  active?: boolean;
  variant?: "default" | "primary" | "danger";
  size?: "small" | "medium" | "large";
  ariaLabel: string;
}

/**
 * Reusable icon button component used throughout the app.
 */
export default function IconButton({
  icon,
  active = false,
  variant = "default",
  size = "medium",
  ariaLabel,
  className,
  ...props
}: IconButtonProps) {
  const buttonClasses = [
    styles.iconButton,
    styles[variant],
    styles[size],
    active ? styles.active : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={buttonClasses} aria-label={ariaLabel} {...props}>
      {icon}
    </button>
  );
}
