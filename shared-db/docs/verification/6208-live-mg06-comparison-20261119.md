---
summary: "Read-only reconciliation of production DesignFlow item MG06 codes against live ColdLion for issue 6208."
kind: proof
status: done
read-when: checking the November 19 live comparison for CP, MM, MMF, or ME
---

# Live MG06 comparison for issue 6208

On November 19, 2026, before 2:38 PM EST, 904 of 914 distinct production styles matched live ColdLion. Each of the 10 remaining styles was checked individually.

| MG06 | Production rows | ColdLion rows | Matching rows |
| --- | ---: | ---: | ---: |
| CP | 24 | 24 | 24 |
| MM | 445 | 436 | 436 |
| MMF | 279 | 277 | 277 |
| ME | 168 | 167 | 167 |
| Total | 916 | 904 | 904 |

- Eight styles were absent from ColdLion's exact-style results in all four EDGEHOME divisions checked. They account for ten production rows because one style appears once in CW001 and twice in SP001.
- Two CW001 styles still carry MM in production and have a blank MG06 in live ColdLion. Their MG05 was also blank in ColdLion.
- Every live style in the four code groups had a corresponding production entry with the same division, style, MG05, and MG06. The comparison included prepacks and applied no active-status filter.

The production comparison used the stored item-header codes. ColdLion pulls used division and MG06 filters, explicit item-number sorting, and verified that retrieved and distinct item counts matched the reported total on every pull. The exceptions were rechecked by item number without an MG06 filter in CW001, SP001, EH001, and EP001. The results establish the current differences. The reason the copy retains those values or rows was not established. Both systems were read only.

Tracking: [shared-db issue 6208](https://github.com/popcre/shared-db/issues/6208).
