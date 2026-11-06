-- Owner ruling (Albert Hazan, 2026-11-05): "only admin and sales can mark
-- contacts defunct". Narrows crm_write on crm.contact_ext from any CRM user to
-- administrator or sales. crm_read is unchanged. Supersedes the any-CRM-user
-- choice recorded on review finding #5768.
-- derived-from: 20261105215348
drop policy crm_write on crm.contact_ext;
create policy crm_write on crm.contact_ext for all to authenticated
  using (app.has_role('administrator') or app.has_any_role(array['sales']::app.app_role[]))
  with check (app.has_role('administrator') or app.has_any_role(array['sales']::app.app_role[]));
