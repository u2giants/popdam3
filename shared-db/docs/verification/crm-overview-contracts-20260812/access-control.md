# Runtime access-control evidence — CRM overview contracts (Phase 7A)

After the correction applied in run `31641099199`, a CRM-authorized caller was
retested in a read-only transaction. The corrected functions returned 500 email
rows in the aggregate, 12 volume periods, at most 6 recent unrouted rows, and 0
pending approvals on the current fixture. The authorization gate itself is
unchanged from the earlier runtime proof below, including the non-CRM `42501`
denial.

Every contract is `security definer` and hard-gates on `app.has_app_access('crm')`,
raising `insufficient_privilege` (errcode `42501`, message `crm: not authorized`)
when the caller is not authorized. This is proved two ways: structurally (the
offline test `tools/crm-overview-contracts.test.mjs`, which pins the
`raise exception … errcode = 'insufficient_privilege'` guarded by
`app.has_app_access('crm')` for all seven functions) and at runtime on preview.

## Runtime proof on preview (rjyboqwcdzcocqgmsyel)

Each call was made as the **`authenticated` role** with
`request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'` — the faithful
browser path (the EXECUTE privilege granted to `authenticated` is actually
exercised, and `app.current_profile_id()` resolves from the JWT `sub`).

| Caller | `crm_overview_counts()` | `crm_overview_recent_unrouted()` |
|---|---|---|
| **CRM user** (profile with active `app_access('crm')`) | **ALLOWED** — returned `{customers:66, contacts:271, open_opportunities:0, meetings:27, open_tasks:0, pending_approvals:0}` | ALLOWED (6 rows) |
| **Non-CRM user** (authenticated JWT whose `sub` maps to no profile / no CRM grant) | **DENIED 42501** `crm: not authorized` | **DENIED 42501** |

The deny path raises `42501` (`insufficient_privilege`) **before** any data is
returned, for every function.

### Note on the non-CRM caller

No *real* non-CRM profile exists on this preview branch: the first-login trigger
`app.handle_new_auth_user()` auto-grants `app_access('crm')` to every sign-in,
so every active profile has CRM access. The deny was therefore proved with an
authenticated JWT whose `sub` resolves to **no active profile** — the exact
"valid authenticated session with no CRM grant" case. `app.current_profile_id()`
returns NULL → `app.has_app_access('crm')` is FALSE (no `administrator` role, no
`app_access` row) → the function raises `42501`. This exercises the same
authorization predicate every other `api.crm_*` contract uses; it is the
authoritative "authenticated but denied" path, not a bypass.
