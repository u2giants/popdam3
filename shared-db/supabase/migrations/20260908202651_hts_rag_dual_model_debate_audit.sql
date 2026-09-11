-- Durable service-only audit contract for HTS dual-model debate promotion (#2535).
-- RAG remains decision support; this migration does not make a recommendation operative
-- and does not alter the manual Apply path or any authoritative duty-rate field.
-- derived-from: none

create table public.hts_rag_debate_runs (
  id uuid primary key default gen_random_uuid(),
  source_determination_id uuid not null
    references public.hts_rag_determinations(id) on delete restrict,
  session_id uuid not null,
  policy_version text not null check (btrim(policy_version) <> ''),
  case_packet_hash text not null check (case_packet_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in (
      'pending', 'claimed', 'initial_opinions', 'debating', 'final_votes',
      'gating', 'promoted', 'not_proven', 'failed', 'dead_letter'
    )),
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  turn_count integer not null default 0 check (turn_count >= 0),
  evidence_expansion_count integer not null default 0
    check (evidence_expansion_count >= 0),
  spark_initial_code text check (spark_initial_code is null or spark_initial_code ~ '^[0-9]{10}$'),
  luna_initial_code text check (luna_initial_code is null or luna_initial_code ~ '^[0-9]{10}$'),
  spark_final_code text check (spark_final_code is null or spark_final_code ~ '^[0-9]{10}$'),
  luna_final_code text check (luna_final_code is null or luna_final_code ~ '^[0-9]{10}$'),
  consensus_code text check (consensus_code is null or consensus_code ~ '^[0-9]{10}$'),
  stop_reason text check (stop_reason is null or stop_reason in (
    'converged', 'needs_more_facts', 'deadlocked', 'degraded', 'circuit_breaker'
  )),
  evidence_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence_result) = 'object'),
  gate_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(gate_result) = 'object'),
  precedent_id uuid references public.hts_rag_precedents(id) on delete restrict,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint hts_rag_debate_runs_determination_policy_uq
    unique (source_determination_id, policy_version),
  constraint hts_rag_debate_runs_promoted_chk check (
    status <> 'promoted'
    or (
      consensus_code is not null
      and precedent_id is not null
      and gate_result @> '{"passed": true}'::jsonb
    )
  ),
  constraint hts_rag_debate_runs_terminal_completed_chk check (
    status not in ('promoted', 'not_proven', 'failed', 'dead_letter')
    or completed_at is not null
  )
);

create index hts_rag_debate_runs_claim_idx
  on public.hts_rag_debate_runs (status, lease_expires_at)
  where status in ('pending', 'claimed');

create index hts_rag_debate_runs_source_determination_idx
  on public.hts_rag_debate_runs (source_determination_id);

create index hts_rag_debate_runs_precedent_idx
  on public.hts_rag_debate_runs (precedent_id)
  where precedent_id is not null;

create trigger set_updated_at
before update on public.hts_rag_debate_runs
for each row execute function app.set_updated_at();

alter table public.hts_rag_precedents
  add column promotion_basis text not null default 'legacy_unspecified'
    constraint hts_rag_precedents_promotion_basis_chk
    check (promotion_basis in ('human_review', 'dual_model_verified', 'legacy_unspecified')),
  add column promotion_policy_version text
    constraint hts_rag_precedents_promotion_policy_version_chk
    check (promotion_policy_version is null or btrim(promotion_policy_version) <> ''),
  add column promotion_source_determination_id uuid
    constraint hts_rag_precedents_promotion_source_determination_id_fkey
    references public.hts_rag_determinations(id) on delete restrict,
  add column promotion_debate_run_id uuid
    constraint hts_rag_precedents_promotion_debate_run_id_fkey
    references public.hts_rag_debate_runs(id) on delete restrict,
  add column promotion_gate_result jsonb
    constraint hts_rag_precedents_promotion_gate_result_chk
    check (promotion_gate_result is null or jsonb_typeof(promotion_gate_result) = 'object'),
  add constraint hts_rag_precedents_dual_model_provenance_chk check (
    promotion_basis <> 'dual_model_verified'
    or (
      promotion_debate_run_id is not null
      and promotion_policy_version is not null
      and promotion_gate_result is not null
    )
  );

create function public.enforce_hts_rag_precedent_promotion_gate_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.promotion_gate_result is not null
     and new.promotion_gate_result is distinct from old.promotion_gate_result then
    raise exception using
      errcode = '23514',
      message = 'hts_rag_precedents.promotion_gate_result is immutable once set';
  end if;
  return new;
end
$function$;

revoke all on function public.enforce_hts_rag_precedent_promotion_gate_immutable()
  from public, anon, authenticated;

create trigger hts_rag_precedents_promotion_gate_immutable
before update of promotion_gate_result on public.hts_rag_precedents
for each row execute function public.enforce_hts_rag_precedent_promotion_gate_immutable();

alter table public.hts_rag_debate_runs enable row level security;

revoke all on public.hts_rag_debate_runs from public, anon, authenticated, service_role;
grant select, insert on public.hts_rag_debate_runs to service_role;
grant update (
  status,
  claimed_at,
  claimed_by,
  lease_expires_at,
  attempt_count,
  turn_count,
  evidence_expansion_count,
  spark_initial_code,
  luna_initial_code,
  spark_final_code,
  luna_final_code,
  consensus_code,
  stop_reason,
  evidence_result,
  gate_result,
  precedent_id,
  error_code,
  error_detail,
  completed_at
) on public.hts_rag_debate_runs to service_role;

create policy hts_rag_debate_runs_backend_read
  on public.hts_rag_debate_runs
  for select to service_role
  using (true);

create policy hts_rag_debate_runs_backend_insert
  on public.hts_rag_debate_runs
  for insert to service_role
  with check (true);

create policy hts_rag_debate_runs_backend_update
  on public.hts_rag_debate_runs
  for update to service_role
  using (true)
  with check (true);

comment on table public.hts_rag_debate_runs is
  'Service-only, append-preserved HTS dual-model debate audit. No browser role has access and no application role may delete records. Raw provider payloads and licensed product descriptions do not belong here.';

comment on column public.hts_rag_precedents.promotion_basis is
  'Typed promotion provenance. Rows predating this contract remain legacy_unspecified unless separate durable row-specific evidence supports another value.';

comment on column public.hts_rag_precedents.promotion_gate_result is
  'Bounded promotion-policy result. It may be set once and is immutable after its first non-null value.';

do $verify$
declare
  v_columns text;
  v_update_columns text;
  v_count integer;
begin
  if to_regclass('public.hts_rag_debate_runs') is null then
    raise exception 'public.hts_rag_debate_runs is missing';
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
    into v_columns
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'hts_rag_precedents'
     and column_name like 'promotion_%';
  if v_columns <> 'promotion_basis,promotion_policy_version,promotion_source_determination_id,promotion_debate_run_id,promotion_gate_result' then
    raise exception 'promotion provenance columns are incomplete or out of order: %', coalesce(v_columns, '<none>');
  end if;

  if exists (
    select 1
      from public.hts_rag_precedents
     where promotion_basis <> 'legacy_unspecified'
  ) then
    raise exception 'existing precedents were assigned inferred promotion provenance';
  end if;

  select count(*) into v_count
    from pg_constraint
   where connamespace = 'public'::regnamespace
     and conname in (
       'hts_rag_debate_runs_determination_policy_uq',
       'hts_rag_debate_runs_promoted_chk',
       'hts_rag_debate_runs_terminal_completed_chk',
       'hts_rag_precedents_promotion_basis_chk',
       'hts_rag_precedents_promotion_policy_version_chk',
       'hts_rag_precedents_promotion_source_determination_id_fkey',
       'hts_rag_precedents_promotion_debate_run_id_fkey',
       'hts_rag_precedents_promotion_gate_result_chk',
       'hts_rag_precedents_dual_model_provenance_chk'
     );
  if v_count <> 9 then
    raise exception 'expected nine named promotion/debate constraints, got %', v_count;
  end if;

  if exists (
    select 1
      from pg_constraint fk
      join pg_class source_table on source_table.oid = fk.conrelid
      join pg_namespace source_schema on source_schema.oid = source_table.relnamespace
      join pg_class target_table on target_table.oid = fk.confrelid
      join pg_namespace target_schema on target_schema.oid = target_table.relnamespace
     where fk.contype = 'f'
       and fk.conname in (
         'hts_rag_debate_runs_source_determination_id_fkey',
         'hts_rag_debate_runs_precedent_id_fkey',
         'hts_rag_precedents_promotion_source_determination_id_fkey',
         'hts_rag_precedents_promotion_debate_run_id_fkey'
       )
       and (source_schema.nspname <> 'public' or target_schema.nspname <> 'public')
  ) then
    raise exception 'an HTS debate foreign key is not local to the public schema';
  end if;

  select count(*) into v_count
    from pg_indexes
   where schemaname = 'public'
     and indexname in (
       'hts_rag_debate_runs_claim_idx',
       'hts_rag_debate_runs_source_determination_idx',
       'hts_rag_debate_runs_precedent_idx'
     );
  if v_count <> 3 then
    raise exception 'expected three explicit debate-run indexes, got %', v_count;
  end if;

  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'hts_rag_debate_runs'
       and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.hts_rag_debate_runs';
  end if;

  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'hts_rag_debate_runs'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception 'a browser or PUBLIC role can access public.hts_rag_debate_runs';
  end if;

  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'hts_rag_debate_runs'
       and grantee = 'service_role'
       and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
  ) then
    raise exception 'service_role has a table-wide mutation privilege on public.hts_rag_debate_runs';
  end if;

  select string_agg(column_name, ',' order by column_name)
    into v_update_columns
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'hts_rag_debate_runs'
     and grantee = 'service_role'
     and privilege_type = 'UPDATE';
  if v_update_columns <> 'attempt_count,claimed_at,claimed_by,completed_at,consensus_code,error_code,error_detail,evidence_expansion_count,evidence_result,gate_result,lease_expires_at,luna_final_code,luna_initial_code,precedent_id,spark_final_code,spark_initial_code,status,stop_reason,turn_count' then
    raise exception 'service_role debate-run update columns differ from the bounded worker set: %', coalesce(v_update_columns, '<none>');
  end if;

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename = 'hts_rag_debate_runs'
     and policyname in (
       'hts_rag_debate_runs_backend_read',
       'hts_rag_debate_runs_backend_insert',
       'hts_rag_debate_runs_backend_update'
     )
     and roles = array['service_role']::name[];
  if v_count <> 3 then
    raise exception 'expected three service-only debate-run policies, got %', v_count;
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.hts_rag_precedents'::regclass
       and tgname = 'hts_rag_precedents_promotion_gate_immutable'
       and not tgisinternal
  ) then
    raise exception 'promotion_gate_result immutability trigger is missing';
  end if;
end
$verify$;
