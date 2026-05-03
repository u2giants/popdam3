import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";

export async function handleBackfillPdfFilesUsed() {
  const db = serviceClient();
  const { data, error } = await db.rpc("backfill_pdf_files_used");
  if (error) return err(error.message, 500);
  return json({ ok: true, inserted: data ?? 0 });
}

export async function handleResolveSkuFilesUsed() {
  const db = serviceClient();
  const { data, error } = await db.rpc("resolve_sku_files_used");
  if (error) return err(error.message, 500);
  return json({ ok: true, resolved: data ?? 0 });
}
