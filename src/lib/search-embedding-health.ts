export interface SearchEmbeddingHealth {
  corpus: "dam" | "popsg";
  pending: number;
  errored: number;
  last_write: string | null;
  minutes_since_last_write: number | null;
  stale: boolean;
}

export function parseSearchEmbeddingHealth(value: unknown): SearchEmbeddingHealth[] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error("Search health is unavailable");
  const corpora = new Set<string>();
  for (const row of value) {
    if (!row || !["dam", "popsg"].includes(row.corpus) || corpora.has(row.corpus) ||
      typeof row.pending !== "number" || !Number.isFinite(row.pending) || row.pending < 0 ||
      typeof row.errored !== "number" || !Number.isFinite(row.errored) || row.errored < 0 ||
      typeof row.stale !== "boolean" ||
      (row.last_write !== null && (typeof row.last_write !== "string" || !Number.isFinite(Date.parse(row.last_write))))) {
      throw new Error("Search health is unavailable");
    }
    corpora.add(row.corpus);
  }
  return value as SearchEmbeddingHealth[];
}

