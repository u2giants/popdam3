-- derived-from: 20261026155023
-- CRM: Sales Asst. role and a second salesperson per department (issue #4851).
--
-- Owner (Albert, 2026-10-26): "add another role for 'Sales Asst.' one
-- department can have 2 salesmen on it."
--
-- Additive only. Adds the app.app_role value sales_assistant (its app.role
-- row ships in a follow-up migration, because a new enum value cannot be used
-- in the transaction that adds it), the nullable column
-- crm.department.secondary_salesperson_profile_id with its index, extends the
-- department salesperson guard to the new column, adds
-- api.crm_admin_set_department_salespeople, and re-derives
-- api.crm_admin_user_directory and api.crm_admin_department_assignments from
-- 20261026155023. Nothing is renamed or dropped; every existing function keeps
-- its signature.

-- 0. New role value (not used anywhere in this transaction).
alter type app.app_role add value if not exists 'sales_assistant';

-- 1. Secondary department salesperson.
alter table crm.department
  add column if not exists secondary_salesperson_profile_id uuid
    references app.profile(id) on delete set null;
create index if not exists crm_department_secondary_salesperson_profile_idx
  on crm.department (secondary_salesperson_profile_id);
comment on column crm.department.secondary_salesperson_profile_id is
  'Second salesperson (active app.profile with the sales role) on this customer department; must differ from salesperson_profile_id. Null = none. Enforced by trigger crm_department_salesperson_guard.';

-- 2. Guard both salesperson columns: active + sales role when set or changed,
--    and the secondary may not equal the primary.
create or replace function crm.enforce_department_salesperson()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_col text;
  v_new uuid;
  v_old uuid;
begin
  if new.secondary_salesperson_profile_id is not null
     and new.secondary_salesperson_profile_id = new.salesperson_profile_id then
    raise exception 'crm: the second salesperson must differ from the first'
      using errcode = 'invalid_parameter_value';
  end if;

  foreach v_col in array array['salesperson_profile_id', 'secondary_salesperson_profile_id'] loop
    if v_col = 'salesperson_profile_id' then
      v_new := new.salesperson_profile_id;
      v_old := case when tg_op = 'UPDATE' then old.salesperson_profile_id end;
    else
      v_new := new.secondary_salesperson_profile_id;
      v_old := case when tg_op = 'UPDATE' then old.secondary_salesperson_profile_id end;
    end if;
    if v_new is not null
       and (tg_op = 'INSERT' or v_new is distinct from v_old)
       and not exists (
         select 1
         from app.profile p
         join app.user_role ur on ur.profile_id = p.id and ur.revoked_at is null
         join app.role r on r.id = ur.role_id and r.slug = 'sales'
         where p.id = v_new and p.status = 'active'
       ) then
      raise exception 'crm: salesperson must be an active user with the sales role'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function crm.enforce_department_salesperson() from public, anon;
comment on function crm.enforce_department_salesperson() is
  'Trigger: crm.department salesperson_profile_id and secondary_salesperson_profile_id must each name an active profile holding the sales role when set or changed, and the secondary may not equal the primary.';

create or replace trigger crm_department_salesperson_guard
  before insert or update of salesperson_profile_id, secondary_salesperson_profile_id on crm.department
  for each row execute function crm.enforce_department_salesperson();

-- 3. User directory: department_count now includes secondary assignments.
create or replace function api.crm_admin_user_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  result jsonb;
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(to_jsonb(u) order by lower(coalesce(u.display_name, u.email)), u.email), '[]'::jsonb)
  into result
  from (
    select
      p.id,
      p.email::text            as email,
      p.display_name,
      p.avatar_url,
      p.status::text           as status,
      p.created_at,
      au.last_sign_in_at,
      coalesce((
        select array_agg(r.slug::text order by r.slug::text)
        from app.user_role ur
        join app.role r on r.id = ur.role_id
        where ur.profile_id = p.id and ur.revoked_at is null
      ), array[]::text[])      as roles,
      coalesce((
        select array_agg(aa.app::text order by aa.app::text)
        from app.app_access aa
        where aa.profile_id = p.id and aa.revoked_at is null
      ), array[]::text[])      as apps,
      (
        exists (
          select 1 from app.app_access aa
          where aa.profile_id = p.id and aa.app = 'crm' and aa.revoked_at is null
        )
        or exists (
          select 1 from app.user_role ur
          join app.role r on r.id = ur.role_id
          where ur.profile_id = p.id and ur.revoked_at is null and r.slug = 'administrator'
        )
      )                        as crm_access,
      coalesce(dc.n, 0)        as department_count
    from app.profile p
    left join auth.users au on au.id = p.auth_user_id
    left join (
      -- Counts every department (active or not) where the person is the
      -- primary or the secondary salesperson; each department counts once.
      select x.pid, count(distinct x.id)::int as n
      from (
        select d.id, d.salesperson_profile_id as pid from crm.department d
        where d.salesperson_profile_id is not null
        union all
        select d.id, d.secondary_salesperson_profile_id from crm.department d
        where d.secondary_salesperson_profile_id is not null
      ) x
      group by x.pid
    ) dc on dc.pid = p.id
    where p.status <> 'deleted'
  ) u;

  return result;
end;
$$;

revoke all on function api.crm_admin_user_directory() from public, anon;
grant execute on function api.crm_admin_user_directory() to authenticated;
comment on function api.crm_admin_user_directory() is
  'Admin-only directory of all non-deleted profiles with last sign-in, active roles[], apps[], crm_access and department_count (primary or secondary salesperson). Powers popcrm-web Settings.';

-- 4. Department assignment list: adds secondary_salesperson_profile_id.
create or replace function api.crm_admin_department_assignments()
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  result jsonb;
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id,
           'name', d.name,
           'division', d.division,
           'category', d.category,
           'status', d.status,
           'is_active', d.is_active,
           'customer_id', c.id,
           'customer_name', c.name,
           'customer_display_name', c.display_name,
           'customer_status', c.status::text,
           'salesperson_profile_id', d.salesperson_profile_id,
           'secondary_salesperson_profile_id', d.secondary_salesperson_profile_id
         ) order by lower(c.name), c.id, d.sort_order nulls last, lower(d.name), d.id), '[]'::jsonb)
  into result
  from crm.department d
  join core.customer c on c.id = d.company_id;

  return result;
end;
$$;

revoke all on function api.crm_admin_department_assignments() from public, anon;
grant execute on function api.crm_admin_department_assignments() to authenticated;
comment on function api.crm_admin_department_assignments() is
  'Admin-only: every customer department with its customer, salesperson_profile_id and secondary_salesperson_profile_id, ordered by customer name, then sort_order and name.';

-- 5. Set both department salespeople at once.
create or replace function api.crm_admin_set_department_salespeople(p_department_ids uuid[], p_profile_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = app, public
as $$
declare
  v_ids uuid[] := coalesce(p_profile_ids, array[]::uuid[]);
  v_primary uuid;
  v_secondary uuid;
  v_bad uuid;
  v_count integer;
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if cardinality(v_ids) > 2 then
    raise exception 'crm: a department can have at most two salespeople'
      using errcode = 'invalid_parameter_value';
  end if;
  v_primary := v_ids[1];
  v_secondary := v_ids[2];
  if v_secondary is not null and v_primary is null then
    raise exception 'crm: a second salesperson requires a first salesperson'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_secondary is not null and v_secondary = v_primary then
    raise exception 'crm: the same salesperson cannot be listed twice'
      using errcode = 'invalid_parameter_value';
  end if;

  select x into v_bad
  from unnest(array[v_primary, v_secondary]) as t(x)
  where x is not null and not exists (
    select 1
    from app.profile p
    join app.user_role ur on ur.profile_id = p.id and ur.revoked_at is null
    join app.role r on r.id = ur.role_id and r.slug = 'sales'
    where p.id = x and p.status = 'active'
  )
  limit 1;
  if v_bad is not null then
    raise exception 'crm: salesperson must be an active user with the sales role'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_department_ids is null or cardinality(p_department_ids) = 0 then
    return 0;
  end if;

  update crm.department d
     set salesperson_profile_id = v_primary,
         secondary_salesperson_profile_id = v_secondary,
         updated_at = now()
   where d.id = any(p_department_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function api.crm_admin_set_department_salespeople(uuid[], uuid[]) from public, anon;
grant execute on function api.crm_admin_set_department_salespeople(uuid[], uuid[]) to authenticated;
comment on function api.crm_admin_set_department_salespeople(uuid[], uuid[]) is
  'Admin-only: for each department set salesperson_profile_id = p_profile_ids[1] and secondary_salesperson_profile_id = p_profile_ids[2] (missing = null). Rejects more than two, duplicates, or a second without a first; each must be an active user with the sales role. Unknown department ids are skipped. Returns rows updated.';
