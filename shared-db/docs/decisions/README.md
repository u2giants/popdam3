---
summary: "Index of settled design decisions and owner rulings for popcre/shared-db."
kind: living
status: current
read-when: browsing settled owner rulings or checking decisions before changing shared-db
---

# Decisions catalog

Settled design decisions and active owner rulings that future sessions must not contradict.
Search the `## decision` section of [`docs/INDEX.md`](../INDEX.md) for your topic and open only matching files.
When a decision is replaced, write the new file here and move the superseded file to `docs/archive/decisions/` with `kind: archive`.

- [ColdLion ERP data is canonical (§6.3)](2026-07-31-coldlion-erp-canonical.md) — ColdLion ERP data is canonical; follow ColdLion inactivations and removals rather than preserving stale raw records.
- [Master Data import is transitional and curated data outranks it (§6.4)](2026-08-03-master-data-import-transitional.md) — Google Sheets Master Data import is transitional; curated database edits outrank it and must not be overwritten.
- [DB Data Admin owns licensor-to-property parentage (§6.6, §6.12)](2026-08-03-db-data-admin-licensor-property-parentage.md) — DB Data Admin is the home for monitoring and establishing licensor-to-property parentage across all apps.
- [Feeds must not drop records; property codes are unique per licensor (§6.10)](2026-08-06-feed-does-not-drop-records.md) — Ingest feeds must not silently drop records; property codes are unique only per licensor (licensor_id, code).
- [DY and DS are one Disney licensor (§6.11)](2026-08-07-disney-dy-ds-one-company.md) — DY and DS are two spellings of the same Disney licensor company, not two separate licensors.
- [Public repository boundary: no personal identifiers or secrets (§6.14)](2026-08-09-public-repo-no-personal-identifiers.md) — popcre/shared-db is public; never commit personal identifiers, credentials, or new infrastructure project refs.
- [shared-db governs structure, not application data (§0.0-B)](2026-08-13-structure-not-data.md) — shared-db governs database structure (schema, migrations, RLS, functions); ordinary application data belongs to app sessions.
- [No licence contracts, term, or territory in the database (§6.16)](2026-08-19-no-licence-contracts-term-territory.md) — Licence contracts are not a database source; licence term and territory do not belong in the database at all.
- [ColdLion division code is the only division; EP001 filtered from new ingest (§6.1b, §6.17)](2026-08-19-coldlion-division-code-only.md) — ColdLion division codes (CW001, SP001, EH001, EP001) are canonical; DesignFlow numeric division IDs do not enter Supabase.
- [No contact information except PopCRM routing email (§6.19)](2026-09-06-no-contact-info-except-popcrm-routing-email.md) — Do not import or store contact information anywhere in the database except PopCRM email routing addresses.
- [Peanuts art program and WildBrain two-axis model (§6.20)](2026-09-07-peanuts-art-program-and-wildbrain-two-axes.md) — Peanuts property is the art program (not retailer initiative); WildBrain era and creative group are two separate axes.
- [No new direct database logins (§6.21)](2026-09-23-no-new-direct-database-logins.md) — Do not create new direct Postgres database logins; use sanctioned service/application access paths.
- [Disney DCP Vault artwork withdrawal signals settled (#3347)](2026-09-25-disney-dcp-vault-withdrawal-signals.md) — Disney DCP Vault artwork withdrawal signal handling is settled (#3347); follow the documented routing and never contact external parties.
- [Never ask Albert for technical approval or risk sign-off (§6.18, §6.23)](2026-09-30-albert-not-technical-reviewer.md) — Albert is a business owner, not a technical reviewer; never ask him for technical approval or risk-class sign-off.
- [Structural work is claim-first; orchestrator role is retired (§0.0-D)](2026-10-02-claim-first-no-orchestrator.md) — There is no orchestrator role; any session needing a structural change claims the exact objects on the existing issue and executes it.
- [Scraped submission Properties are 100% canonical (§6.31)](2026-10-26-scraped-submission-properties-canonical.md) — Properties scraped from licensor submission sites are 100% canonical for licensor-submission taxonomy.
- [User administration lives in DesignFlow PLM (§6.33)](2026-10-28-user-admin-in-designflow-plm.md) — User administration, permissions, and roles live in one place: DesignFlow PLM; all other apps read from it.
- [AI review is advisory and never a merge gate](2026-10-29-reviews-are-advisory.md) — AI review is advisory only and never blocks a merge or production promotion; findings become issues for the auto-fixer.
- [DC and Harry Potter are properties under Warner Bros (§6.34)](2026-11-01-dc-harry-potter-under-warner-bros.md) — DC and Harry Potter are properties under Warner Bros, not standalone licensors.
- [Claims idle for 10 days may be taken over (§6.35)](2026-11-02-idle-claim-takeover-10-days.md) — A structural claim or session idle for 10 days may be taken over by a fresh session.
- [All PRs to main merge through the GitHub merge queue](2026-11-12-merge-queue-only-for-main.md) — Every PR to main merges through GitHub's merge queue via plain gh pr merge; never use --admin or --squash.
- [Signed contract places OPA Properties under Disney, Marvel, or Star Wars (§6.36)](2026-11-12-opa-properties-under-disney-marvel-star-wars.md) — The signed contract places Disney OPA Properties under Disney, Marvel, or Star Wars; do not re-ask Albert.
- [core.property is ColdLion's Property list, filled daily from landing (§6.37)](2026-11-12-core-property-from-coldlion-daily.md) — core.property is ColdLion's Property list, populated daily via ColdLion -> landing table -> app table.
- [No ColdLion Property values are inactivated now (§6.39)](2026-11-13-no-coldlion-property-inactivation-now.md) — Do not inactivate ColdLion Property values right now; Ilona and Laura will decide later.
- [core.licensor comes only from ColdLion MG05 (§6.41)](2026-11-15-core-licensor-coldlion-mg05-only.md) — core.licensor is a nightly copy of ColdLion MG05 only, written solely by plm.sync_core_licensor_from_coldlion.
- [Production dflow seed schema retirement is a merged runbook, not a migration (#6325)](2026-11-15-dflow-snapshot-demolition-runbook-not-migration.md) — Production-only retirement of the stale dflow seed schema is executed via merged runbook, not a migration (#6325).
- [ColdLion MG groups are division-specific (§6.42)](2026-11-16-coldlion-mg-groups-division-specific.md) — ColdLion MG groups are division-specific; MG05=Licensor and MG06=Property apply only in CW001 and SP001.
- [Mickey/Minnie property codes and X-Men scrape precedence (§6.38, §6.40, §6.43)](2026-11-16-mickey-minnie-property-codes.md) — Mickey/Minnie codes: MM=Mickey alone, ME=Minnie alone, MMF=Mickey Group->Standard Characters; X-Men follows scrape.
