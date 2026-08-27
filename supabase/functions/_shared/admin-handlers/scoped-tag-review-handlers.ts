/**
 * Scoped tag review — the server side of the Style Group / This file controls in
 * the detail panels.
 *
 * Every write here is provenance-aware and scope-aware:
 *   - a MANUAL fact is owned by the person who made it (`created_by`), and an AI
 *     rerun can never overwrite or delete it;
 *   - REJECTING an AI fact writes a durable tombstone rather than deleting the
 *     row, so the next AI run cannot reinstate it;
 *   - DELETING a manual fact removes only that manual fact and leaves any
 *     tombstone in place;
 *   - a fact derived from business data (`authoritative`) is NOT a suggestion and
 *     cannot be rejected here — it changes when Master Data changes.
 *
 * Callers must be authenticated; the caller's id is recorded on every row so the
 * provenance shown in the UI is auditable.
 */

import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";
import { AUTHORITATIVE_TAG_SOURCE, normalizeMetadataTag } from "../tagging-metadata-policy.js";

/**
 * A fact on one file is that person's own housekeeping — any signed-in user may
 * add or retract it, as they always could. A fact on the whole Style Group is a
 * product-level statement that changes what every colleague sees, and a review
 * decision decides whether an AI suggestion becomes searchable truth. Both need
 * an elevated role.
 */
async function requireGroupAuthority(userId: string): Promise<null | Response> {
  const db = serviceClient();
  const { data, error } = await db.from("user_roles").select("role").eq("user_id", userId);
  if (error) return err(error.message, 500);
  const roles = ((data ?? []) as Array<{ role: string }>).map((row) => row.role);
  if (roles.includes("admin")) return null;
  return err("Forbidden: changing shared Style Group facts requires an admin role", 403);
}

/** A write that matched no row after a successful read means someone else changed it. */
function concurrentChange() {
  return err("That tag changed while you were editing it — reload the panel and try again", 409);
}

type Scope = "asset" | "style_group";

const ASSET_TABLE = "asset_tags";
const GROUP_TABLE = "style_group_tags";
const ASSET_KEY = "asset_id";
const GROUP_KEY = "style_group_id";

function readScope(body: Record<string, unknown>): Scope | null {
  const scope = typeof body.scope === "string" ? body.scope : "asset";
  return scope === "asset" || scope === "style_group" ? scope : null;
}

function target(scope: Scope) {
  return scope === "asset" ? { table: ASSET_TABLE, key: ASSET_KEY } : { table: GROUP_TABLE, key: GROUP_KEY };
}

function readEntityId(body: Record<string, unknown>, scope: Scope): string | null {
  const raw = scope === "asset" ? body.asset_id : body.style_group_id;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Add or restore a manual fact at the requested scope. */
export async function handleAddScopedTag(body: Record<string, unknown>, userId: string) {
  const scope = readScope(body);
  if (!scope) return err("scope must be 'asset' or 'style_group'");
  const entityId = readEntityId(body, scope);
  if (!entityId) return err(`${scope === "asset" ? "asset_id" : "style_group_id"} is required`);
  const tag = normalizeMetadataTag(body.tag);
  if (!tag) return err("tag is required");
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : "other";
  if (scope === "style_group") {
    const denied = await requireGroupAuthority(userId);
    if (denied) return denied;
  }

  const db = serviceClient();
  const { table, key } = target(scope);

  // Adding by hand over a Master Data fact would flip its ownership to manual and
  // permanently stop it being re-derived. Refuse it for the same reason removing
  // one is refused.
  const { data: existing, error: existingError } = await db
    .from(table)
    .select("id, source")
    .eq(key, entityId)
    .eq("tag", tag)
    .maybeSingle();
  // Fail closed: a transient read error must not silently skip the guard below.
  if (existingError) return err(existingError.message, 500);
  if ((existing as { source?: string } | null)?.source === AUTHORITATIVE_TAG_SOURCE) {
    return err(
      "This fact already comes from Master Data. Change it in Master Data rather than adding it by hand.",
      409,
    );
  }

  const { data, error } = await db
    .from(table)
    .upsert({
      [key]: entityId,
      tag,
      category,
      source: "manual",
      status: "active",
      created_by: userId,
      // A person owns this fact now, so it carries no model attribution.
      model: null,
      // A manual add explicitly clears any earlier rejection of the same text.
      rejected_at: null,
      rejected_by: null,
    } as never, { onConflict: `${key},tag` })
    .select("id, tag, status, source");
  if (error) return err(error.message, 500);
  if (!data || data.length === 0) return concurrentChange();
  return json({ ok: true, scope, tag, row: data[0] });
}

/**
 * Remove a fact.
 *  - a manual row is deleted outright: the person is retracting their own fact;
 *  - an AI row becomes a rejected tombstone so no rerun can bring it back.
 */
export async function handleRemoveScopedTag(body: Record<string, unknown>, userId: string) {
  const scope = readScope(body);
  if (!scope) return err("scope must be 'asset' or 'style_group'");
  const entityId = readEntityId(body, scope);
  if (!entityId) return err(`${scope === "asset" ? "asset_id" : "style_group_id"} is required`);
  const tag = normalizeMetadataTag(body.tag);
  if (!tag) return err("tag is required");
  if (scope === "style_group") {
    const denied = await requireGroupAuthority(userId);
    if (denied) return denied;
  }

  const db = serviceClient();
  const { table, key } = target(scope);
  const { data: existing, error: readError } = await db
    .from(table)
    .select("id, source, status, created_by")
    .eq(key, entityId)
    .eq("tag", tag)
    .maybeSingle();
  if (readError) return err(readError.message, 500);
  if (!existing) return err("Tag not found", 404);

  const row = existing as { id: string; source: string; status: string; created_by: string | null };

  if (row.source === AUTHORITATIVE_TAG_SOURCE) {
    return err(
      "This fact comes from Master Data, not from AI. Change it in Master Data instead of rejecting it here.",
      409,
    );
  }

  if (row.source === "manual") {
    const { data, error } = await db.from(table).delete().eq("id", row.id).select("id");
    if (error) return err(error.message, 500);
    if (!data || data.length === 0) return concurrentChange();
    return json({ ok: true, scope, tag, outcome: "manual_removed" });
  }

  const { data, error } = await db
    .from(table)
    .update({ status: "rejected", rejected_at: new Date().toISOString(), rejected_by: userId } as never)
    .eq("id", row.id)
    .select("id");
  if (error) return err(error.message, 500);
  if (!data || data.length === 0) return concurrentChange();
  return json({ ok: true, scope, tag, outcome: "rejected" });
}

/**
 * Confirm an AI suggestion (candidate -> active) or send an active AI fact back
 * to review (active -> candidate). Neither ever touches a manual row.
 */
export async function handleReviewScopedTag(body: Record<string, unknown>, userId: string) {
  const scope = readScope(body);
  if (!scope) return err("scope must be 'asset' or 'style_group'");
  const entityId = readEntityId(body, scope);
  if (!entityId) return err(`${scope === "asset" ? "asset_id" : "style_group_id"} is required`);
  const tag = normalizeMetadataTag(body.tag);
  if (!tag) return err("tag is required");
  const decision = typeof body.decision === "string" ? body.decision : "";
  if (!["approve", "demote", "restore"].includes(decision)) {
    return err("decision must be 'approve', 'demote', or 'restore'");
  }
  // A review decision at EITHER scope makes a suggestion into searchable truth
  // for everyone, so it always needs authority.
  const denied = await requireGroupAuthority(userId);
  if (denied) return denied;

  const db = serviceClient();
  const { table, key } = target(scope);
  const { data: existing, error: readError } = await db
    .from(table)
    .select("id, source, status, evidence")
    .eq(key, entityId)
    .eq("tag", tag)
    .maybeSingle();
  if (readError) return err(readError.message, 500);
  if (!existing) return err("Tag not found", 404);
  const row = existing as { id: string; source: string; status: string; evidence: unknown };

  if (row.source === "manual") return err("A manual fact is already confirmed and needs no review", 409);
  if (row.source === AUTHORITATIVE_TAG_SOURCE) {
    return err("This fact comes from Master Data and is not an AI suggestion", 409);
  }

  const status = decision === "demote" ? "candidate" : "active";
  // There is no reviewed_by column in the shared contract, so the audit trail is
  // recorded in the existing `evidence` jsonb rather than being invented.
  // Asset evidence is a JSONB ARRAY and group evidence is an object, so the
  // stored value is nested untouched rather than spread — spreading an array
  // would persist {"0": "...", ...} and destroy the contract shape.
  const evidence = {
    review: { reviewed_by: userId, reviewed_at: new Date().toISOString(), decision },
    prior: row.evidence ?? null,
  };
  const { data, error } = await db
    .from(table)
    .update({
      status,
      // Approving or restoring clears the tombstone; demoting never sets one.
      rejected_at: null,
      rejected_by: null,
      evidence,
    } as never)
    .eq("id", row.id)
    .select("id, status");
  if (error) return err(error.message, 500);
  if (!data || data.length === 0) return concurrentChange();
  return json({ ok: true, scope, tag, status, reviewed_by: userId });
}
