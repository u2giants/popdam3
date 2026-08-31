-- Issue #1936 forward 4: keep cursor pages bounded when they contain mapped
-- Creative-to-Submissions rows. Forward 3 correctly stopped the unconditional
-- whole-source spool, but its per-row submission label join could re-run the
-- complete source union for every mapped row on a later page.
-- derived-from: 20260830230246

do $migration$
declare
  v_definition text;
  v_ordered_tail_old constant text := $old$    limit v_page_size + 1
  ), enriched as materialized ($old$;
  v_ordered_tail_new constant text := $new$    limit v_page_size + 1
  ), page_creative_decision as materialized (
    select o.row_key, r.*
    from ordered o
    left join lateral (
      select candidate.*
      from plm.creative_submission_property_resolution candidate
      where candidate.creative_source_system=o.source_system
        and candidate.creative_source_table=o.source_table
        and candidate.creative_source_id=o.source_property_id
        and not exists (
          select 1
          from plm.creative_submission_property_resolution newer
          where newer.supersedes_resolution_id=candidate.resolution_id
        )
      order by candidate.decision_version desc,
        candidate.approved_at desc,candidate.resolution_id desc
      limit 1
    ) r on true
  ), page_submission_identity as materialized (
    select distinct m.submission_source_system,m.submission_source_table,
      m.submission_source_id
    from page_creative_decision d
    join plm.creative_submission_property_resolution_member m
      on m.resolution_id=d.resolution_id
  ), page_submission_source as materialized (
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,s.source_property_name
    from page_submission_identity i
    left join source_rows s
      on s.source_system=i.submission_source_system
     and s.source_table=i.submission_source_table
     and s.source_property_id=i.submission_source_id
  ), enriched as materialized ($new$;
  v_creative_lateral_old constant text := $old$    left join lateral (
      select r.* from plm.creative_submission_property_resolution r
      where r.creative_source_system=o.source_system
        and r.creative_source_table=o.source_table
        and r.creative_source_id=o.source_property_id
        and not exists (select 1 from plm.creative_submission_property_resolution newer
          where newer.supersedes_resolution_id=r.resolution_id)
      order by r.decision_version desc,r.approved_at desc,r.resolution_id desc limit 1
    ) creative_decision on true$old$;
  v_creative_join_new constant text := $new$    left join page_creative_decision creative_decision
      on creative_decision.row_key=o.row_key$new$;
  v_submission_source_old constant text := $old$      left join source_rows submission_source
        on submission_source.source_system=m.submission_source_system
       and submission_source.source_table=m.submission_source_table
       and submission_source.source_property_id=m.submission_source_id$old$;
  v_submission_source_new constant text := $new$      left join page_submission_source submission_source
        on submission_source.submission_source_system=m.submission_source_system
       and submission_source.submission_source_table=m.submission_source_table
       and submission_source.submission_source_id=m.submission_source_id$new$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position(v_ordered_tail_old in v_definition)=0
     or position(v_creative_lateral_old in v_definition)=0
     or position(v_submission_source_old in v_definition)=0
     or position('source_rows as not materialized' in v_definition)=0
     or position('page_dcp_context_rows as materialized' in v_definition)=0
     or position('l.row_key collate "C" > v_cursor_key collate "C"' in v_definition)=0
     or position('app.require_licensing_manager_access()' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#1936 forward-4 predecessor differs from applied forward-3';
  end if;

  v_definition:=replace(v_definition,v_ordered_tail_old,v_ordered_tail_new);
  v_definition:=replace(v_definition,v_creative_lateral_old,v_creative_join_new);
  v_definition:=replace(v_definition,v_submission_source_old,v_submission_source_new);

  if position('page_creative_decision as materialized' in v_definition)=0
     or position('page_submission_identity as materialized' in v_definition)=0
     or position('page_submission_source as materialized' in v_definition)=0
     or position(v_creative_lateral_old in v_definition)<>0
     or position(v_submission_source_old in v_definition)<>0
     or position('l.row_key collate "C" > v_cursor_key collate "C"' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#1936 forward-4 bounded submission lookup postconditions failed';
  end if;

  execute v_definition;
end
$migration$;
