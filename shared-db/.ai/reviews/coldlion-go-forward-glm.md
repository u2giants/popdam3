Here's my second opinion. Plain language, owner-readable. Everything below I verified against the actual SQL and workflows, not just the summary.

## The one correction that changes everything
Your "circuit breaker" is **not an automatic cutout — it's a switch a human throws by hand.** Nothing trips it on its own. I traced every code path that could trip it:

- The three database triggers fire **only after someone has manually run `trip_taxonomy_circuit_breaker`.** In normal operation they do nothing.
- Nothing auto-trips: not the identity verifier (it's a read-only check), not a failed promotion (it just rolls back), not the daily/6-hourly detection jobs (they only write an alert row).
- Your own forced-failure drill **tripped the breaker by hand first**, *then* tried the promotion. The failed write did not trip anything.

So the lane is **open** in steady state — not "already safely stopped," as the brief assumes. This reframes both decisions.

## 1. Decision 1 — Alerting
**Go with (a), synchronous delivery. I agree with it; do it.** ~1 hour, no new infra or secrets, and it reuses the GitHub-issue machinery that already works. Option (b) ("move off GitHub") fixes only the smallest of three timing problems (see §3) and costs 1–2 sessions, a second repo, and secrets on a box — not worth it as the primary fix. Keep the cron monitor as a backstop: it's the only path that catches alerts not originating inside a GitHub run. Just know (a) makes the *notify* step seconds-fast; it does **not** make the lane safe faster — see §3.

## 2. Decision 2 — Read-only production access
**Yes — for the migration ledger it's the only correct call. You cannot build a safely bounded package without reading production.**
- The one committed ledger snapshot is **stale**: it says 318 applied, but the repo's own 2026-07-27 records show production is at ~321–322.
- Filename ordering is wrong here: earlier sessions hand-copied files under newer timestamps, leaving real holes *below* the highest version. `--include-all` would drag other teams' deliberately-unpromoted work onto production.
- Guessing here is what caused the prior incident. The ledger read is genuinely read-only. Read it; don't approximate it.

**The DAM check is riskier than it looks.** `dam.designflow.app` is live production (fine), but a normal "tester" login is **not** automatically read-only — the styles/master-data grid is writable by *any* logged-in user, and there's no read-only role. So before Step 6, get a **specifically constrained** read-only account, or brief the tester to avoid that grid. If you can't guarantee that account, defer the DAM smoke. Ledger read: safe today. DAM smoke: safe only with guardrails.

## 3. What you're under-weighting (the important one)
Your premise — *"alert speed only changes how fast a human investigates a lane that is already safely stopped"* — doesn't hold. The lane is open until a human trips it. The real window in which drifted data is live for all 5 apps to read is:

**time-to-next-detection (up to 6 h, ~24 h for the full compare) + alert latency (your 15-min problem) + a human actually running the trip command.**

(a) shrinks only the middle term. Drift can sit undetected for hours even with perfect notify.

Where the breaker genuinely does **not** protect you, so alert speed matters more than you claim:
- **Silent drift off the promotion path** — a source ref edited by another job/person, a moved parent link, a hard `DELETE` (no delete trigger exists), a soft-delete on the mirror tables (only the link columns are guarded, not status), a new mirror row with a wrong link (INSERT isn't guarded), a row re-tagged off `coldlion`, or direct writes to the typed `core` tables. None are blocked, none trip, none alarm — until a human trips.
- **The breaker can be silently disarmed.** `DROP TRIGGER`, deleting the state row, or `service_role` setting `state='closed'` directly (it bypasses the reset authorization) all remove enforcement with no alarm. No watchdog confirms the trigger still exists.

Credit where due: the **promotion function itself** re-validates every mapping live and rolls back on any mismatch — that's your real automatic protection during a cutover write. Just know it's the function's own guards, not the breaker, and only for writes that go through that function.

**Single highest-value fix:** make the promotion path call the identity verifier and trip the breaker in the same transaction on failure. That's what finally makes "blocks unsafe writes in milliseconds" literally true. Pair it with running detection at least as often as your alert target — not once every 6 hours. (Is the 15-min gate the right requirement? In spirit yes — but as measured today it aims at the wrong end, the notify term, while the detect-and-trip term dominates.)

## 4. Step ordering
Before Step 9 — ideally before Step 7 — insert the hardening that makes the safety real: (a) wire verify→auto-trip on the promotion path; (b) raise detection cadence to match the alert target; (c) confirm the constrained read-only DAM account. Step 7's ledger read is independent and safe — do it now to unblock the package. Run Step 6 in parallel. Make Step 8 (owner approval) **contingent on** those three items plus the guard script's exact-set check, so approval rests on automatic protection, not a manual switch.

Full write-up with the verified file list is saved to the plan file.
