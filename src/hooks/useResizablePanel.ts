import { useCallback, useEffect, useRef, useState } from "react";

interface UseResizablePanelOptions {
  /** localStorage key used to persist the chosen width. */
  storageKey: string;
  /** Initial width in px when nothing is persisted. */
  defaultWidth: number;
  /** Minimum width in px. */
  min: number;
  /** Maximum width in px. */
  max: number;
  /**
   * Which edge the drag handle lives on relative to the panel.
   * "left" (default) means the panel sits on the right of the handle, so
   * dragging the handle left widens the panel.
   */
  side?: "left" | "right";
}

/**
 * Drag-to-resize width for a side panel. Persists to localStorage and clamps
 * to [min, max]. Returns props to spread onto the drag handle element; the
 * handle uses pointer capture so dragging keeps working outside its bounds.
 */
export function useResizablePanel({
  storageKey,
  defaultWidth,
  min,
  max,
  side = "left",
}: UseResizablePanelOptions) {
  const clamp = useCallback((w: number) => Math.min(max, Math.max(min, w)), [min, max]);

  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth;
    const saved = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? Math.min(max, Math.max(min, saved)) : defaultWidth;
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ startX: 0, startWidth: 0 });

  // Re-clamp when the allowed range shifts (e.g. window resized smaller).
  useEffect(() => {
    setWidth((w) => clamp(w));
  }, [clamp]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startWidth: width };
      setDragging(true);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Only react while this handle holds the pointer (i.e. between down and up).
      if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
      const delta = e.clientX - drag.current.startX;
      const next = side === "left" ? drag.current.startWidth - delta : drag.current.startWidth + delta;
      setWidth(clamp(next));
    },
    [side, clamp],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      setDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      setWidth((w) => {
        window.localStorage.setItem(storageKey, String(w));
        return w;
      });
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    setWidth(clamp(defaultWidth));
    window.localStorage.setItem(storageKey, String(clamp(defaultWidth)));
  }, [clamp, defaultWidth, storageKey]);

  return {
    width,
    dragging,
    reset,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
