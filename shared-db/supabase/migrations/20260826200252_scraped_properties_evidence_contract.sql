-- Issue #1599: make Scraped Properties source purpose and review evidence explicit.
-- Licensed OPA memberships and DCP decisions remain private runtime data.

create table plm.opa_property_scope_membership (
  membership_id uuid primary key default gen_random_uuid(),
  licensed_property_id bigint not null
    references plm.opa_property(licensed_property_id) on delete restrict,
  region_code text not null,
  branch_code text not null,
  line_of_business_id bigint not null,
  product_type_code text not null,
  template_id bigint not null,
  workflow_id bigint not null,
  capture_id text not null,
  source_captured_at timestamptz not null,
  approval_status text not null default 'pending',
  evidence_reference text not null,
  evidence_sha256 text not null,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz not null default clock_timestamp(),
  constraint opa_property_scope_membership_identity_key unique (
    licensed_property_id, region_code, branch_code, line_of_business_id,
    product_type_code, template_id, workflow_id, capture_id
  ),
  constraint opa_property_scope_membership_region_ck check (btrim(region_code) <> ''),
  constraint opa_property_scope_membership_branch_ck check (
    branch_code in ('disney', 'lucasfilm')
  ),
  constraint opa_property_scope_membership_product_ck check (btrim(product_type_code) <> ''),
  constraint opa_property_scope_membership_capture_ck check (btrim(capture_id) <> ''),
  constraint opa_property_scope_membership_approval_ck check (
    approval_status in ('pending', 'approved', 'rejected')
  ),
  constraint opa_property_scope_membership_evidence_ck check (
    btrim(evidence_reference) <> '' and evidence_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint opa_property_scope_membership_approved_shape_ck check (
    (approval_status = 'approved' and approved_at is not null
      and approved_by is not null and btrim(approved_by) <> '')
    or (approval_status <> 'approved' and approved_at is null and approved_by is null)
  )
);

comment on table plm.opa_property_scope_membership is
  'Append-only direct OPA route membership for stable Property IDs. Route identity, not landing-table family or name keywords, is scope authority. One Property may legitimately occur in multiple scopes.';
comment on column plm.opa_property_scope_membership.branch_code is
  'Authoritative top-level OPA creation branch. Marvel submissions remain within the Disney branch by settled business rule.';
comment on column plm.opa_property_scope_membership.capture_id is
  'Stable private capture identity; licensed membership values are loaded only by the approved private workflow.';

alter table plm.opa_property_scope_membership enable row level security;
revoke all on table plm.opa_property_scope_membership from public, anon, authenticated;
revoke update, delete, truncate, references, trigger, maintain
  on table plm.opa_property_scope_membership from service_role;
grant select, insert on table plm.opa_property_scope_membership to service_role;

-- Convert the original immutable DCP decision row into immutable version history.
alter table plm.dcp_property_licensor_resolution
  add column resolution_id uuid,
  add column decision_version bigint,
  add column supersedes_resolution_id uuid,
  add column approval_status text,
  add column approved_at timestamptz,
  add column approved_by text,
  add column decision_reason text;

update plm.dcp_property_licensor_resolution
set resolution_id = gen_random_uuid(),
    decision_version = 1,
    approval_status = 'approved',
    approved_at = coalesce(resolved_at, created_at),
    approved_by = 'governed-issue-1592',
    decision_reason = coalesce(
      nullif(btrim(authority_kind), ''),
      case resolution_status
        when 'authority_conflict' then 'Conflicting authority evidence requires Licensing review.'
        else 'No approved authority evidence is available.'
      end
    );

alter table plm.dcp_property_licensor_resolution
  alter column resolution_id set not null,
  alter column resolution_id set default gen_random_uuid(),
  alter column decision_version set not null,
  alter column approval_status set not null,
  alter column approval_status set default 'pending',
  alter column decision_reason set not null,
  drop constraint dcp_property_licensor_resolution_pkey,
  drop constraint dcp_property_licensor_resolution_status_chk,
  add constraint dcp_property_licensor_resolution_pkey primary key (resolution_id),
  add constraint dcp_property_licensor_resolution_identity_version_key
    unique (source_system, source_property_id, decision_version),
  add constraint dcp_property_licensor_resolution_identity_resolution_key
    unique (source_system, source_property_id, resolution_id),
  add constraint dcp_property_licensor_resolution_supersedes_fk
    foreign key (source_system, source_property_id, supersedes_resolution_id)
    references plm.dcp_property_licensor_resolution
      (source_system, source_property_id, resolution_id) on delete restrict,
  add constraint dcp_property_licensor_resolution_version_ck check (decision_version > 0),
  add constraint dcp_property_licensor_resolution_status_chk check (
    resolution_status in (
      'supported_signed_contract',
      'supported_core_ownership',
      'supported_owner_approved_opa',
      'supported_owner_source_label',
      'authority_conflict',
      'unresolved'
    )
  ),
  add constraint dcp_property_licensor_resolution_approval_ck check (
    approval_status in ('pending', 'approved', 'rejected')
  ),
  add constraint dcp_property_licensor_resolution_approved_shape_ck check (
    (approval_status = 'approved' and approved_at is not null
      and approved_by is not null and btrim(approved_by) <> '')
    or (approval_status <> 'approved' and approved_at is null and approved_by is null)
  ),
  add constraint dcp_property_licensor_resolution_reason_ck
    check (btrim(decision_reason) <> ''),
  add constraint dcp_property_licensor_resolution_supersession_ck check (
    (decision_version = 1 and supersedes_resolution_id is null)
    or (decision_version > 1 and supersedes_resolution_id is not null)
  );

comment on table plm.dcp_property_licensor_resolution is
  'Append-only, exact-source-identity DCP presentation decision history. Every supersession preserves its predecessor; presentation consumes only the deterministic latest approved version and fails closed otherwise.';
comment on column plm.dcp_property_licensor_resolution.resolution_status is
  'supported_owner_source_label is an owner-approved source-title-family declaration, distinct from exact OPA evidence.';
comment on column plm.dcp_property_licensor_resolution.supersedes_resolution_id is
  'Prior decision for the same exact source_system/source_property_id identity.';

revoke update, delete, truncate, references, trigger, maintain
  on table plm.dcp_property_licensor_resolution from service_role;
grant select, insert on table plm.dcp_property_licensor_resolution to service_role;

do $migration$
declare
  v_definition text;
  v_old_opa text := $old$
    select
      case
        when o.resolution_status = 'canonical' then
          case o.studio_code
            when 'disney' then 'disney-opa'
            when 'marvel' then 'marvel-opa'
            when 'lucasfilm' then 'lucasfilm-star-wars-opa'
            when 'pixar' then 'pixar-opa'
          end
        when o.resolution_status = 'ambiguous_crossover'
          then 'disney-opa-ambiguous-crossover'
        else 'disney-opa-unresolved'
      end::text as presentation_licensor_key,
      case
        when o.resolution_status = 'canonical' then
          case o.studio_code
            when 'disney' then 'Disney OPA'
            when 'marvel' then 'Marvel OPA'
            when 'lucasfilm' then 'Lucasfilm / Star Wars OPA'
            when 'pixar' then 'Pixar OPA'
          end
        when o.resolution_status = 'ambiguous_crossover'
          then 'Disney OPA - ambiguous crossover'
        else 'Disney OPA - unresolved'
      end::text as presentation_licensor_name,
      'disney_opa'::text as source_system,
      'plm.opa_property'::text as source_table,
      p.licensed_property_id::text as source_property_id,
      p.property_name::text as source_property_name,
      o.resolution_status::text as source_status,
      'opa_studio_resolution'::text as provenance_kind,
      p.last_seen_at::timestamptz as latest_seen_at,
      null::text as capture_marker
    from plm.opa_property p
    left join lateral (
      select
        case
          when count(*) filter (
            where r.resolution_status = 'ambiguous_crossover'
          ) > 0
            or count(distinct r.studio_code) filter (
              where r.resolution_status = 'canonical'
            ) > 1
            then 'ambiguous_crossover'
          when count(*) filter (
            where r.resolution_status = 'canonical'
          ) = 1
            then 'canonical'
          else 'unresolved'
        end as resolution_status,
        case
          when count(*) filter (
            where r.resolution_status = 'ambiguous_crossover'
          ) = 0
            and count(*) filter (
              where r.resolution_status = 'canonical'
            ) = 1
            then min(r.studio_code) filter (
              where r.resolution_status = 'canonical'
            )
          else null
        end as studio_code
      from plm.opa_property_studio_resolution r
      where r.licensed_property_id = p.licensed_property_id
    ) o on true
$old$;
  v_new_opa text := $new$
    select
      case
        when s.scope_status = 'direct_lucasfilm' then 'lucasfilm-star-wars-opa'
        when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
          and o.studio_code in ('disney', 'marvel', 'pixar') then
          case o.studio_code when 'disney' then 'disney-opa'
            when 'marvel' then 'marvel-opa' when 'pixar' then 'pixar-opa' end
        when s.scope_status = 'direct_disney' then 'disney-opa'
        when s.scope_status = 'scope_conflict' or o.resolution_status = 'ambiguous_crossover'
          then 'opa-scope-conflict'
        when s.scope_status is null and o.resolution_status = 'canonical' then
          case o.studio_code when 'disney' then 'disney-opa'
            when 'marvel' then 'marvel-opa'
            when 'lucasfilm' then 'lucasfilm-star-wars-opa'
            when 'pixar' then 'pixar-opa' end
        else 'disney-opa-unresolved'
      end::text as presentation_licensor_key,
      case
        when s.scope_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
        when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
          and o.studio_code = 'marvel' then 'Marvel - Submissions (OPA)'
        when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
          and o.studio_code = 'pixar' then 'Pixar - Submissions (OPA)'
        when s.scope_status = 'direct_disney' then 'Disney - Submissions (OPA)'
        when s.scope_status = 'scope_conflict' or o.resolution_status = 'ambiguous_crossover'
          then 'OPA - scope conflict'
        when s.scope_status is null and o.resolution_status = 'canonical' then
          case o.studio_code when 'disney' then 'Disney - Submissions (OPA)'
            when 'marvel' then 'Marvel - Submissions (OPA)'
            when 'lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
            when 'pixar' then 'Pixar - Submissions (OPA)' end
        else 'OPA - unresolved'
      end::text as presentation_licensor_name,
      'disney_opa'::text as source_system,
      'plm.opa_property'::text as source_table,
      p.licensed_property_id::text as source_property_id,
      p.property_name::text as source_property_name,
      coalesce(s.scope_status, o.resolution_status, 'unresolved')::text as source_status,
      case when s.scope_status is not null then 'direct_opa_route_membership'
        else 'opa_studio_resolution' end::text as provenance_kind,
      p.last_seen_at::timestamptz as latest_seen_at,
      null::text as capture_marker
    from plm.opa_property p
    left join lateral (
      select case
        when count(distinct latest.branch_code) > 1 then 'scope_conflict'
        when min(latest.branch_code) = 'lucasfilm' then 'direct_lucasfilm'
        when min(latest.branch_code) = 'disney' then 'direct_disney'
      end scope_status
      from (
        select distinct on (m.region_code, m.branch_code, m.line_of_business_id,
                            m.product_type_code, m.template_id, m.workflow_id)
          m.branch_code
        from plm.opa_property_scope_membership m
        where m.licensed_property_id = p.licensed_property_id
          and m.approval_status = 'approved'
        order by m.region_code, m.branch_code, m.line_of_business_id,
                 m.product_type_code, m.template_id, m.workflow_id,
                 m.source_captured_at desc, m.created_at desc, m.membership_id desc
      ) latest
    ) s on true
    left join lateral (
      select case
          when count(*) filter (where r.resolution_status = 'ambiguous_crossover') > 0
            or count(distinct r.studio_code) filter (where r.resolution_status = 'canonical') > 1
            then 'ambiguous_crossover'
          when count(*) filter (where r.resolution_status = 'canonical') = 1 then 'canonical'
          else 'unresolved' end resolution_status,
        case when count(*) filter (where r.resolution_status = 'ambiguous_crossover') = 0
          and count(*) filter (where r.resolution_status = 'canonical') = 1
          then min(r.studio_code) filter (where r.resolution_status = 'canonical') end studio_code
      from plm.opa_property_studio_resolution r
      where r.licensed_property_id = p.licensed_property_id
    ) o on true
$new$;
  v_old_dcp text := $old$
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
    left join plm.dcp_property_licensor_resolution r
      on r.source_system = p.source_system and r.source_property_id = p.source_id

    union all
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
      p.source_system, 'plm.marvel_dcp_property', p.source_id, p.display_name,
      coalesce(r.resolution_status, 'unresolved'),
      'dcp_property_licensor_resolution', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.marvel_dcp_property p
    left join plm.dcp_property_licensor_resolution r
      on r.source_system = p.source_system and r.source_property_id = p.source_id

    union all
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
      p.source_system, 'plm.lucasfilm_dcp_property', p.source_id, p.display_name,
      coalesce(r.resolution_status, 'unresolved'),
      'dcp_property_licensor_resolution', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.lucasfilm_dcp_property p
    left join plm.dcp_property_licensor_resolution r
      on r.source_system = p.source_system and r.source_property_id = p.source_id
$old$;
  v_new_dcp text := replace(v_old_dcp,
    'left join plm.dcp_property_licensor_resolution r' || chr(10) ||
    '      on r.source_system = p.source_system and r.source_property_id = p.source_id',
    'left join lateral (' || chr(10) ||
    '      select d.* from plm.dcp_property_licensor_resolution d' || chr(10) ||
    '      where d.source_system = p.source_system and d.source_property_id = p.source_id' || chr(10) ||
    '        and d.approval_status = ''approved''' || chr(10) ||
    '      order by d.decision_version desc, d.approved_at desc, d.resolution_id desc limit 1' || chr(10) ||
    '    ) r on true');
begin
  select pg_get_functiondef('api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure)
    into v_definition;
  if position(v_old_opa in v_definition) = 0 or position(v_old_dcp in v_definition) = 0 then
    raise exception using errcode = '55000',
      message = 'Scraped Properties definition differs from the reviewed #1599 predecessor';
  end if;
  v_definition := replace(v_definition, v_old_opa, v_new_opa);
  v_new_dcp := replace(v_new_dcp, $marvel$
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
      p.source_system, 'plm.marvel_dcp_property', p.source_id, p.display_name,
$marvel$, $marvel_replacement$
    select
      'dcp-vault-non-authoritative-marvel-tag',
      'DCP Vault - non-authoritative Marvel tag',
      p.source_system, 'plm.marvel_dcp_property', p.source_id, p.display_name,
$marvel_replacement$);
  v_definition := replace(v_definition, v_old_dcp, v_new_dcp);
  v_definition := replace(v_definition, '      s.*' || chr(10) || '    from source_rows s',
    '      s.*,' || chr(10) ||
    '      case when s.source_table = ''plm.opa_property'' then ''Submissions (OPA)''' || chr(10) ||
    '        when s.source_table in (''plm.dcp_property'',''plm.lucasfilm_dcp_property'') then ''Creative (DCP Vault)''' || chr(10) ||
    '        when s.source_table = ''plm.marvel_dcp_property'' then ''Retained DCP evidence - not Marvel Creative authority''' || chr(10) ||
    '        else ''Source Property vocabulary'' end::text as source_purpose,' || chr(10) ||
    '      case when s.source_status in (''authority_conflict'',''scope_conflict'',''ambiguous_crossover'') then ''Conflicting evidence requires Licensing review.''' || chr(10) ||
    '        when s.source_status in (''unresolved'') or s.source_status is null then ''No current approved direct authority evidence is available.''' || chr(10) ||
    '        when s.source_table = ''plm.marvel_dcp_property'' then ''DCP Marvel tags are retained mixed-guide evidence and are not Marvel Creative authority.''' || chr(10) ||
    '        else ''Current approved evidence supports this presentation.''' || chr(10) ||
    '      end::text as review_reason,' || chr(10) ||
    '      s.provenance_kind::text as evidence_basis,' || chr(10) ||
    '      case when s.source_status in (''authority_conflict'',''scope_conflict'',''ambiguous_crossover'',''unresolved'') or s.source_status is null' || chr(10) ||
    '        then ''Review direct source identity and approve an evidence-backed decision; do not infer from names or landing tables.''' || chr(10) ||
    '        else ''No action unless newer direct evidence supersedes this decision.'' end::text as review_guidance' || chr(10) ||
    '    from source_rows s');
  v_definition := replace(v_definition,
    '        ''capture_marker'', n.capture_marker' || chr(10) || '      ) order by n.rn',
    '        ''capture_marker'', n.capture_marker,' || chr(10) ||
    '        ''source_purpose'', n.source_purpose,' || chr(10) ||
    '        ''review_reason'', n.review_reason,' || chr(10) ||
    '        ''evidence_basis'', n.evidence_basis,' || chr(10) ||
    '        ''review_guidance'', n.review_guidance' || chr(10) ||
    '      ) order by n.rn');
  execute v_definition;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text, text, integer) is
  'Licensing-manager-gated source Property vocabulary with source purpose and sanitized review evidence. Direct latest-approved OPA route membership is preferred; DCP uses deterministic latest-approved exact-identity decision history. Missing or conflicting authority fails closed. Private evidence references and licensed bulk rows are not exposed.';

revoke all on function api.db_data_admin_scraped_properties(text, text, integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_properties(text, text, integer)
  to authenticated;
