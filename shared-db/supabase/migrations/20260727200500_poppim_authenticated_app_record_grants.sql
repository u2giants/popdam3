-- Poppim's authenticated browser contracts are SECURITY INVOKER and therefore
-- need table privileges in addition to the existing row-level policies.
--
-- Preview browser verification found that the report/secondary RPCs stopped at
-- app.activity with 42501 even for an administrator. The app also directly
-- creates PM comments, dependencies/decisions, and own reminders.

grant select on app.activity, app.comment, app.notification to authenticated;
grant insert, update on app.activity to authenticated;
grant insert on app.comment to authenticated;
grant insert, update on app.notification to authenticated;

drop policy if exists notification_insert_own on app.notification;
create policy notification_insert_own
on app.notification
for insert
to authenticated
with check (
  profile_id = app.current_profile_id()
  or app.has_role('administrator')
);
