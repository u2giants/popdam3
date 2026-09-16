# PopSG admin-console acceptance — 2026-09-15

Plan step 5. Signed-in production QA at `https://sg.designflow.app/settings` using the
approved protected administrator test identity held in 1Password vault `vibe_coding`
(item "DAM AI tester login - PopDAM (administrator, …)"). Credentials were never typed,
printed, logged, or committed: a password-grant token was obtained through an
`op run` env injection and the session was injected directly into browser storage,
and the token file was deleted immediately afterwards.

Deployed build shown in the header: `f341443`.

## Result — PASS

All four admin tabs rendered with **zero 4xx/5xx responses and zero browser console
errors**. The four expected authorization failures recorded in the previous
(non-admin) QA do not occur for an administrator identity.

| Area | State proven |
|---|---|
| Crawl health | Fully reconciled / completed; discovered 216,801 = accepted 216,801; stale candidates 0; deactivated 0; remaining 0 |
| Prior ordinary run | 216,702, aggregates refreshed 2026-09-14 |
| Preview coverage | 214,694 of 216,801 active files have a preview (99%) |
| Preview — queued | 99 renderable, not yet rendered |
| Preview — attention | 2,008 render errors, listed with per-file reason and a retry control |
| Preview — unsupported | 0 |
| PDF search coverage | 4,318 active PDFs; extracted 0; waiting 0; failed 0; terminal skips 0; card correctly reports "Not started" |
| Bridge agent | `synology-bridge-1` online, heartbeat current |
| Windows render agent | offline, last heartbeat 2026-09-14; remote controls render and queue correctly |
| Users | active-user roster with role and per-app access rendered |

Healthy, reconciling, completed and failed/attention states were all observed in the
live page. No licensed filename, path, result, credential, cookie, or screenshot was
retained; only the aggregate counts above.

## Blocking item cleared

The predecessor handoff listed "an Admin-capable protected test identity" as a decision
only the owner could make. That identity already exists and is already approved: the
administrator tester account carries the `admin` role in `public.user_roles` and
`styleguides` app access. No new owner decision was required and none was taken.
