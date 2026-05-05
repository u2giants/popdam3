import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { optionalString } from "../validators.ts";

export async function handleRequestDirBrowse(body: Record<string, unknown>, userId: string) {
  const path = optionalString(body, "path") ?? "";
  const db = serviceClient();
  const requestId = crypto.randomUUID();

  const { error } = await db.from("admin_config").upsert({
    key: "DIR_BROWSE_REQUEST",
    value: {
      request_id: requestId,
      path,
      status: "pending",
      requested_at: new Date().toISOString(),
      requested_by: userId,
    },
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, request_id: requestId });
}

export async function handleGetDirBrowseResult() {
  const db = serviceClient();
  const { data } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "DIR_BROWSE_RESULT")
    .maybeSingle();

  return json({ ok: true, result: data?.value ?? null });
}
