-- Issue #2576. DCP full-population matching: approved cross-copy identities
-- still display unmapped.
-- derived-from: 20260907200221, 20260902053756
--
-- WHAT IS WRONG
-- -------------
-- plm.dcp_opa_property_resolution keys every decision on the EXACT retained
-- copy (source_system, source_table, source_property_id). DCP Vault landed the
-- same Creative property into three retained tables, so one business identity
-- owns up to three independent decision ledgers. Read from production
-- (project ref qsllyeztdwjgirsysgai) on 2026-09-10:
--
--   select r.resolution_id, r.source_table, r.decision_version, r.approval_status,
--          r.creative_decision_state,
--          (select count(*) from plm.dcp_opa_property_resolution_member m
--             where m.resolution_id = r.resolution_id) as members
--     from plm.dcp_opa_property_resolution r
--    where r.source_property_id = 'dcpvault:properties/ba/bambi'
--    order by r.source_table, r.decision_version;
--
--   plm.dcp_property            v1 approved unmapped 0 members
--   plm.lucasfilm_dcp_property  v1 approved unmapped 0 members
--   plm.marvel_dcp_property     v1 pending  (null)   1 member
--   plm.marvel_dcp_property     v2 approved (null)   1 member
--
-- The identity IS mapped -- an approved terminal decision with one member
-- exists -- yet the reader, keyed on the exact copy, renders the
-- plm.dcp_property row as unmapped.
--
-- WHY THE STABLE KEY IS THE ID OWN NAMESPACE, NOT THE LANDING TABLE
-- -----------------------------------------------------------------
-- The grouping is derived, not assumed. Cross-tabbing every retained copy:
--
--   select source_property_id, count(distinct source_table) as tables,
--          string_agg(distinct source_system||' / '||source_table, ' ; ')
--     from plm.dcp_opa_property_resolution
--    group by 1 having count(distinct source_table) > 1;
--
--   'dcpvault:properties/ba/bambi' -> 3 tables: disney_dcpvault/plm.dcp_property ;
--       lucasfilm_dcpvault/plm.lucasfilm_dcp_property ;
--       marvel_dcpvault/plm.marvel_dcp_property        (SAME business Creative)
--   '100'                          -> 2 tables: sega_dsi/plm.sega_property ;
--       wildbrain_dam/source.wildbrain_era             (DIFFERENT businesses)
--
-- So a bare source id must never be grouped across systems: small integer ids
-- collide between licensors. The 'dcpvault:' prefix is the id own emitted
-- namespace, and it partitions exactly -- all 462 dcpvault-namespaced rows
-- belong to the three DCP copies and no other system emits that prefix:
--
--   select (source_property_id like 'dcpvault:%'), source_system, source_table,
--          count(*) from plm.dcp_opa_property_resolution group by 1,2,3;
--   -> true : disney_dcpvault/plm.dcp_property 311
--      true : lucasfilm_dcpvault/plm.lucasfilm_dcp_property 119
--      true : marvel_dcpvault/plm.marvel_dcp_property 32
--
-- Grouping therefore reads the stable DCP source id itself. It never infers
-- from landing-table family, from the non-authoritative Marvel tag, or from a
-- normalized name, and every non-DCP source keeps the exact copy key it has
-- today.
--
-- THE STABLE-IDENTITY CONTRACT (identical in all three functions)
-- --------------------------------------------------------------
--   * Take the newest TERMINAL (approved/rejected) decision of EVERY retained
--     copy of the identity. A later pending proposal is a proposal: it stays in
--     the review queue and can never hide a terminal decision.
--   * Fingerprint each terminal copy by its exact member set (submission
--     source system/table/id).
--   * Two or more copies terminally MAPPED to DIFFERENT member sets is a
--     genuine terminal disagreement: the identity FAILS CLOSED to 'conflict'
--     with no resolution_id, so no mapping is served and the identity stays
--     reviewable. Nothing guesses a winner.
--   * Otherwise a single agreed mapping wins, even when another retained copy
--     merely LACKS a mapping (approved/unmapped): a lack is not a competing
--     authority.
--   * With no mapped copy at all, the newest terminal copy own state stands.
--
--   * The WRITE side is guarded to match. The insert stays copy-keyed, so an
--     approval carrying members is refused when it would introduce a member
--     set that disagrees with a terminal mapping already recorded on another
--     retained copy of the same identity and that no terminal mapping already
--     holds. That is the only way a single-copy screen could have driven a
--     working identity into 'conflict' and un-served a mapping the reviewer
--     never opened. Approving the set an existing terminal mapping already
--     carries stays allowed, so a disagreement is always reconcilable and no
--     identity is ever stranded.
--
-- ACCEPTED RESIDUAL RISKS (recorded, not hidden)
-- ---------------------------------------------
--   * NOT RE-RUNNABLE, BY DESIGN. Every in-place rewrite here refuses unless
--     the current body is exactly the text it was derived from. In the two
--     decide-function rewrites the replacement text ENDS with the needle it
--     replaces, so an exact-once hit count alone cannot tell a fresh body from
--     an already-rewritten one. Each of those blocks therefore ASSERTS FIRST
--     that the marker it installs ('identity_decision_state' in section 3,
--     'would give the stable identity' in section 4) is absent, and only then
--     checks the needle occurs exactly once. supabase_migrations.schema_migrations
--     already runs each version once; the absence assertion is what makes an
--     isolated re-run of a single block fail closed too.
--   * GROUPING IS PREFIX-ONLY, NOT A CLOSED SYSTEM ALLOW-LIST. 'dcpvault:' is
--     the id's own emitted namespace and today all 462 such rows belong to the
--     three DCP copies (census above). Since #2449 dropped the three-table
--     identity check, a future non-DCP loader that emitted a 'dcpvault:'
--     prefix would join the DCP identity. This is accepted rather than fixed
--     here because a source_system allow-list would have to be widened by
--     every new DCP-family load and would silently un-group an identity when
--     it was not, which is the failure this issue exists to remove. The prefix
--     is owned by DCP Vault and no other loader in this repository emits it;
--     a loader that did would be the defect.
--   * TIE ORDERING IS TOTAL, NOT ARBITRARY. Both the per-copy pick and the
--     across-copy pick end in resolution_id desc, and resolution_id is the
--     primary key, so equal decision_version and equal approved_at still order
--     deterministically. Divergent mapped member sets never reach the tie: they
--     fail closed to 'conflict' first.
--   * identity_copies IS DELIBERATELY WIDER ON THE READ SIDE. The queue carries
--     copy_decision_state and member_fingerprint so a reviewer screen can show
--     WHY an identity conflicts; the decide response carries the seven fields a
--     write acknowledgement needs. Both agree on identity_key and
--     identity_decision_state, which is what any caller decides on.
--
-- Append-only decision history, canonical OPA ids, the security-definer
-- licensing-manager gate, least-privilege grants, keyset pagination and the
-- #2449 non-authoritative Marvel-tag exclusion are all unchanged. This
-- migration writes no candidate or result rows.

begin;

-- ---------------------------------------------------------------------------
-- 1. api.db_data_admin_scraped_properties
--    Re-point page_creative_decision from the exact copy to the stable DCP
--    identity. Surgery on the merged production body: the rest of this 43 KB
--    function is untouched, and the migration aborts if the current body is
--    not what it was derived from.
-- ---------------------------------------------------------------------------
do $migration$
declare
  v_sig constant text := 'api.db_data_admin_scraped_properties(text,text,integer)';
  v_definition text;
  v_old constant text := $old$  ), page_creative_decision as materialized (
    select o.row_key, r.resolution_id,
      (case
        when r.creative_decision_state is not null then r.creative_decision_state
        when r.resolution_id is null then null
        when r.approval_status='approved' and exists (
          select 1 from plm.dcp_opa_property_resolution_member mm
          where mm.resolution_id=r.resolution_id
        ) then 'mapped'
        else 'unmapped'
      end)::text as decision_state
    from ordered o
    left join lateral (
      select candidate.*
      from plm.dcp_opa_property_resolution candidate
      where candidate.source_system=o.source_system
        and candidate.source_table=o.source_table
        and candidate.source_property_id=o.source_property_id
        -- Pending rows are proposals, not terminal decisions. Read the newest
        -- approved/rejected version so a later pending proposal cannot hide an
        -- approval, while a later rejection still supersedes that approval.
        and candidate.approval_status in ('approved','rejected')
      order by candidate.decision_version desc,
        candidate.approved_at desc nulls last,candidate.resolution_id desc
      limit 1
    ) r on true
$old$;
  v_new constant text := $new$  ), page_creative_decision as materialized (
    -- One stable DCP source id is the business Creative identity. Every
    -- retained source-system/table copy of it is provenance, not a separate
    -- business fact. Non-DCP sources keep their exact copy key because bare
    -- integer source ids collide between licensors.
    select o.row_key, r.resolution_id, r.decision_state
    from ordered o
    cross join lateral (
      select case when o.source_property_id like 'dcpvault:%'
                  then o.source_property_id
                  else o.source_table||'|'||o.source_system||'|'||o.source_property_id
             end as identity_key
    ) k
    left join lateral (
      select
        -- Fails closed: a genuine terminal disagreement serves no mapping.
        case when g.mapped_fingerprints > 1 then null else g.pick_id end
          as resolution_id,
        (case
          when g.copy_count = 0 then null
          when g.mapped_fingerprints > 1 then 'conflict'
          when g.mapped_copies > 0 then 'mapped'
          else g.newest_state
        end)::text as decision_state
      from (
        select
          count(*) as copy_count,
          count(*) filter (where c.copy_state='mapped') as mapped_copies,
          count(distinct c.member_fingerprint)
            filter (where c.copy_state='mapped') as mapped_fingerprints,
          (array_agg(c.resolution_id order by (c.copy_state='mapped') desc,
             c.decision_version desc, c.approved_at desc nulls last,
             c.resolution_id desc))[1] as pick_id,
          (array_agg(c.copy_state order by c.decision_version desc,
             c.approved_at desc nulls last, c.resolution_id desc))[1]
             as newest_state
        from (
          -- Newest TERMINAL decision per retained copy. Pending rows are
          -- proposals: they stay queued and never hide a terminal decision.
          select distinct on (t.source_system, t.source_table)
            t.resolution_id, t.decision_version, t.approved_at,
            (case
              when t.creative_decision_state is not null
                then t.creative_decision_state
              when t.approval_status='approved' and mf.fingerprint <> ''
                then 'mapped'
              else 'unmapped'
            end)::text as copy_state,
            mf.fingerprint as member_fingerprint
          from plm.dcp_opa_property_resolution t
          cross join lateral (
            select coalesce(string_agg(
              m.submission_source_system||'|'||m.submission_source_table||'|'||
                m.submission_source_id, chr(10)
              order by m.submission_source_system, m.submission_source_table,
                m.submission_source_id), '') as fingerprint
            from plm.dcp_opa_property_resolution_member m
            where m.resolution_id = t.resolution_id
          ) mf
          where t.approval_status in ('approved','rejected')
            and case when k.identity_key like 'dcpvault:%'
                     then t.source_property_id = k.identity_key
                     else t.source_system = o.source_system
                      and t.source_table = o.source_table
                      and t.source_property_id = o.source_property_id
                end
          order by t.source_system, t.source_table, t.decision_version desc,
            t.approved_at desc nulls last, t.resolution_id desc
        ) c
      ) g
    ) r on true
$new$;
begin
  v_definition := pg_get_functiondef(v_sig::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception
      'issue #2576: api.db_data_admin_scraped_properties no longer contains the exact copy-keyed page_creative_decision block this migration was derived from; re-derive from the current merged body';
  end if;
  execute replace(v_definition, v_old, v_new);
  if position(v_new in pg_get_functiondef(v_sig::regprocedure)) = 0 then
    raise exception 'issue #2576: stable-identity creative decision block did not install';
  end if;
end
$migration$;

-- ---------------------------------------------------------------------------
-- 2. api.db_data_admin_property_match_queue
--    One coherent review state per business identity, with every retained
--    copy terminal decision carried alongside as provenance and conflict
--    evidence. Rows stay one-per-pending-copy so resolution_id, the decide
--    contract, evidence, candidates and keyset pagination are unchanged.
-- ---------------------------------------------------------------------------
create or replace function api.db_data_admin_property_match_queue(
  p_search text default null::text,
  p_cursor text default null::text,
  p_page_size integer default null::integer
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_page_size integer;
  v_cursor_key text;
  v_search text;
  v_rows jsonb;
  v_fetched integer;
  v_last_key text;
  v_next_cursor text;
begin
  -- Authorization and every licensed read stay one server-side operation.
  perform app.require_licensing_manager_access();

  v_page_size := least(greatest(coalesce(p_page_size, 100), 1), 500);
  v_search := nullif(btrim(coalesce(p_search, '')), '');

  if p_cursor is not null then
    begin
      v_cursor_key := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_key is null or v_cursor_key = '' then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with tip as (
    -- The LATEST version of every exact source identity, decided or not.
    select distinct on (r.source_system, r.source_table, r.source_property_id) r.*
    from plm.dcp_opa_property_resolution r
    order by r.source_system, r.source_table, r.source_property_id,
             r.decision_version desc, r.resolution_id desc
  ), pending as (
    -- Only an identity whose CURRENT version is undecided is a review case. An
    -- identity already approved or rejected is finished and never reappears.
    select t.* from tip t where t.approval_status = 'pending'
  ), prior as (
    select p.resolution_id as pending_resolution_id,
           a.resolution_id as prior_resolution_id,
           a.approval_status as prior_approval_status,
           a.decision_version as prior_decision_version,
           a.contract_asserted_studio_code as prior_contract_asserted_studio_code
    from pending p
    join lateral (
      select a.*
      from plm.dcp_opa_property_resolution a
      where a.source_system = p.source_system
        and a.source_table = p.source_table
        and a.source_property_id = p.source_property_id
        and a.approval_status = 'approved'
        and a.decision_version < p.decision_version
      order by a.decision_version desc, a.resolution_id desc
      limit 1
    ) a on true
  ), candidates as (
    select m.resolution_id,
           count(*)::integer as candidate_count,
           jsonb_agg(jsonb_build_object(
             'licensed_property_id', m.licensed_property_id,
             'member_ordinal', m.member_ordinal
           ) order by m.member_ordinal) as candidates
    from plm.dcp_opa_property_resolution_member m
    join pending p on p.resolution_id = m.resolution_id
    group by m.resolution_id
  ), named as (
    select p.*,
           coalesce(d.display_name, l.display_name, mv.display_name) as source_property_name,
           p.source_table || '|' || p.source_system || '|' || p.source_property_id as row_key
    from pending p
    left join plm.dcp_property d
      on p.source_table = 'plm.dcp_property'
     and d.source_system = p.source_system
     and d.source_id = p.source_property_id
    left join plm.lucasfilm_dcp_property l
      on p.source_table = 'plm.lucasfilm_dcp_property'
     and l.source_system = p.source_system
     and l.source_id = p.source_property_id
    left join plm.marvel_dcp_property mv
      on p.source_table = 'plm.marvel_dcp_property'
     and mv.source_system = p.source_system
     and mv.source_id = p.source_property_id
  ), filtered as (
    select n.* from named n
    where (v_search is null
           or n.source_property_id ilike '%' || v_search || '%'
           or coalesce(n.source_property_name, '') ilike '%' || v_search || '%')
      and (p_cursor is null or n.row_key collate "C" > v_cursor_key collate "C")
  ), ordered as (
    select f.* from filtered f
    order by f.row_key collate "C"
    limit v_page_size + 1
  ), numbered as (
    select o.*, row_number() over (order by o.row_key collate "C") as rn
    from ordered o
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'row_key', n.row_key,
        'resolution_id', n.resolution_id,
        'source_system', n.source_system,
        'source_table', n.source_table,
        'source_property_id', n.source_property_id,
        'source_property_name', n.source_property_name,
        'display_label', coalesce(
          nullif(btrim(n.source_property_name), ''),
          '[Unlabeled source ID: ' || n.source_property_id || ']'
        ),
        'decision_version', n.decision_version,
        'approval_status', n.approval_status,
        'evidence_reference', n.evidence_reference,
        'evidence_sha256', n.evidence_sha256,
        'decision_reason', n.decision_reason,
        'contract_asserted_studio_code', n.contract_asserted_studio_code,
        'contract_evidence_reference', n.contract_evidence_reference,
        'contract_evidence_sha256', n.contract_evidence_sha256,
        'supersedes_resolution_id', n.supersedes_resolution_id,
        'created_at', n.created_at,
        'prior_resolution_id', pr.prior_resolution_id,
        'prior_approval_status', pr.prior_approval_status,
        'prior_decision_version', pr.prior_decision_version,
        'prior_contract_asserted_studio_code', pr.prior_contract_asserted_studio_code,
        'candidate_count', coalesce(c.candidate_count, 0),
        'candidates', coalesce(c.candidates, '[]'::jsonb),
        -- Stable business identity for this row. Non-DCP sources keep their
        -- exact copy key: bare integer source ids collide between licensors.
        'identity_key', ik.identity_key,
        -- ONE coherent review state for the business identity behind this row.
        'identity_decision_state', idn.decision_state,
        'identity_resolution_id', idn.resolution_id,
        'identity_conflict', idn.decision_state = 'conflict',
        'identity_copy_count', idn.copy_count,
        -- Copy-level provenance and conflict evidence, retained in full.
        'identity_copies', idn.copies
      ) order by n.rn
    ) filter (where n.rn <= v_page_size), '[]'::jsonb),
    count(*)::integer,
    max(n.row_key) filter (where n.rn = v_page_size)
  into v_rows, v_fetched, v_last_key
  from numbered n
  left join candidates c on c.resolution_id = n.resolution_id
  left join prior pr on pr.pending_resolution_id = n.resolution_id
  cross join lateral (
    select case when n.source_property_id like 'dcpvault:%'
                then n.source_property_id
                else n.source_table||'|'||n.source_system||'|'||n.source_property_id
           end as identity_key
  ) ik
  cross join lateral (
    select
      case when g.mapped_fingerprints > 1 then null else g.pick_id end
        as resolution_id,
      (case
        when g.copy_count = 0 then null
        when g.mapped_fingerprints > 1 then 'conflict'
        when g.mapped_copies > 0 then 'mapped'
        else g.newest_state
      end)::text as decision_state,
      g.copy_count::integer as copy_count,
      g.copies
    from (
      select
        count(*) as copy_count,
        count(*) filter (where c2.copy_state='mapped') as mapped_copies,
        count(distinct c2.member_fingerprint)
          filter (where c2.copy_state='mapped') as mapped_fingerprints,
        (array_agg(c2.resolution_id order by (c2.copy_state='mapped') desc,
           c2.decision_version desc, c2.approved_at desc nulls last,
           c2.resolution_id desc))[1] as pick_id,
        (array_agg(c2.copy_state order by c2.decision_version desc,
           c2.approved_at desc nulls last, c2.resolution_id desc))[1]
           as newest_state,
        coalesce(jsonb_agg(jsonb_build_object(
          'source_system', c2.source_system,
          'source_table', c2.source_table,
          'resolution_id', c2.resolution_id,
          'decision_version', c2.decision_version,
          'approval_status', c2.approval_status,
          'creative_decision_state', c2.creative_decision_state,
          'copy_decision_state', c2.copy_state,
          'member_count', c2.member_count,
          'member_fingerprint', c2.member_fingerprint
        ) order by c2.source_table, c2.source_system), '[]'::jsonb) as copies
      from (
        -- Newest TERMINAL decision per retained copy. Pending rows are
        -- proposals: they stay in this queue and never hide a terminal
        -- decision.
        select distinct on (t.source_system, t.source_table)
          t.resolution_id, t.source_system, t.source_table, t.decision_version,
          t.approved_at, t.approval_status, t.creative_decision_state,
          (case
            when t.creative_decision_state is not null
              then t.creative_decision_state
            when t.approval_status='approved' and mf.fingerprint <> ''
              then 'mapped'
            else 'unmapped'
          end)::text as copy_state,
          mf.fingerprint as member_fingerprint,
          mf.member_count
        from plm.dcp_opa_property_resolution t
        cross join lateral (
          select coalesce(string_agg(
            m.submission_source_system||'|'||m.submission_source_table||'|'||
              m.submission_source_id, chr(10)
            order by m.submission_source_system, m.submission_source_table,
              m.submission_source_id), '') as fingerprint,
            count(*)::integer as member_count
          from plm.dcp_opa_property_resolution_member m
          where m.resolution_id = t.resolution_id
        ) mf
        where t.approval_status in ('approved','rejected')
          and case when ik.identity_key like 'dcpvault:%'
                   then t.source_property_id = ik.identity_key
                   else t.source_system = n.source_system
                    and t.source_table = n.source_table
                    and t.source_property_id = n.source_property_id
              end
        order by t.source_system, t.source_table, t.decision_version desc,
          t.approved_at desc nulls last, t.resolution_id desc
      ) c2
    ) g
  ) idn;

  if v_fetched > v_page_size and v_last_key is not null then
    v_next_cursor := encode(convert_to(v_last_key, 'UTF8'), 'base64');
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$function$;

comment on function api.db_data_admin_property_match_queue(text, text, integer) is
  'Read-only, licensing-manager-gated review queue of DCP source Property identities whose LATEST resolution version is still pending. Returns the pending decision''s own evidence references and hashes, its proposed OPA candidate members, and the previously approved version for context. Stable keyset pages over source_table|source_system|source_property_id, one row per pending copy. Issue #2576 adds the stable business identity behind each row (identity_key: the dcpvault: source Property id where present, otherwise the exact copy key, because bare integer source ids collide between licensors) and, for that identity, ONE coherent review state derived only from its own retained terminal decisions: identity_decision_state, identity_resolution_id, identity_conflict (true when the identity''s approved copies map to more than one distinct member set), identity_copy_count and identity_copies. Derives no authority verdict over licensor scope: contract-assertion conflict presentation stays in api.db_data_admin_scraped_properties, which issue #1999 already corrected for Marvel contract assertions over Disney OPA scope.';

-- ---------------------------------------------------------------------------
-- 3. api.db_data_admin_decide_property_match
--    Same stable-identity/provenance contract on the write side: the recorded
--    decision is returned with the business identity it belongs to, the
--    identity resulting coherent state, and the retained copies behind it.
--    Append-only history, idempotency, the authenticated-reviewer requirement
--    and the member-write contract are untouched, and there is no
--    title-specific exception anywhere.
-- ---------------------------------------------------------------------------
do $migration$
declare
  v_sig constant text := 'api.db_data_admin_decide_property_match(uuid,text,bigint[],text,uuid)';
  v_definition text;
  v_hits integer;
  v_old constant text := $old$    'idempotent_repeat', v_repeat,$old$;
  v_new constant text := $new$    -- Stable business identity this decision belongs to. Non-DCP sources
    -- keep their exact copy key: bare integer source ids collide between
    -- licensors, so they are never grouped across systems.
    'identity_key', case when v_written.source_property_id like 'dcpvault:%'
      then v_written.source_property_id
      else v_written.source_table||'|'||v_written.source_system||'|'||
           v_written.source_property_id end,
    'identity_decision_state', (
      select case
        when g.copy_count = 0 then null
        when g.mapped_fingerprints > 1 then 'conflict'
        when g.mapped_copies > 0 then 'mapped'
        else g.newest_state
      end
      from (
        select count(*) as copy_count,
          count(*) filter (where c.copy_state='mapped') as mapped_copies,
          count(distinct c.member_fingerprint)
            filter (where c.copy_state='mapped') as mapped_fingerprints,
          (array_agg(c.copy_state order by c.decision_version desc,
             c.approved_at desc nulls last, c.resolution_id desc))[1]
             as newest_state
        from (
          select distinct on (t.source_system, t.source_table)
            t.resolution_id, t.decision_version, t.approved_at,
            (case
              when t.creative_decision_state is not null
                then t.creative_decision_state
              when t.approval_status='approved' and mf.fingerprint <> ''
                then 'mapped'
              else 'unmapped'
            end)::text as copy_state,
            mf.fingerprint as member_fingerprint
          from plm.dcp_opa_property_resolution t
          cross join lateral (
            select coalesce(string_agg(
              m.submission_source_system||'|'||m.submission_source_table||'|'||
                m.submission_source_id, chr(10)
              order by m.submission_source_system, m.submission_source_table,
                m.submission_source_id), '') as fingerprint
            from plm.dcp_opa_property_resolution_member m
            where m.resolution_id = t.resolution_id
          ) mf
          where t.approval_status in ('approved','rejected')
            and case
                  when v_written.source_property_id like 'dcpvault:%'
                    then t.source_property_id = v_written.source_property_id
                  else t.source_system = v_written.source_system
                   and t.source_table = v_written.source_table
                   and t.source_property_id = v_written.source_property_id
                end
          order by t.source_system, t.source_table, t.decision_version desc,
            t.approved_at desc nulls last, t.resolution_id desc
        ) c
      ) g
    ),
    'identity_copies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_system', c.source_system,
        'source_table', c.source_table,
        'resolution_id', c.resolution_id,
        'decision_version', c.decision_version,
        'approval_status', c.approval_status,
        'creative_decision_state', c.creative_decision_state,
        'member_count', c.member_count
      ) order by c.source_table, c.source_system)
      from (
        select distinct on (t.source_system, t.source_table)
          t.resolution_id, t.source_system, t.source_table, t.decision_version,
          t.approval_status, t.creative_decision_state,
          (select count(*)::integer
             from plm.dcp_opa_property_resolution_member m
            where m.resolution_id = t.resolution_id) as member_count
        from plm.dcp_opa_property_resolution t
        where t.approval_status in ('approved','rejected')
          and case
                when v_written.source_property_id like 'dcpvault:%'
                  then t.source_property_id = v_written.source_property_id
                else t.source_system = v_written.source_system
                 and t.source_table = v_written.source_table
                 and t.source_property_id = v_written.source_property_id
              end
        order by t.source_system, t.source_table, t.decision_version desc,
          t.approved_at desc nulls last, t.resolution_id desc
      ) c
    ), '[]'::jsonb),
    'idempotent_repeat', v_repeat,$new$;
begin
  v_definition := pg_get_functiondef(v_sig::regprocedure);
  -- The needle survives its own replacement: v_new ENDS with the same
  -- 'idempotent_repeat', v_repeat, fragment. So an already-rewritten body
  -- still contains the needle exactly once and the exact-once count alone
  -- CANNOT detect a re-run. Assert first that the marker this block installs
  -- is absent, which is true only of a body that has not been rewritten yet;
  -- that is what makes an isolated re-run fail closed. The exact-once count
  -- is kept as well, so a body carrying an unexpected number of needles is
  -- refused instead of being rewritten in more than one place, matching the
  -- exactly-once rewrite discipline of 20260907200221 lines 456-460.
  if position('identity_decision_state' in v_definition) > 0 then
    raise exception
      'issue #2576: api.db_data_admin_decide_property_match already carries the stable-identity decision payload; this block is not re-runnable, re-derive from the current merged body';
  end if;
  v_hits := (length(v_definition) - length(replace(v_definition, v_old, '')))
            / nullif(length(v_old), 0);
  if v_hits is distinct from 1 then
    raise exception
      'issue #2576: expected exactly 1 idempotent_repeat return fragment to rewrite in api.db_data_admin_decide_property_match, found %; re-derive from the current merged body',
      coalesce(v_hits, 0);
  end if;
  execute replace(v_definition, v_old, v_new);
  if position('identity_decision_state' in pg_get_functiondef(v_sig::regprocedure)) = 0 then
    raise exception 'issue #2576: stable-identity decision payload did not install';
  end if;
end
$migration$;

-- ---------------------------------------------------------------------------
-- 4. api.db_data_admin_decide_property_match
--    Close the write path the identity read opened. The INSERT is still
--    copy-keyed, so before this migration a reviewer could approve a pending
--    sibling to a member set that disagrees with a copy already terminally
--    mapped: mapped_fingerprints becomes 2, resolution_id becomes null, and
--    EVERY retained copy of that dcpvault: identity renders 'conflict' with no
--    mapping served -- including a copy the reviewer never opened. The read
--    fails closed by design; it must not be possible to reach that state by
--    accident from a single-copy screen.
--
--    The rule refuses rather than guesses, and it never strands an identity:
--    an approval carrying members is refused only when it would INTRODUCE a
--    member set that no terminal mapping of the same stable identity already
--    holds while some other terminal mapping disagrees with it. Approving the
--    set an existing terminal mapping already carries is always allowed (that
--    is how a disagreement is reconciled), an approval with no members is
--    always allowed (a lack of mapping is not a competing authority), and a
--    rejection is always allowed. Non-dcpvault sources keep their exact copy
--    key and are unaffected. Members are compared by the same submission
--    fingerprint the readers use.
-- ---------------------------------------------------------------------------
do $migration$
declare
  v_sig constant text := 'api.db_data_admin_decide_property_match(uuid,text,bigint[],text,uuid)';
  v_definition text;
  v_hits integer;
  v_old constant text := $old$    begin
      -- Append-only: a superseding version, never an update of the pending row.
$old$;
  v_new constant text := $new$    -- Issue #2576. A copy-keyed approval may not un-serve the stable
    -- identity's working mapping. Refuse an approval whose member set
    -- disagrees with an existing terminal mapping of the same identity on
    -- another retained copy AND is not itself already held by one.
    if v_status = 'approved'
       and array_length(v_ids, 1) is not null
       and v_pending.source_property_id like 'dcpvault:%' then
      if (
        select count(*) filter (
                 where c.copy_state = 'mapped'
                   and c.fingerprint is distinct from p.fingerprint) > 0
           and count(*) filter (
                 where c.copy_state = 'mapped'
                   and c.fingerprint = p.fingerprint) = 0
        from (
          select coalesce(string_agg(
            'disney_opa|plm.opa_property|' || u::text, chr(10)
            order by 'disney_opa|plm.opa_property|' || u::text), '') as fingerprint
          from unnest(v_ids) u
        ) p
        left join lateral (
          select distinct on (t.source_system, t.source_table)
            (case
              when t.creative_decision_state is not null
                then t.creative_decision_state
              when t.approval_status = 'approved' and mf.fingerprint <> ''
                then 'mapped'
              else 'unmapped'
            end)::text as copy_state,
            mf.fingerprint
          from plm.dcp_opa_property_resolution t
          cross join lateral (
            select coalesce(string_agg(
              m.submission_source_system||'|'||m.submission_source_table||'|'||
                m.submission_source_id, chr(10)
              order by m.submission_source_system, m.submission_source_table,
                m.submission_source_id), '') as fingerprint
            from plm.dcp_opa_property_resolution_member m
            where m.resolution_id = t.resolution_id
          ) mf
          where t.approval_status in ('approved','rejected')
            and t.source_property_id = v_pending.source_property_id
            and not (t.source_system = v_pending.source_system
                 and t.source_table = v_pending.source_table)
          order by t.source_system, t.source_table, t.decision_version desc,
            t.approved_at desc nulls last, t.resolution_id desc
        ) c on true
      ) then
        raise exception 'db_data_admin: resolution % would give the stable identity % a member set that disagrees with a terminal mapping already recorded on another retained copy; reconcile the identity instead of recording a conflicting copy',
          p_resolution_id, v_pending.source_property_id
          using errcode = 'restrict_violation';
      end if;
    end if;

    begin
      -- Append-only: a superseding version, never an update of the pending row.
$new$;
begin
  v_definition := pg_get_functiondef(v_sig::regprocedure);
  -- Same trap as section 3: v_new ENDS with the v_old preamble, so an
  -- already-guarded body still contains the needle exactly once and the count
  -- alone cannot detect a re-run. Assert first that this block's own guard
  -- text is absent; only an un-guarded body passes, so an isolated re-run
  -- fails closed. The exact-once count is kept as well.
  if position('would give the stable identity' in v_definition) > 0 then
    raise exception
      'issue #2576: api.db_data_admin_decide_property_match already carries the stable-identity write guard; this block is not re-runnable, re-derive from the current merged body';
  end if;
  v_hits := (length(v_definition) - length(replace(v_definition, v_old, '')))
            / nullif(length(v_old), 0);
  if v_hits is distinct from 1 then
    raise exception
      'issue #2576: expected exactly 1 append-only insert preamble to guard in api.db_data_admin_decide_property_match, found %; re-derive from the current merged body',
      coalesce(v_hits, 0);
  end if;
  execute replace(v_definition, v_old, v_new);
  if position('would give the stable identity' in pg_get_functiondef(v_sig::regprocedure)) = 0 then
    raise exception 'issue #2576: stable-identity write guard did not install';
  end if;
end
$migration$;

commit;
