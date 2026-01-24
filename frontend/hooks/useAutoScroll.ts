"use client";

import { useRef, useEffect, useCallback } from "react";

interface UseAutoScrollOptions {
  threshold?: number; // Distance from bottom to consider "near bottom"
}

interface UseAutoScrollReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  endRef: React.RefObject<HTMLDivElement>;
  handleScroll: () => void;
  isNearBottom: boolean;
}

/**
 * Hook for handling auto-scroll behavior in transcript/translation lists.
 * Scrolls to bottom when new content arrives, but only if user is already near bottom.
 *
 * @param enabled - Whether auto-scroll is enabled
 * @param deps - Dependencies that trigger scroll (e.g., transcripts array)
 * @param options - Configuration options
 */
export function useAutoScroll(
  enabled: boolean,
  deps: unknown[] = [],
  options: UseAutoScrollOptions = {}
): UseAutoScrollReturn {
  const { threshold = 5 } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // Track if user is near bottom of scroll container
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    isNearBottomRef.current = nearBottom;
  }, [threshold]);

  // Auto-scroll to bottom when deps change and conditions are met
  useEffect(() => {
    if (enabled && isNearBottomRef.current && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  // Add scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  return {
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    endRef: endRef as React.RefObject<HTMLDivElement>,
    handleScroll,
    isNearBottom: isNearBottomRef.current,
  };
}

export default useAutoScroll;
