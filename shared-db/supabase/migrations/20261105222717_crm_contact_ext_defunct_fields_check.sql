-- Follow-up to 20261105215348_crm_contact_ext.sql, resolving review finding #5768
-- (finding 1): a contact marked defunct must record when and by whom.
-- The table is new and empty, so validation is immediate.
-- derived-from: none
alter table crm.contact_ext
  add constraint crm_contact_ext_defunct_fields_check
  check (defunct_reason is null or (defunct_at is not null and defunct_by is not null))
  not valid;

alter table crm.contact_ext
  validate constraint crm_contact_ext_defunct_fields_check;
