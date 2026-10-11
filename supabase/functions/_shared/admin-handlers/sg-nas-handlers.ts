// PopSG style-guide NAS connection settings (#194).
//
// The NAS password is write-only from the browser: these routes never return
// it, only whether one is stored. The Windows render agent receives it
// server-side through agent-api. The password itself is stored in Supabase Vault
// behind the service_role-only RPCs get_sg_nas_password / set_sg_nas_password
// (popcre/shared-db#4168); the other keys stay in admin_config, saved in one
// upsert.

export const SG_NAS_PASSWORD_KEY = "WINDOWS_AGENT_SG_NAS_PASS";

export const SG_NAS_PUBLIC_KEYS = {
  host: "WINDOWS_AGENT_SG_NAS_HOST",
  share: "WINDOWS_AGENT_SG_NAS_SHARE",
  mountPath: "WINDOWS_AGENT_SG_NAS_MOUNT_PATH",
  user: "WINDOWS_AGENT_SG_NAS_USER",
} as const;

export interface SgNasConfigView {
  host: string;
  share: string;
  mountPath: string;
  user: string;
  passwordSet: boolean;
}

type Row = { key: string; value: unknown };

/** Build the browser-safe view. The password value is reduced to a boolean. */
export function toSgNasConfigView(rows: Row[], password?: unknown): SgNasConfigView {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const str = (k: string) => {
    const v = map.get(k);
    return typeof v === "string" ? v : "";
  };
  const pass = password === undefined ? map.get(SG_NAS_PASSWORD_KEY) : password;
  return {
    host: str(SG_NAS_PUBLIC_KEYS.host),
    share: str(SG_NAS_PUBLIC_KEYS.share),
    mountPath: str(SG_NAS_PUBLIC_KEYS.mountPath),
    user: str(SG_NAS_PUBLIC_KEYS.user),
    passwordSet: typeof pass === "string" && pass.length > 0,
  };
}

/**
 * Turn a save request into admin_config upsert rows plus a password change.
 * `password` is optional: omitted or null keeps the stored password
 * (`password: undefined` in the result); a string replaces it;
 * `clearPassword: true` clears it (`password: ""`). The password is never an
 * admin_config row.
 */
export function buildSgNasUpserts(
  body: Record<string, unknown>,
  now: string,
): { rows: { key: string; value: string; updated_at: string }[]; password?: string } | { error: string } {
  const rows: { key: string; value: string; updated_at: string }[] = [];
  for (const [field, key] of Object.entries(SG_NAS_PUBLIC_KEYS)) {
    const raw = body[field];
    if (raw !== undefined && typeof raw !== "string") return { error: `${field} must be a string` };
    let value = typeof raw === "string" ? raw.trim() : "";
    if (field === "mountPath") value = value.replace(/\\+$/, "");
    rows.push({ key, value, updated_at: now });
  }
  const password = body.password;
  if (password !== undefined && password !== null && typeof password !== "string") {
    return { error: "password must be a string" };
  }
  if (body.clearPassword === true) return { rows, password: "" };
  if (typeof password === "string" && password.length > 0) return { rows, password };
  return { rows };
}

// deno-lint-ignore no-explicit-any
type Db = any;

export async function handleGetSgNasConfig(db: Db): Promise<SgNasConfigView> {
  const { data, error } = await db
    .from("admin_config")
    .select("key,value")
    .in("key", Object.values(SG_NAS_PUBLIC_KEYS));
  if (error) throw new Error(error.message);
  const pass = await db.rpc("get_sg_nas_password");
  if (pass.error) throw new Error(pass.error.message);
  return toSgNasConfigView((data ?? []) as Row[], typeof pass.data === "string" ? pass.data : "");
}

export async function handleSetSgNasConfig(
  db: Db,
  body: Record<string, unknown>,
): Promise<SgNasConfigView> {
  const built = buildSgNasUpserts(body, new Date().toISOString());
  if ("error" in built) throw new Error(built.error);
  // Password first: if it fails nothing else is saved, and the admin sees the error.
  if (built.password !== undefined) {
    const set = await db.rpc("set_sg_nas_password", { p_password: built.password });
    if (set.error) throw new Error(set.error.message);
  }
  const { error } = await db.from("admin_config").upsert(built.rows);
  if (error) throw new Error(error.message);
  return await handleGetSgNasConfig(db);
}
