-- popcre/shared-db#5952: preserve distinct identifiers from the source PDF.
-- Existing captures remain immutable. A NULL array records unverified evidence.

alter table plm.licensor_submission_pdf
  add column submission_numbers text[],
  add column brand_assurance_numbers text[];

comment on column plm.licensor_submission_pdf.submission_numbers is
  'Submission identifiers explicitly supported by this PDF. NULL when not verified.';

comment on column plm.licensor_submission_pdf.brand_assurance_numbers is
  'Brand Assurance identifiers explicitly supported by this PDF. NULL when not verified.';
