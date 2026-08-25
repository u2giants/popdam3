-- Issue #1492: establish nullable, reviewed identity bridges for the
-- coordinated DesignFlow users/roles/comments adoption.
--
-- dflow remains the only writable authority. This migration does not copy,
-- infer, mirror, or reconcile rows. Integer identities, login/JWT fields,
-- permissions, threaded comments, and office/language authority stay intact.

alter table dflow.users
  add column if not exists app_profile_id uuid;

alter table dflow."Roles"
  add column if not exists app_role_id uuid;

alter table dflow.comments
  add column if not exists app_comment_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.users'::regclass
      and conname = 'users_app_profile_id_fkey'
  ) then
    alter table dflow.users
      add constraint users_app_profile_id_fkey
      foreign key (app_profile_id)
      references app.profile(id)
      on update cascade
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow."Roles"'::regclass
      and conname = 'roles_app_role_id_fkey'
  ) then
    alter table dflow."Roles"
      add constraint roles_app_role_id_fkey
      foreign key (app_role_id)
      references app.role(id)
      on update cascade
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.comments'::regclass
      and conname = 'comments_app_comment_id_fkey'
  ) then
    alter table dflow.comments
      add constraint comments_app_comment_id_fkey
      foreign key (app_comment_id)
      references app.comment(id)
      on update cascade
      on delete restrict
      not valid;
  end if;
end
$migration$;

alter table dflow.users
  validate constraint users_app_profile_id_fkey;
alter table dflow."Roles"
  validate constraint roles_app_role_id_fkey;
alter table dflow.comments
  validate constraint comments_app_comment_id_fkey;

-- A canonical identity can represent at most one legacy identity. Any
-- duplicate or uncertain candidate remains NULL until separately reviewed.
create unique index if not exists users_app_profile_id_uidx
  on dflow.users (app_profile_id)
  where app_profile_id is not null;

create unique index if not exists roles_app_role_id_uidx
  on dflow."Roles" (app_role_id)
  where app_role_id is not null;

create unique index if not exists comments_app_comment_id_uidx
  on dflow.comments (app_comment_id)
  where app_comment_id is not null;

comment on column dflow.users.app_profile_id is
  'Optional reviewed identity bridge to app.profile. NULL means unresolved. dflow.users remains authoritative for login/JWT identity, office_location, and preferred_language until the coordinated application cutover passes.';

comment on column dflow."Roles".app_role_id is
  'Optional reviewed identity bridge to app.role. NULL means unresolved; dflow RolePermissions continues to reference the legacy integer Id.';

comment on column dflow.comments.app_comment_id is
  'Optional reviewed identity bridge to app.comment. NULL means unresolved; dflow.comments remains the writable threaded-item-comment authority until coordinated application cutover.';
