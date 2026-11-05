import { exportOrderColumns } from "./export-pagination.ts";
import type { createClient } from "./supabase-js.ts";

/**
 * Resolve an export table name to its PostgREST source. Legacy names
 * `licensors`/`properties` map to canonical core tables; `plm_item_list`
 * lives in the api schema.
 */
export function tableSource(db: ReturnType<typeof createClient>, table: string) {
  if (table === "licensors") return db.schema("core").from("licensor");
  if (table === "properties") return db.schema("core").from("property");
  if (table === "plm_item_list") return db.schema("api").from("plm_item_list");
  return db.from(table);
}

/** Junction rows have a composite identity; all other export sources expose id. */
export function orderedTableSource(db: ReturnType<typeof createClient>, table: string) {
  let query = tableSource(db, table).select("*");
  for (const column of exportOrderColumns(table)) query = query.order(column, { ascending: true });
  return query;
}
