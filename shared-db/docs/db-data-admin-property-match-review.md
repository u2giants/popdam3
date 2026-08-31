# DB Data Admin — Property match review queue

## What it is

A screen in DB Data Admin (`data.designflow.app`, tab **Property Matches**) where a
Licensing reviewer decides, one DCP Vault Property at a time, which OPA Property it
is — or that it is not on the contract at all.

It replaces trading CSV files back and forth. A spreadsheet decision carries no
author, no reason, and no history; a decision made here carries all three.

## Why it exists

OPA carries exactly two creation branches, `disney` (1,445 Properties) and
`lucasfilm` (74). When Disney moved Marvel product submissions out of ASGARD into
OPA, Marvel was merged into the Disney branch instead of getting its own the way
Lucasfilm did. OPA therefore cannot distinguish Marvel from Disney at all.

Owner ruling, Albert Hazan, 2026-08-31 — recorded in
[`docs/business-rules/licensing-master-data.md`](business-rules/licensing-master-data.md),
section *"OPA cannot separate Marvel from Disney"* — makes the signed K2557
contract schedule the controlling authority for the Disney-versus-Marvel split.
Applying that ruling requires a recorded, per-Property decision. This queue is how
that decision gets made.

Related: the presentation rule that produces `DCP Creative - unresolved authority`
comes from `supabase/migrations/20260830130345_opa_authority_for_dcp_creative.sql`
(issue #1658). Every DCP Vault Property reads unresolved today because
`plm.dcp_opa_property_resolution` is empty. Emptying that queue is what resolves
them.

## Where the decision lands

`plm.dcp_opa_property_resolution` and `plm.dcp_opa_property_resolution_member`,
which already exist and already enforce the shape this screen needs:

- append-only and versioned — an approval is a **new** row that supersedes the
  previous version, never an overwrite, so the history survives;
- `approval_status` is constrained to `pending` / `approved` / `rejected`, and an
  approved row must carry `approved_by` and `approved_at`;
- `decision_reason` is `NOT NULL` and non-blank — a decision must say why;
- the member table allows **more than one** OPA Property per decision, which is
  what the animated-plus-live-action clauses need (Pinocchio, The Little Mermaid,
  The Jungle Book, Moana, Alice in Wonderland) and what the bundled-sequel clauses
  need (Cars, Toy Story, the Star Wars original and prequel trilogies);
- `contract_asserted_studio_code` accepts `marvel`, so a contract assertion of
  Marvel can be recorded against an OPA Property that sits on the `disney` branch.

## Application contract

The screen calls two RPCs in the `api` schema. Both are **still to be created** by
a governed shared-db migration — see the "Not yet enabled" note below.

### `api.db_data_admin_property_match_queue(p_search text, p_cursor text, p_page_size int)`

Returns `{ rows: [...], next_cursor }`. Each row:

| Field | Meaning |
| --- | --- |
| `resolution_id` | the pending decision row being reviewed |
| `source_system`, `source_table`, `source_property_id` | the DCP Vault Property identity |
| `display_label` | what the reviewer sees |
| `decision_version`, `approval_status` | position in the supersession chain |
| `match_state` | `exact` / `multiple` / `suggested` / `none` |
| `contract_section`, `contract_clause`, `contract_page`, `contract_title` | the K2557 evidence shown beside the row |
| `contract_asserted_studio_code` | `disney`, `marvel`, `lucasfilm`, or `pixar` |
| `candidates[]` | `licensed_property_id`, `property_name`, `opa_studio_code`, `is_selected`, `similarity` |

`is_selected` pre-ticks a candidate whose name matched the contract title exactly.
`similarity` is `null` for an exact match and a 0-1 score for a suggestion.

### `api.db_data_admin_decide_property_match(p_resolution_id uuid, p_decision text, p_licensed_property_ids bigint[], p_reason text, p_operation_id uuid)`

`p_decision` is `approve` or `reject`. Returns
`{ success, code, message, resolution_id, decision_version }`.

It must write a **new version** superseding the row under review, stamp
`approved_by` from the signed-in reviewer, and treat `p_operation_id` as an
idempotency key — the same pattern the customer/vendor update and merge RPCs
already use.

## Guarantees the screen enforces in the UI

- Confirming is impossible with nothing selected, and impossible without a reason.
- A rejection sends **no** members, so "not on this contract" can never be
  mistaken for a placement.
- Candidates are offered, never applied. There is no auto-accept path.
- A missing RPC is reported as *"not enabled on this database yet"*, not as a raw
  database error — so this screen can ship ahead of the migration and light up on
  its own once the migration lands.
- An access denial is scoped to this tab; the rest of the app stays usable.

## Not yet enabled

The tab is live but shows the "not enabled" note until the two RPCs above exist
and the pending rows are loaded. Both are structural / governed work and are
requested through the shared-db issue queue, not done from an application session.

## Out of scope for this screen

The "not on the contract" exception lists — 1,393 OPA Properties and 180 DCP Vault
names with no clause behind them — are a licensing entitlement question, not a
name-matching one. They deliberately do not share this queue.

## Source of the candidates

The contract-to-OPA name match that produces the candidate sets is built in the
private repository `u2giants/licensor-source-data` under
`reconciliation/opa-contract-match-20260831/`. It matches the 148 K2557 schedule
clauses against 1,519 OPA Properties, 325 DCP Vault names, and 75 ASGARD guides.
No licensed rows are reproduced in this repository.
