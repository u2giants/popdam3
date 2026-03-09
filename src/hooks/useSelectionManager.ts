import { useState, useCallback, useRef } from "react";

/**
 * Generic multi-select manager with Shift-click range selection
 * and Cmd/Ctrl-click toggle support.
 */
export function useSelectionManager(items: Array<{ id: string }>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIndex = useRef<number | null>(null);

  const handleSelect = useCallback(
    (id: string, event: React.MouseEvent, onSingleClick?: (id: string) => void) => {
      const clickedIndex = items.findIndex((item) => item.id === id);

      // Shift-click: range select
      if (event.shiftKey && lastSelectedIndex.current !== null && clickedIndex >= 0) {
        const start = Math.min(lastSelectedIndex.current, clickedIndex);
        const end = Math.max(lastSelectedIndex.current, clickedIndex);
        const rangeIds = items.slice(start, end + 1).map((item) => item.id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          rangeIds.forEach((rid) => next.add(rid));
          return next;
        });
        return;
      }

      // Plain click: single select + detail toggle
      if (!event.metaKey && !event.ctrlKey) {
        onSingleClick?.(id);
        setSelectedIds(new Set([id]));
        lastSelectedIndex.current = clickedIndex;
        return;
      }

      // Cmd/Ctrl-click: toggle individual
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastSelectedIndex.current = clickedIndex;
    },
    [items],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedIndex.current = null;
  }, []);

  return { selectedIds, setSelectedIds, handleSelect, clearSelection };
}
