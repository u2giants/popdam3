# GLM 5.2 independent review — `plm.acknowledge_taxonomy_sync_alert` (2026-08-02)

Read-only review of the SQL added by `20260802140000`, requested by the shared-db sub-agent
`alert-ack-rpc`. Brief was self-contained with the SQL inline (GLM hangs on large exploratory
briefs). Reviewed the state of the code **as of `20260802140000`** — before `20260802150000`
and `20260802160000`, which were written in response to it.

Verbatim below. Outcome of each point is recorded after it.

---

**1. Can an unauthorized caller reach it?** No realistic path. `anon`/`authenticated` have no `EXECUTE` on either the `plm` or `public` wrapper (revoked from `public`, `anon`, `authenticated`; only `service_role` is granted), so PostgREST never enters the body for them. The function is `SECURITY INVOKER`, so it runs with the caller's privileges, and `UPDATE` on `plm.taxonomy_sync_alert` is granted only to `postgres`/`service_role` — an unprivileged caller's `UPDATE` fails even if the guard were bypassed. `search_path` is pinned on every function and all internal calls are schema-qualified (`plm.…`, `auth.role()`), so no path-hijack. `SET ROLE service_role`/`postgres` requires either membership (`authenticator` is not a member of `postgres`/`supabase_admin`) or a forged signed JWT, which is outside the SQL layer; the only intended operator path is a direct admin connection as `postgres`.

**2. Does the guard fire when `auth.role()` is NULL?** Yes — no NULL hole, by construction. `v_jwt_role` becomes NULL, and the first guard is *positively* guarded (`if v_jwt_role is not null and not (v_jwt_role = any(v_allowed))`), so NULL skips it instead of satisfying a `not(... or service_role)` trap. Control falls to `v_effective := coalesce(v_jwt_role, session_user)`: a PostgREST NULL-anomaly yields `authenticator` (not allow-listed → raises); a direct admin connection yields `postgres` (allowed). The final `if not (v_effective = any(v_allowed))` runs only after `v_effective` is proven non-null, against a concrete array, so it's a clean boolean. There is no route to the `UPDATE` without a positive allow-list match, and the `UPDATE` privilege is checked independently against `current_user`.

**3. Closing a genuine (non-residue) alert?** Yes, deliberately, and the residual risk is low: the same hard gates (allow-listed role + table privilege) apply and the write records actor/reason/evidence/connection metadata. The real gap is *post-hoc detectability*, not authorization: the audit lives inside the row's `payload->'acknowledgement'`, which is mutable by the same roles that can acknowledge, and there's no append-only ledger or pre-ack snapshot. To make a wrongful close provably detectable later, write a separate insert-only audit row (actor, reason, evidence, `effective_role`, `auth.uid()` when present, timestamp, alert snapshot) and add a trigger resisting payload tampering.

**4. Is the who-acknowledged record forgeable?** Yes, fairly easily. `actor`, `on_behalf_of`, `reason`, `evidence` are all caller-supplied JSONB strings, unbound to any verified identity. A `service_role`/CI caller can mint `actor_type='human'`, `actor='John Smith'` as long as the name evades the regex — and the regex only catches obvious bot tokens, so any normal human name passes. The `connection` block honestly records `effective_role`, giving a forensic tell, but the headline `acknowledged_by` reads `human:…` and is forgeable. Fix: tie `actor_type` to the effective role — reject `actor_type='human'` when `v_role in ('service_role','supabase_admin')`, forcing those connections through `actor_type='automation'` + a regex-checked `on_behalf_of`; and persist `auth.uid()`/JWT subject beside the claimed actor so a "human" record minted by a service key is visibly inconsistent.

**Correctness flags**
- **Allow-list / GRANT drift (latent, fails safe):** `v_allowed` includes `supabase_admin`, but `UPDATE` is granted only to `postgres`/`service_role`. Today `supabase_admin` is a superuser so it bypasses the check, but the two sets are maintained separately; if that role ever loses superuser status, its acks fail with permission denied. Either grant `UPDATE` to it or drop it from `v_allowed`.
- **Regex is blunt:** `bot\M` matches "Abbot" and `\mbot` matches "Botany" (false positives that would wrongly reject a real human); unanchored substrings like `agent`/`script`/`worker` can flag legitimate names. Symmetrically, it's easy to pick a name that slips through — reinforcing the Q4 forgeability concern.
- **No bug** in concurrency (the `… where acknowledged_at is null` + `if not found` correctly closes the TOCTOU the pre-`SELECT` opens), NULL handling, or the `jsonb` merge.

---

## Disposition

| Point | Agree? | Action |
|---|---|---|
| Q1 unauthorized callers | **Agree** | Matches the privilege facts measured on preview. No change. |
| Q2 NULL guard fires | **Agree** | Independently confirmed by behavioural test: `auth.role()` genuinely NULL, and setting `request.jwt.claims` to `authenticated`/`anon` makes the guard raise. |
| Q2 sub-claim: "the `UPDATE` privilege is checked independently against `current_user`" | **Agree — and this sentence exposed a bug GLM did not notice it had found** | True, and it is why resolving *authority* from `session_user` was wrong: the privilege check and the assertion were reading different roles. See below. |
| Q3 audit is tamper-able, no append-only ledger | **Agree — real gap, NOT closed** | Reported to the coordinator, not built. Needs an insert-only ack ledger with tamper-resisting triggers; a larger design change touching the sibling evidence tables in `AGENTS.md` §6.3. |
| Q4 record is forgeable; bind `actor_type` to role; persist `auth.uid()` | **Agree** | Adopted in full in `20260802150000`. |
| Flag: `supabase_admin` allow-list/GRANT drift | **Agree it is an asymmetry; disagree it needs changing** | `supabase_admin` must stay in `v_allowed` or a genuine superuser would be blocked by the assertion (superuser bypasses GRANTs, not a `raise`). If it ever loses superuser, acks fail **loudly** with permission denied — fail-safe and diagnosable. Documented rather than changed. |
| Flag: regex blunt, false positives | **Agree** | Independently found the same by *calling* the function on preview ('Abbot', 'Talbot', 'Ai Tanaka', 'Job Vermeulen', 'Scriptor', 'Cronin'). Fixed in `20260802150000`. |
| Flag: no concurrency/NULL/jsonb bug | **Agree** | No change. |

## Where the review was incomplete — and why that matters

GLM's Q4 fix was **correct as a design and inert as implemented**. It proposed testing
`v_role`, which was right; but `v_role` was resolved from `session_user`, and `session_user`
does not follow `SET ROLE`. A connection that had done `SET LOCAL ROLE service_role` still
resolved as `postgres`, so the new binding never fired and a `service_role` caller
successfully recorded `acknowledged_by = 'human:John Smith'` on preview at 13:26 UTC.

This is the same failure class the whole migration was written against — a check that reads
strict, installs cleanly, and never fires. No amount of reading found it, including by a
model that had the full function inline and had *just written the sentence* explaining that
the privilege check uses `current_user`. It was found by asserting the behaviour.
`20260802160000` resolves the effective role from `current_user`.

**Standing lesson: a review of SQL is not a test of SQL.**
