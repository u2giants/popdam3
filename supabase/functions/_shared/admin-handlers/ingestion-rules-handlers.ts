import { type IngestionRule, normalizeIngestionRules, validateIngestionRuleValue } from "../ingestion-rules.ts";

export const INGESTION_RULES_KEY = "INGESTION_RULES";
const HISTORY_LIMIT = 50;

interface HistoryEntry {
  revision: number;
  at: string;
  by: string;
  summary: string;
  /** The rules as they were BEFORE this change, so it can be undone. */
  rules_before: IngestionRule[];
}

interface StoredValue {
  revision: number;
  rules: IngestionRule[];
  history: HistoryEntry[];
}

// deno-lint-ignore no-explicit-any
type Db = any;

function parseStored(value: unknown): StoredValue {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    revision: typeof v.revision === "number" ? v.revision : 0,
    rules: normalizeIngestionRules(v.rules),
    history: Array.isArray(v.history) ? v.history as HistoryEntry[] : [],
  };
}

export async function getIngestionRules(db: Db): Promise<StoredValue> {
  const { data, error } = await db.from("admin_config").select("value").eq("key", INGESTION_RULES_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return parseStored(data?.value);
}

export class IngestionRulesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Replaces the rule list and records the previous list. Refuses stale or invalid saves. */
export async function saveIngestionRules(
  db: Db,
  input: { rules: unknown; expectedRevision: unknown; summary: unknown },
  userId: string,
): Promise<StoredValue> {
  if (!Array.isArray(input.rules)) throw new IngestionRulesError("rules must be a list", 400);
  for (const raw of input.rules) {
    const r = raw as IngestionRule;
    const problem = validateIngestionRuleValue(r?.kind, String(r?.value ?? ""));
    if (problem) throw new IngestionRulesError(`"${r?.value}": ${problem}`, 400);
  }
  const rules = normalizeIngestionRules(input.rules);
  if (rules.length !== input.rules.length) {
    throw new IngestionRulesError("A rule is malformed or duplicates another rule.", 400);
  }

  const { data: row, error } = await db.from("admin_config")
    .select("value, updated_at").eq("key", INGESTION_RULES_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const current = parseStored(row?.value);
  if (input.expectedRevision !== current.revision) {
    throw new IngestionRulesError("Someone else changed the rules. Refresh and try again.", 409);
  }

  const now = new Date().toISOString();
  const next: StoredValue = {
    revision: current.revision + 1,
    rules,
    history: [{
      revision: current.revision + 1,
      at: now,
      by: userId,
      summary: String(input.summary ?? "Changed rules").slice(0, 200),
      rules_before: current.rules,
    }, ...current.history].slice(0, HISTORY_LIMIT),
  };

  const write = { value: next, updated_at: now, updated_by: userId };
  const result = row
    ? await db.from("admin_config").update(write).eq("key", INGESTION_RULES_KEY).eq("updated_at", row.updated_at).select("key")
    : await db.from("admin_config").insert({ key: INGESTION_RULES_KEY, ...write }).select("key");
  if (result.error || !result.data?.length) {
    throw new IngestionRulesError("Someone else changed the rules. Refresh and try again.", 409);
  }
  return next;
}

/** Live library records a would-be exclusion touches. Null when the count times out. */
export async function countAssetsMatchingExclusion(db: Db, kind: unknown, value: unknown): Promise<number | null> {
  const text = String(value ?? "").trim().replace(/[\\%_]/g, "\\$&");
  if (!text) return 0;
  const query = db.from("assets").select("id", { count: "planned", head: true }).eq("is_deleted", false);
  const { count, error } = kind === "folder_exclude" ? await query.ilike("relative_path", `%/${text}/%`) : await query.ilike("filename", `%${text}%`);
  return error ? null : count ?? 0;
}
