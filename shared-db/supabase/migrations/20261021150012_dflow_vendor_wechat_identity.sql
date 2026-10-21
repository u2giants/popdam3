-- #4532 (application issue popcre/designflow-backend#201): DesignFlow WeChat
-- website login for factory/vendor people.
--
-- Owner ruling (Albert, 2026-10-21): WeChat login is vendor-only and
-- invite-only. A person scans once and lands in 'pending'; an admin links the
-- row to an existing vendor user and approves it. Only then does the backend
-- issue a vendor session.
--
-- KEY: WeChat gives no email. wechat_key is the unionid (stable across POP's
-- WeChat apps) or, when WeChat returns none, 'openid:<openid>'.
--
-- vendor_id is deliberately NOT a foreign key: the backend reads vendors
-- through its table-schema map (core vs dflow differs by environment), so the
-- application validates the vendor exists when an admin links it.
--
-- No GRANT/RLS: dflow is not PostgREST-exposed; the backend connects as the
-- owning role, matching every other dflow.* table.

set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists dflow.vendor_wechat_identity (
  id bigint generated always as identity primary key,
  wechat_key text not null unique,
  unionid text,
  openid text not null,
  nickname text,
  avatar_url text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'blocked')),
  vendor_id integer,
  decided_by_user_id integer,
  decided_at timestamptz,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_login_at timestamptz,
  check (wechat_key = coalesce(unionid, 'openid:' || openid)),
  check (status <> 'approved' or vendor_id is not null)
);

comment on table dflow.vendor_wechat_identity is
  'WeChat login identities for vendor users; pending until an admin links vendor_id and approves (#4532).';
