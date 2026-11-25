---
summary: "Close the last retired-handoff leftover: record one real Helper Check Out / Check In on a Brazil Mac through Seafile, plus one from the Photoshop plugin."
kind: plan
status: open
read-when: "finishing #1272 item 3 (Helper Brazil/Seafile pilot on a real Mac)"
---

# Issue #1272 — Helper pilot on a real Brazil Mac (item 3)

Covers [u2giants/popdam3#1272](https://github.com/u2giants/popdam3/issues/1272). Items 1 and 2 are done and proven (issue comments of 2026-11-23). Earlier session handoff with the same steps: [HANDOFF.d/2026-11-24T1621Z-hetz-claude-1272-brazil-mac-pilot.md](../../HANDOFF.d/2026-11-24T1621Z-hetz-claude-1272-brazil-mac-pilot.md). This plan is registered in [HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| Item 1 PO data | ✅ done | Replaced by direct shared-DB read; #1298 closed (comment on #1272, 2026-11-23 4:25 PM EST) |
| Item 2 hi-res tagging image | ✅ done | popcre/shared-db#6979, PRs #1278/#1284; proof comment on #1272 2026-11-23 1:00 PM EST |
| 1. Server readiness re-check | ⬜ open | last done 2026-11-23 (Seafile `/api2/ping` 200; production settings set) |
| 2. Mac access | ⬜ **Blocked** | needs a physical Mac in the Brazil office, or a remote-control session onto one |
| 3. Helper round trip | ⬜ open | |
| 4. Photoshop plugin round trip | ⬜ open | |
| 5. Record and close | ⬜ open | |

**Fresh session starts at step 1; step 2 decides whether it can continue.**

## 1. Ultimate goal

Designers in the Brazil office keep their working files in Seafile (not on the New York NAS). Before relying on the PopDAM Helper there, POP needs one real, recorded proof that a Brazil designer on a Mac can check a file out, edit it, check it back in, and that the new version lands safely — both from the Helper and from inside Photoshop. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, branch `main`) is POP Creations' licensed-artwork library. The **PopDAM Helper** (`apps/popdam-helper/`, Electron, unsigned installers from GitHub Release `popdam-helper-latest`) does Check Out / Check In. For Brazil, the storage provider is Seafile (server URL and libraries come from production settings `HELPER_SEAFILE_SERVER_URL`, `HELPER_SEAFILE_LIBRARIES`, served by `helper-api` `GET /config`). A Photoshop UXP plugin (unsigned, loaded through Adobe's UXP Developer Tool) talks to the Helper. Docs: `docs/POPDAM_HELPER.md`, `docs/SEAFILE_INTEGRATION.md`. Check-in rows: `public.asset_checkouts` (status `complete` when done; Seafile check-ins may pass through `verifying` if the `CHECKIN_VERIFICATION_ENABLED` setting is on).

## 3. What triggered this work

The retired legacy handoff (2026-07-14) listed this pilot as never done; #1272 carried it forward on 2026-11-22.

## 4. Scope

In: one Helper round trip and one plugin round trip on a Brazil Mac, evidence, closing #1272. **NOT in this plan:** code changes (if the pilot finds a bug, open one issue for it and link it here); code signing (abandoned forever); SeaDrive (not the sync client); Windows; items 1-2.

## 5. Current state

Server side ready as of 2026-11-23 (see STATUS). Helper on main is 1.4.18. No Mac is reachable from the AI machines (hetz, al8960ofc, edge-dev*).

## 6. Key findings

The only blocker is physical access to a Mac in Brazil. Settings resolve per machine/region and the library by longest path prefix, so a non-Brazil or non-Mac test does not prove this.

## 7. Approaches considered and rejected

- **Linux or Windows Seafile client as a stand-in** — rejected: region/platform settings differ; the issue requires the macOS Helper.
- **GitHub macOS runner** — rejected: no Photoshop, no Brazil network, no interactive sign-in.
- **Signing the plugin/installer to simplify setup** — rejected: owner decision, signing permanently abandoned.

## 8. Design decisions

Locked (settled designs, `docs/POPDAM_HELPER.md`): provider per machine/region; longest-path-prefix library match; SeaDrive is not the sync client; unsigned installers. Open: which Brazil Mac and file — any Mac with Photoshop and a file under `Decor/Character Licensed` that is safe to edit (add a test layer, then remove it in a second check-in if needed).

## 9. The plan

**Step 1 — Re-check server readiness (lead-only, read-only).** `curl -s -o /dev/null -w "%{http_code}" <Seafile server>/api2/ping` (server URL from production `admin_config` `HELPER_SEAFILE_SERVER_URL`) → 200; `gh release view popdam-helper-latest -R u2giants/popdam3` shows the newest Helper. Verify: both pass.

**Step 2 — Mac access (lead-only).** Check whether any AI session has computer-use on a Brazil Mac (ask the coordinator / list sessions). If none: report `Blocked —` "needs a Brazil Mac" on #1272 once (no repeated waiting turns) and stop; the owner arranges a person or remote session. Never ask Albert to type or click.

**Step 3 — Helper round trip (lead-only: live proof).** On the Mac: install latest Helper (right-click → Open for the unsigned app), sign in, Check Out one file under `Decor/Character Licensed`, edit and save in Photoshop, Check In. Verify: `select id, status, source_provider, checked_in_at from public.asset_checkouts order by created_at desc limit 3;` shows the row `complete` with `source_provider='seafile'`, and the Seafile library file history shows a new revision at that time.

**Step 4 — Plugin round trip (lead-only).** Load the UXP plugin via UXP Developer Tool (developer mode on), Check Out and Check In one file from inside Photoshop. Verify: same two checks.

**Step 5 — Record and close (lead-only).** Post on #1272: EST times, checkout ids, Seafile revision times, Helper version, macOS version. Close #1272. Delete `HANDOFF.d/2026-11-24T1621Z-hetz-claude-1272-brazil-mac-pilot.md` (its retention rule) and mark this plan done.

## 10. Tests required

None (no code change). Evidence is the two database rows plus two Seafile revisions.

## 11. Constraints, standing rules, gotchas

Read-only production access except the pilot's own normal check-in. An older Helper (before 2026-11-19) must update first. A check-in may sit in `verifying` up to the bridge confirmation; that is success-in-progress, not failure — wait for `complete` (verification flags within 30 minutes, `VERIFY_FLAG_MS`). Times in EST. Sign GitHub posts with `$AI_GH_SIGNATURE`.

## 12. Access and environment

Production SQL: Supabase MCP / `SUPABASE_ACCESS_TOKEN` (1Password `vibe_coding`). Seafile login for the test user: 1Password `vibe_coding`, Seafile item; PopDAM Helper sign-in: the designer's own account or the PopDAM test login item. Never paste values.

## 13. Definition of done, risks, open questions

Done: both round trips recorded on #1272, #1272 closed, old handoff deleted, this plan marked done. Risk: the pilot finds a bug — open one issue, keep #1272 open until a passing round trip. Open: which Mac/person (business arrangement, not an AI decision).

## Self-audit

1. Executable without questions? Yes, once a Mac exists — §9 gives every action and check; §2 explains what is needed.
2. Background carried? Yes — items 1-2 evidence, settled designs, rejected stand-ins (§7).
3. Goal clear? Yes — real Brazil Mac proof, both entry points.

## Lead launch prompt

```
Read docs/plans/issue-1272-helper-brazil-mac-pilot.md (STATUS first) in u2giants/popdam3, then AGENTS.md.
You (lead) do every step yourself: they are live-proof steps on a real Mac. There are no helper-ok steps.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. (Unused here.)
If no Brazil Mac is reachable, post one Blocked note on #1272 and stop.
Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
