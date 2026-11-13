---
summary: Plan to keep a property's four names (Coldlion name, exact licensor-submission name, user nickname, short description name) together on core.property; duplicate check done, build open.
kind: plan
status: open
read-when: adding or using property nicknames, short names, or licensor-submission names
---

# Plan: four names for each property, kept in one place

Written 2026-11-13 1:40 PM EST on edge-dev3 by Claude (session 1785fa70-1752-4243-8bec-73fee4b3d368).
Handoff registering this plan: [../HANDOFF.d/2026-11-13T1840Z-edge-dev3-claude-property-name-fields.md](../HANDOFF.d/2026-11-13T1840Z-edge-dev3-claude-property-name-fields.md)

## STATUS (read first — do not re-derive or re-plan)

| Step | State | Evidence |
|---|---|---|
| 0. Check that none of the new fields already exists | ✅ done 2026-11-13 | §6 below; re-run the queries in §6 read-only to reproduce |
| 1. Migration: add the fields to `core.property`, move `metadata.submission_canonical` into them | ⬜ open | |
| 2. Fill the licensor-name field from the scrape link automatically | ⬜ open | |
| 3. Read-only view combining Coldlion property rows with the four names | ⬜ open | |
| 4. DesignFlow shows the nickname; item descriptions use the short name | ⬜ open | |
| 5. Live proof | ⬜ open | |

A fresh session starts at **Step 1**.

---

## Part 1 — Why

### 1. Ultimate goal

Albert (owner, POP Creations) wants each licensed property to carry four names, kept together in one place:

1. **Coldlion name**: what Coldlion (the ERP) calls it. It arrives through the Coldlion API, as it does today.
2. **Licensor-submission name**: the name exactly as the licensor's submission site spells it, typos and double spaces included. Automatic AI licensor submissions will type this. It exists only in our database.
3. **Nickname**: what POP users see, for example "Mickey Group" instead of "Standard Characters".
4. **Short name**: a shortened form used in item descriptions.

Today the Coldlion name has to serve all four jobs. That fails. For example, Coldlion's "WHERE'S WALLY/WHERE'S WALDO  (CLASSIC) - LITERARY’" can never equal the licensor's own "WHERE'S WALLY/WHERE'S WALDO  (CLASSIC)  - LITERARY", and fuzzy matching was rejected (§7).

**If a step conflicts with this goal, the goal wins. Stop and flag it in the handoff.** No name may be stored twice.

### 2. What the applications are

- **Shared POP database**: Supabase project `qsllyeztdwjgirsysgai`. All structure changes go through the repo `u2giants/shared-db` (this repo), using its claim-first process and automatic promotion workflow (`AGENTS.md`, `docs/agents/merge-protocol.md`).
- **Coldlion**: the ERP, authoritative for merch-group codes (MG05 Licensor, MG06 Property).
  - Its API lands in `coldlion.merch_group_detail` (landing).
  - `plm.sync_core_property_from_coldlion` keeps `core.property` (one row per property: `name`, `code`, `licensor_id`, `status`, `nickname`, `metadata`) in step.
  - DesignFlow production's own table is `dflow_prod."merchGroup"`. It has one row per code **per division** (CW001, SP001, EH001) and holds every merch-group type, not just properties.
- **DesignFlow PLM**: repos under GitHub org `popcre` (branch `sandbox-albert` → PR to `develop`, never self-merged). Its Sequelize model is `designflow-backend/models/db/merchGroup.js`.
- **Licensor scrapes** (repo `u2giants/licensor-source-data`) land in `plm.opa_property`, `plm.wb_property`, `plm.nbcu_property`, `plm.dcp_property`, and similar tables. Each has a `core_property_id` link to `core.property`.

### 3. What triggered this

On 2026-11-13, while fixing Where's Wally, Albert ruled out fuzzy matching and asked for separate fields instead. He then asked for a check that none of them already exists elsewhere, with all four kept "in one place".

### 4. Scope

**In scope:**
- Fields on `core.property`.
- Moving the existing submission link into those fields.
- The automatic fill of the licensor name.
- One read view.
- DesignFlow display and description changes.

**NOT in this plan:**
- Changing Coldlion or the Coldlion sync.
- Editing Coldlion names.
- Character names.
- Licensor (MG05) names.
- Bulk-writing nicknames or short names. People fill those; the plan only provides the place to store them.
- The property-suggestion feature (popcre/designflow-backend#408).
- Retiring the stale `core."merchGroup"` copy, which already happened (DesignFlow issue 205, 2026-11-12).

## Part 2 — What we already know

### 5. Current state (checked 2026-11-13, read-only)

`core.property`:
- 824 rows.
- `name` is the Coldlion name.
- `nickname` already exists: text, column comment "Short everyday name used inside POP (owner-maintained)." It is filled on **0** rows. No code writes it; the Coldlion sync does not touch it.
- 29 rows carry `metadata->'submission_canonical'` = `{source_system, licensed_property_id, …}` (21 with `disney_opa`, 8 with no source). This is the licensor link, written by #2541 migrations, for example `25e7f32fc`.
- Trigger `property_licensing_write_guard` guards writes, so migrations must pass it.

Other tables:
- `core.property_alias`: table for cross-app-certified aliases (writes only via `public.promote_property_alias_batch()`). It has **0** rows and holds many search aliases, not one named role. Not a home for these fields.
- `dflow_prod."merchGroup"`: no nickname, short or licensor columns. `ItemNoCode` / `mgCode2` are item-number codes, not names.
- `dflow*."ProductNickname"`: nicknames for whole product combinations (material + size + property and so on), 7 test rows. Not a property nickname.
- Licensor exact names already live in the scrape tables (`plm.opa_property` and the others) behind `core_property_id`.
- Short name: nothing stores one. `designflow-item-master/scripts/display-desc-load-properties.js` strips suffixes like "Group" or "Classic" from `core.property.name` on the fly (`SUFFIX_RE`).

### 6. Duplicate check: answer to Albert's question

| Field | Exists today? | Decision |
|---|---|---|
| 1 Coldlion name | `core.property.name` (synced) | keep, no change |
| 2 Licensor-submission name | the **link** is in `core.property.metadata.submission_canonical` (29 rows); the **text** is in each scrape table | promote the link to real columns, delete the old key, and block future writes to it (Step 1); copy the text from the linked scrape row automatically (never typed) |
| 3 Nickname | `core.property.nickname`, unused, already on the main table, no code reads or writes it | **reuse**; nothing to move or repoint |
| 4 Short name | nowhere | **add** `core.property.short_name` |

Net result: two real additions (the short name, plus the licensor link and name as columns), one reuse, and nothing duplicated.

### 7. Rejected approaches

- **Fuzzy matching licensor names.** Rejected by Albert on 2026-11-13. A 2026-10-11 licensing rule also says similar names are never a mapping.
- **Asking Coldlion to fix Where's Wally to match the licensor.** Unnecessary once field 2 exists.
- **Putting the columns on `dflow_prod."merchGroup"`.** That table repeats each property once per division and mixes all merch-group types, so every name would be stored three times beside unrelated groups. It is also DesignFlow-only, while submissions and other apps need the names. `core.property` is the single per-property row. DesignFlow reads the names from it (Step 3).
- **Storing names in `core.property_alias`.** It is a many-alias search table with certification rules, not one named field per role.
- **Keeping the link in `metadata` JSON.** It is invisible, unvalidated, and two different shapes already exist.

### 8. Decisions

**Locked:**
- The four roles are as defined in §1 (Albert, 2026-11-13).
- The home is `core.property`.
- The nickname reuses the existing column.
- The licensor name is copied automatically from the linked scrape row, never typed or guessed. No link means NULL.
- No fuzzy matching.
- Display fallbacks: nickname → name; short name → nickname → name.

**Open (implementer's judgment):**
- Exact column names. Suggested: `submission_source`, `submission_property_id`, `submission_property_name`, `short_name`.
- Whether one property can need two licensor sites. If yes, use a child table keyed by `(property_id, submission_source)` instead of columns. Check the 29 existing links first.
- Which screen staff use to type nicknames and short names. Check whether the DB Data Admin page (`api.db_data_admin_*`) can host them.

## Part 3 — How to build it

### 9. Steps

**Step 1: migration** (claim the objects first on a `u2giants/shared-db` issue, load the `shared-db-change` skill)
- Add `submission_source text`, `submission_property_id text`, `submission_property_name text` and `short_name text` to `core.property`, with comments.
- Add a unique constraint on `(submission_source, submission_property_id)` where not null.
- Back-fill from `metadata->'submission_canonical'`. The 8 rows without a source are listed for review, not guessed.
- Then drop the `submission_canonical` key from `metadata`.
- Update the `nickname` comment to "User-facing name shown in POP apps."
- Done when the 21 `disney_opa` links appear in the new columns and `metadata ? 'submission_canonical'` returns 0 rows.
- **Repoint every user of the old location in the same step.** Checked 2026-11-13: no live database function, view or app code *reads* `submission_canonical` (query `pg_proc.prosrc` and `pg_views.definition` for it; `git grep` in shared-db and the popcre designflow repos). It is only *written*, by migrations `20261026150931_curated_vm_trackerplus_submission_properties.sql`, `20261112173641_curated_opa_submission_properties.sql`, `20261112225250_opa_contract_studio_placement.sql` and `20261113041225_opa_contract_studio_placement_fix_forward.sql`. Past migrations are not edited, but the back-fill picks up what they wrote. Open work on issue #6209 (handoff `HANDOFF.d/2026-11-13T1455Z-edge-dev-mimo-opa-fix-forward-repair.md`) still writes the old key: comment on #6209 so its next migration writes the new columns instead. Add a check to `property_licensing_write_guard`, or a new constraint, that rejects any new `metadata ? 'submission_canonical'`, so nothing can write the old place again.
- Re-run the grep and the `pg_proc`/`pg_views` query right before merging. Any new reader found must be switched to the columns in this PR.

**Step 2: automatic licensor name**
- Write a function `core.refresh_property_submission_name()` and call it from the scrape load functions (for example `plm.sync_opa_property_character` and the OPA load).
- It sets `submission_property_name` to the scrape row's name exactly (no trimming), matched by source plus ID.
- Done when the Disney OPA rows show the OPA spelling byte-for-byte. Check with `encode(convert_to(...),'hex')`.

**Step 3: read view**
- Create `api.property_names`: `core.property` joined to licensor, exposing `code`, `name`, `nickname`, `short_name`, the submission fields, and `display_name = coalesce(nickname,name)` and `description_name = coalesce(short_name,nickname,name)`.
- Done when the view returns 824 rows and fallback works on a row with no nickname.

**Step 4: DesignFlow** (popcre repos, `dflow-session-start` first)
- The property pickers (`newArtPiece.component.ts`, `newItem-dialog.component.ts`, `itemDetail.component.html`) show `display_name`, joined by licensor plus `mg_code`.
- `designflow-item-master/scripts/display-desc-load-properties.js` reads `description_name`, which replaces the `SUFFIX_RE` stripping when a short name exists.
- Done when sandbox screenshots show a nickname in the picker after one test nickname is set.

**Step 5: live proof** on production after promotion: the view works, and one real nickname shows in DesignFlow.

### 10. Tests

Database test (pgTAP or the repo's script tests):
- the back-fill moved all links;
- the unique constraint rejects a duplicate licensor ID;
- the refresh copies a double-space name unchanged;
- no link leaves NULL;
- the view's fallbacks.

DesignFlow component spec for the fallback display. Existing suites stay green.

### 11. Constraints

- Structure only through `u2giants/shared-db` and its promotion workflow; no manual production commands.
- Coldlion stays authoritative for codes and `name`.
- Never name-match.
- Never store a name twice.
- Pass `property_licensing_write_guard`.
- DesignFlow uses PRs to `develop` and is not self-merged.
- Times are in EST.

### 12. Access

- DB password: 1Password `vibe_coding`, item "Supabase DB Password - shared POP database". Pooler `aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`. Read-only for inspection.
- On edge-dev3 use the 1Password op_run tool and `~/.local/bin/psql`.

## Part 4 — Landing

### 13. Done, risks, open questions

Done when:
- Steps 1–5 are ✅ with evidence.
- The shared-db PR is promoted to production.
- The DesignFlow PR is opened to `develop` with sandbox build green.
- This STATUS table is updated.

Risks:
- Callers that read `metadata->'submission_canonical'` break. Grep shared-db and the app repos for it before Step 1.
- Rollback: the columns are additive; the view can be dropped.

Open: the §8 open items.

## Self-audit (2026-11-13)

1. Could a fresh session execute it without asking? Yes. §2/§12 give access, §5 the exact current state, §9 the steps with gates.
2. Does it carry everything known, including what was ruled out? Yes. The duplicate check is in §6 and the rejected homes in §7.
3. Is the goal clear enough for judgment calls? Yes. §1 says four roles, one place, no duplicates, and the goal wins.
