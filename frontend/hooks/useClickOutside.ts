"use client";

import { useEffect, RefObject } from "react";

/**
 * Hook that triggers a handler when clicking outside the specified element.
 *
 * @param ref - Reference to the element to watch
 * @param handler - Function to call when clicking outside
 * @param enabled - Whether the hook is active (useful for conditional behavior)
 */
export function useClickOutside(
  ref: RefObject<HTMLElement>,
  handler: () => void,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current && !ref.current.contains(target)) {
        handler();
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [ref, handler, enabled]);
}

export default useClickOutside;
