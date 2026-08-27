-- Issue #1631: correct the failed Scraped Properties live acceptance.
-- This changes presentation only. Licensed rows and private decision evidence stay server-side.
-- derived-from: 20260826200252

do $migration$
declare
  v_definition text;
  v_name_needle text := $needle$'presentation_licensor_name', n.presentation_licensor_name$needle$;
  v_name_replacement text := $replacement$'presentation_licensor_name', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
               and n.presentation_licensor_key = 'disney'
            then 'Disney - Creative (DCP Vault)'
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
               and n.presentation_licensor_key in ('star-wars','lucasfilm-star-wars')
            then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
          else n.presentation_licensor_name
        end$replacement$;
  v_asgard_anchor text := $anchor$
    union all
    select '20th-century', '20th Century', p.source_system,
$anchor$;
  v_asgard_arm text := $arm$
    union all
    select
      'marvel-asgard-creative',
      'Marvel - Creative (ASGARD)',
      'marvel_asgard',
      'plm.marvel_asgard_style_guide',
      g.source_identity_key,
      g.exact_label,
      case when g.is_actively_observed then 'active' else 'retained' end,
      'direct_asgard_style_guide',
      null::timestamptz,
      g.last_seen_capture_key::text
    from plm.marvel_asgard_style_guide g

    union all
    select '20th-century', '20th Century', p.source_system,
$arm$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position(v_asgard_anchor in v_definition) = 0
     or position(v_name_needle in v_definition) = 0
     or position($needle$when s.source_table = 'plm.marvel_dcp_property' then 'Retained DCP evidence - not Marvel Creative authority'$needle$ in v_definition) = 0
     or position($needle$case when s.source_status in ('authority_conflict','scope_conflict','ambiguous_crossover') then 'Conflicting evidence requires Licensing review.'$needle$ in v_definition) = 0
     or position($needle$s.provenance_kind::text as evidence_basis,$needle$ in v_definition) = 0
     or position($needle$then 'Review direct source identity and approve an evidence-backed decision; do not infer from names or landing tables.'$needle$ in v_definition) = 0
     or position($needle$'review_reason', n.review_reason$needle$ in v_definition) = 0
     or position($needle$'review_guidance', n.review_guidance$needle$ in v_definition) = 0 then
    raise exception using errcode = '55000',
      message = 'Scraped Properties definition differs from the reviewed #1631 predecessor';
  end if;

  -- Marvel Creative comes only from ASGARD. The retained DCP Marvel arm remains
  -- visibly non-authoritative and can never acquire the Marvel Creative heading.
  v_definition := replace(v_definition, v_asgard_anchor, v_asgard_arm);

  -- Supported DCP decisions carry private source labels. Normalize their public
  -- business headings here, based only on the approved presentation key.
  v_definition := replace(v_definition, v_name_needle, v_name_replacement);
  v_definition := replace(
    v_definition,
    $needle$when s.source_table = 'plm.marvel_dcp_property' then 'Retained DCP evidence - not Marvel Creative authority'$needle$,
    $replacement$when s.source_table = 'plm.marvel_dcp_property' then 'Retained DCP evidence - not Marvel Creative authority'
        when s.source_table = 'plm.marvel_asgard_style_guide' then 'Creative (ASGARD)'$replacement$
  );
  v_definition := replace(
    v_definition,
    $needle$case when s.source_status in ('authority_conflict','scope_conflict','ambiguous_crossover') then 'Conflicting evidence requires Licensing review.'$needle$,
    $replacement$case
        when s.source_status = 'authority_conflict' then 'Conflicting approved authority evidence names more than one presentation scope; Licensing must resolve the exact source identity.'
        when s.source_status = 'scope_conflict' then 'Direct approved OPA route memberships place this Property in both Disney and Lucasfilm scope; Licensing must resolve whether both memberships are intentional.'
        when s.source_status = 'ambiguous_crossover' then 'Approved OPA studio evidence is ambiguous or names multiple studios; Licensing must resolve the direct source scope.'$replacement$
  );
  v_definition := replace(
    v_definition,
    $needle$s.provenance_kind::text as evidence_basis,$needle$,
    $replacement$case
        when s.source_status = 'authority_conflict' then 'approved exact-identity DCP authority decisions'
        when s.source_status = 'scope_conflict' then 'approved direct OPA route memberships'
        when s.source_status = 'ambiguous_crossover' then 'approved OPA studio-resolution records'
        when s.source_status = 'unresolved' or s.source_status is null then 'no current approved direct authority record'
        else s.provenance_kind end::text as evidence_basis,$replacement$
  );
  v_definition := replace(
    v_definition,
    $needle$then 'Review direct source identity and approve an evidence-backed decision; do not infer from names or landing tables.'$needle$,
    $replacement$then case
          when s.source_status = 'authority_conflict' then 'Compare the direct authority records and approve one superseding exact-identity decision. Do not infer authority from a property name or landing table.'
          when s.source_status = 'scope_conflict' then 'Compare the approved Disney and Lucasfilm route records, then approve or reject the exact memberships. Do not use a name keyword as scope evidence.'
          else 'Review direct source identity and approve an evidence-backed decision; do not infer from names or landing tables.' end$replacement$
  );

  if position('Marvel - Creative (ASGARD)' in v_definition) = 0
     or position('Creative (ASGARD)' in v_definition) = 0
     or position('Conflicting approved authority evidence names more than one presentation scope' in v_definition) = 0
     or position('approved exact-identity DCP authority decisions' in v_definition) = 0
     or position('approve one superseding exact-identity decision' in v_definition) = 0 then
    raise exception using errcode = '55000',
      message = 'Scraped Properties #1631 replacement postconditions failed';
  end if;

  execute v_definition;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text, text, integer) is
  'Licensing-manager-gated source Property vocabulary. Supported DCP headings are normalized to Disney or Lucasfilm/Star Wars Creative; Marvel Creative comes only from ASGARD. Conflict and unresolved rows carry sanitized reason, evidence basis, and decision guidance. Exact OPA scope authority, append-only decisions, fail-closed resolution, and the restricted response envelope remain unchanged.';

revoke all on function api.db_data_admin_scraped_properties(text, text, integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_properties(text, text, integer)
  to authenticated;
