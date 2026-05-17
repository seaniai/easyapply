import { useEffect, useMemo, useState } from "react";

export function usePanelRecordSearch<T extends { id: number }>(
  rows: T[],
  fields: (keyof T)[],
  onSelect: (row: T) => void,
  rowRef: (id: number) => HTMLElement | null,
) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const matchIds = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return [] as number[];
    return rows
      .filter((row) =>
        fields.some((f) => {
          const v = row[f];
          return String(v ?? "")
            .toLowerCase()
            .includes(q);
        }),
      )
      .map((r) => r.id);
  }, [rows, debounced, fields]);

  useEffect(() => {
    setMatchIndex(0);
  }, [debounced]);

  const activeMatchId = matchIds.length > 0 ? matchIds[matchIndex % matchIds.length] : null;

  const go = (delta: number) => {
    if (matchIds.length === 0) return;
    const next = (matchIndex + delta + matchIds.length) % matchIds.length;
    setMatchIndex(next);
    const id = matchIds[next];
    const row = rows.find((r) => r.id === id);
    if (row) {
      onSelect(row);
      requestAnimationFrame(() => {
        rowRef(id)?.scrollIntoView({ block: "nearest" });
      });
    }
  };

  return {
    query,
    setQuery,
    matchIds,
    matchIndex,
    activeMatchId,
    goNext: () => go(1),
    goPrev: () => go(-1),
    clear: () => setQuery(""),
  };
}
