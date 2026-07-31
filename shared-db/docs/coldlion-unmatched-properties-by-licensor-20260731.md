# Which licensor do the unmatched ColdLion properties belong to?

**For Albert — one decision pass. Measured on the preview database (a full copy of live data) on 2026-07-31.**

---

## Read this first — three things changed the question

**1. There are 33 unmatched property codes, not 66.** The "66 missing out of 322" figure that has been
circulating is out of date. ColdLion today offers **285** property codes; our master data holds **256**;
**33** have no matching record. Every one of the 33 is listed below — nothing is sampled or summarised away.

**2. 27 of the 33 were created in ColdLion *yesterday*, on 30 July 2026.** They arrived in our copy of
ColdLion for the first time this morning. Twenty-seven of the 285 codes were created on that date, and they
are exactly these 27. **A licence created yesterday cannot be a lapsed licence.** The whole reason for
caution here — "ColdLion has no expiry flag, so it keeps returning dead licences" — does not apply to them.

**3. The lapsed licences everyone was worried about are not in this list.** NASA, ZAG and FRIDA KAHLO were
the named examples of dead licences that would get resurrected. NASA is recorded as a **licensor**, not a
property. Frida Kahlo already has a matching record. Neither ZAG nor any of the three appears among the 33.
**The specific risk that made this a policy question is not present in the actual data.**

The oldest of the 33 was created in ColdLion in January 2025. There is nothing in this list from the
2019–2022 back-catalogue where lapsed licences would live.

### Two honest limits on what I could measure

- **ColdLion does not record which licensor a property belongs to.** Its property records carry a code, a
  name and dates — and nothing that points at a parent. So the licensor column below is *not* copied from
  ColdLion. Where our own master data already holds the parent franchise, I took the licensor from there and
  marked it **from our records**. For the rest I identified the studio that owns the title and marked it
  **inferred**. Inferred rows are my reading, not a system fact.
- **ColdLion has no active/inactive marker on properties at all** — not a blank one, an absent one. So
  "active or inactive" cannot be answered for any of the 33. The nearest usable substitute is the creation
  date, which is why it is the column I lead with.

### Volume: all 33 are at zero

**None of the 33 codes appears on a single product record.** ColdLion's item feed carries 14,527 items with
a property code on them; not one uses any of these 33. So volume cannot separate them — nothing here is
sitting on 400 styles. (Some codes do show asset counts in PopDAM, but PopDAM's codes are a different code
space that collides with ColdLion's — PopDAM's "BB" is Big Bird under Sesame Street, not The Brady Bunch. I
discarded those numbers as misleading rather than present them.)

---

## The table — grouped by licensor

**Is each licensor below correct?**

### Warner Bros — 2 codes · recommend ADMIT

Both were confirmed by Laura in round 1 and she was right; this table exists because our side never acted on
her answer.

| Code | Property name as ColdLion gives it | Created in ColdLion | Licensor evidence |
|---|---|---|---|
| `EX` | THE EXORCIST | 2026-04-21 | Inferred — Warner Bros. Confirmed by Laura, round 1. |
| `LB` | THE LOST BOYS | 2026-04-21 | Inferred — Warner Bros. Confirmed by Laura, round 1. |

> One flag worth your eye: PopDAM currently files eight Exorcist assets under **NBC**, not Warner Bros. Laura
> said Warner Bros and Warner Bros is right. If `EX` is admitted, the PopDAM tagging is wrong and is worth a
> separate look — but it does not change this decision.

### NBCUniversal — 2 codes · recommend ADMIT

| Code | Property name as ColdLion gives it | Created in ColdLion | Licensor evidence |
|---|---|---|---|
| `55` | SHREK 5 | 2025-01-20 | **From our records** — we already hold SHREK (`SH`) under NBC. This is its sequel. |
| `MY` | THE MUMMY | 2026-07-30 | Inferred — Universal. |

### Peanuts Worldwide — 1 code · recommend ADMIT

| Code | Property name as ColdLion gives it | Created in ColdLion | Licensor evidence |
|---|---|---|---|
| `75` | PEANUTS 75TH ANNIVERSARY | 2025-01-06 | **From our records** — we already hold PEANUTS (`UT`) under Peanuts Worldwide. |

### DC — 1 code · recommend ADMIT

| Code | Property name as ColdLion gives it | Created in ColdLion | Licensor evidence |
|---|---|---|---|
| `SGT` | SUPERGIRL THEATRICAL 2026 | 2026-01-16 | **From our records** — we already hold SUPERGIRL (`SG`) under DC. A 2026 film cannot be lapsed. |

### Viacom Multi (Paramount) — 27 codes · recommend ADMIT as a block

This is the finding. **Twenty-six of these 27 were created in ColdLion on 30 July 2026 — one batch, one day.**
Read the titles together and they are unmistakably a single Paramount catalogue load: the CBS television
library, the 1980s–90s Paramount film library, and the current Paramount shows. This is not decay. This looks
like a licence that was signed or renewed and then loaded.

Four of them are sequels or editions of franchises **we already license from Viacom Multi**, which is
data-confirmed rather than inferred.

| Code | Property name as ColdLion gives it | Created in ColdLion | Licensor evidence |
|---|---|---|---|
| `SM1` | SCREAM (2022) | 2026-07-30 | **From our records** — SCREAM (`SCM`) is already ours under Viacom Multi. |
| `SM6` | SCREAM 6 (2023) | 2026-07-30 | **From our records** — same franchise as `SCM`. |
| `SM7` | SCREAM 7 (2026) | 2026-07-30 | **From our records** — same franchise as `SCM`. A 2026 film. |
| `GE1` | GARFIELD (2024) | 2026-07-30 | **From our records** — GARFIELD (`GE`) is already ours under Viacom Multi. |
| `TNT` | TALES OF THE TMNT (2024 Series) | 2026-07-30 | Inferred — Paramount/Nickelodeon. We already hold NINJA TURTLES GROUP. |
| `CU` | CLUELESS | 2026-07-30 | Inferred — Paramount film library. |
| `FB` | FERRIS BUELLER’S DAY OFF | 2026-07-30 | Inferred — Paramount film library. |
| `FG` | FORREST GUMP | 2026-07-30 | Inferred — Paramount film library. |
| `GRE` | GREASE | 2026-07-30 | Inferred — Paramount film library. |
| `FSD` | FLASHDANCE | 2026-07-30 | Inferred — Paramount film library. |
| `FE` | FOOTLOOSE (1984) | 2026-07-30 | Inferred — Paramount film library. |
| `MG1` | MEAN GIRLS (2004) | 2026-07-30 | Inferred — Paramount film library. |
| `MG2` | MEAN GIRLS (2024) | 2026-07-30 | Inferred — Paramount film library. |
| `AM1` | ANCHORMAN: THE LEGEND OF RON BURGUNDY | 2026-07-30 | Inferred — Paramount released it. Slightly less certain, see below. |
| `AM2` | ANCHORMAN 2: THE LEGEND CONTINUES | 2026-07-30 | Inferred — as `AM1`. |
| `BB` | THE BRADY BUNCH | 2026-07-30 | Inferred — CBS library, now Paramount. |
| `CHR` | CHEERS | 2026-01-05 | Inferred — CBS library, now Paramount. The one older title in this group. |
| `HDS` | HAPPY DAYS | 2026-07-30 | Inferred — CBS library, now Paramount. |
| `TZ3` | TWLIGHT ZONE (1959) *(ColdLion's spelling)* | 2026-07-30 | Inferred — CBS library, now Paramount. |
| `TZ1` | THE TWILIGHT ZONE (1985) | 2026-07-30 | Inferred — CBS library, now Paramount. |
| `TZ2` | THE TWILIGHT ZONE (2019) | 2026-07-30 | Inferred — CBS library, now Paramount. |
| `BH` | BEVERLY HILLS 90210 (1990) | 2026-07-30 | Inferred — CBS library, now Paramount. |
| `90` | 90210 (2008) | 2026-07-30 | Inferred — CBS library, now Paramount. |
| `MGM` | MIGHTY MOUSE | 2026-07-30 | Inferred — Terrytoons, CBS library, now Paramount. Less certain, see below. |
| `WND` | IT'S A WONDERFUL LIFE (B/W) | 2026-07-30 | Inferred — Paramount holds it. Less certain, see below. |
| `EP` | EMILY IN PARIS | 2026-07-30 | Inferred — Paramount produces it. Less certain, see below. |
| `YS` | YELLOWSTONE | 2026-07-30 | Inferred — Paramount. |

---

## What I recommend, and what only you can answer

**Recommend admitting all 33.** The reasoning is short: none of them can be a lapsed licence. Twenty-seven
were created in ColdLion yesterday, and the remaining six were created between January 2025 and April 2026.
Nothing in the list is old enough to have quietly expired, and the three titles that prompted the whole
lapsed-licence concern are not in the list at all.

**Five rows I would like you to look at personally** — not because they look lapsed, but because my licensor
attribution is inference rather than a record, and getting a parent wrong is worse than leaving a code out:

| Code | Property | Why I am asking |
|---|---|---|
| `AM1` / `AM2` | ANCHORMAN 1 and 2 | DreamWorks production, Paramount release. Whether the licence sits with Paramount or NBCUniversal is a contract question, not a data one. |
| `MGM` | MIGHTY MOUSE | Terrytoons has changed hands more than once. Paramount is my best read, not a confident one. |
| `WND` | IT'S A WONDERFUL LIFE | Long-disputed ownership. Paramount holds it today, but confirm before filing. |
| `EP` | EMILY IN PARIS | Paramount produces it, Netflix distributes it. Which of those we license from matters. |

**Everything else I am confident in.** The seven marked **from our records** are not inference at all — they
are sequels and editions of franchises we already license, filed under the licensor we already use.

## What happens next

Nothing has been changed. This document only reports what is there. Once you have marked the licensors
correct — or corrected them — the records get created in one reviewed batch. No records have been added,
altered or deleted in producing this.

---

*Source: the preview database, read-only, 2026-07-31. Figures re-derived on the day; treat any count in an
older document as indicative only.*
