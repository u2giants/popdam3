/**
 * Shared metadata derivation from asset relative paths.
 *
 * Single source of truth for workflow_status, is_licensed, licensor/property
 * extraction. Used by both agent-api (ingest) and admin-api (reprocess).
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
  licensor_name: string | null;
  property_name: string | null;
  licensor_id: string | null;
  property_id: string | null;
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
  licensorMap?: Map<string, string>,
  propertyMap?: Map<string, string>,
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

  // licensor/property extraction for licensed files
  // Structure: Decor/Character Licensed/[Licensor]/[Property]/...
  let licensor_name: string | null = null;
  let property_name: string | null = null;
  if (is_licensed && decorIndex >= 0) {
    const licIdx = decorIndex + 2;
    if (pathParts.length > licIdx) licensor_name = pathParts[licIdx];
    if (pathParts.length > licIdx + 1) property_name = pathParts[licIdx + 1];
  }

  // Look up licensor_id and property_id
  let licensor_id: string | null = null;
  let property_id: string | null = null;

  if (licensor_name) {
    if (licensorMap) {
      licensor_id = licensorMap.get(licensor_name.toLowerCase()) ?? null;
    } else {
      const { data: lic } = await db
        .from("licensors")
        .select("id")
        .ilike("name", licensor_name)
        .maybeSingle();
      licensor_id = lic?.id || null;
    }
  }

  if (licensor_id && property_name) {
    if (propertyMap) {
      property_id = propertyMap.get(`${licensor_id}:${property_name.toLowerCase()}`) ?? null;
    } else {
      const { data: prop } = await db
        .from("properties")
        .select("id")
        .eq("licensor_id", licensor_id)
        .ilike("name", property_name)
        .maybeSingle();
      property_id = prop?.id || null;
    }
  }

  return {
    workflow_status,
    is_licensed,
    licensor_name,
    property_name,
    licensor_id,
    property_id,
  };
}
