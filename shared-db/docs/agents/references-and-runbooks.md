# AGENTS.md — §8, §8.1, §9, §10, §10.1-10.3/§11 (project references, credentials runbook, further reading, traps)

> Moved verbatim from `AGENTS.md` by issue #3481 so that file stays a short router. Section numbers and headings are unchanged; a citation of "AGENTS.md §X" resolves here. Relative link targets were re-pointed from this folder; no rule text changed.

## 8. Project references

```text
Preview project ref:    read the repository variable PREVIEW_PROJECT_REF — never a literal
Production project ref: qsllyeztdwjgirsysgai
```

⚠️ **Do not write a preview project ref down anywhere.** Preview is rebuilt from time to time and
its ref changes when it is; `rjyboqwcdzcocqgmsyel` was deleted on 2026-08-18 and this block still
named it as current until 2026-08-20. See §4 rule 2.

Never commit anon keys, service-role keys, database passwords, or `.env` files.


### 8.1 API-exposed schemas (PostgREST) — `dam` is NOT exposed (2026-07-15)

`pgrst.db_schemas` on prod = `public, graphql_public, api, crm, pim, core, app`.
An app schema is exposed only when that app queries it from the browser (`crm`,
`pim`, `core`). **`dam` is intentionally absent** — it holds PopDAM worker-internal
tables (`dam.sku_human_description`, `dam.pdf_rich_extraction`) that the DAM
frontend never touches (DAM queries `public`). Any PostgREST call to `dam.*` —
even with `service_role` — fails with **`Invalid schema: dam`**. Reach `dam.*`
from workers/edge through **`public` `SECURITY DEFINER` functions granted to
`service_role`** (e.g. `public.get_pdf_rich_extraction_hashes`,
`public.upsert_pdf_rich_extraction`, `public.refresh_style_group_rich_metadata`).
Do **not** add `dam` to `pgrst.db_schemas` to "fix" this — it broadens the shared
API surface for every app and would require RLS on every `dam` table.

## 9. Supabase CLI and database credential runbook

**Full runbook — every credential, the canonical login/link flow, and the Windows traps —
[`docs/agents/runbooks-credentials-cli-and-gotchas.md`](../../docs/agents/runbooks-credentials-cli-and-gotchas.md).
Read it when you are about to connect, not at session start.** The headlines:

- **Use the canonical credentials in 1Password vault `vibe_coding`.** Never work around an auth
  failure with manual SQL, dashboard edits, copied browser tokens, or one-off connection strings.
  Fix the login path, then prove it with `supabase projects list`, `supabase link`, and
  `supabase db push --dry-run`. **Fetch 1Password items serially — never fan out `op read`.**
- Production project `qsllyeztdwjgirsysgai`. **The preview project ref is not written down** —
  read it from the repository variable `PREVIEW_PROJECT_REF` (see §4 rule 2).
- **`psql` is NOT installed on the Windows dev machines.** Use Node + `pg` against the pooler
  (`aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`).
- **Never route the 1Password `op_run` tool through `bash` on Windows** — a bare `bash` there is
  WSL, which does not inherit the injected environment, so secrets arrive empty and it looks like
  a broken tool. Use cmd.exe, PowerShell, or `node`.
- The preview-credentials item title contains parentheses and **cannot be used in an `op://`
  reference** — address it by item ID. IDs can be re-keyed; re-resolve by title if one 404s.
- **Presence is not capability.** A tool answering `--version` proves nothing about whether the
  operation works. Exercise the real operation before trusting it.
## 10. Where to read more

**The long form of this file lives in [`docs/agents/`](../../docs/agents/) and
[`docs/owner-rulings.md`](../../docs/owner-rulings.md).** `AGENTS.md` was cut from 234 KB to under 80 KB
across issue #1331 and PR #1212, because it is loaded in full at the start of every session.
**Nothing was resolved or deleted in either move — the full text is verbatim in these files**, and
each section above points at the one that carries it. **Section numbers never change**; supersede
in place, the way §6.13-A supersedes §6.13. CI workflow comments and
`scripts/production_migration_guard.py` cite these numbers.

| File | Carries |
| --- | --- |
| [`docs/agents/section-4-anti-collision-rules.md`](../../docs/agents/section-4-anti-collision-rules.md) | §4 in full — migration author lanes, object claims, reviewer rotation, the business-risk gate, the preview rehearsal and its recovery lane |
| [`docs/agents/section-6-in-flight-long-form.md`](../../docs/agents/section-6-in-flight-long-form.md) | The §6 in-flight narrative in full — ERP mirror relocation, cutover scoreboard, the five ColdLion history traps, ERP business meaning |
| [`docs/agents/runbooks-credentials-cli-and-gotchas.md`](../../docs/agents/runbooks-credentials-cli-and-gotchas.md) | §9, §10.1–§10.3, §11 in full — credentials, CLI, hosted-Supabase traps |
| [`docs/owner-rulings.md`](../../docs/owner-rulings.md) | §6.1–§6.17, §0.1-A, §4.2, §4.3 in full — every owner ruling with its reasoning, incident and measured numbers |
| [`docs/production-promotion-procedure.md`](../../docs/production-promotion-procedure.md) | §5.1 in full — the bounded-checkout recipe and the production apply lane |
| [`docs/agents/ephemeral-route-hop-table.md`](../../docs/agents/ephemeral-route-hop-table.md) | The self-service additive lane's end-to-end merge route — who may dispatch, the boundary classifier, and the completion hops |

**Where `AGENTS.md` and a long-form file differ in wording, `AGENTS.md` wins** — it is the
authoritative statement of policy.

- App rewrite guides: [`docs/ai-session-instructions/`](../../docs/ai-session-instructions/README.md)
- Shared branch workflow: [`docs/ai-session-instructions/shared-supabase-branch-workflow.md`](../../docs/ai-session-instructions/shared-supabase-branch-workflow.md)
- Schema ownership map: [`docs/unified-supabase-schema-map.md`](../../docs/unified-supabase-schema-map.md)
- Migration risks: [`docs/unified-supabase-migration-gaps.md`](../../docs/unified-supabase-migration-gaps.md)
- CRM production cutover (migrations promoted, Azure OAuth, auto-provision, data import): [`docs/app-migration-notes/popcrm-web-production-cutover-20260621.md`](../../docs/app-migration-notes/popcrm-web-production-cutover-20260621.md)
- CRM crm.* direct-write DML grants (fixes Triage 42501 on department create; RLS ≠ grant): [`docs/app-migration-notes/popcrm-web-20260716.md`](../../docs/app-migration-notes/popcrm-web-20260716.md)
- **`public` schema anon lockdown (2026-07-29) — read before creating a function or a view in `public`:** [`docs/security/public-schema-execute-audit.md`](../../docs/security/public-schema-execute-audit.md) (EXECUTE grants; 88 of 99 SECURITY DEFINER functions were anon-callable) and [`docs/security/public-schema-anon-read-audit.md`](../../docs/security/public-schema-anon-read-audit.md) (table/view reads; ~27,000 rows were anon-readable). Summarised as a standing rule in §10.2 above.
- **PopDAM access — read before granting/revoking/debugging a user's access:** [`docs/popdam-access-provisioning.md`](../../docs/popdam-access-provisioning.md). Permissions run on **three independent axes across two schemas**. `public.app_access('popdam')` alone lets someone log in and **see nothing**: every `core.*`/`api.*` policy is **app-schema** gated (`app.has_any_role(...)`), so a user with no active `app.user_role` gets `HTTP 200` with an empty array — success-shaped and data-free. On 2026-07-26, **18 of 35 PopDAM users** were in exactly that state.

- **Cross-workflow take-over (2026-07-31):** [`orchestrator_take_over.md`](../../orchestrator_take_over.md).
  Splits four in-flight threads — characters/style guides, ColdLion source-of-truth, licensing
  coordination, shared-db hygiene — into what is done, what is verified vs merely documented, what
  blocks each, and the failed paths not to repeat. **Read its §1 table before picking up any of
  those four.** Characters/style guides has its own STATUS table in
  [`fix_characters_style_guides.md`](../../fix_characters_style_guides.md) — **read that table first; do
  not re-derive or re-plan the phases.**

## 10.1–10.3 and §11 — traps that cost real time (full text in the runbook)

**Full text:
[`docs/agents/runbooks-credentials-cli-and-gotchas.md`](../../docs/agents/runbooks-credentials-cli-and-gotchas.md).**
Read the relevant part when you hit the situation. The headlines, so you recognise it:

- **§10.1 Clean-slate local replay is unsupported — use the dependency closure.** Applying every
  migration in filename order against an empty local Postgres **cannot work and never could**.
  About 170 files are intentionally **empty markers** lining the ledger up with objects created
  before `shared-db` became canonical; nothing here ever creates them. A full replay produces ~63
  failures of exactly that class. This is by design — not a bug, not something to "fix".
- **§10.2 Grants in `public` are locked down by default (since 2026-07-29) — READ THIS BEFORE
  CREATING A FUNCTION.** An event trigger revokes EXECUTE from PUBLIC and `anon` on every new
  `public` function. **A new function in `public` is reachable by nobody except `postgres` and
  `service_role` unless your migration grants it explicitly.**
- **§10.3 A Node CLI in `tools/` that hand-builds its direct-invocation guard does nothing on
  Windows and exits 0.** A silent success is worse than a failure. Check the entry guard before
  believing a runner "succeeded".
- **§11 Hosted-Supabase gotchas.** **PostgREST schema exposure is control-plane config, NOT SQL** —
  `alter role authenticator set pgrst.db_schemas` does not take effect on hosted Supabase; use the
  Management API `PATCH /v1/projects/{ref}/postgrest`. It is per-project: re-confirm after any
  restore/clone and set it on preview too. If supabase-js suddenly 404s on `api.*`/`crm.*`, check
  this first. **`service_role` has no rights on non-`public` schemas by default.**
