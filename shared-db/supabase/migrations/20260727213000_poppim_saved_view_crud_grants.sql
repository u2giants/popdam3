-- Restore the table privileges required by Poppim's saved-view CRUD callers,
-- and enforce the owner/shared behavior at the database boundary.

grant select, insert, update, delete on pim.saved_view to authenticated;

drop policy if exists pm_read on pim.saved_view;
drop policy if exists pm_write on pim.saved_view;

create policy pm_saved_view_select
on pim.saved_view
for select
to authenticated
using (
  (select app.has_app_access('pm') or app.has_role('administrator'))
  and (
    scope = 'shared'
    or owner_profile_id = (select app.current_profile_id())
  )
);

create policy pm_saved_view_insert
on pim.saved_view
for insert
to authenticated
with check (
  (select app.has_app_access('pm') or app.has_role('administrator'))
  and owner_profile_id = (select app.current_profile_id())
  and (
    scope = 'personal'
    or (scope = 'shared' and (select app.has_role('administrator')))
  )
);

create policy pm_saved_view_update
on pim.saved_view
for update
to authenticated
using (
  owner_profile_id = (select app.current_profile_id())
)
with check (
  owner_profile_id = (select app.current_profile_id())
  and (
    scope = 'personal'
    or (scope = 'shared' and (select app.has_role('administrator')))
  )
);

create policy pm_saved_view_delete
on pim.saved_view
for delete
to authenticated
using (
  owner_profile_id = (select app.current_profile_id())
);

comment on table pim.saved_view is
  'Poppim saved views. Authenticated PM users may read shared views and own views, mutate only their own views, and only administrators may create or retain shared scope.';
