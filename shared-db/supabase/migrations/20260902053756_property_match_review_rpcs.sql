-- Issue #2008 (structural half of #2007): DB Data Admin needs a reviewable
-- property-match queue and a decision write path that cannot be reached without
-- a licensing-manager JWT and cannot rewrite a recorded decision.
-- derived-from: none
--
-- Both objects are brand new. Nothing here re-derives an existing body, alters a
-- table, changes an existing grant or policy, or loads a single row. The pending
-- candidate rows themselves are source-data work and stay in the private
-- u2giants/licensor-source-data repository.
--
-- Design notes that matter for review:
--
-- * plm.dcp_opa_property_resolution is append-only, enforced by ALWAYS triggers
--   that even the table owner cannot bypass. A decision is therefore recorded by
--   INSERTING a superseding version, never by updating the pending row. The
--   existing UNIQUE (supersedes_resolution_id) constraint means one pending row
--   can be superseded exactly once, which is the database-level backstop behind
--   the idempotency logic below.
--
-- * The reviewer identity comes from the JWT and from nowhere else. There is
--   deliberately NO actor parameter and deliberately NO session_user fallback:
--   either identity source would let a caller record a decision under somebody
--   else's name.
--
-- * Idempotency is carried by p_client_request_id, which BECOMES the new
--   decision's resolution_id. A retried call therefore collides with a primary
--   key that already exists, and the function returns the recorded decision
--   unchanged instead of appending a second version. No new column is needed
--   and no schema change is made.
--
-- * The queue derives NO authority-conflict verdict. Conflict presentation lives
--   in api.db_data_admin_scraped_properties, which issue #1999 already corrected
--   so that a Marvel contract assertion over a Disney OPA scope is not a
--   permanent conflict. Recomputing that verdict here would require reading
--   plm.opa_property_scope_membership, which this issue does not authorize, and
--   would create a second copy of a rule that must have exactly one home.

create or replace function api.db_data_admin_property_match_queue(
  p_search text default null::text,
  p_cursor text default null::text,
  p_page_size integer default null::integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog
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
        'candidates', coalesce(c.candidates, '[]'::jsonb)
      ) order by n.rn
    ) filter (where n.rn <= v_page_size), '[]'::jsonb),
    count(*)::integer,
    max(n.row_key) filter (where n.rn = v_page_size)
  into v_rows, v_fetched, v_last_key
  from numbered n
  left join candidates c on c.resolution_id = n.resolution_id
  left join prior pr on pr.pending_resolution_id = n.resolution_id;

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
  'Read-only, licensing-manager-gated review queue of exact DCP source Property identities whose LATEST resolution version is still pending. Returns the pending decision''s own evidence references and hashes, its proposed OPA candidate members, and the previously approved version for context. Stable keyset pages over source_table|source_system|source_property_id. Derives no authority verdict: conflict presentation stays in api.db_data_admin_scraped_properties, which issue #1999 already corrected for Marvel contract assertions over Disney OPA scope.';

revoke all on function api.db_data_admin_property_match_queue(text, text, integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_property_match_queue(text, text, integer)
  to authenticated;

create or replace function api.db_data_admin_decide_property_match(
  p_resolution_id uuid,
  p_decision text,
  p_licensed_property_ids bigint[],
  p_decision_reason text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $function$
declare
  v_actor text;
  v_decision text;
  v_status text;
  v_reason text;
  v_ids bigint[];
  v_existing plm.dcp_opa_property_resolution%rowtype;
  v_existing_ids bigint[];
  v_pending plm.dcp_opa_property_resolution%rowtype;
  v_written plm.dcp_opa_property_resolution%rowtype;
  v_repeat boolean := false;
begin
  perform app.require_licensing_manager_access();

  -- The reviewer is whoever holds the JWT, and nobody else.
  v_actor := coalesce(
    nullif(btrim(auth.uid()::text), ''),
    nullif(btrim(coalesce(current_setting('request.jwt.claim.sub', true), '')), '')
  );
  if v_actor is null then
    raise exception 'db_data_admin: a property match decision requires an authenticated reviewer'
      using errcode = 'insufficient_privilege';
  end if;

  if p_resolution_id is null or p_client_request_id is null then
    raise exception 'db_data_admin: resolution id and client request id are both required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_resolution_id = p_client_request_id then
    raise exception 'db_data_admin: the client request id may not reuse the decided resolution id'
      using errcode = 'invalid_parameter_value';
  end if;

  v_decision := lower(btrim(coalesce(p_decision, '')));
  if v_decision not in ('approve', 'reject') then
    raise exception 'db_data_admin: decision must be approve or reject'
      using errcode = 'invalid_parameter_value';
  end if;
  v_status := case v_decision when 'approve' then 'approved' else 'rejected' end;

  v_reason := nullif(btrim(coalesce(p_decision_reason, '')), '');
  if v_reason is null then
    raise exception 'db_data_admin: a decision reason is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}'::bigint[])
    into v_ids
  from unnest(coalesce(p_licensed_property_ids, '{}'::bigint[])) x
  where x is not null;

  if v_status = 'rejected' and array_length(v_ids, 1) is not null then
    raise exception 'db_data_admin: a rejection selects no OPA members'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Idempotent repeat. The client request id IS the new decision's primary key,
  -- so a retry of the identical call finds its own recorded decision and returns
  -- it. A DIFFERENT call reusing a spent request id is a caller bug and fails.
  select * into v_existing
  from plm.dcp_opa_property_resolution
  where resolution_id = p_client_request_id;

  if found then
    select coalesce(array_agg(m.licensed_property_id order by m.licensed_property_id), '{}'::bigint[])
      into v_existing_ids
    from plm.dcp_opa_property_resolution_member m
    where m.resolution_id = p_client_request_id;

    if v_existing.supersedes_resolution_id is distinct from p_resolution_id
       or v_existing.approval_status <> v_status
       or v_existing_ids is distinct from v_ids then
      raise exception 'db_data_admin: this client request id already recorded a different decision'
        using errcode = 'unique_violation';
    end if;

    v_written := v_existing;
    v_repeat := true;
  else
    select * into v_pending
    from plm.dcp_opa_property_resolution
    where resolution_id = p_resolution_id
    for share;

    if not found then
      raise exception 'db_data_admin: no such resolution'
        using errcode = 'no_data_found';
    end if;
    if v_pending.approval_status <> 'pending' then
      raise exception 'db_data_admin: resolution % is already %',
        p_resolution_id, v_pending.approval_status
        using errcode = 'restrict_violation';
    end if;
    if exists (
      select 1 from plm.dcp_opa_property_resolution newer
      where newer.supersedes_resolution_id = v_pending.resolution_id
    ) then
      raise exception 'db_data_admin: resolution % has already been superseded',
        p_resolution_id
        using errcode = 'restrict_violation';
    end if;

    begin
      -- Append-only: a superseding version, never an update of the pending row.
      insert into plm.dcp_opa_property_resolution (
        resolution_id, source_system, source_table, source_property_id,
        decision_version, approval_status, supersedes_resolution_id,
        evidence_reference, evidence_sha256, decision_reason,
        contract_asserted_studio_code, contract_evidence_reference,
        contract_evidence_sha256, approved_at, approved_by
      ) values (
        p_client_request_id, v_pending.source_system, v_pending.source_table,
        v_pending.source_property_id, v_pending.decision_version + 1, v_status,
        v_pending.resolution_id, v_pending.evidence_reference,
        v_pending.evidence_sha256, v_reason,
        v_pending.contract_asserted_studio_code,
        v_pending.contract_evidence_reference, v_pending.contract_evidence_sha256,
        case when v_status = 'approved' then clock_timestamp() end,
        case when v_status = 'approved' then v_actor end
      )
      returning * into v_written;

      -- Members belong to the SUPERSEDING version and are written inside the
      -- same call as the decision itself.
      insert into plm.dcp_opa_property_resolution_member (
        resolution_id, licensed_property_id, member_ordinal
      )
      select v_written.resolution_id, s.licensed_property_id, s.member_ordinal
      from (
        select u as licensed_property_id,
               row_number() over (order by u)::integer as member_ordinal
        from unnest(v_ids) u
      ) s;
    exception when unique_violation then
      -- A concurrent caller got there first. Either it was this exact request
      -- (return its decision) or somebody else decided the same pending row.
      select * into v_existing
      from plm.dcp_opa_property_resolution
      where resolution_id = p_client_request_id;

      if not found then
        raise exception 'db_data_admin: resolution % was decided concurrently',
          p_resolution_id
          using errcode = 'serialization_failure';
      end if;

      -- The winner used THIS client request id. It is only a safe repeat when it
      -- recorded the same decision on the same pending row with the same member
      -- set. A different decision reusing a spent request id must fail loudly
      -- rather than silently returning somebody else's verdict.
      select coalesce(array_agg(m.licensed_property_id order by m.licensed_property_id), '{}'::bigint[])
        into v_existing_ids
      from plm.dcp_opa_property_resolution_member m
      where m.resolution_id = p_client_request_id;

      if v_existing.supersedes_resolution_id is distinct from p_resolution_id
         or v_existing.approval_status <> v_status
         or v_existing_ids is distinct from v_ids then
        raise exception 'db_data_admin: this client request id already recorded a different decision'
          using errcode = 'unique_violation';
      end if;

      v_written := v_existing;
      v_repeat := true;
    end;
  end if;

  return jsonb_build_object(
    'resolution_id', v_written.resolution_id,
    'source_system', v_written.source_system,
    'source_table', v_written.source_table,
    'source_property_id', v_written.source_property_id,
    'decision_version', v_written.decision_version,
    'approval_status', v_written.approval_status,
    'supersedes_resolution_id', v_written.supersedes_resolution_id,
    'decision_reason', v_written.decision_reason,
    'evidence_reference', v_written.evidence_reference,
    'evidence_sha256', v_written.evidence_sha256,
    'contract_asserted_studio_code', v_written.contract_asserted_studio_code,
    'approved_at', v_written.approved_at,
    'approved_by', v_written.approved_by,
    'created_at', v_written.created_at,
    'idempotent_repeat', v_repeat,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'licensed_property_id', m.licensed_property_id,
               'member_ordinal', m.member_ordinal
             ) order by m.member_ordinal)
      from plm.dcp_opa_property_resolution_member m
      where m.resolution_id = v_written.resolution_id
    ), '[]'::jsonb)
  );
end;
$function$;

comment on function api.db_data_admin_decide_property_match(uuid, text, bigint[], text, uuid) is
  'Licensing-manager-gated, idempotent approve/reject decision for one pending DCP-to-OPA property resolution. Appends a superseding version rather than editing the pending row, stamps the approving reviewer from the JWT alone, and writes the selected OPA members in the same call. p_client_request_id becomes the new version''s resolution_id, so a retry returns the recorded decision instead of appending a second one; reusing a spent request id for a different decision fails. The table''s dcp_opa_property_resolution_approved_shape_ck constraint permits approved_by only on an approved row, so a rejection records no reviewer column; changing that needs a separately authorized table change.';

revoke all on function api.db_data_admin_decide_property_match(uuid, text, bigint[], text, uuid)
  from public, anon, service_role;
grant execute on function api.db_data_admin_decide_property_match(uuid, text, bigint[], text, uuid)
  to authenticated;

-- Post-apply truth. Reads no rows and emits no values.
do $verify$
declare
  v_signatures text[] := array[
    'api.db_data_admin_property_match_queue(text,text,integer)',
    'api.db_data_admin_decide_property_match(uuid,text,bigint[],text,uuid)'
  ];
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array v_signatures loop
    if to_regprocedure(v_signature) is null then
      raise exception '% was not created', v_signature;
    end if;
    v_definition := lower(pg_get_functiondef(v_signature::regprocedure));
    if position('security definer' in v_definition) = 0 then
      raise exception '% is not security definer', v_signature;
    end if;
    if position('search_path' in v_definition) = 0
       or position('pg_catalog' in v_definition) = 0 then
      raise exception '% does not pin its search_path', v_signature;
    end if;
    if position('app.require_licensing_manager_access' in v_definition) = 0 then
      raise exception '% is not licensing-manager gated', v_signature;
    end if;
    if has_function_privilege('anon', v_signature::regprocedure, 'EXECUTE')
       or has_function_privilege('public', v_signature::regprocedure, 'EXECUTE')
       or has_function_privilege('service_role', v_signature::regprocedure, 'EXECUTE') then
      raise exception '% is executable by a role the gate does not require', v_signature;
    end if;
    if not has_function_privilege('authenticated', v_signature::regprocedure, 'EXECUTE') then
      raise exception '% is missing its authenticated grant', v_signature;
    end if;
  end loop;

  v_definition := lower(pg_get_functiondef(
    'api.db_data_admin_decide_property_match(uuid,text,bigint[],text,uuid)'::regprocedure));
  if position('session_user' in v_definition) <> 0 then
    raise exception 'the decision RPC accepts a non-JWT actor identity';
  end if;
  if position('update plm.dcp_opa_property_resolution' in v_definition) <> 0
     or position('delete from plm.dcp_opa_property_resolution' in v_definition) <> 0 then
    raise exception 'the decision RPC mutates the append-only decision ledger';
  end if;
end;
$verify$;
