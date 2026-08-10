/** Resolve licensing from the ColdLion item mirror and curated taxonomy only. */

import type { ServiceClient } from "./service-client.ts";
import type { ParsedSku } from "./sku-parser.ts";

interface ErpLicensing {
  division_code: string | null;
  licensor_code: string | null;
  property_code: string | null;
}

interface SourceIdentity { id: string; name: string | null }

export interface LicensingResolution {
  licensor_id: string | null;
  property_id: string | null;
  licensor_code: string | null;
  licensor_name: string | null;
  property_code: string | null;
  property_name: string | null;
  unresolved_licensor: boolean;
  unresolved_property: boolean;
  reason: string | null;
}

export interface LicensingMaps {
  erpByStyleNumber: Map<string, ErpLicensing>;
  licensorsBySourceId: Map<string, SourceIdentity>;
  propertiesBySourceId: Map<string, SourceIdentity & { licensor_id: string }>;
}

const emptyResolution = (reason: string | null, unresolved: boolean): LicensingResolution => ({
  licensor_id: null, property_id: null, licensor_code: null, licensor_name: null,
  property_code: null, property_name: null, unresolved_licensor: unresolved,
  unresolved_property: unresolved, reason,
});

function coldLionSourceId(divisionCode: string, mgTypeCode: "05" | "06", mgCode: string): string {
  return `EDGEHOME/${divisionCode}/${mgTypeCode}/${mgCode}`;
}

export async function loadAuthoritativeLicensingMaps(
  db: ServiceClient,
  styleNumbers: string[],
): Promise<LicensingMaps> {
  const erpPromise = styleNumbers.length > 0
    ? db.from("erp_items_current").select("style_number, division_code, licensor_code, property_code")
      .in("style_number", [...new Set(styleNumbers)])
    : Promise.resolve({ data: [], error: null });
  const [{ data: erpRows, error: erpError }, { data: refs, error: refError }, { data: properties, error: propertyError }] = await Promise.all([
    erpPromise,
    db.schema("core").from("taxonomy_source_ref").select("entity_table, entity_id, source_id, source_name")
      .eq("source_system", "coldlion").eq("source_table", "merchGroupDetails")
      .in("entity_table", ["licensor", "property"]),
    db.schema("core").from("property").select("id, licensor_id"),
  ]);
  if (erpError) throw new Error(`Authoritative ColdLion item mirror failed: ${erpError.message}`);
  if (refError) throw new Error(`Authoritative licensing source references failed: ${refError.message}`);
  if (propertyError) throw new Error(`Authoritative property catalog failed: ${propertyError.message}`);

  const propertyParents = new Map((properties ?? []).map((row) => [row.id, row.licensor_id]));
  return {
    erpByStyleNumber: new Map((erpRows ?? []).map((row) => [row.style_number, row])),
    licensorsBySourceId: new Map((refs ?? []).filter((row) => row.entity_table === "licensor")
      .map((row) => [row.source_id, { id: row.entity_id, name: row.source_name }])),
    propertiesBySourceId: new Map((refs ?? []).filter((row) => row.entity_table === "property")
      .map((row) => [row.source_id, {
        id: row.entity_id, name: row.source_name, licensor_id: propertyParents.get(row.entity_id) ?? "",
      }])),
  };
}

export async function resolveAuthoritativeLicensing(
  db: ServiceClient,
  isLicensed: boolean,
  parsed: ParsedSku | null,
  maps?: LicensingMaps,
): Promise<LicensingResolution> {
  if (!isLicensed) return emptyResolution(null, false);
  if (!parsed) return emptyResolution("licensed_asset_has_no_parseable_sku", true);

  let erp: ErpLicensing | null = maps?.erpByStyleNumber.get(parsed.sku) ?? null;
  if (!maps) {
    const { data, error } = await db.from("erp_items_current")
      .select("division_code, licensor_code, property_code").eq("style_number", parsed.sku).maybeSingle();
    if (error) throw new Error(`Authoritative ColdLion item lookup failed: ${error.message}`);
    erp = data;
  }
  if (!erp) return emptyResolution("sku_not_in_coldlion_item_mirror", true);
  if (!erp.division_code || !["CW001", "SP001"].includes(erp.division_code)) {
    return emptyResolution("coldlion_item_is_not_in_a_licensed_division", true);
  }
  if (!erp.licensor_code) return emptyResolution("coldlion_item_has_no_licensor_code", true);

  const licensorSourceId = coldLionSourceId(erp.division_code, "05", erp.licensor_code);
  let licensor: SourceIdentity | null = maps?.licensorsBySourceId.get(licensorSourceId) ?? null;
  if (!maps) {
    const { data, error } = await db.schema("core").from("taxonomy_source_ref")
      .select("entity_id, source_name").eq("entity_table", "licensor").eq("source_system", "coldlion")
      .eq("source_table", "merchGroupDetails").eq("source_id", licensorSourceId).maybeSingle();
    if (error) throw new Error(`Authoritative licensor lookup failed: ${error.message}`);
    licensor = data ? { id: data.entity_id, name: data.source_name } : null;
  }
  if (!licensor) return { ...emptyResolution("licensor_source_key_not_in_curated_taxonomy", true), licensor_code: erp.licensor_code };

  if (!erp.property_code) {
    return {
      ...emptyResolution("coldlion_item_has_no_property_code", true),
      licensor_id: licensor.id, licensor_code: erp.licensor_code, licensor_name: licensor.name,
      unresolved_licensor: false,
    };
  }

  const propertySourceId = coldLionSourceId(erp.division_code, "06", erp.property_code);
  let property: SourceIdentity | null = null;
  if (maps) {
    const candidate = maps.propertiesBySourceId.get(propertySourceId);
    property = candidate?.licensor_id === licensor.id ? candidate : null;
  } else {
    const { data: ref, error: refError } = await db.schema("core").from("taxonomy_source_ref")
      .select("entity_id, source_name").eq("entity_table", "property").eq("source_system", "coldlion")
      .eq("source_table", "merchGroupDetails").eq("source_id", propertySourceId).maybeSingle();
    if (refError) throw new Error(`Authoritative property source lookup failed: ${refError.message}`);
    if (ref) {
      const { data, error } = await db.schema("core").from("property").select("id")
        .eq("id", ref.entity_id).eq("licensor_id", licensor.id).maybeSingle();
      if (error) throw new Error(`Authoritative property relationship lookup failed: ${error.message}`);
      property = data ? { id: data.id, name: ref.source_name } : null;
    }
  }

  return {
    licensor_id: licensor.id,
    property_id: property?.id ?? null,
    licensor_code: erp.licensor_code,
    licensor_name: licensor.name,
    property_code: erp.property_code,
    property_name: property?.name ?? null,
    unresolved_licensor: false,
    unresolved_property: !property,
    reason: property ? null : "property_source_key_not_linked_to_licensor",
  };
}
