---
summary: DesignFlow backend is the sole writer of user roles and app access; DAM Settings is only a frontend (owner ruling 2026-10-28).
kind: decision
status: current
read-when: changing how PopDAM reads or writes user roles, app access or permissions
---

# DesignFlow is the single home for user roles and permissions

**Decided by:** Albert Hazan, owner ruling, 2026-10-28 (verbatim from his chat):

> "this should be pulled from the roles set in designflow plm. there should be one place that holds all the user data/permissions/roles. transfer over user settings in all apps (crm, Poppim, DAM) to designflow's. Keep user info in the settings of each app, but it's just a frontend to the true user permissions/roles functionality in dflow"

**Decision (locked 2026-10-28, Phase 0 evidence on popcre/designflow-backend#250):** option (a) sole-writer. DesignFlow backend is the only writer of `app.user_role` and `app.app_access` through its own API. `app.profile` row creation stays with the Supabase Auth signup hook.

**Why:** DesignFlow already co-resides on the same database with bridge columns (`users.app_profile_id`, `Roles.app_role_id`).

**Rejected:** (b) syncing into the `app.*` rows from a separate DesignFlow store; it adds a sync path with a stale-roles outage failure mode.

**Still open in the plan:** whether per-app legacy `public.*` axes fold into the canonical model.

## Source

- [plan_user_permissions_designflow_cutover.md](../../plan_user_permissions_designflow_cutover.md)
