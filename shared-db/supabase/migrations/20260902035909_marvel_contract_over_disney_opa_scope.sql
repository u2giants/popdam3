-- Issue #1999: Disney OPA cannot distinguish Marvel from Disney submissions.
-- Preserve every existing fail-closed rule except this one proven false conflict.
do $migration$
declare
  v_definition text;
  v_updated text;
  v_disney_old text := $old$    left join dcp_current_resolution r
      on r.source_system = p.source_system
     and r.source_table = 'plm.dcp_property'
     and r.source_property_id = p.source_id
    left join dcp_member_count mc on mc.resolution_id = r.resolution_id
    left join dcp_scope_summary o on o.resolution_id = r.resolution_id
    left join lateral (
      select case
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and mc.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
    ) x on true$old$;
  v_disney_new text := $new$    left join dcp_current_resolution r
      on r.source_system = p.source_system
     and r.source_table = 'plm.dcp_property'
     and r.source_property_id = p.source_id
    left join dcp_member_count mc on mc.resolution_id = r.resolution_id
    left join dcp_scope_summary o on o.resolution_id = r.resolution_id
    left join lateral (
      select case
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          and not (
            r.contract_asserted_studio_code = 'marvel'
            and o.opa_studio_code = 'disney'
          )
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and mc.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
    ) x on true$new$;
  v_lucasfilm_old text;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  v_lucasfilm_old := replace(v_disney_old,
    '''plm.dcp_property''', '''plm.lucasfilm_dcp_property''');

  if position(v_disney_new in v_definition) <> 0 then
    if position(v_lucasfilm_old in v_definition) = 0 then
      raise exception using
        errcode = 'P0001',
        message = 'db_data_admin_scraped_properties Lucasfilm authority changed while #1999 was already installed';
    end if;
    return;
  end if;

  if position(v_disney_old in v_definition) = 0
     or position(v_lucasfilm_old in v_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'db_data_admin_scraped_properties authority expression differs from the reviewed #1999 definition';
  end if;

  v_updated := replace(v_definition, v_disney_old, v_disney_new);

  if v_updated = v_definition
     or position(v_disney_old in v_updated) <> 0
     or position(v_disney_new in v_updated) = 0
     or position(v_lucasfilm_old in v_updated) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'db_data_admin_scraped_properties Marvel/Disney tie-breaker replacement was not exact';
  end if;

  execute v_updated;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text,text,integer) is
  'Licensing-manager-gated source Property vocabulary. Signed-contract and direct OPA scope disagreements fail closed, except that a Marvel contract assertion wins over Disney OPA scope because OPA does not expose a separate Marvel creation branch. Multi-scope OPA conflicts, Lucasfilm/Star Wars authority, Pixar authority, ASGARD-only Marvel Creative authority, pagination, sanitized review context, and the restricted response envelope remain unchanged.';

revoke all on function api.db_data_admin_scraped_properties(text,text,integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_properties(text,text,integer)
  to authenticated;
