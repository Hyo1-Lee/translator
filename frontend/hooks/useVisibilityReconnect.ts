"use client";

import { useEffect, useRef } from "react";

interface UseVisibilityReconnectOptions {
  onVisible: () => void;
  onHidden?: () => void;
}

/**
 * Hook that handles page visibility changes for socket reconnection.
 * Triggers reconnection when the page becomes visible again (e.g., tab switch).
 *
 * @param options - Callbacks for visibility changes
 */
export function useVisibilityReconnect(options: UseVisibilityReconnectOptions): void {
  const { onVisible, onHidden } = options;
  const onVisibleRef = useRef(onVisible);
  const onHiddenRef = useRef(onHidden);

  // Keep refs updated with latest callbacks
  useEffect(() => {
    onVisibleRef.current = onVisible;
    onHiddenRef.current = onHidden;
  }, [onVisible, onHidden]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        onVisibleRef.current();
      } else if (document.visibilityState === "hidden" && onHiddenRef.current) {
        onHiddenRef.current();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);
}

export default useVisibilityReconnect;
