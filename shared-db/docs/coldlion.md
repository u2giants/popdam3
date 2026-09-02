# ColdLion — start here

**This page is a map, not a source.** It holds no facts of its own, so it cannot go stale
except by a broken link. Everything ColdLion lives in the documents below. Read this page
first, then go to the one you need.

**Last reviewed: 2026-09-01.**

---

## Before you ask ColdLion anything

> ### ⛔ Read [`coldlion-open-questions.md`](coldlion-open-questions.md) FIRST.
>
> It is the single register of every question we have asked ColdLion, every answer they
> have given, and everything still outstanding. **Twelve questions are already answered
> there.** Check it before drafting a question, before concluding a field is broken, and
> before telling Albert something is unknown.
>
> **This is not optional advice.** On 2026-08-19 a session spent an afternoon measuring
> two always-zero quantity fields and drafted a question to ColdLion about them. That exact
> question had been answered on 2026-08-18 and was sitting in §4 of the register. The
> session had read four ColdLion documents and none of them pointed here. That is why this
> page exists.

**Who answers, and how.** ColdLion is a third-party ERP that Albert does **not**
administer. Questions go **from Albert**, never sent by an AI session:

| Topic | Contact |
|---|---|
| API behaviour, fields, data meaning | **JamieLynn** |
| Division and company codes | **Uma** |
| Whether we even want to ask | **Albert** (some register entries are owner decisions, not ColdLion questions) |

---

## What ColdLion is

The ERP that runs the business day to day: what we sell, what we bought, what it cost, who
we bought it from, who we sold it to. Base URL `http://x5.coldlion.com/EhpApi`, tenant
`companyCode=EDGEHOME`. We are a client of it, not its owner — we cannot change its schema,
and it has changed shape on us three times in a month.

Credentials: 1Password vault `vibe_coding`, item *"Coldlion ERP API key x5.coldlion.com"*,
field `credential`. Header `X-API-Key`. **A missing key returns HTTP 400, not 401.**

**Do not ask Albert to rotate the ColdLion API key.** He does not administer ColdLion.
Owner ruling 2026-08-09.

---

## The map

### How the API behaves
| Document | What it answers |
|---|---|
| [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) | Every endpoint, its parameters, paging, auth, the division matrix, which four endpoints are writable |
| [`coldlion-history-endpoints-shape.md`](coldlion-history-endpoints-shape.md) | The two history feeds in depth: the 7-day window cap, row identity, the malformed error contract, dead fields |
| [`business-rules-erp-data.md` §10](business-rules-erp-data.md) | **Read before building any order-history loader.** How one prepack line explodes into one row per SKU, which quantity fields are per-SKU and which are parent totals, and the four-part natural key |
| [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) | ColdLion's 2026-08-26 answers, each verified live: `salesOrderLineNo` and `stageCode` are now IN the API, the report formulas are applied, `orderHistory` has no hidden dimension — and the one question ColdLion asked us back |
| **The live spec** — `GET /EhpApi/v2/api-docs` | The final authority when a document and reality disagree. It has been right and our docs wrong at least once |

### What the data means to the business
| Document | What it answers |
|---|---|
| [`business-rules/erp-orders-and-source-meaning.md`](business-rules/erp-orders-and-source-meaning.md) | Order history, production history, `COS`, contractual samples, ERP code meaning |
| [`business-rules/merchandise-and-product-taxonomy.md`](business-rules/merchandise-and-product-taxonomy.md) | Merch groups, `mgCategory`, product types, the divisions and what each sells |
| [`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md) | Why `mgTypeCode` cannot be hardcoded — its meaning changes per division |
| [`business-rules/application-map.md`](business-rules/application-map.md) | The front door to all companywide business rules |

### What we are building
| Document | What it answers |
|---|---|
| [`plan_coldlion-landing-phases-2-6.md`](plan_coldlion-landing-phases-2-6.md) | The current build plan (issue #1184 phases 2-6). **Read its STATUS table first** |
| [`coldlion-field-decisions-20260819.csv`](coldlion-field-decisions-20260819.csv) | Albert's per-field ingest/ignore decision for all eight feeds. **Owner authority, not a suggestion** |
| [`coldlion-raw-landing-schema-design.md`](coldlion-raw-landing-schema-design.md) | The landing-layer design, grain by grain. Carries dated supersession notes — read them |
| [`coldlion-source-of-truth-plan.md`](coldlion-source-of-truth-plan.md) | Making ColdLion authoritative for the `core.*` master tables |
| [`coldlion-direct-sync-and-taxonomy-plan.md`](coldlion-direct-sync-and-taxonomy-plan.md) | The "Option B" direct-sync architecture decision |

### History and evidence
| Document | What it answers |
|---|---|
| [`coldlion-erp-to-supabase-field-mapping.md`](coldlion-erp-to-supabase-field-mapping.md) | Field-by-field mapping into our schema |
| [`coldlion-customer-dedupe-review.md`](coldlion-customer-dedupe-review.md) | Customer duplicate analysis |
| [`coldlion-unmatched-properties-by-licensor-20260731.md`](coldlion-unmatched-properties-by-licensor-20260731.md) | The 66 unmatched property codes behind register question 2.5 |
| [`verification/`](verification/) | Measured evidence from past sessions. Cite these rather than re-measuring |

---

## The five traps that have already cost us

Each of these was learned the expensive way. They are stated in full in the documents
above; this list exists so you recognise one before it costs you the same afternoon.

1. **`mgTypeCode` has no fixed meaning.** `05` is Licensor in `CW001`/`SP001`, "Big Theme"
   in `EH001`, "Product Line" in retired `EP001`. Keying on the number alone corrupts data.
2. **`mgCode` collides across types inside one division.** `1P` is both a licensor and a
   property in `CW001`. Identity is always `(division, mgTypeCode, mgCode)` — four parts
   with company. Never the code alone.
3. **ColdLion has no licensor-to-property link and no licence expiry flag.** Neither can be
   invented. A sync that assumes otherwise resurrects lapsed licences.
4. **The 7-day-cap refusal is malformed.** It arrives as **HTTP 400 on the wire** with
   `"status": 500` in the body. Branch on the wire status, or your loader will retry a
   permanent input error forever.
5. **A zero is not an absence.** Several fields return `0` rather than null, so a report
   sums them happily and shows a plausible wrong answer. Equally, a field measuring 0%
   populated is not necessarily dead — `subUpc` is empty by business practice and one real
   value would be meaningful.

---

## Adding to this page

Add a **link and one line saying what the document answers**. Never copy content here — a
map that restates its territory becomes a second source that disagrees with the first. If a
document is superseded, leave the row and mark it, so a reader who finds the old file also
finds the pointer.
