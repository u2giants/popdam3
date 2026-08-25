/**
 * Idempotent, low-churn style-group assignment used by agent ingestion.
 *
 * Counts are deliberately not maintained here.  The database statement trigger
 * maintains the cache whenever style_group_id changes, and the worker's bounded
 * reconciliation operation repairs any historic drift.
 */

type Query = Record<string, (...args: any[]) => any>;

export type StyleGroupAssignmentDb = {
  from(table: "style_groups" | "assets"): Query;
};

export type StyleGroupAssignment = {
  assetId: string;
  sku: string;
  groupFields: Record<string, unknown>;
};

function sameValue(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

export function changedStyleGroupFields(
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(desired).filter(([key, value]) => !sameValue(existing[key], value)),
  );
}

export async function assignStyleGroup(
  db: StyleGroupAssignmentDb,
  { assetId, sku, groupFields }: StyleGroupAssignment,
): Promise<{ groupId: string; created: boolean; metadataUpdated: boolean }> {
  const selected = await db.from("style_groups")
    .select(`id, ${Object.keys(groupFields).join(", ")}`)
    .eq("sku", sku)
    .maybeSingle();
  if (selected.error) throw new Error(`style group lookup failed: ${selected.error.message}`);

  let group = selected.data as Record<string, unknown> | null;
  let created = false;
  let metadataUpdated = false;

  if (!group) {
    // DO NOTHING on a concurrent creator. A second lookup obtains its id without
    // rewriting the same row and firing unnecessary search-document updates.
    const inserted = await db.from("style_groups")
      .upsert(groupFields, { onConflict: "sku", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (inserted.error) throw new Error(`style group create failed: ${inserted.error.message}`);
    group = inserted.data as Record<string, unknown> | null;
    created = !!group;

    if (!group) {
      const concurrent = await db.from("style_groups").select("id").eq("sku", sku).single();
      if (concurrent.error || !concurrent.data) {
        throw new Error(`style group concurrent lookup failed: ${concurrent.error?.message ?? "missing row"}`);
      }
      group = concurrent.data as Record<string, unknown>;
    }
  } else {
    const changed = changedStyleGroupFields(group, groupFields);
    if (Object.keys(changed).length > 0) {
      const updated = await db.from("style_groups").update(changed).eq("id", group.id).select("id").single();
      if (updated.error) throw new Error(`style group metadata update failed: ${updated.error.message}`);
      metadataUpdated = true;
    }
  }

  const groupId = group.id as string;
  // Conditional assignment keeps repeated scans from refreshing the asset's
  // search document when membership has not changed.
  const assignment = await db.from("assets")
    .update({ style_group_id: groupId })
    .eq("id", assetId)
    .neq("style_group_id", groupId);
  if (assignment.error) throw new Error(`asset style group assignment failed: ${assignment.error.message}`);

  return { groupId, created, metadataUpdated };
}
