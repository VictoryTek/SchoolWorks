/**
 * Reports an element's real rendered width via ResizeObserver.
 * Uses useLayoutEffect so the first measurement lands before paint.
 */
import { useCallback, useLayoutEffect, useState } from 'react';

export function useContainerWidth(): [(node: HTMLElement | null) => void, number] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const ref = useCallback((next: HTMLElement | null) => setNode(next), []);

  useLayoutEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [ref, width];
}
