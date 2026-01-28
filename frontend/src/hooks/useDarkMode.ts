/**
 * Dark mode detection hook and color utilities
 */

import { useState, useEffect } from "react";

export function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return isDark;
}

export interface ThemeColors {
  // Backgrounds
  panelBg: string;
  panelHeaderBg: string;
  cardBg: string;
  cardHoverBg: string;
  overlayBg: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // Borders
  border: string;
  borderLight: string;

  // Interactive
  buttonBg: string;
  buttonHoverBg: string;
  buttonText: string;
  buttonActiveBg: string;
  buttonActiveText: string;

  // Status colors
  success: string;
  successBg: string;
  error: string;
  errorBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;

  // Accents
  primary: string;
  primaryHover: string;
}

export function useThemeColors(): ThemeColors {
  const isDark = useDarkMode();

  if (isDark) {
    return {
      // Backgrounds
      panelBg: "#1f2937",
      panelHeaderBg: "#111827",
      cardBg: "#374151",
      cardHoverBg: "#4b5563",
      overlayBg: "rgba(0, 0, 0, 0.6)",

      // Text
      textPrimary: "#f9fafb",
      textSecondary: "#e5e7eb",
      textMuted: "#9ca3af",

      // Borders
      border: "#4b5563",
      borderLight: "#374151",

      // Interactive
      buttonBg: "#374151",
      buttonHoverBg: "#4b5563",
      buttonText: "#f9fafb",
      buttonActiveBg: "#3b82f6",
      buttonActiveText: "#ffffff",

      // Status colors
      success: "#10b981",
      successBg: "#064e3b",
      error: "#ef4444",
      errorBg: "#7f1d1d",
      warning: "#f59e0b",
      warningBg: "#78350f",
      info: "#3b82f6",
      infoBg: "#1e3a5f",

      // Accents
      primary: "#3b82f6",
      primaryHover: "#2563eb",
    };
  }

  return {
    // Backgrounds
    panelBg: "#ffffff",
    panelHeaderBg: "#f9fafb",
    cardBg: "#ffffff",
    cardHoverBg: "#f3f4f6",
    overlayBg: "rgba(0, 0, 0, 0.3)",

    // Text
    textPrimary: "#111827",
    textSecondary: "#374151",
    textMuted: "#6b7280",

    // Borders
    border: "#e5e7eb",
    borderLight: "#f3f4f6",

    // Interactive
    buttonBg: "#ffffff",
    buttonHoverBg: "#f3f4f6",
    buttonText: "#374151",
    buttonActiveBg: "#3b82f6",
    buttonActiveText: "#ffffff",

    // Status colors
    success: "#10b981",
    successBg: "#d1fae5",
    error: "#ef4444",
    errorBg: "#fee2e2",
    warning: "#f59e0b",
    warningBg: "#fef3c7",
    info: "#3b82f6",
    infoBg: "#dbeafe",

    // Accents
    primary: "#3b82f6",
    primaryHover: "#2563eb",
  };
}
