-- Issue #1658 dual-state forward reconciliation.
-- Accept exactly: (1) clean bootstrap with reviewed #1631 API predecessor, or
-- (2) the exact preview residue proven by runs 33095556822 and 33100418436.
-- Any partial or drifted third state fails before DDL.

do $reconcile$
declare
  v_actual text[];
  v_expected constant text[] := array[
    'dcp_opa_property_resolution_approval_ck=CHECK (approval_status = ANY (ARRAY[''pending''::text, ''approved''::text, ''rejected''::text]))',
    'dcp_opa_property_resolution_approved_shape_ck=CHECK (approval_status = ''approved''::text AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND btrim(approved_by) <> ''''::text OR approval_status <> ''approved''::text AND approved_at IS NULL AND approved_by IS NULL)',
    'dcp_opa_property_resolution_contract_assertion_ck=CHECK (contract_asserted_studio_code IS NULL AND contract_evidence_reference IS NULL AND contract_evidence_sha256 IS NULL OR (contract_asserted_studio_code = ANY (ARRAY[''disney''::text, ''marvel''::text, ''lucasfilm''::text, ''pixar''::text])) AND btrim(contract_evidence_reference) <> ''''::text AND contract_evidence_sha256 ~ ''^[0-9a-f]{64}$''::text)',
    'dcp_opa_property_resolution_evidence_ck=CHECK (btrim(evidence_reference) <> ''''::text AND evidence_sha256 ~ ''^[0-9a-f]{64}$''::text AND btrim(decision_reason) <> ''''::text)',
    'dcp_opa_property_resolution_id_identity_key=UNIQUE (resolution_id, source_system, source_table, source_property_id)',
    'dcp_opa_property_resolution_identity_ck=CHECK (btrim(source_system) <> ''''::text AND btrim(source_property_id) <> ''''::text AND (source_table = ANY (ARRAY[''plm.dcp_property''::text, ''plm.lucasfilm_dcp_property''::text, ''plm.marvel_dcp_property''::text])))',
    'dcp_opa_property_resolution_identity_version_key=UNIQUE (source_system, source_table, source_property_id, decision_version)',
    'dcp_opa_property_resolution_member_licensed_property_id_fkey=FOREIGN KEY (licensed_property_id) REFERENCES plm.opa_property(licensed_property_id) ON DELETE RESTRICT',
    'dcp_opa_property_resolution_member_ordinal_ck=CHECK (member_ordinal > 0)',
    'dcp_opa_property_resolution_member_ordinal_key=UNIQUE (resolution_id, member_ordinal)',
    'dcp_opa_property_resolution_member_pkey=PRIMARY KEY (resolution_id, licensed_property_id)',
    'dcp_opa_property_resolution_member_resolution_id_fkey=FOREIGN KEY (resolution_id) REFERENCES plm.dcp_opa_property_resolution(resolution_id) ON DELETE RESTRICT',
    'dcp_opa_property_resolution_not_self_superseding_ck=CHECK (supersedes_resolution_id IS NULL OR supersedes_resolution_id <> resolution_id)',
    'dcp_opa_property_resolution_pkey=PRIMARY KEY (resolution_id)',
    'dcp_opa_property_resolution_same_identity_supersession_fk=FOREIGN KEY (supersedes_resolution_id, source_system, source_table, source_property_id) REFERENCES plm.dcp_opa_property_resolution(resolution_id, source_system, source_table, source_property_id) ON DELETE RESTRICT',
    'dcp_opa_property_resolution_supersedes_key=UNIQUE (supersedes_resolution_id)',
    'dcp_opa_property_resolution_supersedes_resolution_id_fkey=FOREIGN KEY (supersedes_resolution_id) REFERENCES plm.dcp_opa_property_resolution(resolution_id) ON DELETE RESTRICT',
    'dcp_opa_property_resolution_version_ck=CHECK (decision_version > 0)'
  ];
begin
  if (to_regclass('plm.dcp_opa_property_resolution') is null)
     <> (to_regclass('plm.dcp_opa_property_resolution_member') is null) then
    raise exception using errcode = '55000', message = 'partial #1658 catalog is neither bootstrap nor proven residue';
  end if;
  if to_regclass('plm.dcp_opa_property_resolution') is null then
    if to_regprocedure('plm.reject_dcp_opa_resolution_mutation()') is not null then
      raise exception using errcode = '55000', message = '#1658 bootstrap has an orphan hardening function';
    end if;
    if position('plm.dcp_property_licensor_resolution' in pg_get_functiondef(
         'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure)) = 0 then
      raise exception using errcode = '55000', message = '#1658 bootstrap predecessor API differs from reviewed #1631';
    end if;
    return;
  end if;

  select array_agg(c.conname || '=' || pg_get_constraintdef(c.oid, true) order by c.conname)
    into v_actual
  from pg_constraint c
  where c.conrelid in ('plm.dcp_opa_property_resolution'::regclass,
                       'plm.dcp_opa_property_resolution_member'::regclass);
  if v_actual is distinct from v_expected then
    raise exception using errcode = '55000', message = 'retained #1658 constraints differ from the proven original catalog';
  end if;

  if (select count(*) from pg_attribute where attrelid = 'plm.dcp_opa_property_resolution'::regclass and attnum > 0 and not attisdropped) <> 16
     or (select count(*) from pg_attribute where attrelid = 'plm.dcp_opa_property_resolution_member'::regclass and attnum > 0 and not attisdropped) <> 4 then
    raise exception using errcode = '55000', message = 'retained #1658 columns differ from the proven original catalog';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'plm.dcp_opa_property_resolution'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'plm.dcp_opa_property_resolution_member'::regclass)
     or (select count(*) from pg_policies where schemaname = 'plm' and tablename in ('dcp_opa_property_resolution','dcp_opa_property_resolution_member')) <> 2
     or (select array_agg(policyname || '=' || cmd || '=' || array_to_string(roles, ',') || '=' || qual order by policyname)
         from pg_policies where schemaname = 'plm' and tablename in ('dcp_opa_property_resolution','dcp_opa_property_resolution_member'))
        is distinct from array[
          'dcp_opa_property_resolution_member_read=SELECT=authenticated=(app.has_role(''administrator''::app.app_role) OR app.has_app_access(''plm''::app.app_name) OR app.has_any_role(ARRAY[''sales''::app.app_role, ''licensing''::app.app_role]))',
          'dcp_opa_property_resolution_read=SELECT=authenticated=(app.has_role(''administrator''::app.app_role) OR app.has_app_access(''plm''::app.app_name) OR app.has_any_role(ARRAY[''sales''::app.app_role, ''licensing''::app.app_role]))'
        ]
     or has_table_privilege('anon', 'plm.dcp_opa_property_resolution', 'SELECT')
     or has_table_privilege('anon', 'plm.dcp_opa_property_resolution_member', 'SELECT')
     or not has_table_privilege('authenticated', 'plm.dcp_opa_property_resolution', 'SELECT')
     or not has_table_privilege('authenticated', 'plm.dcp_opa_property_resolution_member', 'SELECT')
     or has_table_privilege('authenticated', 'plm.dcp_opa_property_resolution', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'plm.dcp_opa_property_resolution_member', 'INSERT,UPDATE,DELETE') then
    raise exception using errcode = '55000', message = 'retained #1658 RLS, policies, or grants differ from the private contract';
  end if;

  if not has_table_privilege('service_role', 'plm.dcp_opa_property_resolution', 'SELECT,INSERT')
     or not has_table_privilege('service_role', 'plm.dcp_opa_property_resolution_member', 'SELECT,INSERT')
     or has_table_privilege('service_role', 'plm.dcp_opa_property_resolution', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('service_role', 'plm.dcp_opa_property_resolution_member', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception using errcode = '55000', message = 'retained #1658 service-role grants differ from the append-only contract';
  end if;

  if exists (select 1 from pg_constraint where conrelid = 'plm.dcp_opa_property_resolution'::regclass and conname = 'dcp_opa_property_resolution_single_chain_ck')
     or to_regprocedure('plm.reject_dcp_opa_resolution_mutation()') is not null
     or exists (select 1 from pg_trigger where tgrelid in ('plm.dcp_opa_property_resolution'::regclass,'plm.dcp_opa_property_resolution_member'::regclass) and not tgisinternal) then
    raise exception using errcode = '55000', message = 'one or more #1658 hardening objects already exist';
  end if;
end;
$reconcile$;

create table if not exists plm.dcp_opa_property_resolution (
  resolution_id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_table text not null,
  source_property_id text not null,
  decision_version bigint not null,
  approval_status text not null default 'pending',
  supersedes_resolution_id uuid null
    references plm.dcp_opa_property_resolution(resolution_id) on delete restrict,
  evidence_reference text not null,
  evidence_sha256 text not null,
  decision_reason text not null,
  contract_asserted_studio_code text null,
  contract_evidence_reference text null,
  contract_evidence_sha256 text null,
  approved_at timestamptz null,
  approved_by text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint dcp_opa_property_resolution_identity_version_key unique
    (source_system, source_table, source_property_id, decision_version),
  constraint dcp_opa_property_resolution_supersedes_key unique
    (supersedes_resolution_id),
  constraint dcp_opa_property_resolution_id_identity_key unique
    (resolution_id, source_system, source_table, source_property_id),
  constraint dcp_opa_property_resolution_identity_ck check (
    btrim(source_system) <> '' and btrim(source_property_id) <> ''
    and source_table in (
      'plm.dcp_property',
      'plm.lucasfilm_dcp_property',
      'plm.marvel_dcp_property'
    )
  ),
  constraint dcp_opa_property_resolution_version_ck check (decision_version > 0),
  constraint dcp_opa_property_resolution_approval_ck check (
    approval_status in ('pending', 'approved', 'rejected')
  ),
  constraint dcp_opa_property_resolution_evidence_ck check (
    btrim(evidence_reference) <> '' and evidence_sha256 ~ '^[0-9a-f]{64}$'
    and btrim(decision_reason) <> ''
  ),
  constraint dcp_opa_property_resolution_contract_assertion_ck check (
    (contract_asserted_studio_code is null
      and contract_evidence_reference is null and contract_evidence_sha256 is null)
    or (contract_asserted_studio_code in ('disney', 'marvel', 'lucasfilm', 'pixar')
      and btrim(contract_evidence_reference) <> ''
      and contract_evidence_sha256 ~ '^[0-9a-f]{64}$')
  ),
  constraint dcp_opa_property_resolution_approved_shape_ck check (
    (approval_status = 'approved' and approved_at is not null
      and approved_by is not null and btrim(approved_by) <> '')
    or (approval_status <> 'approved' and approved_at is null and approved_by is null)
  ),
  constraint dcp_opa_property_resolution_not_self_superseding_ck check (
    supersedes_resolution_id is null or supersedes_resolution_id <> resolution_id
  ),
  constraint dcp_opa_property_resolution_same_identity_supersession_fk
    foreign key (supersedes_resolution_id, source_system, source_table, source_property_id)
    references plm.dcp_opa_property_resolution
      (resolution_id, source_system, source_table, source_property_id)
    on delete restrict
);

comment on table plm.dcp_opa_property_resolution is
  'Append-only versioned decisions for one exact DCP source Property identity. A decision may have zero, one, or many OPA Property members and an independently evidenced signed-contract studio assertion. Creative placement, normalized names, canonical ownership, source labels, and landing-table families never create a member or assertion.';

create table if not exists plm.dcp_opa_property_resolution_member (
  resolution_id uuid not null
    references plm.dcp_opa_property_resolution(resolution_id) on delete restrict,
  licensed_property_id bigint not null
    references plm.opa_property(licensed_property_id) on delete restrict,
  member_ordinal integer not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint dcp_opa_property_resolution_member_pkey
    primary key (resolution_id, licensed_property_id),
  constraint dcp_opa_property_resolution_member_ordinal_key
    unique (resolution_id, member_ordinal),
  constraint dcp_opa_property_resolution_member_ordinal_ck
    check (member_ordinal > 0)
);

comment on table plm.dcp_opa_property_resolution_member is
  'Explicit approved crosswalk members from one versioned exact DCP identity decision to stable OPA licensed_property_id values. Display text and co-occurrence never populate this table.';

alter table plm.dcp_opa_property_resolution enable row level security;
alter table plm.dcp_opa_property_resolution_member enable row level security;
revoke all on plm.dcp_opa_property_resolution,
  plm.dcp_opa_property_resolution_member from public, anon, authenticated;
revoke update, delete, truncate, references, trigger, maintain
  on plm.dcp_opa_property_resolution,
  plm.dcp_opa_property_resolution_member from service_role;
grant select, insert on plm.dcp_opa_property_resolution,
  plm.dcp_opa_property_resolution_member to service_role;
grant select on plm.dcp_opa_property_resolution,
  plm.dcp_opa_property_resolution_member to authenticated;

do $policies$
begin
  if not exists (select 1 from pg_policies where schemaname='plm' and tablename='dcp_opa_property_resolution' and policyname='dcp_opa_property_resolution_read') then
    create policy dcp_opa_property_resolution_read
      on plm.dcp_opa_property_resolution for select to authenticated
      using (app.has_role('administrator') or app.has_app_access('plm')
        or app.has_any_role(array['sales', 'licensing']::app.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='plm' and tablename='dcp_opa_property_resolution_member' and policyname='dcp_opa_property_resolution_member_read') then
    create policy dcp_opa_property_resolution_member_read
      on plm.dcp_opa_property_resolution_member for select to authenticated
      using (app.has_role('administrator') or app.has_app_access('plm')
        or app.has_any_role(array['sales', 'licensing']::app.app_role[]));
  end if;
end;
$policies$;

do $migration$
declare
  v_definition text;
  v_old_disney text := $old$
    select
      case when r.resolution_status like 'supported_%'
        then r.presentation_licensor_key
        when r.resolution_status = 'authority_conflict'
        then 'dcp-vault-authority-conflict'
        else 'dcp-vault-unresolved'
      end,
      case when r.resolution_status like 'supported_%'
        then r.presentation_licensor_name
        when r.resolution_status = 'authority_conflict'
        then 'DCP Vault - authority conflict'
        else 'DCP Vault - unresolved'
      end,
      p.source_system, 'plm.dcp_property', p.source_id, p.display_name,
      coalesce(r.resolution_status, 'unresolved'),
      'dcp_property_licensor_resolution', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.dcp_property p
    left join lateral (
      select d.* from plm.dcp_property_licensor_resolution d
      where d.source_system = p.source_system and d.source_property_id = p.source_id
        and d.approval_status = 'approved'
      order by d.decision_version desc, d.approved_at desc, d.resolution_id desc limit 1
    ) r on true
$old$;
  v_old_lucasfilm text := replace(replace(v_old_disney,
    '''plm.dcp_property''', '''plm.lucasfilm_dcp_property'''),
    'from plm.dcp_property p', 'from plm.lucasfilm_dcp_property p');
  v_old_marvel text := $old$
    select
      'dcp-vault-non-authoritative-marvel-tag',
      'DCP Vault - non-authoritative Marvel tag',
      p.source_system, 'plm.marvel_dcp_property', p.source_id, p.display_name,
      coalesce(r.resolution_status, 'unresolved'),
      'dcp_property_licensor_resolution', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.marvel_dcp_property p
    left join lateral (
      select d.* from plm.dcp_property_licensor_resolution d
      where d.source_system = p.source_system and d.source_property_id = p.source_id
        and d.approval_status = 'approved'
      order by d.decision_version desc, d.approved_at desc, d.resolution_id desc limit 1
    ) r on true
$old$;
  v_new_disney text;
  v_new_lucasfilm text;
  v_context_needle text := $needle$'review_guidance', n.review_guidance$needle$;
  v_context_replacement text := $replacement$'review_guidance', n.review_guidance,
        'asset_count', case
          when n.source_table = 'plm.dcp_property' then
            (select count(distinct o.dcp_asset_id) from plm.dcp_property p2
             join plm.dcp_asset_property_observation o on o.dcp_property_id = p2.id
             where p2.source_system = n.source_system and p2.source_id = n.source_property_id)
          when n.source_table = 'plm.lucasfilm_dcp_property' then
            (select count(distinct o.lucasfilm_dcp_asset_id) from plm.lucasfilm_dcp_property p2
             join plm.lucasfilm_dcp_asset_property_observation o on o.lucasfilm_dcp_property_id = p2.id
             where p2.source_system = n.source_system and p2.source_id = n.source_property_id)
          else null end,
        'style_guide_count', case
          when n.source_table = 'plm.dcp_property' then
            (select count(distinct a.style_guide_id) from plm.dcp_property p2
             join plm.dcp_asset_property_observation o on o.dcp_property_id = p2.id
             join plm.dcp_asset a on a.id = o.dcp_asset_id
             where p2.source_system = n.source_system and p2.source_id = n.source_property_id)
          when n.source_table = 'plm.lucasfilm_dcp_property' then
            (select count(distinct a.style_guide_id) from plm.lucasfilm_dcp_property p2
             join plm.lucasfilm_dcp_asset_property_observation o on o.lucasfilm_dcp_property_id = p2.id
             join plm.lucasfilm_dcp_asset a on a.id = o.lucasfilm_dcp_asset_id
             where p2.source_system = n.source_system and p2.source_id = n.source_property_id)
          else null end,
        'style_guide_names', case
          when n.source_table = 'plm.dcp_property' then
            (select coalesce(jsonb_agg(x.folder_name order by x.folder_name), '[]'::jsonb)
             from (select distinct g.folder_name from plm.dcp_property p2
               join plm.dcp_asset_property_observation o on o.dcp_property_id = p2.id
               join plm.dcp_asset a on a.id = o.dcp_asset_id
               join plm.dcp_style_guide g on g.id = a.style_guide_id
               where p2.source_system = n.source_system and p2.source_id = n.source_property_id) x)
          when n.source_table = 'plm.lucasfilm_dcp_property' then
            (select coalesce(jsonb_agg(x.folder_name order by x.folder_name), '[]'::jsonb)
             from (select distinct g.folder_name from plm.lucasfilm_dcp_property p2
               join plm.lucasfilm_dcp_asset_property_observation o on o.lucasfilm_dcp_property_id = p2.id
               join plm.lucasfilm_dcp_asset a on a.id = o.lucasfilm_dcp_asset_id
               join plm.lucasfilm_dcp_style_guide g on g.id = a.style_guide_id
               where p2.source_system = n.source_system and p2.source_id = n.source_property_id) x)
          else '[]'::jsonb end$replacement$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position('explicit_dcp_to_opa_property_id' in v_definition) <> 0
     and position('style_guide_names' in v_definition) <> 0
     and position('plm.dcp_property_licensor_resolution' in v_definition) = 0 then
    null; -- Proven preview residue: the original API replacement already landed.
  else
  v_new_disney := $new$
    select
      case when x.authority_status = 'direct_disney' then 'disney'
        when x.authority_status = 'direct_marvel' then 'marvel'
        when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
        when x.authority_status = 'direct_pixar' then 'pixar'
        when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
        when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
        else 'dcp-authority-unresolved' end,
      case when x.authority_status = 'direct_disney' then 'Disney'
        when x.authority_status = 'direct_marvel' then 'Marvel'
        when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars'
        when x.authority_status = 'direct_pixar' then 'Pixar'
        when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
        when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
        else 'DCP Creative - unresolved authority' end,
      p.source_system, 'plm.dcp_property', p.source_id, p.display_name,
      coalesce(x.authority_status, 'unresolved'),
      'explicit_dcp_to_opa_property_id_with_independent_contract_and_opa_authority', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.dcp_property p
    left join lateral (
      select case
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and o.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
      from (
        select current_r.*
        from plm.dcp_opa_property_resolution current_r
        where current_r.source_system = p.source_system
          and current_r.source_table = 'plm.dcp_property'
          and current_r.source_property_id = p.source_id
          and current_r.approval_status = 'approved'
          and not exists (select 1 from plm.dcp_opa_property_resolution newer_r
            where newer_r.supersedes_resolution_id = current_r.resolution_id)
        order by current_r.decision_version desc, current_r.approved_at desc,
          current_r.resolution_id desc
        limit 1
      ) r
      left join lateral (
        select count(distinct m.branch_code) as opa_scope_count,
          min(m.branch_code) as opa_studio_code,
          (select count(*) from plm.dcp_opa_property_resolution_member all_rm
            where all_rm.resolution_id = r.resolution_id) as member_count
        from (
        select distinct on (rm.licensed_property_id, sm.region_code, sm.branch_code,
          sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id)
          sm.branch_code
        from plm.dcp_opa_property_resolution_member rm
        join plm.opa_property_scope_membership sm
          on sm.licensed_property_id = rm.licensed_property_id
         and sm.approval_status = 'approved'
        where rm.resolution_id = r.resolution_id
        order by rm.licensed_property_id, sm.region_code, sm.branch_code,
          sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id,
          sm.source_captured_at desc, sm.created_at desc, sm.membership_id desc
        ) m
      ) o on true
    ) x on true
$new$;
  v_new_lucasfilm := replace(replace(v_new_disney,
    '''plm.dcp_property''', '''plm.lucasfilm_dcp_property'''),
    'from plm.dcp_property p', 'from plm.lucasfilm_dcp_property p');

  if position(v_old_disney in v_definition) = 0
     or position(v_old_lucasfilm in v_definition) = 0
     or position(v_old_marvel in v_definition) = 0
     or position(v_context_needle in v_definition) = 0 then
    raise exception using errcode = '55000',
      message = 'Scraped Properties definition differs from reviewed #1631 predecessor';
  end if;

  v_definition := replace(v_definition, v_old_disney, v_new_disney);
  v_definition := replace(v_definition, v_old_lucasfilm, v_new_lucasfilm);
  -- Marvel DCP is retained evidence only. Remove its obsolete resolution join entirely.
  v_definition := replace(v_definition, v_old_marvel, replace(
    split_part(v_old_marvel, '    left join lateral (', 1),
    'coalesce(r.resolution_status, ''unresolved'')', '''non_authoritative'''));
  v_definition := replace(v_definition, v_context_needle, v_context_replacement);

  v_definition := replace(v_definition,
    $old$when s.source_status = 'authority_conflict' then 'Conflicting approved authority evidence names more than one presentation scope; Licensing must resolve the exact source identity.'$old$,
    $new$when s.source_status = 'scope_conflict' and s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property') then 'Authoritative signed-contract and direct captured OPA assertions disagree, or mapped OPA IDs have conflicting direct scopes; Licensing must review the concrete assertions and named style guides.'$new$);
  v_definition := replace(v_definition,
    $old$when s.source_status = 'scope_conflict' and s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')$old$,
    $new$when s.source_status in ('contract_opa_conflict','opa_scope_conflict') and s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')$new$);
  v_definition := replace(v_definition,
    $old$when s.source_status in ('unresolved') or s.source_status is null then 'No current approved direct authority evidence is available.'$old$,
    $new$when s.source_status in ('unresolved') or s.source_status is null then case
          when s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then 'DCP supplied a Creative metadata value but no approved exact OPA Property ID link carries an authoritative signed-contract assertion or direct captured OPA scope.'
          else 'No current approved direct authority evidence is available.' end$new$);
  v_definition := replace(v_definition,
    $old$when s.source_status = 'unresolved' or s.source_status is null then 'no current approved direct authority record'$old$,
    $new$when s.source_status = 'unresolved' or s.source_status is null then case
          when s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then 'DCP Creative evidence has no authoritative signed-contract assertion or direct captured OPA scope through an approved exact OPA Property ID link'
          else 'no current approved direct authority record' end$new$);
  v_definition := replace(v_definition,
    $old$when s.source_status = 'authority_conflict' then 'approved exact-identity DCP authority decisions'$old$,
    $new$when s.source_status in ('contract_opa_conflict','opa_scope_conflict') and s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property') then 'authoritative signed-contract assertion compared independently with direct latest captured OPA scope through exact OPA Property IDs'$new$);
  -- A clean row is not a review case. Preserve the two-line review fields but
  -- leave them genuinely blank instead of publishing positive-status prose.
  v_definition := replace(v_definition,
    $old$else 'Current approved evidence supports this presentation.'$old$,
    $new$else null::text$new$);
  v_definition := replace(v_definition,
    $old$else s.provenance_kind end::text as evidence_basis,$old$,
    $new$else null::text end::text as evidence_basis,$new$);
  v_definition := replace(v_definition,
    $old$else 'No action unless newer direct evidence supersedes this decision.' end::text as review_guidance$old$,
    $new$else null::text end::text as review_guidance$new$);

  if position('plm.dcp_property_licensor_resolution' in v_definition) <> 0
     or position('DCP Vault decision' in v_definition) <> 0
     or position('style_guide_names' in v_definition) = 0
     or position('explicit_dcp_to_opa_property_id' in v_definition) = 0
     or position('Current approved evidence supports this presentation.' in v_definition) <> 0
     or position('No action unless newer direct evidence supersedes this decision.' in v_definition) <> 0 then
    raise exception using errcode = '55000',
      message = format(
        'Scraped Properties OPA-authority postconditions failed: legacy=%s decision=%s guides=%s explicit=%s clean_reason=%s clean_guidance=%s',
        position('plm.dcp_property_licensor_resolution' in v_definition),
        position('DCP Vault decision' in v_definition),
        position('style_guide_names' in v_definition),
        position('explicit_dcp_to_opa_property_id' in v_definition),
        position('Current approved evidence supports this presentation.' in v_definition),
        position('No action unless newer direct evidence supersedes this decision.' in v_definition)
      );
  end if;

  execute v_definition;
  end if;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text, text, integer) is
  'Licensing-manager-gated source Property vocabulary. DCP Creative placement uses only authoritative signed-contract assertions and direct captured OPA scope attached through an explicit approved DCP-to-OPA Property ID resolution. Contract/OPA disagreement and ambiguous OPA scope fail closed. Review context exposes sanitized style-guide names and aggregate counts, never raw paths or private authority references.';

revoke all on function api.db_data_admin_scraped_properties(text, text, integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_properties(text, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- PR #1660 independent review (Muse Spark 1.2, sequence 420) hardening.
-- ---------------------------------------------------------------------------

-- Finding: nothing in the schema prevented two contradictory ACTIVE approved
-- resolutions for one exact source Property identity. UNIQUE(identity,
-- decision_version) and UNIQUE(supersedes_resolution_id) together allow at most
-- one child per parent, but permitted two disjoint chain roots, so the reader
-- function's ORDER BY ... LIMIT 1 was picking a winner the database had never
-- rejected. Binding the root to decision_version = 1 makes the existing identity
-- unique constraint admit exactly one root per identity; combined with the
-- one-child rule the approved chain is a single path with exactly one tip.
alter table plm.dcp_opa_property_resolution
  add constraint dcp_opa_property_resolution_single_chain_ck check (
    (decision_version = 1) = (supersedes_resolution_id is null)
  );

-- Finding: "append-only" was enforced only by REVOKE UPDATE/DELETE from
-- service_role. The table owner -- the migration role, and any future
-- SECURITY DEFINER function owned by it -- bypasses both GRANTs and RLS and
-- could rewrite or erase a recorded decision silently. A trigger is not
-- bypassed by ownership, so it is the only barrier that actually holds.
create or replace function plm.reject_dcp_opa_resolution_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'plm.% is append-only: % is not permitted. Record a new superseding decision instead.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- Trigger functions are internal enforcement machinery, never a callable API.
revoke all on function plm.reject_dcp_opa_resolution_mutation() from public;

create trigger dcp_opa_property_resolution_append_only
before update or delete on plm.dcp_opa_property_resolution
for each row execute function plm.reject_dcp_opa_resolution_mutation();

create trigger dcp_opa_property_resolution_member_append_only
before update or delete on plm.dcp_opa_property_resolution_member
for each row execute function plm.reject_dcp_opa_resolution_mutation();

-- PR #1660 independent review (Grok 4.6, sequence 543) hardening.
-- Finding: the row triggers above closed UPDATE and DELETE but left two ways to
-- erase the ledger anyway. TRUNCATE does not fire a row trigger at all, and a
-- default origin-only trigger is skipped entirely under
-- session_replication_role = 'replica'. Both are available to the table owner,
-- which is exactly the actor the trigger barrier exists to bind.
create trigger dcp_opa_property_resolution_no_truncate
before truncate on plm.dcp_opa_property_resolution
for each statement execute function plm.reject_dcp_opa_resolution_mutation();

create trigger dcp_opa_property_resolution_member_no_truncate
before truncate on plm.dcp_opa_property_resolution_member
for each statement execute function plm.reject_dcp_opa_resolution_mutation();

alter table plm.dcp_opa_property_resolution
  enable always trigger dcp_opa_property_resolution_append_only;
alter table plm.dcp_opa_property_resolution
  enable always trigger dcp_opa_property_resolution_no_truncate;
alter table plm.dcp_opa_property_resolution_member
  enable always trigger dcp_opa_property_resolution_member_append_only;
alter table plm.dcp_opa_property_resolution_member
  enable always trigger dcp_opa_property_resolution_member_no_truncate;

-- Same review: row security was enabled but not forced, so the owner still read
-- around the SELECT policies. The read policies are the whole access rule here.
alter table plm.dcp_opa_property_resolution force row level security;
alter table plm.dcp_opa_property_resolution_member force row level security;

-- Accepted, documented residual risk from the same review: approved_by and
-- approved_at are free-form and are therefore forgeable by any principal that
-- can INSERT -- today only service_role. They are not defaulted from auth.uid()
-- or clock_timestamp() on purpose: they record a HUMAN approval decision made
-- outside the database, so a database-generated value would be a stronger-looking
-- claim with no more truth behind it. The real control is that INSERT is granted
-- to service_role alone, every row carries a mandatory evidence_sha256, and the
-- append-only triggers above mean a forged row can never be quietly removed.
