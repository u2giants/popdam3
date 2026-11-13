/** Admin-only folder guard (u2giants/popdam3#963, plan Phase 6). Read-only: lists, never renames. */
import { json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
// @ts-ignore pure JS module shared with tools/folder-rename
import { folderGuard } from "../folder-rules/guard.mjs";
import rules from "../folder-rules/rules.json" with { type: "json" };

const PAGE = 1000;

export async function handleFolderGuardReport(body: Record<string, unknown>) {
  const db = serviceClient();
  const root = (rules as { root: string }).root;
  const paths: string[] = [];
  let after = "";
  for (;;) {
    let q = db
      .from("assets")
      .select("id, relative_path")
      .eq("is_deleted", false)
      .like("relative_path", `${root.replace(/_/g, "\\_")}/%`)
      .order("id")
      .limit(PAGE);
    if (after) q = q.gt("id", after);
    const { data, error } = await q;
    if (error) return json({ error: error.message }, 500);
    for (const r of data ?? []) paths.push(r.relative_path as string);
    if (!data || data.length < PAGE) break;
    after = data[data.length - 1].id as string;
  }
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 2000);
  return json({ ok: true, generated_at: new Date().toISOString(), ...folderGuard(paths, rules, { limit }) });
}
