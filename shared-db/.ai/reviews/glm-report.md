# Review: `temp_status_watch` stopgap migration

## 1. Can a status change BYPASS the change record?

**Yes — several paths.** Normal DML UPDATE is *not* one of them: the import's force-`status='active'` fires `property_status_change_log_upd`/`licensor_status_change_log_upd` via `when (old.status is distinct from new.status)`, and INSERT/DELETE are logged unconditionally.

Bypasses that exist:
- **`TRUNCATE core.property` / `core.licensor`** — row-level DELETE triggers do not fire on TRUNCATE and there is no `truncate` trigger. Mass-wipe = mass status loss, unlogged. **Primary bypass.**
- **`session_replication_role = replica`** — these triggers are default `ENABLE ORIGIN`; a replica-role session skips them. A bulk-import job often holds that privilege.
- **DDL by owner/superuser** — `alter table … disable trigger`, `drop trigger`, `drop column status`, `drop table`. Inherent, but real.
- **Partition/inheritance edge** — only if `core.property` is partitioned and writes hit partitions directly; PG ≥11 auto-propagates, usually covered. (Couldn't verify structure — asked not to explore.)

The `when (old.status is distinct from new.status)` clause itself has no gap: it catches `NULL→'active'`, `'inactive'→'active'`, etc., and correctly skips no-change updates.

## 2. Can the actor fields be FORGED?

**Yes — on a direct DB connection.** Trapdoor is the first arm of the `v_actor_kind` CASE:

```sql
when v_uid is not null  then 'signed_in_user'
```

`auth.uid()`/`auth.role()` read the `request.jwt.claims` GUC — a two-part custom setting with **no superuser restriction**. Any session can `set local request.jwt.claims='{"role":"service_role","sub":"<real user uuid>"}'`. Then `auth.uid()` returns the forged uuid, the CASE labels the row `'signed_in_user'`, and `jwt_uid`/`jwt_role` record the impersonated identity. An auditor reads it as a specific human.

- **Via PostgREST (normal app path): not forgeable** without the JWT secret or a victim's valid token — PostgREST validates the JWT and sets the claims itself. The documented past defect (agent typing a name) is genuinely closed there.
- `application_name` and `statement_prefix` are caller-controlled free text. The "no free-text changed-by column" claim is **partially undermined** — an automated direct-connection actor can still craft human-looking signal in those columns.
- **Brittleness:** the human/automation split hinges on the `service_role` JWT `sub` *not* casting to uuid (today it's the string `"service_role"` → `auth.uid()` throws → `v_uid` null → correct label). If Supabase ever ships a uuid `sub` there, automation mis-labels as `'signed_in_user'`.

## 3. Does the append-only guard fire when `auth.role()` is NULL? Any NULL-permissive expression?

**Yes, it fires.** `reject_mutation()` raises unconditionally — no `if`, no role branch:

```sql
raise exception 'temp_status_watch.% is append-only: % is not permitted …',
  tg_table_name, tg_op using errcode = 'restrict_violation';
```

It never references `auth.role()`, so NULL is irrelevant. The "NO role allowlist" design holds.

**No NULL-permissive expression exists anywhere.** Scanned every conditional:
- `reject_mutation()` — unconditional.
- The only `auth.role()`/`auth.uid()` use is in `record_status_change()`, purely for labeling. `when v_role = 'service_role'` with `v_role` NULL → NULL → not-true → falls through to `else 'direct_db_connection_unattributed'` (the least-trusting label). No permission is ever granted on a NULL.
- No `or auth.role() = 'service_role'` (the documented no-op shape) anywhere.
- The `exception when others then v_uid := null; v_role := null;` only degrades labeling, never a permission.

The migration genuinely avoids the named NULL-bug class. ✓

## 4. Does it survive `plm.import_master_data` being revived and run?

**Mostly yes, with two holes.**

Breaks the import? Low risk today. AFTER triggers `return null` and never raise, so writes aren't blocked; the force-`active` UPDATEs are logged. Caveats:
- The trigger's INSERT into `status_change_log` is **not** wrapped in its own `begin … exception`. If it ever fails (future constraint change, or a core-table column the function reads is absent), the exception propagates and **aborts the import statement**.
- The snapshot + trigger assume `core.property(id, name, code, status, updated_at, licensor_id)` and `core.licensor(id, name, code, status, updated_at)`. If the real schema differs, it errors. (Couldn't verify.)

Evasion?
- Normal DML: **no** — the case the design handles correctly.
- If the import runs with **`session_replication_role = replica`** (common in bulk ETL) or after `DISABLE TRIGGER`, the origin-configured triggers don't fire and it evades entirely. The migration does **not** defend against this. **Main hole.**
- TRUNCATE-based import logic evades (no truncate trigger).

## Other defects

- **`TRUNCATE` of `status_change_log`/`status_snapshot` evades append-only** — `reject_mutation` is `before update or delete` only. Add a `before truncate` trigger. Owner-only privilege, but the owner is who runs things.
- **Audit log readable by all authenticated users** — `grant select … on status_change_log … to authenticated` exposes `actor_kind`, `db_current_user`, `db_session_user`, `jwt_uid`, `application_name`, `statement_prefix` to every signed-in app user. Too broad for a security log; restrict to a dedicated reviewer role. No RLS, so SELECT = full read for the role.
- **`statement_prefix` leaks SQL** (first 100 chars, may contain UUIDs/values) to all authenticated.
- **`actor_kind` brittleness** (see Q2).
- Minor: `txid_current()` is deprecated (prefer `pg_current_xact_id()`); `status_changes_since_snapshot` shows NULL rather than the sibling view's `'(row no longer exists)'` marker for deleted rows.

## Bottom line

The design soundly avoids the three named past defects (unconditional append guard; AFTER trigger so GENERATED reads aren't NULL; no free-text changed-by) and catches the import's normal force-`active` flips. Real gaps: **(1)** TRUNCATE evades both logging and append-only; **(2)** `session_replication_role=replica`/trigger-disable lets a privileged import evade; **(3)** actor forgery is possible on direct connections via `request.jwt.claims`, with `application_name`/`statement_prefix` still caller-controlled; **(4)** the audit log is readable by all authenticated users, including statement SQL.

Full version persisted to the plan file. No implementation to do — this was review only.
