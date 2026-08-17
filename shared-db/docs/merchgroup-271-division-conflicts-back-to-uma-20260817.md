# The 271 merchGroup division conflicts: why we did not apply the fix yet

**Date:** 2026-08-17. **Audience:** Uma, with Albert reviewing.
**Measured live, read-only, against production `qsllyeztdwjgirsysgai`
(`get_project_url` → `https://qsllyeztdwjgirsysgai.supabase.co`). Nothing was changed.**

Follow-up to [`division-code-answers-from-uma-20260813.md`](division-code-answers-from-uma-20260813.md),
step 3 of the agreed next steps ("Fix the 271 rows using the Q5 rules").

---

## Your numbers reproduce exactly

| Text `divisionCode_fk` | Integer `divisionCode_id_fk` | Rows |
|---|---|---|
| CW001 | 1 | 1,269 |
| SP001 | 8 | 1,090 |
| EH001 | 9 | 923 |
| **EH001** | **2** | **217** ← block A |
| **CW001** | **8** | **54** ← block B |
| EP001 | *null* | 49 |
| *null* | 1 | 39 |
| *null* | *null* | 4 |

3,645 rows total, 271 in conflict. Same in `core."merchGroup"` and `dflow."merchGroup"` —
the two tables are identical row for row.

---

## Three things we found that the fix rule does not cover

### 1. The fix would create 169 duplicate rows

There is **no unique constraint** on `(division, mgTypeCode, mg_code)` — the only key is
`mg_id` — so the UPDATE succeeds and the duplicates appear silently.

| Block | Rows moved | Land on an existing row with the **same** name | Land on an existing row with a **different** name |
|---|---|---|---|
| A (217 → integer 9) | 217 | 119 | 23 |
| B (54 → text SP001) | 54 | 7 | 21 |
| **Total** | **271** | **126** | **44** |

The 126 same-name cases are duplicates of a row that already exists correctly. The 44
different-name cases are worse: the same code already means something else in the
destination division. Examples:

| Moving | Its name | Lands on | Which already means |
|---|---|---|---|
| mg_id 473, type 01, code V → EH001 | CANVAS | mg_id 3237 | Floor coverings |
| mg_id 461, type 01, code C → EH001 | CERAMIC | mg_id 3221 | Plaque |
| mg_id 909, type 01, code V → SP001 | CANVAS | mg_id 2749 | Floor coverings |
| mg_id 3120, type 02, code 91 → SP001 | Other | mg_id 2756 | Other clocks |

Type 01 in the moving rows is a **material** list (CANVAS, CERAMIC, STEEL, WOOD…), while
type 01 in the destination is a **product-form** list (Framed, Plaque, Box, Garden…). Those
are two different dictionaries sharing one code space. The full 44 are listed at the bottom.

### 2. 266 of the 271 rows are already inactive

| Block | `is_active = false` | `is_active = true` |
|---|---|---|
| A | 217 | 0 |
| B | 49 | 5 |

Every block-A row is dead. Only **five** live rows are involved, all block B:

| mg_id | type | code | name |
|---|---|---|---|
| 3120 | 02 | 91 | Other |
| 3121 | 02 | G1 | Glass |
| 3580 | 03 | A2 | Plain |
| 3581 | 03 | 11 | Foil |
| 3582 | 03 | Q3 | Glitter/Sequins/Rhinest |

**Zero** `designflow.art_piece` rows reference any of the 271. Nothing downstream in
Supabase is currently pointing at them.

### 3. Supabase is a mirror, so fixing it here would not last

`core."merchGroup"` and `dflow."merchGroup"` hold identical contradictions, both fed from
DesignFlow. Correcting them in Supabase would be undone by the next sync. **The fix belongs
in DesignFlow's own database**, and flows down from there.

---

## What we are asking you

1. **Where do you want the correction made** — DesignFlow Cloud SQL (our assumption), or
   Supabase with DesignFlow following after?
2. **The 44 different-name conflicts:** since the code already means something else in the
   destination, is the right answer to **retire** these rows rather than move them? All 44
   but one (mg_id 3120) are already inactive.
3. **The 126 same-name conflicts:** merge into the existing correct row and retire the
   duplicate, rather than end up with two rows that mean the same thing?
4. **The 5 live rows above** are the only ones that affect anybody today. Can you confirm
   each belongs in SP001 (Spruce Lic), so we can do those five first and correctly?

Once those are settled we will add the uniqueness rule on
`(division, mgTypeCode, mg_code)` so this cannot recur, plus the `CHECK` on the division
code shape from step 5.

---

## Appendix: the 44 different-name conflicts

Format: moving `mg_id` = name → destination division, type, code, already occupied by.
All are inactive unless marked LIVE.

**Block A, into EH001, type 01 (material list landing on product-form list):**
459 LEATHER/COWHIDE → code A (3219 Stretched/Box); 460 GREYBOARD → B (3220 Framed);
461 CERAMIC → C (3221 Plaque); 462 DRY ERASE → D (3222 Functional); 463 FELT → E (3223 Other Wall);
464 FOAM → F (3224 Block); 465 GLASS → G (3225 Box); 466 DENIM → J (3227 Object);
467 CORK → K (3228 Other tabletop); 468 MDF → M (3229 Clocks); 469 PVC → P (3231 Hard storage);
470 PAPER → R (3233 Other storage); 471 STEEL → S (3234 Stationery org);
472 PLUSH → U (3236 Other workspace); 473 CANVAS → V (3237 Floor coverings);
474 WOOD → W (3238 Garden).

**Block A, into EH001, type 04 (size codes, near-miss names):**
486 `10.25X24` → code 02 (1343 `10.25X24"`); 488 `9.5X5` → 05 (1345 `10X5"`);
498 `10X20"` → 1A (1359 `15X23"`); 522 `40x16"` → 41 (1402 `14X30"`);
543 `6X2"` → 6T (1440 `60X48"`); 546 `7.9X11.5` → 71 (1443 `7.9X11.5"`);
578 `22X16"` → Q6 (1489 `15X22"`).

**Block B, into SP001, type 01:**
893 LEATHER/COWHIDE → A (2731 Stretched/Box); 894 GREYBOARD → B (2732 Framed);
895 CERAMIC → C (2733 Plaque); 896 DRY ERASE → D (2734 Functional); 897 FELT → E (2735 Other Wall);
898 FOAM → F (2736 Block); 899 GLASS → G (2737 Box); 900 FABRIC → H (2738 Photo Frames);
901 DENIM → J (2739 Object); 902 CORK → K (2740 Other tabletop); 903 MDF → M (2741 Clocks);
904 SILICONE → N (2742 Soft storage); 905 PLASTIC → P (2743 Hard storage);
906 PAPER → R (2745 Other storage); 907 STEEL → S (2746 Stationery org);
908 PLUSH → U (2748 Other workspace); 909 CANVAS → V (2749 Floor coverings);
910 WOOD → W (2750 Garden).

**Block B, into SP001, type 02:**
912 DECAL → code 6 (2337 Shades); **3120 LIVE** `Other` → 91 (2756 Other clocks);
914 TABLETOP DECOR → T (2382 Tool / 2383 Tray-Dish / 2384 Satin).
