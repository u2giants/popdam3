# Owner ruling, 2026-08-02 — FRIENDS TV (`FR`) and FRIDA KAHLO (`FK`)

**Status:** half applied, half blocked on decisions only Albert can make.
**Migrations:** `20260802170000`, `20260802171000`.
**Measured against production (`qsllyeztdwjgirsysgai`), read-only, 2026-08-02.**

---

## 1. The correction that came first

The task was briefed as *"`core.licensor` has no way to say a licensor is defunct — add an
active/inactive flag."* **That premise is false, and it matters, because acting on it would
have added a second, competing status concept to a table that already has one.**

`core.licensor` has carried this since the very first schema migration
(`20260621150815_app_core.sql`):

```sql
status app.entity_status not null default 'active'
```

`core.property` and `core.character` carry the identical column. The enum behind it —
`app.entity_status` — already offers **`active`, `inactive`, `archived`, `deleted`,
`potential`**. So "this licensor is defunct" has always been expressible. Nothing was added.

**What was actually broken is durability, not vocabulary.** `plm.import_master_data()` — the
DesignFlow PLM master-data importer — force-set `status = 'active'` on *every* matched
licensor and *every* matched property on *every* re-pull. Marking a licensor inactive
therefore worked right up until the next PLM sync and then quietly undid itself. That is why
production has never contained a single inactive licensor (21 `active` + 5 `potential`, and
all 256 properties `active`): inactive rows do not fail to be *expressible*, they fail to
*survive*.

This exact fault was already fixed once, for customers, in
`20260723140000_plm_import_master_data_preserve_customer_status.sql`, whose own header says:
*"Licensor/property paths are unchanged in this tranche."* Migration `20260802170000` is that
missing tranche.

## 2. What Albert ruled

1. Licensor `FR` "FRIENDS TV" **was never a real licensor** — created by mistake.
2. "FRIDA KAHLO" was a **property** under a **FRIDA KAHLO licensor**, and that licensor is
   now **defunct**.
3. Therefore the live mapping — property `FK` (FRIDA KAHLO) → licensor `FR` (FRIENDS TV) —
   is **wrong on both halves**.

## 3. The production facts the ruling lands on

| Row | Detail |
|---|---|
| `core.licensor` `FR` "FRIENDS TV" | was `active`; id `2b2caddf-…`; sourced from DesignFlow PLM |
| `core.property` `FK` "FRIDA KAHLO" | `active`; id `cb26ec58-…`; parent = `FR` |
| Properties under `FR` | exactly **1** — `FK`, and nothing else |
| Characters under `FK` | **0** |
| Unrelated but important | property `FN` "FRIENDS" already sits correctly under `WB` WARNER BROS — the real TV series is not affected by any of this |

## 4. What was done

- **`20260802170000`** — `plm.import_master_data()` no longer overwrites `status` on an
  already-matched licensor or property. Newly created rows still arrive `active`. Two lines
  removed; nothing else in the function touched. No table, column, type, grant or RLS change.
- **`20260802171000`** — created `core.taxonomy_owner_ruling` (who ruled, when, on what, what
  the ruling was, what was done, what was left open), recorded both halves of the ruling in
  it, and **set licensor `FR` to `inactive`**.

Nothing was dropped or deleted: the `FR` row, the `FK` row, their source refs and their
relationship are all intact, and every change reverses with a one-line update.

## 5. What was **not** done, and why — decisions for Albert

The FRIDA KAHLO half is **recorded but not applied**. Four questions block it:

1. **Should a FRIDA KAHLO licensor be created in our master data at all**, given it is defunct
   and does not appear in the DesignFlow PLM feed?
2. **If yes, what licensor code?** `FR` is taken by FRIENDS TV and codes are unique. The
   established convention for licensors absent from the PLM/ColdLion feed is an `X-` prefix
   (`X-NASA`, `X-FORD`, `X-NFL`, added by migration `20260724021500`), which points at
   `X-FRIDAKAHLO` — but assigning a master-data code is a business call, not an engineering one.
3. **Should property `FK` be re-pointed to it, and should `FK` itself also go inactive**, since
   its licensor is defunct?
4. **The durability blocker.** `plm.import_master_data()` still re-points an existing property
   at whatever parent DesignFlow PLM reports, on every re-pull. `20260802170000` protects
   `status` but deliberately does **not** protect parentage, because deciding that our curated
   parentage outranks DesignFlow PLM is itself an owner decision. **Until that is decided, any
   re-point applied today would silently revert on the next sync** — which is exactly the kind
   of self-undoing change this repository forbids.

A fifth, smaller one: "created by mistake" arguably justifies `archived` or `deleted` rather
than `inactive` for `FR`. `inactive` was used because it is the least destructive value that
expresses the ruling. Escalating it further is a separate decision.

## 6. Blast radius — who reads `core.licensor`

Four apps share this database: Poppim, PopCRM, PopDAM and DesignFlow PLM.

- **No new column was added**, so no app can break on an unexpected column, no generated type
  goes stale, and no `select *` changes shape. This is the main reason the false premise in §1
  mattered.
- **The one behaviour change apps will see** is that licensor `FR` now reports
  `status = 'inactive'`. Any screen that lists licensors *without* filtering on status will
  still show FRIENDS TV; any screen that filters to `status = 'active'` will stop showing it.
  That is the intended effect of the ruling. `FR` has exactly one property and zero characters,
  so the surface is as small as it could be.
- **The PLM importer change is strictly less destructive** than the code it replaces: it stops
  writing a value it used to force, and writes nothing new.
- **Not verified by this work:** whether any app hard-codes the string `FRIENDS TV` or the code
  `FR`, and whether PopDAM's separate code space collides here. Both are outside this change.

## 7. Caveat on ColdLion

`plm.erp_property` and `plm.erp_licensor` are both empty and the ColdLion licensor/property
sync has never recorded a run, so there is no ColdLion-sourced licensor data to reconcile this
ruling against. ColdLion also has no active/inactive marker of its own — which is the original
reason this gap existed at all.

## 8. FR bundle authorization recovery

The FR write guard permits exactly one unconsumed
`owner_ruling_fr_inactivation` authorization across the table. That check
deliberately ignores `expires_at`. Therefore an expired authorization left by an
abandoned or failed FR bundle blocks every later FR attempt. This is a fail-closed
operational latch: expiry does not make an unexplained committed authorization
safe to ignore.

When the guard reports that another FR authorization is outstanding, do not
weaken the guard or issue another authorization. A superuser must inspect the
single stale row and its transaction/audit evidence, establish why it was left
unconsumed, and delete only that exact authorization before retrying the complete
bundle. The normal successful path remains unchanged: the exact guarded write
consumes its authorization and writes immutable audit evidence in the same
transaction.
