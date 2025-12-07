'use client';

import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import Toast from '@/components/Toast';

interface ToastOptions {
  duration?: number;  // 토스트 표시 시간 (ms)
}

interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info', options?: ToastOptions) => void;
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info', options?: ToastOptions) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type, duration: options?.duration }]);
  }, []);

  const success = useCallback((message: string, options?: ToastOptions) => showToast(message, 'success', options), [showToast]);
  const error = useCallback((message: string, options?: ToastOptions) => showToast(message, 'error', options), [showToast]);
  const info = useCallback((message: string, options?: ToastOptions) => showToast(message, 'info', options), [showToast]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info }}>
      {children}
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
