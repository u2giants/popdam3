-- =====================================================================================
-- Issue #3887 (child 2b of #3882) - one user list for DesignFlow: repoint user
-- foreign keys from app.users to dflow.users.
--
-- Claim: #3888. Reserved version 20261002155633.
--
-- WHY: the DesignFlow table map loads users into dflow.users (the list carrying the
-- app_profile_id link to app.profile), but these mapped tables' user FKs still
-- reference app.users. After the Cloud SQL copy, rows written by users who exist only
-- in dflow.users would be rejected.
--
-- STRUCTURE ONLY. Each FK is dropped and re-added under the same name, column and
-- ON UPDATE/ON DELETE actions; only the referenced table changes. Live check
-- 2026-10-02 on production and preview: zero child rows orphan against dflow.users,
-- so the constraints are added validated. app.users itself is not touched.
--
-- Not here: app."RolePermissions"."UserId" and plm.art_piece_attachment
-- created_by/updated_by (held by claim #3378 / PR #3391), and the frozen schema
-- designflow_frozen_20260710 (retired by PR #3391).
-- =====================================================================================

-- derived-from: none

alter table core.age_group drop constraint age_group_created_by_fkey;
alter table core.age_group add constraint age_group_created_by_fkey
  foreign key (created_by) references dflow.users(id);
alter table core.age_group drop constraint age_group_updated_by_fkey;
alter table core.age_group add constraint age_group_updated_by_fkey
  foreign key (updated_by) references dflow.users(id);
alter table core.art_types drop constraint art_types_created_by_fkey;
alter table core.art_types add constraint art_types_created_by_fkey
  foreign key (created_by) references dflow.users(id);
alter table core.art_types drop constraint art_types_updated_by_fkey;
alter table core.art_types add constraint art_types_updated_by_fkey
  foreign key (updated_by) references dflow.users(id);
alter table core.artist_types drop constraint artist_types_created_by_fkey;
alter table core.artist_types add constraint artist_types_created_by_fkey
  foreign key (created_by) references dflow.users(id);
alter table core.artist_types drop constraint artist_types_updated_by_fkey;
alter table core.artist_types add constraint artist_types_updated_by_fkey
  foreign key (updated_by) references dflow.users(id);
alter table plm."productUserAssignment" drop constraint "productUserAssignment_user_id_fk_fkey";
alter table plm."productUserAssignment" add constraint "productUserAssignment_user_id_fk_fkey"
  foreign key (user_id_fk) references dflow.users(id) on update cascade;
alter table plm.sample_comments drop constraint sample_comments_user_id_fkey;
alter table plm.sample_comments add constraint sample_comments_user_id_fkey
  foreign key (user_id) references dflow.users(id) on update cascade;
