"use client";

/**
 * PYROSENSE — comparison selection store (Track D).
 *
 * Holds the 2–3 facilities pinned for side-by-side comparison. Persisted to
 * localStorage so the selection survives navigating to /compare — the pin
 * buttons write here, the compare page reads from here.
 */

import { useCallback, useEffect, useState } from "react";

const KEY = "pyrosense.compareIds";
export const COMPARE_MAX = 3;

/** Safely read persisted ids (client only). */
function readIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, COMPARE_MAX);
  } catch {
    return [];
  }
}

function writeIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.length > 0) window.localStorage.setItem(KEY, JSON.stringify(ids));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode) — selection just won't persist */
  }
}

/** Shared compare-selection state. `hydrated` flips after first client read. */
export function useCompareIds(): {
  ids: string[];
  hydrated: boolean;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  isPinned: (id: string) => boolean;
  isFull: boolean;
} {
  const [ids, setIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setIds(readIds());
    setHydrated(true);
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((cur) => {
      const next = cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length >= COMPARE_MAX
          ? cur // at capacity — ignore extra pins (UI communicates this)
          : [...cur, id];
      writeIds(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setIds((cur) => {
      const next = cur.filter((x) => x !== id);
      writeIds(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setIds([]);
    writeIds([]);
  }, []);

  return {
    ids,
    hydrated,
    toggle,
    remove,
    clear,
    isPinned: (id: string) => ids.includes(id),
    isFull: ids.length >= COMPARE_MAX,
  };
}
