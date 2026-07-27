# PopSG Property reconciliation PSG-3 evidence

**Phase:** PSG-3 only
**Status:** UI/fixture shell implemented locally; full PSG-3 plan gate remains OPEN
**Date:** 2026-07-27
**Shared database:** no connection, query, write, migration, or apply
**Deployment:** none

## Result

Albert approved only `batch-01-exact-existing`, 51 rows covering 44,331 files, at SHA-256
`f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
[`approval.json`](approval.json) preserves the exact bounded approval and every explicit
exclusion. The approved CSV hash was rechecked before implementation.

PopDAM now has the pending-only PSG-3 UI/fixture shell backed by the frozen PSG-2 evidence:

- summary cards reconcile 372 observed values and 216,417 active file occurrences;
- five business queues remain separate: needs review, intentionally untagged, mapped, create
  approval required, and Licensor unresolved;
- filters cover Licensor, disposition, minimum occurrence count, ambiguity, and text search;
- rows show bounded redacted path evidence and canonical Property name, code, and parent proof;
- the exact owner-approved batch/hash and its exclusions stay visible;
- an administrator may prepare only an unchanged, same-parent `exact_existing` row from the
  approved batch;
- both preparation and export reject any row outside the signed 51-key batch set;
- after the first proposal, other Licensors lock until the pending set is cleared;
- proposals remain in browser memory and export as a stable JSON decision set with SHA-256;
- designer and viewer roles cannot prepare or export proposals;
- create candidates remain locked and route to the existing ColdLion Phase 5 gate;
- `the lion king` remains ambiguous with no target;
- no activation action or backend adapter exists.

## Phase-boundary resolution

The plan's PSG-3 gate names role/RLS/RPC proof, but PSG-5 owns migrations, database contracts,
RLS, RPCs, activation, and preview rebuild work. Albert did not authorize any of those actions.
PSG-3 therefore uses `safe-non-writing-fixture-v1`:

1. the UI reads a generated, deterministic copy of all signed PSG-2 rows;
2. pending proposals live only in React memory and disappear on refresh or role downgrade;
3. executable feature source is statically tested to contain no Supabase, RPC, SQL, or activation
   adapter;
4. role and same-parent contract tests prove viewer/designer denial and administrator bounds;
5. real RLS/RPC persistence tests remain a PSG-5 entry item after schema is separately approved.

This provides the safe UI shell without weakening the plan or inventing database authority. The
full PSG-3 plan gate remains open until PSG-5 supplies separately approved RLS, RPC, persistence,
and preview-browser proof.

## Browser evidence

The dev-only visual route mounted the real component with the frozen fixture and no Supabase
client. Playwright CLI used a real headed Chromium browser. Console errors: zero.

| Screenshot | Proof |
|---|---|
| `psg3-admin-overview.png` | owner hash, exclusions, totals, queues, filters, and mapped rows |
| `psg3-admin-prepare-dialog.png` | same-parent target and 6,887-file impact preview before preparation |
| `psg3-admin-pending-export.png` | browser-memory pending count and exported SHA-256 after the action |
| `psg3-cross-licensor-locked.png` | Looney Tunes locks after the pending set starts with Disney |
| `psg3-designer-locked.png` | designer cannot prepare |
| `psg3-lion-king-open.png` | `the lion king`, 521 files, remains ambiguous and locked |
| `psg3-create-candidates-locked.png` | CHEERS and THE EXORCIST remain locked behind ColdLion Phase 5 |

## Verification

- Feature tests: 19 passed across 4 files.
- Full PopDAM suite: 93 tests passed across 22 files.
- Production build: passed.
- Fixture contract: 372 rows / 216,417 files.
- Approved fixture subset: 51 rows / 44,331 files.
- Browser console errors: zero.
- Database writes: zero.
- Migration files added: zero.
- Rebuilds, deploys, and activation: zero.

## Files

PopDAM:

- `scripts/generate-popsg-property-reconciliation-fixture.cjs`
- `src/features/popsg-property-reconciliation/contract.ts`
- `src/features/popsg-property-reconciliation/contract.test.ts`
- `src/features/popsg-property-reconciliation/fixture-contract.test.ts`
- `src/features/popsg-property-reconciliation/no-write-boundary.test.ts`
- `src/features/popsg-property-reconciliation/generated-psg2-fixture.ts`
- `src/features/popsg-property-reconciliation/PropertyReconciliationPanel.tsx`
- `src/features/popsg-property-reconciliation/PropertyReconciliationPanel.test.tsx`
- `src/features/popsg-property-reconciliation/PropertyReconciliationVisualPage.tsx`
- `src/pages/popsg/PopSGSettingsPage.tsx`
- `src/App.tsx`

Shared-db:

- this README;
- `approval.json`;
- `source-hashes.json`;
- the seven browser screenshots;
- the PSG-3 completion record in the bounded plan;
- the fresh-session boundary in `HANDOFF.md`.

## Failed attempts and corrections

- Raw working-tree hashes first disagreed with PSG-0/1 evidence because Windows checked out CRLF.
  Canonical LF hashing reproduced every signed manifest.
- The first static no-write test scanned the large data fixture and matched ordinary source-data
  words. It was narrowed to executable source, where the prohibited adapter scan passes.
- The first designer visual check inherited one administrator memory proposal in the dev role
  switcher. The component now clears pending memory on role downgrade and disables export.
- The first create-candidate screenshot retained the Lion King search filter. The filter was
  cleared and the screenshot was retaken with both locked candidates visible.
- The first Grok review required corrections for the phase-status claim, ambiguity filter,
  mixed-Licensor export, signed-key enforcement, security tests, and hidden rows. Those items and
  its medium findings were corrected before the second review.
- The second Grok review found that the prepare screenshot showed the wrong already-started row.
  It was retaken from an empty set on Winnie the Pooh / 6,887 files.
- The second review also requested signed-key enforcement on prepare/export, conditional parent
  proof text, and immediate locking of other Licensors after a set starts. All three are now
  implemented and covered by tests or browser proof.
- The final Grok follow-up returned PASS with no Critical, High, or Medium findings.

## ColdLion and later-phase drift audit

The accelerated ColdLion plan still shows Steps 1 through 10 open. Production Phase 7 remains
forbidden. PSG-3 performed no ColdLion action.

After rereading PSG-4 through PSG-7:

- PSG-4 still requires an exact unchanged batch hash before any activation decision.
- PSG-5 still owns schema/RLS/RPC persistence, all eight Licensor alias decisions, preview
  implementation, and rebuild proof.
- PSG-5 still has no approved at-risk removal subset and cannot treat the 6,961-row evidence as
  approval.
- PSG-6 remains blocked by the moving ColdLion checkpoint, Albert's sign-off, and a separately
  named production window.
- PSG-7 must preserve zero-valued alias/Classics/no-code proposal categories and report unexplained
  tag loss as zero.
- No downstream phase order or safety rule drifted.

## Gate and next action

Stop before PSG-4. Do not deploy, write either database, author a migration, rebuild tags, or
activate a proposal. The full PSG-3 plan gate remains open until separately approved PSG-5 work
proves RLS, RPCs, persistence, and the complete preview workflow.
