\set ON_ERROR_STOP on
\pset pager off

begin;
set local statement_timeout = '8s';

select p.auth_user_id::text as admin_auth_user_id
from app.profile p
join app.user_role ur on ur.profile_id = p.id and ur.revoked_at is null
join app.role r on r.id = ur.role_id and r.slug = 'administrator'
where p.auth_user_id is not null
limit 1
\gset

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'admin_auth_user_id', 'role', 'authenticated')::text,
  true
);

\echo FIRST_LICENSED
explain (analyze, buffers)
select * from api.pm_pipeline_page('Licensed', p_limit => 50);

\echo FIRST_GENERIC
explain (analyze, buffers)
select * from api.pm_pipeline_page('Generic', p_limit => 50);

\echo FIRST_SOFTWARE
explain (analyze, buffers)
select * from api.pm_pipeline_page('Software', p_limit => 50);

select updated_at::text as deep_updated_at, id::text as deep_id
from api.pm_pipeline_page('Licensed', p_limit => 200)
order by updated_at, id
limit 1
\gset

\echo NEXT_LICENSED
explain (analyze, buffers)
select *
from api.pm_pipeline_page(
  'Licensed',
  p_limit => 50,
  p_after_updated_at => :'deep_updated_at',
  p_after_id => :'deep_id'
);

\echo SEARCH_LICENSED
explain (analyze, buffers)
select *
from api.pm_pipeline_page('Licensed', p_search => 'batman', p_limit => 50);

\echo LIST_FILTER_LICENSED
explain (analyze, buffers)
select *
from api.pm_pipeline_page(
  'Licensed',
  p_list_names => array['Licensing Management'],
  p_limit => 50
);

\echo COUNT_LICENSED
explain (analyze, buffers)
select api.pm_pipeline_count('Licensed');

\echo FACETS_LICENSED
explain (analyze, buffers)
select * from api.pm_pipeline_list_facets('Licensed');

-- The RPC appears as a Function Scan in an outer EXPLAIN. This equivalent
-- predicate/order probe records the underlying keyset index and bounded sort.
\echo UNDERLYING_KEYSET_PLAN
explain (analyze, buffers)
select p.id, p.updated_at
from pim.product p
where p.clickup_parent_id is null
  and lower(coalesce(p.metadata ->> 'clickup_status_type', p.metadata ->> 'status_type', ''))
    in ('open', 'custom')
  and lower(coalesce(p.metadata ->> 'business_unit', p.metadata ->> 'department', ''))
    in ('licensed', 'pop', 'pop creations')
  and (p.updated_at, p.id) < (:'deep_updated_at'::timestamptz, :'deep_id'::uuid)
order by p.updated_at desc, p.id desc
limit 50;

rollback;
