---
summary: Style Guide Sources (sku_files_used) are populated only from licensing sheet and tech pack PDFs.
kind: decision
status: current
read-when: changing how sku_files_used is parsed, backfilled or cleaned
---

# Style Guide Sources come from licensing PDFs only

**Decided:** 2026-06-10 (migration `20260610070731`).

**Decision:** `sku_files_used` is populated only from PDFs whose filename contains "licensing sheet", "license sheet", "tech pack" or "techpack". All three write paths are gated and the PDF backfill claim is scoped to those PDFs. Resolution of the listed files is fuzzy and continuous.

**Why:** `.ai` OCR text is garbage or the "saved without PDF Content" sentinel, and non-licensing PDFs added noise (backfill remaining dropped from 52,862 to 13,819).

**Rejected:** bulk-deleting unresolved filename-looking rows. PopSG is not comprehensive ground truth, so "no match" is not "garbage"; only categorical non-filenames are safe to delete.

## Source

- [docs/idiosyncrasies.md, Style Guide Sources](../idiosyncrasies.md)
- private memory note project_style_guide_sources_scope (outside this repo)
