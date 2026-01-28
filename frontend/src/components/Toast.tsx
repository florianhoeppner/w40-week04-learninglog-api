/**
 * Toast Notification System
 * Provides app-wide toast notifications for user feedback
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";

// ===========================
// Types
// ===========================

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: ToastAction;
  details?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  showSuccess: (message: string, action?: ToastAction) => void;
  showError: (message: string, details?: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
  dismissToast: (id: string) => void;
}

// ===========================
// Error Message Mapping
// ===========================

export const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: "Unable to connect. Please check your internet connection.",
  TIMEOUT_ERROR: "Request took too long. Please try again.",
  NOT_FOUND: "The item you requested could not be found.",
  SERVER_ERROR: "Something went wrong on our end. Please try again later.",
  CIRCUIT_BREAKER_OPEN: "Service temporarily unavailable. Please wait a moment.",
  VALIDATION_ERROR: "Please check your input and try again.",
};

// ===========================
// Context
// ===========================

const ToastContext = createContext<ToastContextValue | null>(null);

// ===========================
// Toast Item Component
// ===========================

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const typeStyles: Record<ToastType, React.CSSProperties> = {
    success: {
      backgroundColor: "#dcfce7",
      borderColor: "#22c55e",
      color: "#166534",
    },
    error: {
      backgroundColor: "#fef2f2",
      borderColor: "#ef4444",
      color: "#dc2626",
    },
    warning: {
      backgroundColor: "#fef9c3",
      borderColor: "#eab308",
      color: "#854d0e",
    },
    info: {
      backgroundColor: "#dbeafe",
      borderColor: "#3b82f6",
      color: "#1e40af",
    },
  };

  const icons: Record<ToastType, string> = {
    success: "\u2713", // checkmark
    error: "\u2717", // x mark
    warning: "\u26A0", // warning triangle
    info: "\u2139", // info
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        ...typeStyles[toast.type],
        padding: "12px 16px",
        borderRadius: "8px",
        borderLeft: `4px solid ${typeStyles[toast.type].borderColor}`,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        maxWidth: "400px",
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <span style={{ fontSize: "16px", flexShrink: 0 }}>{icons[toast.type]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 500 }}>{toast.message}</p>
        {toast.details && (
          <p style={{ margin: "4px 0 0", fontSize: "13px", opacity: 0.8 }}>
            {toast.details}
          </p>
        )}
        {toast.action && (
          <button
            onClick={() => {
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
            style={{
              marginTop: "8px",
              padding: "4px 8px",
              fontSize: "13px",
              fontWeight: 500,
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              backgroundColor: "rgba(0, 0, 0, 0.1)",
              color: "inherit",
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "18px",
          opacity: 0.5,
          padding: "0 4px",
          color: "inherit",
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ===========================
// Toast Container Component
// ===========================

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <style>
        {`
          @keyframes slideIn {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
        `}
      </style>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// ===========================
// Toast Provider
// ===========================

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (
      message: string,
      type: ToastType,
      options: { duration?: number; action?: ToastAction; details?: string } = {}
    ) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const toast: Toast = {
        id,
        message,
        type,
        duration: options.duration || (type === "error" ? 6000 : 4000),
        action: options.action,
        details: options.details,
      };
      setToasts((prev) => [...prev, toast]);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showSuccess = useCallback(
    (message: string, action?: ToastAction) => {
      addToast(message, "success", { action });
    },
    [addToast]
  );

  const showError = useCallback(
    (message: string, details?: string) => {
      addToast(message, "error", { details });
    },
    [addToast]
  );

  const showWarning = useCallback(
    (message: string) => {
      addToast(message, "warning");
    },
    [addToast]
  );

  const showInfo = useCallback(
    (message: string) => {
      addToast(message, "info");
    },
    [addToast]
  );

  return (
    <ToastContext.Provider
      value={{ toasts, showSuccess, showError, showWarning, showInfo, dismissToast }}
    >
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

// ===========================
// Hook
// ===========================

export function useToast(): Omit<ToastContextValue, "toasts"> {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  const { showSuccess, showError, showWarning, showInfo, dismissToast } = context;
  return { showSuccess, showError, showWarning, showInfo, dismissToast };
}
