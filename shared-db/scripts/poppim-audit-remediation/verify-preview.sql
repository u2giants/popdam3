\set ON_ERROR_STOP on
\pset pager off

begin;
set local statement_timeout = '8s';

-- Preview has production-like data but fewer than 10,000 eligible rows in one
-- department. Add rollback-only fixtures so the old 5,000-row failure boundary
-- and deep keyset behavior are exercised without leaving test data behind.
insert into pim.product (
  id,
  name,
  stage,
  external_source,
  external_id,
  metadata,
  updated_at
)
select
  ('10000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  case when g = 12050 then 'needle-beyond-former-cap' else 'PM keyset fixture ' || g end,
  (
    select s.name
    from pim.stage s
    where s.pipeline = 'POP Creations'
    order by s.sort_order, s.id
    limit 1
  ),
  'pm-contract-preview-fixture',
  g::text,
  jsonb_build_object(
    'business_unit', 'POP Creations',
    'clickup_status_type', case when g % 2 = 0 then 'open' else 'custom' end,
    'clickup_folder_name', 'PM Contract Fixture',
    'clickup_list_name', case when g % 3 = 0 then 'Fixture A' else 'Fixture B' end,
    'clickup_orderindex', g::text
  ),
  '2025-01-01 00:00:00+00'::timestamptz + (12051 - g) * interval '1 second'
from generate_series(1, 12050) g;

-- Resolve one preview administrator and one authenticated non-PM reader
-- dynamically. No user identifiers or credentials are stored in this script.
select p.auth_user_id::text as admin_auth_user_id
from app.profile p
join app.user_role ur on ur.profile_id = p.id and ur.revoked_at is null
join app.role r on r.id = ur.role_id and r.slug = 'administrator'
where p.auth_user_id is not null
limit 1
\gset

select p.auth_user_id::text as non_pm_auth_user_id
from app.profile p
where p.auth_user_id is not null
  and not exists (
    select 1
    from app.user_role ur
    join app.role r on r.id = ur.role_id
    where ur.profile_id = p.id
      and ur.revoked_at is null
      and r.slug = 'administrator'
  )
  and not exists (
    select 1
    from app.app_access aa
    where aa.profile_id = p.id
      and aa.app = 'pm'
      and aa.revoked_at is null
  )
limit 1
\gset

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'admin_auth_user_id', 'role', 'authenticated')::text,
  true
);

do $$
begin
  begin
    perform * from api.pm_pipeline_page('Licensed', p_after_updated_at => now());
    raise exception 'half cursor was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'PM_PIPELINE_CURSOR_INCOMPLETE' then raise; end if;
  end;

  begin
    perform * from api.pm_pipeline_page('All');
    raise exception 'invalid business unit was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'PM_PIPELINE_BUSINESS_UNIT_INVALID' then raise; end if;
  end;
end
$$;

create temp table fetched_pm_ids (
  id uuid primary key,
  updated_at timestamptz not null
) on commit drop;

-- The loop is one PostgreSQL statement containing many individually bounded
-- page calls, so its aggregate timeout must exceed the per-call 8-second budget.
set local statement_timeout = '60s';
do $$
declare
  v_after_updated_at timestamptz;
  v_after_id uuid;
  v_page_count integer;
begin
  loop
    insert into fetched_pm_ids (id, updated_at)
    select id, updated_at
    from api.pm_pipeline_page(
      'Licensed',
      p_limit => 200,
      p_after_updated_at => v_after_updated_at,
      p_after_id => v_after_id
    );
    get diagnostics v_page_count = row_count;

    select f.updated_at, f.id
    into v_after_updated_at, v_after_id
    from fetched_pm_ids f
    order by f.updated_at, f.id
    limit 1;

    exit when v_page_count < 200;
  end loop;
end
$$;
set local statement_timeout = '8s';

do $$
declare
  v_expected bigint;
  v_fetched bigint;
begin
  select api.pm_pipeline_count('Licensed') into v_expected;
  select count(*) into v_fetched from fetched_pm_ids;
  if v_expected <> v_fetched then
    raise exception 'keyset gap: expected %, fetched %', v_expected, v_fetched;
  end if;
  if v_fetched <= 10000 then
    raise exception 'fixture did not cross 10k: %', v_fetched;
  end if;
  if not exists (
    select 1 from api.pm_pipeline_page('Licensed', p_search => 'needle-beyond-former-cap')
  ) then
    raise exception 'search was limited before filtering';
  end if;
end
$$;

-- Facets use department eligibility only and reconcile to the authoritative
-- eligible product count. Search/count failures are independent RPC failures and
-- cannot affect a successful list call.
do $$
declare
  v_facets bigint;
  v_authoritative bigint;
begin
  select sum(product_count)
  into v_facets
  from api.pm_pipeline_list_facets('Licensed');

  select count(*)
  into v_authoritative
  from pim.product p
  where p.clickup_parent_id is null
    and lower(coalesce(p.metadata ->> 'clickup_status_type', p.metadata ->> 'status_type', ''))
      in ('open', 'custom')
    and lower(coalesce(p.metadata ->> 'business_unit', p.metadata ->> 'department', ''))
      in ('licensed', 'pop', 'pop creations')
    and nullif(p.metadata ->> 'clickup_list_name', '') is not null;

  if v_facets <> v_authoritative then
    raise exception 'facet mismatch: expected %, got %', v_authoritative, v_facets;
  end if;
end
$$;

-- Metadata merges preserve unrelated keys, reject stale writers distinctly, and
-- reject direct-column keys.
select id, updated_at
from api.pm_patch_product_metadata(
  '10000000-0000-4000-8000-000000000001',
  '{"existing":"preserve"}'::jsonb
)
\gset metadata_

select *
from api.pm_patch_product_metadata(
  '10000000-0000-4000-8000-000000000001',
  '{"risk_level":"high"}'::jsonb,
  :'metadata_updated_at'
);

do $$
begin
  if (
    select metadata
    from pim.product
    where id = '10000000-0000-4000-8000-000000000001'
  ) @> '{"existing":"preserve","risk_level":"high"}'::jsonb is not true then
    raise exception 'metadata merge lost an unrelated key';
  end if;

  begin
    perform * from api.pm_patch_product_metadata(
      '10000000-0000-4000-8000-000000000001',
      '{"waiting_on":"stale writer"}'::jsonb,
      '2020-01-01 00:00:00+00'
    );
    raise exception 'stale metadata writer was accepted';
  exception
    when sqlstate '40001' then
      if sqlerrm <> 'PM_METADATA_CONFLICT' then raise; end if;
  end;

  begin
    perform * from api.pm_patch_product_metadata(
      '10000000-0000-4000-8000-000000000001',
      '{"stage":"forbidden"}'::jsonb
    );
    raise exception 'direct-column metadata key was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'PM_METADATA_PATCH_FORBIDDEN_KEY' then raise; end if;
  end;
end
$$;

-- The saved-view table already has UNIQUE(profile_id, scope). Two partial
-- writes use the database-native conflict path and produce one merged row.
select *
from api.pm_upsert_view_pref(
  'view:11111111-1111-4111-8111-111111111111',
  '{"sort_order":2,"color":"#123456"}'::jsonb
);
select *
from api.pm_upsert_view_pref(
  'view:11111111-1111-4111-8111-111111111111',
  '{"hidden":true}'::jsonb
);

do $$
declare
  v_rows integer;
  v_config jsonb;
begin
  select count(*)
  into v_rows
  from pim.view_pref
  where profile_id = app.current_profile_id()
    and scope = 'view:11111111-1111-4111-8111-111111111111';
  select config
  into v_config
  from pim.view_pref
  where profile_id = app.current_profile_id()
    and scope = 'view:11111111-1111-4111-8111-111111111111';
  if v_rows <> 1 or v_config @> '{"sort_order":2,"color":"#123456","hidden":true}'::jsonb is not true then
    raise exception 'saved-view atomic merge failed: rows %, config %', v_rows, v_config;
  end if;
end
$$;

-- Stage UUID is department-specific. A no-op adds no history; a forced history
-- failure rolls back the product update in the same RPC transaction.
select * from api.pm_set_product_stage(
  '10000000-0000-4000-8000-000000000001',
  (
    select s.id
    from pim.stage s
    where s.pipeline = 'POP Creations'
    order by s.sort_order, s.id
    limit 1
  )
);

do $$
begin
  if (
    select count(*)
    from pim.stage_history
    where product_id = '10000000-0000-4000-8000-000000000001'
  ) <> 0 then
    raise exception 'no-op stage transition added history';
  end if;
end
$$;

-- A real transition writes exactly one history row with the current actor, and
-- a transition back restores the fixture for the forced-rollback test.
select * from api.pm_set_product_stage(
  '10000000-0000-4000-8000-000000000001',
  (
    select s.id
    from pim.stage s
    where s.pipeline = 'POP Creations'
      and s.name <> (
        select p.stage
        from pim.product p
        where p.id = '10000000-0000-4000-8000-000000000001'
      )
    order by s.sort_order, s.id
    limit 1
  )
);

do $$
begin
  if (
    select count(*)
    from pim.stage_history h
    where h.product_id = '10000000-0000-4000-8000-000000000001'
      and h.changed_by_profile_id = app.current_profile_id()
  ) <> 1 then
    raise exception 'stage transition did not add one actor-attributed history row';
  end if;
end
$$;

select * from api.pm_set_product_stage(
  '10000000-0000-4000-8000-000000000001',
  (
    select s.id
    from pim.stage s
    where s.pipeline = 'POP Creations'
    order by s.sort_order, s.id
    limit 1
  )
);

reset role;
create function pg_temp.reject_pm_stage_history()
returns trigger language plpgsql as $$
begin
  raise exception 'forced stage history failure';
end
$$;
create trigger reject_pm_stage_history
before insert on pim.stage_history
for each row execute function pg_temp.reject_pm_stage_history();
set local role authenticated;

do $$
begin
  begin
    perform * from api.pm_set_product_stage(
      '10000000-0000-4000-8000-000000000001',
      (
        select s.id
        from pim.stage s
        where s.pipeline = 'POP Creations'
          and s.name <> (
            select p.stage
            from pim.product p
            where p.id = '10000000-0000-4000-8000-000000000001'
          )
        order by s.sort_order, s.id
        limit 1
      )
    );
    raise exception 'forced history failure did not fire';
  exception
    when others then
      if sqlerrm <> 'forced stage history failure' then raise; end if;
  end;

  if (
    select stage
    from pim.product
    where id = '10000000-0000-4000-8000-000000000001'
  ) <> (
    select s.name
    from pim.stage s
    where s.pipeline = 'POP Creations'
    order by s.sort_order, s.id
    limit 1
  ) then
    raise exception 'product stage changed despite history failure';
  end if;
end
$$;

-- A signed-in user without PM access can execute the RPC but RLS returns no
-- product rows; anonymous has no EXECUTE grant.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'non_pm_auth_user_id', 'role', 'authenticated')::text,
  true
);
do $$
begin
  if exists (select 1 from api.pm_pipeline_page('Licensed')) then
    raise exception 'non-PM user read PM pipeline rows';
  end if;
end
$$;

reset role;
do $$
begin
  if has_function_privilege(
    'anon',
    'api.pm_pipeline_page(text,text,uuid[],text[],text[],integer,timestamptz,uuid)',
    'execute'
  ) then
    raise exception 'anon retained pipeline execute';
  end if;
end
$$;

rollback;
