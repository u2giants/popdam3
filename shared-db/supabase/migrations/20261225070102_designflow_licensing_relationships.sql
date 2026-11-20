-- #4707: additive DesignFlow licensing assignee, mention and attachment relationships.
-- derived-from: none
-- The primary identity at this stage is the existing DesignFlow user ID.
-- A profile is linked only when its identity is established by the consumer.
-- The app user list uses different schemas in production and sandbox. Enforce
-- the selected environment’s user mapping before granting the consumer writes.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table plm.licensing_status_assignee (
  licensing_status_id uuid not null references plm.licensing_status(id) on delete cascade,
  designflow_user_id integer not null check (designflow_user_id > 0),
  profile_id uuid references app.profile(id) on delete set null,
  position integer not null check (position > 0),
  primary key (licensing_status_id, designflow_user_id),
  unique (licensing_status_id, position)
);

create index licensing_status_assignee_profile_id_idx
  on plm.licensing_status_assignee (profile_id) where profile_id is not null;

create table plm.licensing_feedback_mention (
  licensing_feedback_id uuid not null references plm.licensing_feedback(id) on delete cascade,
  designflow_user_id integer not null check (designflow_user_id > 0),
  profile_id uuid references app.profile(id) on delete set null,
  position integer not null check (position > 0),
  primary key (licensing_feedback_id, designflow_user_id),
  unique (licensing_feedback_id, position)
);

create index licensing_feedback_mention_profile_id_idx
  on plm.licensing_feedback_mention (profile_id) where profile_id is not null;

create table plm.licensing_attachment (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references plm.item(id) on delete cascade,
  licensing_status_id uuid references plm.licensing_status(id) on delete cascade,
  licensing_feedback_id uuid references plm.licensing_feedback(id) on delete cascade,
  file_object_id uuid references app.file_object(id) on delete set null,
  source_reference text not null check (btrim(source_reference) <> ''),
  position integer not null check (position > 0),
  constraint licensing_attachment_one_parent
    check (num_nonnulls(item_id, licensing_status_id, licensing_feedback_id) = 1)
);

create unique index licensing_attachment_item_slot_idx
  on plm.licensing_attachment (item_id, position) where item_id is not null;

create unique index licensing_attachment_status_slot_idx
  on plm.licensing_attachment (licensing_status_id, position) where licensing_status_id is not null;

create unique index licensing_attachment_feedback_slot_idx
  on plm.licensing_attachment (licensing_feedback_id, position) where licensing_feedback_id is not null;

create index licensing_attachment_file_object_id_idx
  on plm.licensing_attachment (file_object_id);

alter table plm.licensing_status_assignee enable row level security;
alter table plm.licensing_feedback_mention enable row level security;
alter table plm.licensing_attachment enable row level security;

revoke all on plm.licensing_status_assignee, plm.licensing_feedback_mention,
  plm.licensing_attachment from public, anon, authenticated;

comment on table plm.licensing_status_assignee is
  'Ordered DesignFlow licensing assignees. First position is the primary assignee.';
comment on table plm.licensing_feedback_mention is
  'Ordered DesignFlow user mentions on a licensing feedback entry.';
comment on table plm.licensing_attachment is
  'Ordered licensing document reference attached to exactly one item, status or feedback entry.';
comment on column plm.licensing_attachment.source_reference is
  'Stable DesignFlow attachment identity retained after the file object is deleted.';

commit;
