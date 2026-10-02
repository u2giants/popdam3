# Plan — move DesignFlow PLM production off Cloud SQL onto Supabase, group by group

Owner request (Albert Hazan, 2026-10-02): group the Cloud SQL tables by which ones are linked and
must move together, then move them piecemeal and re-point DesignFlow production, instead of one
all-at-once cutover.

Classification: this plan is documentation (non-orchestrator). Each wave below that creates or
changes Supabase structure is **orchestrator (structural) work** and runs through the normal
shared-db claim → preview → PR → bounded production apply lane. Copying production rows is
**data work** owned by the DesignFlow session, with §4.2 target proof.

## STATUS

| Step | What | Status | Evidence |
|---|---|---|---|
| 0 | Table inventory + link analysis | DONE | this file; `docs/verification/cloudsql-designflow-capture-2026-08-10/`; `docs/verification/cloudsql-piecemeal-cutover-20261002/designflow-code-table-usage.md` |
| W0 | Prep: refresh capture, settle divergences, deploy two-connection routing | NOT STARTED | — |
| W1–W6 | Waves in §4 | NOT STARTED | — |

## 1. Facts this plan rests on (re-derive before acting)

- Cloud SQL production schema `designflow`: 103 tables, 542 MB [SNAPSHOT 2026-08-10 capture —
  re-run `scripts/capture-postgres-schema.sql` with `exact_count_max_bytes=0`. RE-DERIVE BEFORE ACTING].
- Only ~42 declared foreign keys exist. Most links are implicit (Sequelize associations, raw SQL,
  `*_id` columns). The grouping below uses both kinds.
- Supabase `dflow` is structurally the same 103 tables (3-object divergence in August), and
  develop / staging / sandbox already run DesignFlow on Supabase. The code already works there;
  the job is data plus routing, not porting.
- Each of the four DB services (backend, item-master, tracking, data-syncing) has **one**
  Sequelize connection. That is the central obstacle to piecemeal moves: a service cannot today
  read one table from Supabase and another from Cloud SQL. `config/table-schema-map.js` already
  maps every table to its Supabase schema — that is the target layout.
- No code copies Cloud SQL ↔ Supabase today. `designflow-data-syncing` writes ColdLion data into
  whichever database it points at (production orders, item detail, external vendor/customer,
  merch groups).
- Shared transactions: RFQ workflow + users; licensing status + feedback + item attachments;
  art_piece + attachments; FactoryTime family; RolePermissions (under a lock). Tables in one
  transaction must live in the same database.
- Every model write also writes `AuditLog` (app hook). Advisory lock IDs 21450, 21460, 21461 are
  used — check against `docs/advisory-lock-registry.md` before go-live. The RFQ workflow sets the
  acting user as session values that database functions read.

## 2. The groups

Hubs referenced from almost everything: **`users`** (created_by / assignee everywhere),
**`merchGroup`** (ten columns on itemHeader, ten on art_piece), **`itemHeader`**.

| Group | Tables | Links out | Size | Move as |
|---|---|---|---|---|
| G0 HTS | `hts_rag.*` (already on Supabase, switched off) | none | — | switch on |
| G1 Logs / cache | email_logs, ai_cache_events, user_notification | users (soft) | ~46 MB | own wave |
| G2 Audit | AuditLog | written by every write | 400 MB | see §3 rule B |
| G3 Reference lookups | divisionCode, companyCode, SeasonCode, FOBCountry, ShippingPort, deliveryLocation, itemType, itemSize, itemDepth, product_category, age_group, OrderLeadTime, ProdPaymentTerms, ProdShipmentTransitTime, customers, externalCustomer, externalVendor, vendor, vendorGroup, Factory, licenseList | users (created_by) | small | read-mostly; dual copy |
| G4 Screen config | GridLayout, GridAccessLevel, GridChildrenLayout, GridChildrenLayoutOrder, GridViewState, grid_cell_notes, UIElements, app_settings, externalApi | users | small | own wave |
| G4b UDF | UDFComponent, UDFElement, UDFElementType, UDFGroup, UDFQuery, UDFTable | rows define RFQ grid joins | small | with the core |
| G5 Identity & permissions | users, Roles, RolePermissions, groups, AdditionalUserEmail, auth_token, quote_auth_token | hub | ~21 MB | with the core |
| G6 Taxonomy | merchGroup, merchGroupMaster, merchGroupRelations, merchGroupHeaders, properties_and_characters, property_character_associations | hub | ~6 MB | with the core; coordinate with the licensor/property cutover plan |
| G7 Quoting (RFQ) | RFQItem, RFQVendor, RFQGroup, RFQStep, RFQItemStatus, RFQItemDivision, RFQContainer, RFQWhse, Standardized* (9), productUserAssignment | users, Factory, customers, itemHeader, UDF | ~17 MB | core |
| G8 Items, art, licensing | itemHeader, itemDetail, itemAttachment, itemLicenseImage, item_character_associations, ProductNickname, comments, licensingStatus, licensingFeedbackReply, LicenseFeedBacks, licensingMilestone, art_piece, art_piece_attachment, art_types, artists, artist_types | merchGroup, users, SeasonCode, divisionCode | ~40 MB | core |
| G9 Production orders | ProdOrderHeader, ProdOrderDetail, item_prod_order_detail_associations, ContainerHeader | itemHeader; written by data-syncing | ~13 MB | core |
| G10 Timing tables | DesignTeamTime(s), FactoryTime(s), LicensingTime(s) | Factory | tiny | with G3 |
| G11 Samples | sample_* | Factory, customers, users | — | already Supabase-only by design (#707) |

**Honest conclusion.** G4b–G9 (users, taxonomy, UDF, RFQ, items/art/licensing, production orders)
are one tightly knotted core holding most live business data, tied by shared transactions and three
hub tables. Splitting it further would require cross-database joins inside a single request, which
is exactly how piecemeal moves cause outages. So piecemeal here means: **move everything around the
core first in small safe waves, then move the core as one bounded, rehearsed wave** — about 100 MB
without AuditLog, a copy measured in minutes.

## 3. How one group moves

1. **Two connections per service.** Add a second Sequelize instance (Supabase pooler, 6543) beside
   the Cloud SQL one and route each model by a per-table home setting driven by
   `table-schema-map.js`. Default every table to Cloud SQL, so deploying it changes nothing.
   App-team work on `sandbox-albert` → `develop`, reviewed by Uma.
2. **Rule A — no request joins or transacts across the two databases.** A group moves only when
   every query and transaction touching it stays inside its new home, checked against the
   code-usage evidence file and a fresh scan at the release commit.
3. **Rule B — AuditLog.** Each service writes the audit row to the database the changed row lives
   in. Combine or archive history after W6.
4. **Per-wave runbook:** pause writes to that group → copy rows Cloud SQL → Supabase `dflow`
   (row counts and checksums must match) → reset sequences → flip the group's home in all four
   services together → smoke-test the screens that use it → resume. Rollback = flip back; valid
   only until new writes land on Supabase, after which fix forward.
5. **Read-mostly lookups (G3).** Supabase becomes the writer; a one-way copy keeps Cloud SQL's
   copy current so core tables still there keep their joins. Retire the copy when the core moves.

## 4. Waves

| Wave | Moves | Why this order | Gate before it |
|---|---|---|---|
| W0 | Prep: refresh capture; settle the 3 divergences (incl. duplicate check on `productUserAssignment (item, role)`); deploy routing with everything still on Cloud SQL | nothing moves; proves the switch | — |
| W1 | G0 HTS on; G1 logs/cache | no links into them; failure invisible to users | W0 live, no behaviour change |
| W2 | G4 screen config | self-contained per-user settings | W1 stable one week |
| W3 | G3 lookups + G10 timing, Supabase as writer, copy back | first wave with real links; proves the copy-back | W2 stable |
| W4 | Rehearse the core: full copy of G4b–G9 into staging, run the DesignFlow end-to-end suite, time it | measures the real window | W3 stable |
| W5 | The core: G4b–G9, data-syncing re-pointed | one bounded window, rehearsed | W4 passes; owner picks the window |
| W6 | Retire: stop copy-back; Cloud SQL read-only 30 days; then decommission via `popcre/infrastructure` | — | 30 days clean |

## 5. Boundaries this plan does not relax

- AI sessions do not change Cloud SQL, Secret Manager, Cloud Build or Cloud Run; those steps belong
  to `popcre/infrastructure`, gated by an assigned AI reviewer's APPROVE.
- Unsuffixed DB secret IDs are production-only. The second connection uses new, separately named
  secrets — never a repoint of the existing ones.
- Reading Cloud SQL row counts or checksums for the copy check is outside the §0.1-A.1
  catalog-only waiver and needs its own owner ruling before W1.
- Licensor/property follows `docs/licensor-property-cloudsql-cutover-plan-20260806.md` and the
  curated-data rulings (§6.4–6.6): moving G6 moves DesignFlow's copy; it never overwrites curated
  `core.*`.
