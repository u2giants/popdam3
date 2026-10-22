/**
 * Extracted admin-api handlers for ColdLion mirror lookups and property name repairs.
 * Both read the shared database mirror; PopDAM never calls the ColdLion API.
 */

import { err, json } from "../http.ts";
import { getMgLookup } from "../coldlion.ts";
import { serviceClient } from "../service-client.ts";

// ── debug-coldlion-lookup ───────────────────────────────────────────

export async function handleDebugColdlionLookup(body: Record<string, unknown>) {
  const mgType = (body.mg_type as string) || "06";
  const division = (body.division as string) || "CW001";
  const searchCode = (body.search_code as string)?.toUpperCase() || null;

  try {
    const lookup = await getMgLookup(mgType, division);

    // If searching for a specific code, check if it exists
    let searchResult: { found: boolean; code: string; name: string | null } | null = null;
    if (searchCode) {
      searchResult = {
        found: searchCode in lookup,
        code: searchCode,
        name: lookup[searchCode] ?? null,
      };
    }

    // Check if CREATURE exists anywhere
    const creatureCode = Object.entries(lookup).find(([_, name]) => name.toUpperCase().includes("CREATURE"));

    return json({
      ok: true,
      mg_type: mgType,
      division,
      total_codes: Object.keys(lookup).length,
      search_result: searchResult,
      creature_check: creatureCode ? { found: true, code: creatureCode[0], name: creatureCode[1] } : { found: false, code: null, name: null },
      sample_codes: Object.entries(lookup).slice(0, 20).map(([code, name]) => ({ code, name })),
      all_codes: lookup,
    });
  } catch (e) {
    return err(`ColdLion mirror error: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}

// ── repair-invalid-property-names ───────────────────────────────────

export async function handleRepairInvalidPropertyNames() {
  const db = serviceClient();
  const fetchPropertyCodes = async (division: string): Promise<Set<string>> => new Set(Object.keys(await getMgLookup("06", division)));

  const [cw001Codes, sp001Codes, eh001Codes] = await Promise.all([
    fetchPropertyCodes("CW001"),
    fetchPropertyCodes("SP001"),
    fetchPropertyCodes("EH001"),
  ]);

  const validCodes = new Set([...cw001Codes, ...sp001Codes, ...eh001Codes]);

  const { data: invalidAssets, error: findError } = await db
    .from("assets")
    .select("id, property_code, property_name")
    .not("property_code", "is", null)
    .not("property_name", "is", null)
    .or(`property_name.eq.CREATURE,property_name.eq.CR`)
    .limit(5000);

  if (findError) {
    return err(`Failed to find invalid assets: ${findError.message}`, 500);
  }

  const toRepair = (invalidAssets || []).filter((a) =>
    a.property_name === "CREATURE" ||
    a.property_name === "CR" ||
    (a.property_code && !validCodes.has(a.property_code))
  );

  if (toRepair.length === 0) {
    return json({
      ok: true,
      message: "No invalid property_name values found",
      valid_codes_count: validCodes.size,
      repaired: 0,
    });
  }

  const idsToRepair = toRepair.map((a) => a.id);
  const { error: updateError } = await db
    .from("assets")
    .update({ property_name: null })
    .in("id", idsToRepair);

  if (updateError) {
    return err(`Failed to repair assets: ${updateError.message}`, 500);
  }

  // Also repair style_groups
  const { data: invalidGroups } = await db
    .from("style_groups")
    .select("id, property_code, property_name")
    .or(`property_name.eq.CREATURE,property_name.eq.CR`)
    .limit(1000);

  let groupsRepaired = 0;
  if (invalidGroups && invalidGroups.length > 0) {
    const groupIds = invalidGroups.map((g) => g.id);
    const { error: groupUpdateError } = await db
      .from("style_groups")
      .update({ property_name: null })
      .in("id", groupIds);
    if (!groupUpdateError) {
      groupsRepaired = groupIds.length;
    }
  }

  return json({
    ok: true,
    message: `Repaired ${idsToRepair.length} assets and ${groupsRepaired} style groups`,
    valid_codes_count: validCodes.size,
    sample_valid_codes: Array.from(validCodes).slice(0, 30),
    assets_repaired: idsToRepair.length,
    groups_repaired: groupsRepaired,
    sample_repaired: toRepair.slice(0, 10).map((a) => ({
      id: a.id,
      property_code: a.property_code,
      old_property_name: a.property_name,
    })),
  });
}
