-- Issue #1669: make every Scraped Properties heading state one business
-- source purpose, expose the already-landed WildBrain Property vocabulary,
-- and preserve Sega submission and creative identities under one Licensor.
-- derived-from: 20260830130345

do $migration$
declare
  v_definition text;
  v_old_sega_cte text := $old$  ), sega_ranked as (
    select
      p.*,
      l.licensor_label,
      l.normalized_licensor_label,
      row_number() over (
        partition by p.property_source_id, l.normalized_licensor_label
        order by c.source_captured_at desc, p.capture_id::text desc, l.licensor_ordinal
      ) as capture_rank
    from plm.sega_property p
    join plm.sega_capture c on c.id = p.capture_id
    left join plm.sega_property_licensor l
      on l.capture_id = p.capture_id
     and l.property_source_id = p.property_source_id
    where c.status = 'complete'
  ), source_rows as ($old$;
  v_new_source_ctes text := $new$  ), wildbrain_ranked as (
    select e.*,
      row_number() over (
        partition by e.era_source_id
        order by c.source_captured_at desc, e.capture_id::text desc
      ) as capture_rank
    from plm.wildbrain_era e
    join plm.wildbrain_capture c on c.id = e.capture_id
    where c.status = 'complete'
  ), sega_submission_ranked as (
    select p.*,
      row_number() over (
        partition by p.property_source_id
        order by c.source_captured_at desc, p.submission_capture_id::text desc
      ) as capture_rank
    from plm.sega_submission_property p
    join plm.sega_submission_capture c on c.id = p.submission_capture_id
    where c.status = 'complete'
  ), sega_ranked as (
    select p.*,
      row_number() over (
        partition by p.property_source_id
        order by c.source_captured_at desc, p.capture_id::text desc
      ) as capture_rank
    from plm.sega_property p
    join plm.sega_capture c on c.id = p.capture_id
    where c.status = 'complete'
  ), source_rows as ($new$;
  v_old_sega_arm text := $old$    union all
    select
      'sega:' || coalesce(p.normalized_licensor_label, 'unlabeled'),
      coalesce(p.licensor_label, 'Sega (licensor not supplied)'),
      'sega_dsi', 'plm.sega_property', p.property_source_id,
      p.property_label, p.source_status, 'portal_ip_registry',
      null::timestamptz, p.capture_id::text
    from sega_ranked p
    where p.capture_rank = 1
$old$;
  v_new_source_arms text := $new$    union all
    select 'strawberry-shortcake-creative', 'Strawberry Shortcake - Creative',
           'wildbrain_tenovos', 'plm.wildbrain_era', e.era_source_id,
           e.era_label, case when e.is_root then 'root' else 'descendant' end,
           'declared_era_hierarchy', null::timestamptz, e.capture_id::text
    from wildbrain_ranked e
    where e.capture_rank = 1

    union all
    select 'sega-submissions', 'Sega - Submissions', 'sega_product_approval',
           'plm.sega_submission_property', p.property_source_id,
           p.property_label, 'complete', 'product_approval_property_picker',
           null::timestamptz, p.submission_capture_id::text
    from sega_submission_ranked p
    where p.capture_rank = 1

    union all
    select 'sega-creative', 'Sega - Creative',
           'sega_dsi', 'plm.sega_property', p.property_source_id,
           p.property_label, p.source_status, 'portal_ip_registry',
           null::timestamptz, p.capture_id::text
    from sega_ranked p
    where p.capture_rank = 1
$new$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position(v_old_sega_cte in v_definition) = 0
     or position(v_old_sega_arm in v_definition) = 0
     or position('plm.wildbrain_era' in v_definition) <> 0
     or position('plm.sega_submission_property' in v_definition) <> 0 then
    raise exception using errcode = '55000',
      message = 'Scraped Properties definition differs from the reviewed #1669 predecessor';
  end if;

  v_definition := replace(v_definition, v_old_sega_cte, v_new_source_ctes);
  v_definition := replace(v_definition, v_old_sega_arm, v_new_source_arms);

  -- Static source headings. Each names exactly one purpose; source identity stays
  -- in the separate source_system/source_table/source_property_id fields.
  v_definition := replace(v_definition, $$'20th Century'$$, $$'20th Century - Creative (DCP Vault)'$$);
  v_definition := replace(v_definition, $$'Paramount'$$, $$'Paramount - Creative (Creative Library)'$$);
  v_definition := replace(v_definition, $$'Warner Bros.'$$, $$'Warner Bros. - Creative (STARLABS)'$$);
  v_definition := replace(v_definition, $$'NBCUniversal'$$, $$'NBCUniversal - Creative (Creative Asset Factory)'$$);
  v_definition := replace(v_definition, $$'OPA - scope conflict'$$, $$'OPA - Submissions (scope conflict)'$$);
  v_definition := replace(v_definition, $$'OPA - unresolved'$$, $$'OPA - Submissions (unresolved)'$$);
  v_definition := replace(v_definition, $$'DCP Vault - non-authoritative Marvel tag'$$,
    $$'DCP Vault - Creative (non-authoritative Marvel tag)'$$);
  v_definition := replace(v_definition,
    $$when x.authority_status = 'direct_disney' then 'Disney'$$,
    $$when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'$$);
  v_definition := replace(v_definition,
    $$when x.authority_status = 'direct_marvel' then 'Marvel'$$,
    $$when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'$$);
  v_definition := replace(v_definition,
    $$when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars'$$,
    $$when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'$$);
  v_definition := replace(v_definition,
    $$when x.authority_status = 'direct_pixar' then 'Pixar'$$,
    $$when x.authority_status = 'direct_pixar' then 'Pixar - Creative (DCP Vault)'$$);

  v_definition := replace(v_definition,
    $old$        else 'Source Property vocabulary' end::text as source_purpose,$old$,
    $new$        when s.source_table = 'plm.twentieth_century_dcp_property' then 'Creative (DCP Vault)'
        when s.source_table = 'plm.pmt_property' then 'Creative (Creative Library)'
        when s.source_table = 'plm.wb_property' then 'Creative (STARLABS)'
        when s.source_table = 'plm.nbcu_property' then 'Creative (Creative Asset Factory)'
        when s.source_table = 'plm.wildbrain_era' then 'Creative'
        when s.source_table = 'plm.sega_submission_property' then 'Submissions'
        when s.source_table = 'plm.sega_property' then 'Creative'
        else 'Creative' end::text as source_purpose,$new$);

  if position('Strawberry Shortcake - Creative' in v_definition) = 0
     or position('Sega - Submissions' in v_definition) = 0
     or position('Sega - Creative' in v_definition) = 0
     or position('DCP Vault - Creative (authoritative Marvel scope)' in v_definition) = 0
     or position('Marvel - Creative (DCP Vault)' in v_definition) <> 0
     or position('Pixar - Creative (DCP Vault)' in v_definition) = 0
     or position('plm.sega_property_licensor' in v_definition) <> 0
     or position('Source Property vocabulary' in v_definition) <> 0 then
    raise exception using errcode = '55000',
      message = 'Scraped Properties #1669 replacement postconditions failed';
  end if;

  execute v_definition;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text, text, integer) is
  'Licensing-manager-gated source Property vocabulary. Every public heading names exactly one business source purpose. Strawberry Shortcake Creative comes from the latest complete WildBrain era hierarchy. Sega Submissions and Sega Creative remain distinct source identities under one presentation Licensor. Raw payloads and private source evidence are never exposed.';

revoke all on function api.db_data_admin_scraped_properties(text, text, integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_properties(text, text, integer)
  to authenticated;
