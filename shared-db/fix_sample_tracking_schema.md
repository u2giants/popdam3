# DesignFlow Sample Tracking — Shared Database Implementation Plan

**Status:** APPLIED to preview **and production**. The full schema (restore +
uniqueness, quantity movements, ownership, shipment intent, closeouts, durable
imports, permissions, and read models) is merged to `main` and live on both
preview (`rjyboqwcdzcocqgmsyel`) and production (`qsllyeztdwjgirsysgai`).
Migrations occupy the clean contiguous range `20260722221000`–`20260722221700`
after the `220000` collision was fixed (PRs #164, #166, #168, #170 — all merged).
Production ledger `221000`–`221700` and every object verified present 2026-07-22
(read-only). Evidence: `docs/verification/sample-tracking-quantity-schema-20260722.md`.
One cosmetic open item: production records the PopSG trigram migration at old
version `220000` while on disk it is `220800` (idempotent `CREATE INDEX IF NOT
EXISTS`; ledger-only drift, no functional impact).

**Created:** 2026-07-22

> ### Progress log — 2026-07-22
>
> **Gates 1–3 (§14) complete — read-only inventory, no data mutated.** Full
> catalog + count + membership audit of all seven sample tables on **both**
> preview (`rjyboqwcdzcocqgmsyel`) and production (`qsllyeztdwjgirsysgai`):
> [`docs/verification/sample-tracking-inventory-20260722.md`](docs/verification/sample-tracking-inventory-20260722.md).
> Confirmed: `dflow.sample_shipment_item` is **absent in both** environments;
> `plm` retains all seven; tiny legacy footprint; **zero memberships and zero
> duplicate `(sample_id_fk, box_id_fk)` groups anywhere**.
>
> **Migration steps 1 & 4 (the missing-table repair + membership uniqueness)** —
> now live at the re-timestamped versions below (originally authored at
> `220000/220100`, moved past the PopSG-trigram `220000` collision by PR #168):
> - `supabase/migrations/20260722221000_restore_dflow_sample_shipment_item.sql`
>   — recreates `dflow.sample_shipment_item` from the `plm` template (identity PK,
>   the two intra-cluster FKs with plm's ON DELETE rules, plus FK-supporting
>   indexes). Idempotent/defensive per §5.1. Fixed the live
>   `relation "dflow.sample_shipment_item" does not exist` failure and the
>   tracking service's fail-closed factory→NYC path.
> - `supabase/migrations/20260722221100_dflow_sample_shipment_item_membership_uniqueness.sql`
>   — adds `UNIQUE(sample_id_fk, box_id_fk)` (the safeguard the tracking service
>   itself anticipates), with a **loud abort-guard** that refuses to add the
>   constraint if any duplicate memberships exist (no silent failure / no blind
>   row-number delete).
> - `supabase/tests/dflow_sample_shipment_item_restore.sql` — transactional,
>   rolled-back verification of structure, FKs, indexes, the unique constraint,
>   concurrent-duplicate rejection, NULL-box distinctness, and ON DELETE CASCADE.
>
> **Quantity tranche:** migrations `20260722221200` through `20260722221700`
> (ownership + legacy state, shipment intent, movements + closeouts, durable
> imports, read models, contract hardening) add durable ownership, normalized
> immutable movements, shipment intent, stop closeouts, durable imports, read
> models, and fail-closed browser grants. `221700` (contract hardening) sorts
> last because it ALTERs the tables created at `221400`/`221500` (PR #170).
> Inventory-based decisions and acceptance evidence:
> `docs/verification/sample-tracking-quantity-schema-20260722.md`.
>
> **Applied state:** the whole `221000`–`221700` block is merged to `main` and
> live on **both preview and production**. Production ledger and objects verified
> present 2026-07-22 (read-only). Consumer service wiring remains separate; legacy
> quantities were not fabricated.

**Repository:** [`u2giants/shared-db`](https://github.com/u2giants/shared-db)

**Owning schema:** `dflow` in the shared Supabase project

**Production project:** `qsllyeztdwjgirsysgai`

**Preview project:** `rjyboqwcdzcocqgmsyel` (`shared-db-schema-rehearsal`; re-verify against `AGENTS.md` before use)

**Consumer services:** `popcre/designflow-tracking` and `popcre/designflow-frontend`
**Database rule:** all DDL, constraints, indexes, views, backfills, and database tests for this feature are authored here first. No DesignFlow application repository may add its own migration or startup DDL.

---

## 1. What DesignFlow and Sample Tracking are

DesignFlow is POP Creations' product-lifecycle-management application. Factory users, Sourcing,
Production, the Ningbo office, and the New York office use its Sample Tracking function to record
physical product samples as they are created, shipped, received, retained, forwarded, returned, or
delivered to a customer.

The current application treats one sample row as if it has one quantity, one status, one office, and
one box. That cannot represent the real business process because one sample batch can split across
several places. The redesigned system treats one sample row as a **sample batch/style/type**, while
immutable quantity movements account for the physical pieces in that batch.

### Canonical four-piece scenario

One factory makes four pieces of the same sample:

1. The factory declares that it made four and ships all four to Ningbo.
2. Ningbo receives four, retains one in China, and ships three to New York.
3. New York receives three, retains two, and ships one to the customer.
4. The customer receives one.

At the end, all four pieces remain accounted for: one retained in Ningbo, two retained in New York,
and one delivered to the customer. Ningbo and New York may each close their **local handling work**
once their received quantity is fully allocated, but the overall sample batch is not globally
complete until no piece remains in transit or otherwise unresolved.

India factories normally ship directly to New York instead of passing through Ningbo. That is the
same normalized `factory_to_nyc` route with a specific factory identity; it is not a special
country-shaped custody bucket.

The feature must also support quality-reference samples, new-product-idea samples, new
embellishment/treatment-idea samples, and pre-production samples. Pre-production may link to
DesignFlow Licensing Tracking when the selected item has licensing context, but licensing is not a
prerequisite for a sample to exist.

---

## 2. Why this work belongs in shared-db

The database is shared by DesignFlow and other POP applications. A schema change made inside an app
repository can silently diverge from the canonical database or break another consumer. This plan is
therefore the only database implementation authority for Sample Tracking.

The required work includes new tables/columns, uniqueness and conservation constraints, normalized
location identities, read views, and legacy reconciliation. Those are database contracts, not
application implementation details. DesignFlow may update Sequelize models and services only after
the corresponding shared-db migration is reviewed, proven on preview, merged, and applied.

No direct SQL against production is authorized by this plan. No migration is to be applied merely
because this document exists.

---

## 3. Verified current state and immediate defect

### 3.1 Existing tables

The DesignFlow sample domain consists of these legacy tables:

- `sample`
- `sample_attachment`
- `sample_box`
- `sample_comments`
- `sample_event`
- `sample_factory_group`
- `sample_shipment_item`

The schema-segregation inventory lists all seven in
`docs/designflow-master-data-migration/designflow-schema-segregation.md`.

### 3.2 Restore migration omitted one table

Migration `20260721201500_restore_dflow_sample_tracking_tables.sql` restored only six tables from
`plm` into the runtime `dflow` schema. It omitted `dflow.sample_shipment_item`. The running tracking
service nevertheless reads and writes that table for box membership. The observed application
failure was:

```text
relation "dflow.sample_shipment_item" does not exist
```

This omission must be reconciled before adding a uniqueness constraint or any new shipment model.
The implementing session must inspect preview and production rather than assuming the table is absent
everywhere or empty. Never create a second competing table without first establishing actual state.

### 3.3 Current membership race

The application now performs a transaction-wrapped existence check before inserting a sample into a
box and treats ordinary retries idempotently. That prevents common duplicates but cannot prevent two
concurrent transactions from both observing no row and both inserting. The definitive safeguard is a
database unique constraint on `(sample_id_fk, box_id_fk)` after existing duplicates are audited and
resolved.

### 3.4 Current model cannot represent quantity splits

Legacy `sample.quantity`, `sample.status`, `sample.office_location`, and `sample.box_id_fk` are scalar
compatibility fields. `sample_shipment_item` records membership but not intended or received quantity.
Neither table can represent simultaneous retained and in-transit balances. They must not become the
new quantity authority.

---

## 4. Decisions already made

1. One sample row represents a sample batch/style/type, not one physical piece.
2. Tracking numbers and carrier state belong to a box, never to individual sample rows.
3. Every custody stop declares quantity received or made and quantity sent onward; any remainder is
   explicitly retained, returned, damaged/lost, disposed, or left open.
4. The physical-quantity authority is immutable movement history. There is no second editable
   `current_quantity` authority.
5. Each movement transfers a **positive** whole-number quantity from one normalized typed location to
   another. Current balance equals inbound minus outbound movements.
6. Corrections are compensating movements linked to the original; posted history is never edited or
   deleted.
7. Manual UI entry, spreadsheet import, and future carrier automation all call the same movement
   service and create the same receipt/movement records.
8. Local stop closeout is distinct from global sample completion.
9. Legacy quantities remain unknown unless evidence proves them. Never backfill an unknown legacy
   sample as quantity one.
10. Database design is additive first. Legacy fields remain readable during rollout.
11. Vendor/factory tenancy comes from authenticated factory identity, not email parsing.
12. Carrier email/API automation is a later phase and must never create a parallel receipt authority.

---

## 5. Required data model

Names below are proposed contract names. The implementing session must compare them with actual
preview/production catalogs and existing repo conventions before writing migration SQL. Any justified
renaming must be reflected in this plan and the consumer contract before implementation.

### 5.1 Repair and harden `dflow.sample_shipment_item`

Required responsibilities:

- one current membership row per `(sample_id_fk, box_id_fk)`;
- foreign keys to `dflow.sample` and `dflow.sample_box` with deliberate delete behavior;
- `factory_group_id_fk` only if still required for compatibility;
- controlled `leg_type` route token;
- intended shipment quantity for this sample batch in this box;
- creator/time audit;
- idempotency/correlation token where appropriate.

Required immediate constraint:

```text
UNIQUE (sample_id_fk, box_id_fk)
```

Before adding it, run a read-only duplicate report grouped by both keys. For every duplicate set,
capture row identifiers, sample, box, route leg, timestamps, and creator. Resolve duplicates only
after determining whether they are exact retries or represent distinct historical legs that were
incorrectly placed in one current-membership table. Preserve evidence in migration verification
notes. Do not use a blind `DELETE ... WHERE row_number > 1`.

The migration must be safe when `dflow.sample_shipment_item` is missing, present and empty, present
with clean rows, or present with duplicates. Split repair/backfill/constraint into separate migrations
if that produces clearer review and rollback boundaries.

### 5.2 Durable box ownership

Add durable ownership to `dflow.sample_box`, proposed as `owner_factory_id_fk` referencing the
canonical DesignFlow factory/vendor identity used by current sample rows. Requirements:

- stamped when a vendor creates a box;
- immutable to vendors;
- nullable only for explicitly internal/shared legacy boxes during transition;
- indexed for tenancy reads;
- backfilled only from unambiguous evidence;
- ambiguous or mixed legacy boxes must remain flagged for internal reconciliation rather than being
  assigned arbitrarily.

The current application derives box ownership from carried samples or empty-box creator as a
conservative bridge. Remove that bridge only after this column is populated and consumer code has
switched.

### 5.3 Normalized locations

Use typed location identity rather than hard-coded office strings:

- `factory`
- `office`
- `customer`
- `in_transit`
- `terminal`

Each movement needs source and destination type, stable identifier where applicable, and a display
label snapshot for audit. Ningbo and New York should be configured office records. Factory and
customer locations must reference stable existing identities when possible. `in_transit` should
correlate to a box/shipment leg. Terminal destinations include created/source, delivered, disposed,
cancelled, damaged/lost, or other explicitly approved dispositions.

Do not encode each factory, country, office, or route as a new column.

### 5.4 `dflow.sample_movement` — sole physical-quantity authority

Each posted row moves a positive quantity from one normalized location to another.

Required fields/semantics:

- movement primary key;
- sample foreign key;
- positive whole-number quantity;
- normalized source type/id and destination type/id;
- box and shipment-line references when transport is involved;
- lifecycle action and prior/resulting status context;
- discrepancy code/details where applicable;
- actor user, actor role, actor factory, and event timestamp;
- request/idempotency key with a uniqueness guarantee;
- optional `reversal_of_movement_id` or correction relationship;
- created timestamp; no update/delete workflow for posted movements.

Creation is represented as a movement from a terminal `created` source to the factory/source
location. Shipping moves quantity from a physical location to a specific in-transit box/leg.
Receiving moves it from that in-transit location to the receiving location. Retention is a balance at
the physical location plus local closeout; it is not a fake terminal movement unless the business
explicitly classifies the retained piece as terminal. Customer delivery, disposal, return, and loss
use explicit destinations.

Required database protections:

- quantity is a positive integer;
- idempotency key is unique in the appropriate scope;
- source and destination are not identical;
- required location identifiers exist for their type;
- referenced sample/box/shipment rows exist;
- reversal/correction cannot point to itself and must concern the same sample;
- posted movement rows cannot be silently updated/deleted by normal application roles.

Preventing a negative source balance under concurrency requires transactional locking in the service
and a database-enforced mechanism agreed during implementation. A simple pre-insert `SELECT` without
locking is insufficient. The migration tests must demonstrate two concurrent attempts cannot consume
the same remaining units.

### 5.5 Shipment intent versus actual movement

Shipment-line intended quantity is a plan. Movement quantity is actual physical custody. They must
not be conflated.

- Packing a box records intended quantity.
- Shipping posts the movement into the box's in-transit location.
- Receiving posts the actual quantity out of transit.
- Short/over/damaged receipts require discrepancy information and leave every unit accounted for.

If `sample_shipment_item` cannot cleanly hold multiple historical legs, introduce an additive
shipment-line table and keep `sample_shipment_item` as a compatibility/current-membership adapter.
Make this decision from actual data and consumer queries, not convenience.

### 5.6 `dflow.sample_stop_closeout`

Record when one location has fully allocated its handling work. Required fields:

- sample and normalized location;
- movement watermark or revision being closed;
- closeout actor/time;
- note/reason;
- reopening/revision relationship if later activity arrives.

A stop may close only when all quantity received at that stop has been allocated to onward movement,
retention, return, disposition, or an explicitly open exception. Closing Ningbo or New York does not
automatically close the global sample batch.

### 5.7 Durable spreadsheet import records

The upload workflow needs durable records so preview and confirmation are auditable and idempotent.
At minimum record:

- import job ID, template version, content/file hash, uploader, role/factory scope, timestamps, state;
- source filename and private object-storage reference if retention is approved;
- per-row normalized values, validation errors/warnings, image status, and resolution choices;
- aggregate row/photo/sample/box counts;
- confirmation idempotency key and resulting box/sample references;
- failure/retry status without partial silent success.

The workbook binary and images belong in approved private object storage, not large database blobs.
The database stores references and audit metadata.

### 5.8 Derived read models

Create views or equivalent stable read contracts for:

- balance by sample and normalized location;
- quantities in transit by box and route leg;
- open local-stop work;
- globally outstanding sample batches;
- discrepancies between intended and actual receipt;
- derived global completion.

Views derive from movements and closeouts. They must not treat legacy scalar status/location/quantity
as authoritative after migration. Define grants and RLS/access behavior explicitly; a view being
readable through PostgREST is not automatic.

---

## 6. Quantity conservation and transaction rules

For each sample batch:

```text
total created
= sum(current balances at every physical location)
 + sum(current balances in every in-transit shipment)
 + sum(terminally delivered/returned/disposed/lost quantities)
```

Every service transaction must:

1. authenticate and authorize the actor;
2. lock the relevant sample balance/movement stream;
3. derive the source balance from posted movements;
4. reject over-allocation;
5. validate route, box ownership, and destination;
6. insert movement(s), shipment intent, discrepancy, and closeout changes atomically;
7. return the derived balances;
8. make an identical idempotency-key retry return the original result;
9. make a conflicting reuse of an idempotency key fail loudly.

No importer, carrier worker, or UI endpoint may bypass this transaction service with direct quantity
writes.

---

## 7. Authorization and tenancy contract

### Vendor/factory users

- may see and create only their factory's sample batches and boxes;
- may not assign another factory ID from request data;
- may not mutate mixed/foreign boxes;
- may ship only available quantity owned by their factory/source workflow;
- direct factory-to-New-York route requires persisted approved route evidence.

### Sourcing and Production

- may import and operate within granted locations/workflows;
- may resolve discrepancies and approved corrections with audit;
- may not create unaudited history rewrites.

### Office users

- receive, count, split, retain, repack, forward, and close work for their authorized office;
- actual received quantity is explicit and discrepancies are required when it differs from intent.

### Read-only and unknown actors

- receive no mutation grants;
- direct handler/RPC calls fail closed even if an application router normally blocks them.

RLS, grants, functions/RPCs, and service-role boundaries must be designed together. An RLS policy is
not a table grant. Use the repo's established patterns and verify with each real role.

---

## 8. Legacy data strategy

1. Inventory counts and null patterns for all seven legacy sample tables in preview and production.
2. Report duplicate shipment memberships and cross-box inconsistencies.
3. Classify legacy samples as `known`, `reconciled`, or `unknown` quantity state (exact representation
   decided in migration review).
4. Do not synthesize quantity one for unknown rows.
5. Preserve existing status, location, events, comments, attachments, and box data for historical
   display.
6. Only create opening movements from evidence or an authorized reconciliation decision.
7. Keep compatibility views/columns until consumer rollout proves no old path relies on them.
8. Contract/remove obsolete authority only in a later explicitly approved migration.

---

## 9. Migration sequence

Use separate timestamped migrations so each step is reviewable and recoverable. Suggested sequence:

1. **Catalog/repair prerequisite:** reconcile `dflow.sample_shipment_item` existence and structure;
   add missing FKs/indexes without uniqueness yet.
2. **Duplicate audit support:** add any temporary/reporting support needed; produce and review the
   duplicate/ambiguity report.
3. **Data reconciliation:** resolve only approved duplicate/current-box inconsistencies with an audit
   artifact.
4. **Membership uniqueness:** add `UNIQUE(sample_id_fk, box_id_fk)` and test concurrent inserts.
5. **Box ownership:** add/backfill `owner_factory_id_fk`, indexes, constraints, and ambiguity state.
6. **Movement foundation:** normalized locations, movement authority, constraints, grants/RLS, and
   idempotency.
7. **Shipment intent and stop closeout:** additive tables/columns and FKs.
8. **Import durability:** import job/row records and access policies.
9. **Read models:** balance, transit, stop, outstanding, discrepancy, and completion views.
10. **Compatibility and legacy markers:** expose old rows safely without fabricated quantities.

Do not combine all steps into one irreversible migration. Do not edit the 2026-07-21 restore
migration; add new timestamped migrations.

---

## 10. Preview-first execution procedure

Before any migration:

1. Read `AGENTS.md`, this plan, and `HANDOFF.md` completely.
2. Run `gh pr list`, `git branch -a`, `git ls-remote`, inspect latest migrations, and `git status`.
3. If another schema change is in flight, serialize rather than starting a parallel migration.
4. Create a shared-db feature branch and PR.
5. Authenticate Supabase CLI using the named 1Password items in `AGENTS.md`; never paste values.
6. Link to preview `rjyboqwcdzcocqgmsyel` and run a dry-run.
7. The dry-run must show only intended additive changes and no unexplained migration drift.
8. Apply to preview and run all database/concurrency/authorization scenarios below.
9. Test the DesignFlow tracking service against preview after models/services are updated on its
   sandbox branch.
10. Merge the shared-db PR only after repo checks, preview evidence, app compatibility, and review
    gates pass.
11. Production promotion requires the repo's approved window and current authorization; this plan is
    not blanket approval. **✅ DONE (2026-07-22):** the `221000`–`221700` block is applied to
    production `qsllyeztdwjgirsysgai` (ledger + objects verified read-only).

`main` merge synchronizes shared-db content into consumers; it does not itself prove the migration was
applied. Record PR, merge SHA, preview application evidence, production migration status, and consumer
type/model update evidence separately.

---

## 11. Required database and integration tests

### Membership and ownership

- missing `sample_shipment_item` repair works on a faithful rehearsal;
- duplicate report identifies exact and conflicting duplicates;
- clean repeated insert conflicts on the unique constraint;
- two simultaneous inserts for the same sample/box produce one membership;
- the application maps the unique violation to “already in this box”;
- a sample already in another active box is not silently moved;
- vendor cannot read/mutate another factory's box;
- ambiguous/mixed legacy box is not assigned to a vendor arbitrarily.

### Quantity and lifecycle

- canonical 4 → 4 → 3 → 1 scenario conserves four at every step;
- one retained in Ningbo, two retained in New York, one delivered to customer are simultaneously
  visible;
- India factory → New York route works without a Ningbo event;
- short, over, partial, and damaged receipt preserve intended and actual quantities;
- discrepancy reason is mandatory where required;
- concurrent shipments cannot consume the same units or make a negative balance;
- identical idempotency retry does not double-move;
- conflicting idempotency reuse fails;
- compensating correction preserves original history;
- local stop closes while global batch remains open;
- global completion occurs only when every unit is resolved and none is in transit.

### Authorization

- vendor isolation by factory;
- office restriction by authorized location;
- read-only/unknown roles cannot mutate;
- staff correction is audited;
- direct request-body route/factory spoofing does not authorize a move;
- grants plus RLS work through the actual application role/path.

### Imports and read models

- preview/confirm retry is idempotent;
- failed confirmation leaves no partial samples, movements, or box;
- row warnings/errors remain durable;
- balance/outstanding/discrepancy views match movement truth;
- unknown legacy quantities do not appear as one;
- query plans/indexes support operational dashboard filtering at expected scale.

---

## 12. Rollback and failure policy

- Prefer additive expand/migrate/contract. Roll back application usage before dropping additive
  objects.
- Never delete posted movements to “fix” a balance; insert audited compensation.
- If preview reveals legacy ambiguity, stop and document it rather than guessing.
- If migration drift appears, do not blindly run migration repair or pull remote schema; identify the
  owner and serialize.
- If unique-constraint creation finds duplicates, abort before constraint creation and produce the
  review report.
- Every fallback must be visible through a failed job/exception/log; no silent success.
- Record exact migration versions and environment state in `HANDOFF.md` while work is unfinished.

---

## 13. Observability and support requirements

Capture structured metrics/logs for:

- membership unique conflicts and idempotency replays;
- movement conservation failures (must be zero and alert);
- rejected negative/over-allocation attempts;
- receipt discrepancies;
- open/stalled stop work and in-transit age;
- import job status/duration/row/photo counts;
- authorization denials;
- carrier event failures in the later phase.

Provide safe support queries/views for membership duplicates, movement audit, balances, open stops,
outstanding samples, discrepancies, and failed imports. Normal recovery must not require ad-hoc
production edits.

---

## 14. Exact next steps for a fresh AI session

1. **Establish clean state.** Read `AGENTS.md`, this file, and `HANDOFF.md`; check open PRs, branches,
   repo status, and latest migrations. **Gate:** no uncoordinated schema work is in flight.
2. **Verify actual catalogs read-only.** Compare `dflow` and `plm` definitions/counts for all seven
   sample tables in preview and production, especially `sample_shipment_item`. **Gate:** a written
   inventory includes columns, constraints, indexes, row counts, and environment differences.
3. **Audit memberships read-only.** Report duplicate `(sample_id_fk, box_id_fk)`, missing referenced
   samples/boxes, multi-box samples, route conflicts, and scalar `sample.box_id_fk` disagreement.
   **Gate:** every anomaly is categorized; no data has been mutated.
4. **Choose the repair path.** Decide from evidence whether to restore/repair
   `sample_shipment_item`, introduce a historical shipment-line table, or both. Update this plan with
   the decision and rationale. **Gate:** reviewer can trace every existing datum to its destination.
5. **Author prerequisite migrations and tests.** Add new timestamped migrations for table repair,
   approved duplicate reconciliation, membership uniqueness, and ownership. **Gate:** SQL lint/checks
   pass and dry-run shows only intended changes.
6. **Apply to preview.** Run duplicate, concurrency, FK, ownership, and authorization tests. **Gate:**
   one concurrent membership survives, no unrelated object changes, and legacy records remain
   accessible.
7. **Author movement/closeout/import/read-model migrations.** Keep them additive and separately
   reviewable. **Gate:** canonical four-piece and India-direct SQL/integration fixtures pass with no
   negative or unexplained balance.
8. **Coordinate consumer implementation.** Only now update DesignFlow tracking models/services and
   test against preview. **Gate:** full tracking/frontend tests pass and unique violations are mapped
   idempotently.
9. **Complete PR evidence and merge.** Attach migration list, catalog diffs, anomaly disposition,
   preview commands/results, app results, and rollback notes. **Gate:** all shared-db merge checklist
   items are satisfied; merge the PR.
10. **Promote only when authorized.** Apply through the approved production workflow/window and
    verify catalog, constraints, views, and app health. **Gate:** production migration versions and
    consumer deployed SHAs are recorded; no unexplained variance exists. **✅ DONE (2026-07-22):**
    production carries ledger `221000`–`221700` and all objects (tables, functions,
    five views) verified present read-only. One known cosmetic variance: the PopSG trigram file is
    recorded at old version `220000` on production vs on-disk `220800` (idempotent index; ledger-only).

---

## 15. Open questions requiring evidence or product confirmation

1. Does `sample_shipment_item` need to preserve historical membership legs, or is it strictly current
   box membership? Actual data/query inspection decides this before uniqueness cleanup.
2. Which canonical table/key owns factory identity for `sample_box.owner_factory_id_fk` in the current
   `dflow` runtime?
3. Which user-location assignments currently authorize Ningbo versus New York operations?
4. Which retained dispositions count as globally complete versus still outstanding?
5. Is original workbook retention required, and what is its approved object-storage lifecycle?
6. Which legacy rows have trustworthy quantity evidence?
7. Which import/reference tables should hold extensible sample types and disposition codes?

Do not block the immediate read-only inventory/duplicate audit on product questions that do not affect
those steps. Do not guess answers when they affect irreversible reconciliation.

---

## 16. Definition of done

Database work is complete only when:

- all seven sample tables have a documented, canonical `dflow` contract;
- sample/box membership is database-idempotent under concurrency;
- box ownership is durable and vendor-safe;
- every physical quantity is conserved through immutable normalized movements;
- local stop closeout and global completion remain distinct;
- imports and receipts use one authority;
- legacy unknown quantities remain explicitly unknown;
- required views, grants, RLS, indexes, and audit fields are verified;
- canonical four-piece, India-direct, discrepancy, concurrency, correction, and authorization tests
  pass on preview;
- shared-db PR is merged with evidence and migrations are applied through approved workflows;
- consumer models/types/services are updated only after the schema contract lands;
- production status and deployed consumer SHAs are explicitly recorded when promotion is authorized.

Until every item passes, keep this plan linked from `HANDOFF.md` as an unfinished active workstream.

---

## 17. Handoff completeness audit

1. **Can a developer with no DesignFlow or session context continue without asking what this feature
   is or why it exists? Yes.** Sections 1–4 explain the application, users, canonical scenario,
   repository ownership, current failure, race condition, and decisions.
2. **Can that developer design and execute the database work as effectively as the originating
   session? Yes.** Sections 5–10 define the contract, conservation/authorization rules, legacy
   strategy, migration order, environment boundaries, and preview-first workflow.
3. **Are failed attempts and non-obvious findings preserved? Yes.** Section 3 records the six-of-seven
   restore omission and why application-only idempotency cannot close the concurrent race; Sections
   8 and 12 prohibit fabricated backfills and blind duplicate deletion/repair.
4. **Is every next step concrete and verifiable? Yes.** Section 14 supplies ordered actions with an
   explicit gate for each; Sections 11 and 16 define test and completion evidence.
5. **Are identifiers, paths, URLs, constraints, risks, access, and secrets explained safely? Yes.**
   The header, Sections 2, 3, 5, 9, 10, 12, and 15 identify repositories, schemas, project refs,
   migration names, ownership boundaries, open questions, and 1Password-by-name only.

Final synthesis: this document is comprehensive enough for a brand-new developer, contains the
current session's relevant background and decisions, and includes the goals, intended outcome,
current state, failures, constraints, risks, exact next actions, and verification evidence required
to execute the database work without this chat.
