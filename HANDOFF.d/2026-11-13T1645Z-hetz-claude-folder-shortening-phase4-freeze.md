# Handoff — folder shortening Phase 4 freeze (#963)

Issue: https://github.com/u2giants/popdam3/issues/963 · Plan (authority): https://github.com/u2giants/popdam3/blob/main/plan_folder_shortening_snapshot_restore.md (Phase 4, §11, §13)

## 0. Business decisions only the owner can make
- **Customer short names** — Albert asked for a sheet and will fill it: https://github.com/u2giants/popdam3/blob/main/verification/folder-shortening/customer-short-names.csv (column "NEW SHORT NAME", pre-filled with today's name; posted on #963 2026-11-11 9:50 PM EST). Not answered as of 2026-11-13 11:45 AM EST.
- **Evening for the two top-folder renames** (step 5.6) — Albert: "undecided". Needed only at Phase 5.6.
- Already answered (do not re-ask): drop repeated year = yes; `Concept Approved Designs` → `Concept_Approved`.

## 1. What this application is
PopDAM (u2giants/popdam3) catalogs design files on the edge1 Synology NAS. This work shortens long folder names under `Decor/Character Licensed/____New Structure` so Windows can open files (260-char limit), without losing PopDAM metadata or snapshot restore.

## 2. What we set out to do, and why
Phase 4: a rules file plus a dry-run tool that produce the exact old→new folder list (folders only; files never renamed), owner sign-off on rules, then freeze (4.5) as the list Phase 5 executes.

## 3. Current state
- Done and merged: PR https://github.com/u2giants/popdam3/pull/969 (tool, tests, first list), PR https://github.com/u2giants/popdam3/pull/983 (owner answers applied, customer sheet, case-insensitive aliases).
- Tool: https://github.com/u2giants/popdam3/blob/main/tools/folder-rename/plan.mjs, rules https://github.com/u2giants/popdam3/blob/main/tools/folder-rename/rules.json, tests https://github.com/u2giants/popdam3/blob/main/tools/folder-rename/plan.test.mjs (15 pass; `node --test tools/folder-rename/plan.test.mjs`; not run by CI's vitest).
- Output: https://github.com/u2giants/popdam3/blob/main/verification/folder-shortening/summary.md, old-to-new.csv (4,106 renames), needs-attention.csv (7 rows, all kept at old name). Files over 200 chars: 43,845 → 6,105 (all files on disk, not only PopDAM assets).
- Phase 3 (PopDAM reads `In Dev`, `Cust Adopted`, `Concept_Approved`, `_FINISHED/<Cust>` without suffix) is live (popcre/shared-db#6079, #6106; PR #982). Phases 1–2 done.
- STATUS row Phase 4 = 🟡 waiting on the customer sheet. Nothing on the NAS renamed.

## 4. What we tried that did NOT work
- Customer/stage rules alone left ~21,700 files over 200; the deep working-folder rules (exact renames, phrase abbreviations, vault-folder pattern, dropping `_finished`) were needed.
- Reaching zero by rules is impractical: remaining files are mostly 201–210 chars deep in product-photo/SKU folders.

## 5. Root causes and key findings
- Customer master data (`core.customer` display names) already matches nearly all folder names; it settles little.
- `would_be_empty` cases (e.g. `Dollar General/2026/Dollar General 2026`) keep their old name by design.
- A short alias under 3 chars is rejected as a fragment (kept old name, flagged).

## 6. Exact next steps
1. When Albert's filled sheet appears on #963: for each row where NEW SHORT NAME differs, add `"<folder name>": "<short>"` to `customer_aliases` in rules.json (matching ignores case/punctuation, so one entry covers `Homegoods_finished` too).
2. Re-list folders/files on **edgesynology2** read-only: `cd /volume1/mac && find "Decor/Character Licensed/____New Structure" \( -name @eaDir -o -name "#recycle" -o -name "#snapshot" \) -prune -o -type d -print` (and `-type f`), save to scratch, run plan.mjs with `--out verification/folder-shortening`.
3. Check needs-attention.csv for new collisions; run tests.
4. Step 4.5 freeze: PR with rules.json + CSVs, STATUS row Phase 4 = done, merge; one short plain-English comment on #963.
5. Optional next pass: more explicit rules for the ~6,100 remaining (top groups listed in summary.md).
Done when: frozen list merged, STATUS Phase 4 ✅, #963 comment posted.

## 7. Constraints and gotchas
Read on edge2, never write; no NAS writes in Phase 4. Feature branch + PR, AI merges. Sign GitHub posts with $AI_GH_SIGNATURE. Times in EST. Ask Albert business questions only.

## 8. Access and environment
`gh` as u2giants (remote `github`); SSH alias `edgesynology2`; Supabase project `qsllyeztdwjgirsysgai` (read-only use here).

## 9. Open questions and risks
Albert may not return the sheet; if he only pastes changed rows, apply those and keep the rest. Listing changes daily, so regenerate right before freezing.

## Self-audit
Stranger can resume from this file and the linked URLs alone: yes. All paths are GitHub URLs or NAS paths. Owner questions isolated in §0.
