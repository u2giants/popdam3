# Handoff — live proofs for merged PopDAM fixes (agents, desktop helper, worker, edge, admin tool)

Owner of record: Claude chat 807923b7-e0c0-4386-9ddc-b43ce32dc0b7 on hetz (closed 2026-10-08 ~7:30 AM EDT). Next session takes ownership.

## 1. Goal
Close 11 issues in u2giants/popdam3 whose code is merged and deployed but whose `- [ ] live proof` item is unticked. Each issue body/comments hold its own checklist; tick it with signed evidence, then close.

## 2. Done and verified (2026-10-07/08, EDT)
- 20 issues were worked by subagents via branch+PR, all merged on main. Closed with live proof: #244, #236, #221, #245, #191, #218, #270, #202 (full ERP apply run do2xj3c20xk completed 2:03 AM EDT 10/08: 19,522 items, 36,836 assets, 3,949 groups, no errors).
- Shared-db work for this session is finished: popcre/shared-db #4064 (atomic counters function, PR #4066) and #4084 (index public.assets(sku,division_code) where not deleted, PR #4086) are promoted, live-proven, claims #4065/#4085 released and closed.
- #196 (AG Grid license): Albert ruled 2026-10-07 "ignore ag-grid license issues now and in the future". Do not touch.

## 3. Not done — the remaining live proofs
| Issue | PR | What proves it |
|---|---|---|
| #231 Windows agent NAS password off `net use` cmdline | #255 (v0.16.5) | Windows render agent self-updates; NAS mount + a render succeed |
| #230 Windows agent OTA checksum/URL pinning | #266 (v0.16.6) | agent installs 0.16.6 by itself (heartbeat shows version/build_sha) |
| #226 Helper redacts checkout token in logs | #252 | next Helper release; open a checkout deep link; log shows `[REDACTED]` |
| #227 Helper credential store atomic, no silent drop | #267 | next Helper release; sign in, restart Helper, still signed in |
| #217 helper-api checkout token single-use | #251 | two concurrent consumes of one token → exactly one succeeds |
| #208 worker unhandled rejection handlers | #256 | worker logs show a caught rejection without process exit (or no restarts since deploy) |
| #207 worker respects user Stop | #265 | start then Stop a bulk op in UI; worker does not overwrite Stop |
| #198 SeaDrive mirror single in-flight download | #264 | worker logs show one mirror run per hour max |
| #215 data exports exclude admin_config, escaping | #263 | as admin: export of admin_config refused; dump with apostrophe in array restores |
| #237 db-data-admin nginx headers | #253 | curl -I live db-data-admin URL shows the headers; login + loading work |
| #243 db-data-admin loading robustness | #259 | load customers/vendors pages in live admin tool, switch tabs |

## 4. Facts learned
- Admin API access for proofs: AI admin login = 1Password vault vibe_coding item `7s5uzpbjenka4fpvrqogh44bre` (username/password); publishable key item `3hhxwrljnaq2tykxi7hplq5ryi` field `SUPABASE_PUBLISHABLE_KEY`. Password-grant on https://qsllyeztdwjgirsysgai.supabase.co, then POST `functions/v1/admin-api` with `{"action":"get-config","keys":["BULK_OPERATIONS"]}` to read operation state, or `update-bulk-op` to start one. Always via `op run`, never print secrets.
- Railway MCP fails on Linux (repo `.mcp.json` launches it with Windows `cmd /c`). Use the `railway` CLI instead: link a scratch dir with `railway link -p 8645c5fe-ae60-413e-8464-508456c65365 -s popdam3 -e production`, then `railway logs`. `railway logs -n 400` returned only "Starting Container" on 10/07 — worker logging may be sparse; try `railway logs --deployment` or a time filter.
- Windows agent and Helper proofs need a real install to update itself; the Windows render agent auto-updates from GitHub releases (publish-windows-agent workflow). Check its heartbeat version in agent_registrations.

## 5. Tried and did NOT work
- Railway MCP: "Executable not found in $PATH: cmd" — don't retry; use the CLI.
- First ERP apply failed on `Invalid schema: plm` then on statement timeout; both fixed (#271, shared-db #4086). Not a live issue now.

## 6. Stale-able facts
- Issue states checked 2026-10-08 7:30 AM EDT. Re-check with `gh issue view`.

## 7. Verify / done when
Every issue in section 3 is closed with a signed comment carrying the evidence. Then delete this file in a docs-only PR.
