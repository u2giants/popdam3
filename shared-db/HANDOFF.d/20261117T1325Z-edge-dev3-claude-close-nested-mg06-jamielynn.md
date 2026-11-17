---
issue: 6208
status: OPEN
owner: claude/edge-dev3 MG06 coordinator (shared-db-coordinator-9369a6)
---

# Close-nested handoff — MG06 + three waitOnJamielynn sessions (2026-11-17, 8:25 AM EST)

Owner: Albert (business owner, not a programmer; plain-English replies per `~/.claude/CLAUDE.md`).
Authority: Albert, 2026-11-17 8:18 AM EST: "/close-nested and consolidate your handoff with the
handoff from the Claude sessions named: "waitOnJamielynn.MG change sheet property structure" and
"waitOnJamielynn.PDF upload MG value distribution" and "waitOnJamielynn.Inactive Disney Classic
Characters property" to make one large handoff that creates a new session that is a coordinator
and spins up nested subsessions for each of the tasks among all these chats."

## Owner rulings (binding; quote, do not re-ask)
- 2026-11-12: "there's no Mickey Mouse Family vs. MICKEY MOUSE. one lives under the other."
- 2026-11-12: "leave rugrats inactive. old styles can still be associated with an inactive property, you just can't make new ones."
- 2026-11-12, on contract-based studio placement: "No, we decided this already. read the documentation to find out where and then record it in a more conspicuous place" (recorded by PR 6203/6285).
- 2026-11-12: ColdLion feeds all three places (sandbox, prod temporary schema `dflow_prod`, prod permanent schema) via the established landing-table path (done, #6194).
- 2026-11-13: no property inactivations for now; Ilona and Laura revisit in ~3 months (PR 6293).
- 2026-11-16 (Mickey/Minnie): MM = Mickey alone ("Mickey Mouse"); new code ME = Minnie alone
  ("Minnie & Me"; avoid letters I/L; MN is Minions); MMF renamed "Mickey Group" in ColdLion and its
  licensor-site value is OPA "Standard Characters". Not yet in `docs/owner-rulings.md` (task 1).
- 2026-11-16: name→code mapping picks only active='Y' codes (popcre/shared-db#6491).
- Earlier: "a blank active flag in ColdLion means active" (designflow-data-syncing PR 90 follow-up).

## Tree closed
| Session | Final state | Branch |
|---|---|---|
| MG06 coordinator (this, local_f20e3912) | closed | this handoff PR |
| MG06 task 1 site-path proof (local_2196e410) + load data (local_0bb2f573) | closed, #6150 closed | merged (6214, 6246) |
| MG06 task 3 nickname (local_db1b6ec8) | closed, #6178 closed | merged (6181, 6210, 6263) |
| MG06 task 5 OPA placement (local_911e8938) | closed | merged (6203, 6285) |
| MG06 task 6 ColdLion feed (local_1eb33a58) + queue repair (local_aa9f5f2f) | closed, #6194 closed | merged (6206, 6264) |
| MG06 task 7 Jamielynn sheet (local_bf0ed083) | closed | merged (6204, 6293, 6491) |
| MG06 task 8 handoff PRs (local_822c71cb) | closed | merged (6149, 6195, 6197) |
| waitOnJamielynn.PDF upload MG value distribution (local_1d4f6529) + child local_d12cb2c7 | closed, nothing open | designflow-backend#277, designflow-frontend#408, designflow-data-syncing#90 merged 2026-11-02 |
| waitOnJamielynn.MG change sheet property structure (local_b6c7ff00) + child local_61283820 | closed | no repo changes (Dropbox files) |
| waitOnJamielynn.Inactive Disney Classic Characters property (local_ccb6bc10) | closed | `claude/inactive-disney-classic-characters-589647` preserved, no commits |

## Landed (verified merged on GitHub)
popcre/shared-db 6149, 6153, 6154, 6181, 6195, 6197, 6203, 6204, 6206, 6210, 6214, 6246, 6263,
6264, 6285, 6293, 6491; issues 6150, 6178, 6194 closed. Standard Characters exists under Disney with
nickname "Mickey Group"; MG06 site paths populated on production; daily ColdLion → core.property feed live.
u2giants/licensor-source-data#185 (active-code fixes). Stale merch-group copy drops are owned by
popcre/designflow-item-master#205 (scheduled 2026-11-26 non-prod, 2026-11-29 prod) — not a task here.

## Dropbox deliverables (Albert's `ai/` folder, unsent)
- `ColdLion changes for Jamielynn - 2026-11-12 - FINAL.xlsx` (217 Disney MM rows marked REPLACED; RG Rugrats row asks for reactivation).
- `ColdLion Mickey-Minnie clean-up for Jamielynn - 2026-11-16.xlsx` (411 moves + 199 rows for Albert).
- `RESUME-classic-characters-cp-2026-11-17.md`; `mickey-minnie-missing-pdfs/found.csv` (254 of 327 PDFs found).

## Open tasks (dependency order)

### 1. Record the 2026-11-16 Mickey/Minnie rulings
Add the 2026-11-16 Mickey/Minnie ruling (quoted above) to `docs/owner-rulings.md` and the MG06 plan
`plan_mg06_licensor_site_path.md`. Class reviewer-safety if a plan file changes. Done when merged on
main. Issue: https://github.com/popcre/shared-db/issues/6208 · fresh from main · no blockers.

### 2. Verify Jamielynn's ColdLion changes (after: Albert sends both sheets; Jamielynn executes)
Jamielynn creates ME, renames MMF→"Mickey Group", moves 411 styles (253 MM→MMF, 157 MM→ME, 1 MMF→ME),
renames MM→"Mickey Mouse" (divisions CW001/SP001), and applies the FINAL sheet (5 spellings, NASA,
duplicate codes, RG reactivation). Next: once she reports done, re-read `dflow_prod."merchGroup"` and
item headers on production (read-only) and compare against both sheets. Done when every row matches,
posted on #6208. Blocker: waiting on Albert to send / Jamielynn to execute. Do not start a session until
Albert says she is done; check ColdLion data weekly otherwise.

### 3. Fix MG06 licensor-site paths for the new Mickey/Minnie scheme (after: 2 — ME exists and synced)
`core.property_site_path` maps MMF → OPA 373 "Mickey Mouse Family > Mickey Mouse" (wrong now).
Target: MM → Mickey Mouse Family > Mickey Mouse (373/558); ME → Minnie > Minnie & Me; MMF → Standard
Characters (361). Claimed data migration via `shared-db-change`, automatic promotion only. Done when a
production count query shows exactly one correct current path per code. Issue: #6150 follow-up — open a
new issue if none tracks it. fresh from main.

### 4. Albert's 199 Mickey/Minnie decisions (waits on Albert)
Tabs "Sister-style guess" (100), "Unclear" (29), "No submission PDF" (70) of the 2026-11-16 clean-up
sheet. After Albert decides, write his decisions into the Moves tab in place (never regenerate the
sheet). Done when every row has a code. No PR.

### 5. Disney Classic Characters (CP) inactivation (waits on Albert; on hold per Albert 2026-11-17)
Note the 2026-11-13 ruling (no inactivations for ~3 months) — likely answer is "not now". If Albert
says yes: re-check the production target, inactivate CP in `core.property` via migration, verify.
Also 18 unassigned items (9 no-code, 9 generic) and 33 title/misfiled assignments need Albert's
answers; resume notes in Dropbox `ai/RESUME-classic-characters-cp-2026-11-17.md`.

### 6. 112 "needs a call" styles from Anyela's review (waits on Albert + Licensing)
No AI work until he answers.

### 7. Uma merchGroup email (waits on Albert sending it)
Dropbox `ai/email-to-uma-merchgroup-functions-2026-11-12.md`. Act on her reply only.

### 8. Optional: load newly found Mickey/Minnie submission PDFs
254 PDFs in `found.csv` → `plm.licensor_submission_pdf` as a new capture (u2giants/licensor-source-data
pipeline). Low priority; start only after 1–3 are idle.

## Child handoffs
- https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261112T2100Z-edge-dev3-claude-close-nested-mg06.md
- https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261112T2100Z-edge-dev3-claude-mg06-site-path-step6.md
- https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-12T2052Z-edge-dev3-claude-opa-submission-properties.md
- https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-12T2052Z-edge-dev3-claude-coldlion-property-feed-and-stale-tables.md

## Self-audit
Cold-start ready: rulings quoted, every task has next action, done-when, issue or "no PR". No secrets.
No claims held by any session in the tree. Scratch files from the MG change sheet session (/tmp) may be
gone; Dropbox copies are the source.
