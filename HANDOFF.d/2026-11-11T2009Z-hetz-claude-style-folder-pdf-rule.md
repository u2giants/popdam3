---
issue: 958
status: OPEN
owner: claude/handoff-958-style-folder-pdf (session aaacb4ed-6ed0-441b-a688-2bf311cf2243)
---

# Style-folder PDF rule: live proof for SQX26DYMM03 still open

Written 2026-11-11 3:15 PM EST. All times below are EST (America/New_York).

## 0. Business decisions only the owner can make

One item, not blocking, a wrong guess is recoverable:

- **Receipts and UPC stickers will come in with the new rule.** Of the 89 PDFs
  the rule takes in, about 15 are paperwork that happens to sit directly in a
  style folder (for example `2991954-C_Receipt.pdf`, `VS1M7DCDC01 UPC STICKER.pdf`,
  `VSM22DCJG01 pre-pro photos.pdf`). **Recommendation: leave them out** by adding
  three "skip names containing" rules in Settings → Storage → Ingestion Rules
  (`receipt`, `upc sticker`, `pre-pro photos`). Not asked yet; ask once, after the
  live proof, together with the result. Blocks nothing.

Already settled, do NOT re-ask:

- 2026-11-11, Albert: "Yes, narrower rule" — take a PDF only when it sits
  directly in a style's own folder under `____New Structure` and that folder has
  no .ai or .psd. The broad version (any folder with no art file) was rejected
  because it would add 1,374 PDFs, about two-thirds paperwork.

Put the one open question to Albert in a single message, in plain business
words. No technical approval is needed from him for anything here.

## 1. What this application is

PopDAM is POP Creations' internal library of licensed product artwork (Disney,
Marvel and others). Design files live on a Synology NAS. A scanner program on
the NAS (the "bridge agent", container `popdam-bridge` on host `edgesynology1`)
walks the `Decor` share, picks files by rule, makes thumbnails and records them
in the shared Supabase database (project `qsllyeztdwjgirsysgai`), where the web
app shows them grouped by style number (SKU). Repository:
[u2giants/popdam3](https://github.com/u2giants/popdam3). Guide:
[AGENTS.md](https://github.com/u2giants/popdam3/blob/main/AGENTS.md).

## 2. What we set out to do, and why

Albert asked why style `SQX26DYMM03` is not in PopDAM. Cause: its NAS folder
`Decor/Character Licensed/____New Structure/In Development/Customer Adopted/Desperate Signs/Shane Desperate Signs SS24/SQX26DYMM03`
holds only `SQX26DYMM03 DE METAL SIGN.pdf`, `SQX26DYMM03.jpg` and four photos in
`PPS Photos`. The scanner takes .psd/.ai always, PDFs only when the name contains
a keyword (tech pack, licensing sheet, comp view), and images only when named
mockup or comp. Nothing in the folder qualified. The style exists in the ERP
mirror (`plm.item.item_number = 'SQX26DYMM03'`). Albert then chose a new rule
(section 0) so such styles appear.

## 3. Current state

Done and verified:

- Rule merged: [PR #959](https://github.com/u2giants/popdam3/pull/959), squash
  commit [be26393](https://github.com/u2giants/popdam3/commit/be26393553d73bbb7c5cd398c7de12ed1d551387),
  2026-11-11 about 1:56 PM.
  - Shared rule `takesAnyPdfInFolder` in
    [packages/agent-common/src/ingestion-rules.ts](https://github.com/u2giants/popdam3/blob/main/packages/agent-common/src/ingestion-rules.ts)
    and its test-enforced identical copy
    [supabase/functions/_shared/ingestion-rules.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/ingestion-rules.ts).
  - Scanner applies it per folder:
    [apps/bridge-agent/src/scanner.ts](https://github.com/u2giants/popdam3/blob/main/apps/bridge-agent/src/scanner.ts)
    (`anyPdfTaken`). Bridge agent version 1.16.26.
  - Settings text and path tester:
    [src/components/settings/IngestionRulesTab.tsx](https://github.com/u2giants/popdam3/blob/main/src/components/settings/IngestionRulesTab.tsx).
  - Test: [src/lib/ingestion-rules.test.ts](https://github.com/u2giants/popdam3/blob/main/src/lib/ingestion-rules.test.ts).
  - Doc: [docs/configuration.md](https://github.com/u2giants/popdam3/blob/main/docs/configuration.md) → `INGESTION_RULES`.
- Deploys from that commit all succeeded: Publish Bridge Agent, Deploy Supabase
  Edge Functions, Publish Frontend Image, Publish Windows Agent, CI.
- NAS bridge `synology-bridge-1` updated through the app's own Update action at
  1:58 PM; at 2:00 PM it reported version 1.16.26, build `be26393`, no error.
- Windows render agent: the same Update action reached it 30 seconds before its
  new build finished publishing, so it logged one checksum mismatch. Its own
  10-minute check retried; at 2:13 PM it reported 0.17.0.209, no error. Closed.
- Full scan requested through the app's `trigger-scan` action at 2:01 PM
  (request `245e2f92-3cc9-4779-ab1f-578d6e86569c`), claimed at 2:01 PM, running
  on 1.16.26. At 3:09 PM it was at
  `____New Structure/Concept Approved Designs/FUNCTIONAL WALL/DFP_Dry erase/16x20/Warner Bros/DFP62FRFN01`.

Not done:

- **Live proof.** At 3:09 PM there was no `assets` row for `SQX26DYMM03` and no
  new-rule PDF had been ingested yet (the scan had not reached a qualifying
  folder). Issue [#958](https://github.com/u2giants/popdam3/issues/958) carries
  the open `live proof` checkbox.

## 4. What did not work

- Looking in the obvious place (`WALL ART/CSM - Tin signs/12x16/Disney`) found
  only `SQX26DYNX01`. The style is under `In Development/Customer Adopted`, not
  under approved designs. A name search across `____New Structure` found it.
- `ai-pr-wait 959` kept waiting on a cancelled, non-required `Supabase Preview`
  check for about 45 minutes. Every real check had passed; the PR was merged by
  hand. If that waiter stalls on an advisory check again, read the check list
  and merge.
- Sending the app's Update action while `Publish Windows Agent` was still
  running caused the Windows checksum mismatch above. Wait for every publish
  run to finish before using Update.
- Waiting on GitHub runs with `gh run watch` in a background shell was refused
  by the session's permissions; a Monitor poll over `gh run list` worked.
- First estimate said the rule adds 78 PDFs. That used a looser SKU pattern. The
  shipped rule, run against the full NAS listing, adds 89.

## 5. Root causes and key findings

- The scanner's PDF and image filters are name-only keyword lists; a style
  whose only design file is an oddly named PDF never appears.
- Style folder shape used by the rule is the same as `extractSkuFolder` in
  [supabase/functions/_shared/style-grouping.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/style-grouping.ts):
  letters and digits only, both present, 7 or more characters.
- "No art file" is judged on the style folder's own files only. Art in a
  subfolder does not switch the rule off.
- Bridge updates are not automatic: publishing only records
  `BRIDGE_LATEST_BUILD`; the agent updates when the app's Update action
  (`admin-api` → `trigger-agent-update`, `update_action: apply`) is sent. That
  action also flags every Windows render agent.
- Auto-scan runs every 2 hours after the last scan ends
  (`admin_config.AUTO_SCAN_CONFIG`); a full scan took about 22 hours last time
  (2026-11-10 2:28 PM to 2026-11-11 12:53 PM).
- The scan walks folders in name order: `___OLD`, then `____New Structure`
  (`Concept Approved Designs`, `Discontinued`, `Freelancer art`,
  `In Development`, `Product Ideas`). Measured pace between 2:13 PM and 3:09 PM:
  about 94 art/PDF files per minute, which puts the Desperate Signs folder at
  roughly **5:30 AM on Thursday 2026-11-12**. Treat 7:00 AM as the recheck time.
- The read-only listing used for all counts is on `edgesynology2` at
  `/volume1/docker/synology-monitor-agent/manual-scans/popdam-pdf-rule-estimate-2026-11-11T1723Z/`
  (`files.tsv`: 137,957 lines of size and path for every .pdf/.ai/.psd under
  `____New Structure`; exit code 0, no errors). No user data was changed.

## 6. Exact next steps

1. At or after 7:00 AM EST on 2026-11-12, query the live database (project
   `qsllyeztdwjgirsysgai`; first run `select max(created_at) from public.assets`
   and confirm it is today, because the default Supabase tool can point at a
   frozen old project):
   `select relative_path, created_at from public.assets where relative_path ilike '%SQX26DYMM0%';`
   You'll know it worked when `…/SQX26DYMM03/SQX26DYMM03 DE METAL SIGN.pdf` is
   returned (and the same for 01, 02, 04, 05).
2. If nothing is returned, read `admin_config` keys `SCAN_PROGRESS` and
   `SCAN_REQUEST`. If `current_path` is still before
   `____New Structure/In Development/Customer Adopted/Desperate Signs`, the scan
   has not arrived: wait and repeat step 1. If it is past that folder, or the
   scan ended, the rule failed live: check
   `agent_registrations.metadata->'version_info'` for `synology-bridge-1` is
   still 1.16.26, then debug `anyPdfTaken` in the scanner. You'll know which
   case you are in from `current_path`.
3. Confirm the style is visible in the app: sign in to PopDAM with the viewer
   test login (section 8), search `SQX26DYMM03`, and see the style card. A style
   group may only appear after the nightly `rebuild-style-groups` job; if the
   asset row exists but the card does not, check
   `select * from public.style_groups where sku ilike 'SQX26DYMM03'` after the
   next nightly run. You'll know it worked when the card shows with the PDF.
4. Tick `live proof` on [#958](https://github.com/u2giants/popdam3/issues/958)
   with the query result, close the issue, and delete this file in the same
   pull request.
5. Tell Albert the result in plain words and ask the one question in section 0.

## 7. Constraints and gotchas

- Never push to `main`; branch and pull request. The AI merges.
- Do not modify the bridge self-update code
  ([docs/KNOWN_QUIRKS.md #26](https://github.com/u2giants/popdam3/blob/main/docs/KNOWN_QUIRKS.md)).
- Any change under `apps/bridge-agent/` publishes a new scanner image; bump its
  version in the same commit.
- The two `ingestion-rules.ts` copies must stay byte-identical (a test fails
  otherwise).
- Read the NAS on `edgesynology2`; write only on `edgesynology1`. NAS reads over
  25 seconds run as a detached low-priority job.
- Folders named `_old` and `sample` are always skipped, so PDFs there never come
  in even under the new rule.
- Rules affect future scans only; nothing is ever deleted by a rule.
- Style group ids change nightly; identify by SKU.

## 8. Access and environment

- GitHub CLI signed in as `u2giants`.
- Supabase: `mcp__supabase__execute_sql` pointed at the live project in this
  session (verified by a same-minute `max(created_at)`); verify again.
- App admin actions were sent as the administrator test login, 1Password vault
  `vibe_coding`, item id `7s5uzpbjenka4fpvrqogh44bre` (fields `username`,
  `password`), through a password sign-in and a POST to
  `https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/admin-api`. The
  publishable key is in
  [src/lib/app-mode.ts](https://github.com/u2giants/popdam3/blob/main/src/lib/app-mode.ts).
  Viewer test login for visual checks: item id `mbspkosvp2rf25qxhqufipxqca`.
- NAS: SSH aliases `edgesynology1` and `edgesynology2` work without a prompt.
- Task gate: this change is class `deployment` (`ai-task-gates start --class deployment`).

## 9. Open questions and risks

- 2026-11-11: the 5:30 AM estimate ignores images and assumes a steady pace;
  the scan could be hours slower in `WALL ART`, the largest folder.
- 2026-11-11: the next auto-scan starts 2 hours after this one ends, so a
  missed folder gets another pass within about a day without action.
- 2026-11-11: about 15 paperwork PDFs come in with the rule (section 0).
- 2026-11-11: a style with a PDF in its folder and its art only in a subfolder
  now also gets that PDF. Accepted as within the ruling; not measured separately.

## Self-audit

1. Newcomer can continue cold: sections 1 to 3 give the app, the change and the
   exact state; section 6 gives the query, the branch for each outcome and the
   close-out. Yes.
2. As effectively as the author: pace measurement, scan order, the update and
   scan actions, and the listing location are in sections 5 and 8. Yes.
3. Every relevant detail: background 2, goal 2, state 3, failures 4, decisions 0
   and 9, constraints 7, next actions and gates 6, evidence 3. Yes.
4. Owner-only sweep: the only business judgement anywhere is whether paperwork
   PDFs stay out (sections 0 and 9). No technical approval is asked. Yes.
