# CI audit backfill retirement evidence — issue #3986

Parent #3536. Albert authorized completion of the overall plan through subagents, with the coordinating session retaining merge decisions.

Read-only production confirmation on October 6, 2026 at 2:26 PM EDT used the documented production pooler and canonical vault password, through an isolated Node pg client in an explicit `BEGIN READ ONLY` transaction. No API requests or database writes were performed and no row identifiers were printed. The target was the documented shared production project; `current_database()` was postgres. PgBouncer did not retain the connection startup default_transaction_read_only setting, so the explicit transaction boundary enforced read-only access; current_setting(transaction_read_only) returned on.

- Prepack: harvested keys 2580; covered keys 2580; pending keys 0; landed rows 10120; distinct landed prepack keys 2578. Two covered keys returned zero rows.
- Production detail: population 3811; answered 3811; pending 0; successful keys 3803; explicitly refused/excluded keys 8; zero-row successful keys 1; fetched, landed and distinct primary-key counts each 17431; reconciliation agrees true.

The backfill workflow files are retired, while their bounded manual jobs remain in ColdLion Landing Sync. The new operation choice isolates refresh, prepack backfill and production-detail backfill. Only the refresh job is reachable on a schedule. Existing recovery parameters, offline contracts, production target declarations, secrets refusal, serialization and timeout budgets are preserved. Loader scripts remain unchanged. The daily full prepack refresh and bounded production-detail refresh remain unchanged.

The obsolete owner-decision workflow already refused every new record before checkout, under the September 30 owner ruling. Removing that producer does not revive human technical approvals. Its historical Python verifier and tests remain, together with the assigned AI reviewer risk-acceptance mechanism in the production lane.

A prototype was inspected and tested before the prospective contract. It was preserved as private scratch design evidence and discarded from the authoring worktree before publication of refs/db-contracts/3986/1. Implementation then resumed under the published prospective scope; this report does not claim retroactive pre-work evidence.

Validation: 79 Node tests passed; 24 historical owner-decision verifier tests passed; static SQL checks passed with no added migrations. New negatives verify schedule isolation, retained recovery parameters, offline checks before credentials, preserved loader and verifier files, and absence of redundant workflows. Exact-head assigned review and required GitHub checks remain mandatory.
