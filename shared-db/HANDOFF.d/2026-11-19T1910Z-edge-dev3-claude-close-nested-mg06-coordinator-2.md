---
issue: 6208
status: OPEN
owner: claude/edge-dev3 MG06 coordinator (shared-db-coordinator-sync-76e72b)
---

# Close-nested handoff — MG06 coordinator round 2 (2026-11-19, 2:10 PM EST)

Owner: Albert (business owner, not a programmer; plain-English replies per `~/.claude/CLAUDE.md`).
Authority: Albert, 2026-11-17 8:18 AM EST: "/close-nested and consolidate your handoff with the
handoff from the Claude sessions named ... to make one large handoff that creates a new session that
is a coordinator and spins up nested subsessions for each of the tasks among all these chats."
Re-invoked by Albert 2026-11-19 2:09 PM EST: "/close-nested".

Predecessor: https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-17T1325Z-edge-dev3-claude-close-nested-mg06-jamielynn.md
(owner rulings there remain binding; ME/MMF/MM ruling is now owner ruling 6.43 in `docs/owner-rulings.md`).

## Additional owner rulings (2026-11-17)
- CP leftovers: "if the licensor submission PDFs don't answer the question then leave them on CP for now"
  (both the 9 no-active-code and the 9 generic Disney Assorted items). PDFs settled MFZ62DYCP04 and
  MFZ80DYCP04 → PN Disney Princess; the other 16 stay on CP.

## Tree closed
| Session | Final state | Branch |
|---|---|---|
| Coordinator (this) | closed | this handoff PR |
| Record rulings (local_0dce2d0c) | closed | PR 6570 merged |
| Classic Characters re-check (local_03afda73) | closed | no changes |
| Verify Jamielynn (local_efd3320d) | closed | `claude/blissful-clarke-46a518` preserved, no commits |
| Site paths (local_d32743f5) | closed | PR 6577 merged |
| Refresh stale production (local_41be148b) | closed | removed, no changes |
| DFlow item refresh (local_0fca7075) + children mickey-count-gap, widen-itemheader-display, fix-catalog-verifier | closed | data-syncing PRs 145, 149 merged; shared-db 6596, 6615 merged |
| Load MM PDFs (local_38920094) | closed | u2giants/licensor-source-data PR 187 merged |

## Landed (verified)
popcre/shared-db 6570, 6577 (MM/ME/MMF site paths live in production core.property), 6596, 6615;
popcre/designflow-data-syncing 145 (merged 2026-11-18), 149 (merged 2026-11-19) — production item
refresh runs nightly 2:00 AM EST, runs succeeded 11-18 and 11-19; u2giants/licensor-source-data 187
(found MM/Minnie PDFs loaded). Jamielynn applied: Mickey/Minnie clean-up (ME created, MMF="Mickey Group",
MM="Mickey Mouse", active in SP001+CW001; verified live 2026-11-17 3:55 PM EST) and the whole Harry
Potter sheet (37 moves + 5 MG05 HP→WB, verified live 2026-11-17).

## Dropbox state (Albert's `ai/` folder)
- `ColdLion changes for Jamielynn - 2026-11-12 - FINAL.xlsx` — trimmed 2026-11-17 to outstanding only:
  243 style moves (incl. the 2 PN moves), 5 spelling fixes, NASA CW001 off, duplicate-code switch-offs.
  Unsent. Backup of prior versions: `~/backups/jamielynn-sheets-2026-11-17/` (edge-dev3).
- `ColdLion Mickey-Minnie clean-up for Jamielynn - 2026-11-16.xlsx` — kept for Albert's 199 decisions.
- Harry Potter sheet deleted (done).

## Open tasks (dependency order)

### 1. Compare production item copy with live ColdLion (no blocker)
Production `dflow_prod."itemHeader"` now refreshes nightly. At 2:09 PM EST 11-19 counts were CP 24,
MM 445, MMF 279, ME 168 (incl. prepacks). Next: pull live ColdLion items (API base
`http://x5.coldlion.com/EhpApi`, `/items?companyCode=EDGEHOME&itemNo=...`, key
`op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential` via op_run) and compare MG06 per style
for MM/MMF/ME/CP. Read-only. Done when every style matches (or each mismatch is explained) and the result
is posted on https://github.com/popcre/shared-db/issues/6208. fresh from main.

### 2. Verify the FINAL sheet once Jamielynn applies it (after: Albert sends it; Jamielynn reports done)
Re-read every row of the trimmed FINAL sheet against live ColdLion (items MG06; merchGroupDetails
`?companyCode=EDGEHOME&divisionCode=..&mgTypeCode=..&mgCode=..` for spellings/NASA/switch-offs).
Done when every row matches, posted on #6208. Do not start until Albert says she is done.

### 3. Albert's 199 Mickey/Minnie decisions (waits on Albert)
Tabs "Sister-style guess", "Unclear", "No submission PDF" of the 2026-11-16 clean-up sheet; write
decisions into it in place. No PR.

### 4. Toy Story question (waits on Albert)
"Toy Story 4" (TS) holds 119 styles; plain "Toy Story" (TY) is unused. Ask whether non-TS4 styles move to TY.

### 5. 112 "needs a call" styles; Uma merchGroup email; CP inactivation (all wait on Albert)
Unchanged from the predecessor handoff tasks 5–7. CP inactivation stays on hold (2026-11-13 ruling).

## Child handoffs
None written this round; evidence is on https://github.com/popcre/shared-db/issues/6208.

## Self-audit
No secrets. No claims or locks held by any session in the tree. Every task has next action and done-when.
