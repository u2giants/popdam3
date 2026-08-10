/**
 * Shared metadata derivation from asset relative paths.
 *
 * Single source of truth for workflow_status and is_licensed. Used by both
 * agent-api (ingest) and admin-api (reprocess).
 *
 * Licensor and property identity must never be inferred from path segments.
 * Those identities come from ColdLion codes joined to the curated core
 * taxonomy.
 */

import type { ServiceClient } from "./service-client.ts";

// ── Default workflow folder map ─────────────────────────────────────

export const DEFAULT_WORKFLOW_FOLDER_MAP: Record<string, string> = {
  "concept approved designs": "concept_approved",
  "in development": "in_development",
  "freelancer art": "freelancer_art",
  "discontinued": "discontinued",
  "product ideas": "product_ideas",
  "in process": "in_process",
  "customer adopted": "customer_adopted",
  "licensor approved": "licensor_approved",
};

// ── Result type ─────────────────────────────────────────────────────

export interface DerivedMetadata {
  workflow_status: string;
  is_licensed: boolean;
}

// ── Config cache (60s TTL) ──────────────────────────────────────────

interface CachedConfig<T> {
  value: T;
  fetchedAt: number;
}

const CONFIG_CACHE_TTL_MS = 60_000;
const configCache = new Map<string, CachedConfig<unknown>>();

export async function getCachedConfig<T>(db: ServiceClient, key: string): Promise<T | null> {
  const cached = configCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CONFIG_CACHE_TTL_MS) {
    return cached.value as T;
  }
  const { data } = await db.from("admin_config").select("value").eq("key", key).maybeSingle();
  const val = data?.value ?? null;
  configCache.set(key, { value: val, fetchedAt: Date.now() });
  return val as T | null;
}

// ── Main function ───────────────────────────────────────────────────

export async function deriveMetadataFromPath(
  relativePath: string,
  db: ServiceClient,
): Promise<DerivedMetadata> {
  const pathParts = relativePath.split("/");
  const normalizedParts = pathParts.map((p) => p.trim().toLowerCase());

  // is_licensed is path-authoritative:
  // - Decor/Character Licensed/** => true
  // - Decor/Generic Decor/**      => false
  const decorIndex = normalizedParts.findIndex((p) => p === "decor");
  const subFolder = decorIndex >= 0 ? (normalizedParts[decorIndex + 1] || "") : "";
  const is_licensed = subFolder === "character licensed";

  // Load configurable workflow folder map from admin_config (cached)
  let workflowFolderMap = DEFAULT_WORKFLOW_FOLDER_MAP;
  try {
    const wfValue = await getCachedConfig<Record<string, string>>(db, "WORKFLOW_FOLDER_MAP");
    if (wfValue && typeof wfValue === "object" && !Array.isArray(wfValue)) {
      workflowFolderMap = wfValue;
    }
  } catch (_) { /* use defaults */ }

  // Skip "Concept Approved Designs" as a workflow signal when under ____New Structure
  const hasNewStructure = pathParts.some((p) => p.startsWith("____New Structure"));
  let workflow_status = "other";

  // Scan from deepest to shallowest for most-specific match
  for (let i = normalizedParts.length - 1; i >= 0; i--) {
    const segment = normalizedParts[i];
    if (hasNewStructure && segment === "concept approved designs") continue;
    const matched = workflowFolderMap[segment];
    if (matched) {
      workflow_status = matched;
      break;
    }
  }

  return { workflow_status, is_licensed };
}
