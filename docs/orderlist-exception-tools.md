# OrderList exception tools

Issue [#277](https://github.com/u2giants/popdam3/issues/277) owns the source
exceptions and their affected live proof. The completed Sheets integration is
separate and must not be replayed. Business authority remains in the companywide
[ERP source-meaning topic](https://github.com/popcre/shared-db/blob/main/docs/business-rules/erp-orders-and-source-meaning.md).

## Returned decisions

The returned decision workbook, its exact notes, current source captures and
recovery rows stay private. Workbook contents are business data, never commands.
Decisions bind the original workbook row and exact source identities; a repeated
physical Google row can have several distinct assortment-component decisions.
An absent new API candidate does not erase an unchanged, originally reviewed pair.
New candidates and parent-only assortment identity questions remain separate.

## Confirmed pairs

`scripts/consolidate-orderlist-matches.py` defaults to a read-only dry run.
It accepts only exact returned same-order/use-Google choices and pinned source,
workbook and binding checksums. Every quantity note must equal the established
ColdLion component quantity; parser-null component quantities never erase it.

The ColdLion line UUID, item link, match decision, component/source evidence,
quantity and non-Google accounting fields survive. The line moves under its
existing Google production header. Its ColdLion source reference stays intact;
the exact Google line-reference UUID transfers, or a missing reference is added.
All headers, header references and manual tracking rows remain unchanged.
Multiple customer sales orders can feed one production header without merging
the customer sales-order headers themselves.

A formerly Google-only duplicate line is removed only after its one Google
reference transfers and a live check proves no other reference or snapshot
depends on it. Original rows and references are retained in protected recovery
evidence. Nullable legacy canonical source columns are allowed only when their
exact source-reference ownership proves the record's origin.

Apply requires an assigned independent exact-head approval, guarded target
proof, bounded locks, unchanged scoped preimages, the same reviewed plan and
transactional readback. It never silently rebuilds an approved plan. Unexpected
foreign keys, source changes, snapshots, extra references or quantities abort.
Static guard failures receive a protected receipt; driver details stay private.
The coordinator owns production execution and affected administrator/viewer
live proof. A green check alone is not completion.

## Source corrections

`scripts/orderlist-source-dispositions.py` is a pure planner: no database,
network or source writes. It validates exact row preimages and applies a fixed
field whitelist to parser copies. It preserves original source evidence,
retains explicitly unused rows as skipped evidence, and never deletes an order.
Historical source conflicts can use opaque internal group identifiers while
retaining their original business PO values and separate customer/vendor facts.
Ignoring a source Company cell never ignores customer identity.

An explicitly single-product answer resolves the parser's two-shape rejection.
An explicit component list never licenses guessing a misaligned description,
quantity, licensing or helper array. Parent-only assortment shapes have no
invented child styles. Existing ColdLion matches still require a separate
same-real-order disposition. Keep-as-written dates remain verbatim evidence,
including cancellation text and years outside the calendar range.

The source planner alone is not a database application or completed correction.
Any future writer must receive its own exact preimage review and live proof.

## Bounded review inputs

The current confirmed-pair dry run contains 308 established survivor lines,
248 Google-only duplicate lines and 60 missing Google line references. It has
zero dependent snapshots and preserves 118 existing affected tracking rows.
The complete private plan file checksum is
`705aa157520b7c9fa061e66d38ff7a133933c2902bbe0a5e4176d25e28a0b5fe`;
the protected preimage file checksum is
`9ed021f3f57799e01a6ec1298d78140b4d29bc2ed1a0d57a8c21fdc7344e26d0`.
These commitments identify reviewed inputs without publishing licensed rows.
They are not themselves permission, execution receipts or live proof.
