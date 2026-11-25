# Factory licensor and retailer approvals (issue #7070)

Licensors: Disney (FAMA form), NBCUniversal (LMS form). Retailers: Dollar
General, Walmart.

Shared-db objects: `core.factory_approval` (one row per factory × program:
disney, dollar_general, nbcu, walmart), `core.factory_approval_form` (full
history of Disney FAMA / NBCU LMS PDFs), bucket `factory-approval-forms`,
view `core.factory_approval_renewal_due`, role `production`.

Application work still needed:

- **Vendor screen (PLM/DesignFlow):** Yes/No per program, approved name,
  facility/LMS number and expiry; manual edits write `core.factory_approval`
  (licensing, production, administrator). Upload: put the PDF in the bucket,
  then insert `core.factory_approval_form (factory_id, program, storage_path, file_name)`.
  Show the form history list.
- **Indra OCR worker (PopDAM agent-api):** service role calls
  `core.claim_factory_approval_form_ocr(limit)`, downloads each PDF, OCRs with
  Indra, extracts the fields below, then calls
  `core.record_factory_approval_form_ocr(form_id, text, name, number, expires_on, error, 'indra', issued_on, form_reference, aliases)`.
  - **FAMA** (title "FACILITY AND MERCHANDISE AUTHORIZATION"): name = "FACILITY
    NAME" without the trailing `(FAC-…)`; number = that `FAC-` code (e.g.
    `FAC-046111`); aliases = "FACILITY ALIAS NAME(S)"; form_reference = "FAMA
    ID"; issued_on = the MM/DD/YYYY date. No expiry is printed: pass null and
    the database sets issued + 1 year.
  - **NBCU LMS** (e.g. "WAIVER APPROVAL" letter): name = "Manufacturer Name";
    number = "Manufacturer Code" as printed (e.g. `L-12813`); issued_on =
    "Issued Date"; expires_on = "Approval Expiration Date".
  The newest processed form updates the approval automatically.
- **Reminders:** daily cron `factory-approval-renewal-reminders` writes
  `app.notification` rows (app `plm`) to every licensing and production user,
  once per expiry date, 42 days before expiry. Email delivery, if wanted, reads
  those rows.
- Assign the new `production` role to the production team members.
