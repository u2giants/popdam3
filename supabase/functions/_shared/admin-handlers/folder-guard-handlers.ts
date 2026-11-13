/** Admin-only folder guard (u2giants/popdam3#963, plan Phase 6). Read-only: lists, never renames. */
import { json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { folderGuard } from "../folder-rules/guard.mjs";
import rules from "../folder-rules/rules.json" with { type: "json" };

const PAGE = 1000;

export async function handleFolderGuardReport(body: Record<string, unknown>) {
  const db = serviceClient();
  const root = (rules as { root: string }).root;
  const paths: string[] = [];
  // 16 parallel keyset scans over disjoint id ranges (first hex digit), so the
  // ~170k-row read finishes well inside the edge-function time limit.
  const hex = "0123456789abcdef";
  const scan = async (i: number) => {
    const lo = `${hex[i]}0000000-0000-0000-0000-000000000000`;
    const hi = i < 15 ? `${hex[i + 1]}0000000-0000-0000-0000-000000000000` : null;
    let after = "";
    for (;;) {
      let q = db
        .from("assets")
        .select("id, relative_path")
        .eq("is_deleted", false)
        .like("relative_path", `${root.replace(/_/g, "\\_")}/%`)
        .order("id")
        .limit(PAGE);
      q = after ? q.gt("id", after) : q.gte("id", lo);
      if (hi) q = q.lt("id", hi);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of data ?? []) paths.push(r.relative_path as string);
      if (!data || data.length < PAGE) return;
      after = data[data.length - 1].id as string;
    }
  };
  try {
    await Promise.all(Array.from({ length: 16 }, (_, i) => scan(i)));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 2000);
  return json({ ok: true, generated_at: new Date().toISOString(), ...folderGuard(paths, rules, { limit }) });
}
