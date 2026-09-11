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

Both RPCs exist as of `supabase/migrations/20260902053756_property_match_review_rpcs.sql`
(issue #2008, the structural half of #2007). The signatures below are the shipped
ones — the screen follows them exactly.

### `api.db_data_admin_property_match_queue(p_search text, p_cursor text, p_page_size int)`

Licensing-manager gated, read-only. Returns `{ rows, next_cursor, page_size }`,
keyset-paged over `source_table|source_system|source_property_id`. A row is in the
queue only while its **latest** version is `pending`; once decided it never
reappears.

Each row carries its own identity (`source_system`, `source_table`,
`source_property_id`, `display_label`), its version and status, its evidence
(`evidence_reference`, `evidence_sha256`, `decision_reason`), its contract
assertion (`contract_asserted_studio_code`, `contract_evidence_reference`,
`contract_evidence_sha256`), the previously approved version for context
(`prior_*`), and `candidates` — an array of `{ licensed_property_id,
member_ordinal }`.

The queue deliberately returns **no** authority verdict and **no** OPA property
names. Conflict presentation has exactly one home,
`api.db_data_admin_scraped_properties`, which #1999 corrected so a Marvel contract
assertion over a Disney OPA scope is not a permanent conflict. The screen resolves
candidate names separately through `api.opa_property_reconciliation`, and falls
back to showing the OPA id if that lookup returns nothing.

### `api.db_data_admin_decide_property_match(p_resolution_id uuid, p_decision text, p_licensed_property_ids bigint[], p_decision_reason text, p_client_request_id uuid)`

`p_decision` is `approve` or `reject`. The reviewer's identity comes from the JWT
and from nowhere else — there is deliberately no actor parameter.

`p_client_request_id` **becomes the new decision row's id**, which is what makes a
retry idempotent: the same call twice collides with its own primary key and
returns the recorded decision instead of appending a second version. It may not
equal `p_resolution_id`, and reusing a spent one for a *different* decision fails
loudly. The screen therefore mints one id per queued row and holds it until that
row's decision succeeds, rather than minting a fresh one per click.

A rejection must carry no members; the database rejects one that does.

## Guarantees the screen enforces in the UI

- Confirming is impossible with nothing selected, and impossible without a reason.
- A rejection sends **no** members, so "not on this contract" can never be
  mistaken for a placement.
- The recorded candidates are preselected suggestions, never applied automatically.
- Every row also provides an autocomplete selector over the complete Disney OPA
  Property vocabulary, so a reviewer can replace an incorrect or missing suggestion.
- A missing RPC is reported as *"not enabled on this database yet"*, not as a raw
  database error — so this screen can ship ahead of the migration and light up on
  its own once the migration lands.
- An access denial is scoped to this tab; the rest of the app stays usable.

## Enablement status

**Live and populated as of 2026-09-02.** The RPCs are live, and 113 version-1
`pending` rows were loaded into production `plm.dcp_opa_property_resolution` (80
`disney`, 31 `lucasfilm`, 2 `marvel`) with 173 candidate members. Every row is a
proposal carrying its K2557 clause, page and title; nothing was placed. A DCP
Vault Property keeps reading "DCP Creative - unresolved authority" until its row
is APPROVED here.

The rows are source data, not structure, so they were built and loaded from the
private `u2giants/licensor-source-data` repository
(`reconciliation/opa-contract-match-20260831/`) per the migration's own note.

Note for whoever ships the next change to this screen: **merging to `main` does
not deploy it.** The guarded merge runs as `GITHUB_TOKEN`, and GitHub suppresses
workflow triggers for token-driven pushes, so the `DB Data Admin` push workflow
never fires. Production release is always a manual `workflow_dispatch` of
`db-data-admin.yml` with the confirmation input — see
[`db-data-admin-deployment.md`](db-data-admin-deployment.md).

If the RPCs are ever absent — an older database, a rollback — the screen
says "not enabled on this database yet" rather than showing a PostgREST error.

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
