-- derived-from: none
-- Claim popcre/shared-db#6605. Application issue u2giants/popdam3#1037, plan
-- docs/plans/issue-1037-typed-search-meaning-matching.md Step 3 (decisions D4,
-- D5, D6). Storage and work queue for PopDAM "text-meaning" vectors: one
-- Qwen/Qwen3-Embedding-0.6B vector (1024 dimensions, unit length, cosine) per
-- search document, built from a clean description of the product rather than
-- from its thumbnail. Nothing reads these vectors yet (Steps 5-6); the GPU
-- worker that fills them is Step 4.
--
-- What this adds (all additive; no existing column, index or function body of
-- the picture lane changes, and public.search_dam_documents is not touched):
--   dam.search_text_vectors        one vector per document, model stamped on
--                                  every row, HNSW (halfvec_cosine_ops) plus a
--                                  style-group-only partial HNSW.
--   dam.search_text_embed_jobs     its own queue and lease columns. The picture
--                                  lease columns on dam_search_documents are
--                                  never read or written (D5).
--   dam.search_text_embedding_input(text, uuid)
--                                  the text to embed: labelled lines, in plan
--                                  order, whitespace collapsed, at most 2,000
--                                  characters. Returns null when there is
--                                  nothing to say.
--   dam.enqueue_search_text_embedding()  trigger on dam_search_documents:
--                                  enqueues only when the embedding INPUT
--                                  changes. Invariant relied on: every field
--                                  the input reads also feeds search_text, so
--                                  the trigger fires on search_text changes
--                                  only; a thumbnail-only change never fires
--                                  it, and a search_text change that leaves
--                                  the input identical enqueues nothing.
--   four worker RPCs (claim / upsert / mark error / status), EXECUTE for
--   dam_image_embed_worker only; RLS on both tables with no policy; browser
--   and service roles get no table access.
--   public.get_search_embedding_health() gains a 'dam_text' corpus row (same
--   columns; existing rows unchanged) for the Production Canary.
--   admin_config SEARCH_TEXT_EMBEDDING_MODEL = the model stamp from Step 0.
--   No bulk backfill: existing documents are seeded into the queue in small
--   batches by the claim RPC, from a per-type cursor (dam.search_text_seed_state).
--
-- REISSUE of 20261204001000 (retired in production_migration_guard
-- HARD_BLOCKED). The original was applied to preview but its production apply
-- (run 44189714544) hit the server statement timeout after 2 minutes, almost
-- certainly on its single 183k-row backfill insert. This version drops that
-- insert, adds the seed cursor, and is idempotent so it also converges preview,
-- which already holds the original's objects and jobs.

begin;
set local lock_timeout = '20s';

-- ---------------------------------------------------------------- config
insert into public.admin_config(key, value)
values ('SEARCH_TEXT_EMBEDDING_MODEL',
        to_jsonb('Qwen/Qwen3-Embedding-0.6B@97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3'::text))
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function dam.search_text_embedding_model()
returns text
language sql stable security definer set search_path = ''
as $function$
  select nullif(btrim(c.value #>> '{}'), '')
    from public.admin_config c
   where c.key = 'SEARCH_TEXT_EMBEDDING_MODEL';
$function$;
revoke all on function dam.search_text_embedding_model() from public, anon, authenticated;

-- ---------------------------------------------------------------- tables
create table if not exists dam.search_text_vectors (
  document_type text not null,
  entity_id uuid not null,
  model text not null check (btrim(model) <> ''),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  embedding extensions.halfvec(1024) not null,
  embedded_at timestamptz not null default now(),
  primary key (document_type, entity_id),
  foreign key (document_type, entity_id)
    references public.dam_search_documents(document_type, entity_id) on update cascade on delete cascade
);
comment on table dam.search_text_vectors is
  'PopDAM text-meaning vectors (u2giants/popdam3#1037). One per search document; model stamp on every row. Independent of the picture vector (D5).';

create index if not exists search_text_vectors_embedding_hnsw
  on dam.search_text_vectors using hnsw (embedding extensions.halfvec_cosine_ops);
-- Style-group-only search must not walk an index dominated by 171k asset rows
-- (the picture side needed dam.search_group_vectors for the same reason).
-- Queries must use the literal document_type = 'style_group' to match it.
create index if not exists search_text_vectors_style_group_hnsw
  on dam.search_text_vectors using hnsw (embedding extensions.halfvec_cosine_ops)
  where document_type = 'style_group';

create table if not exists dam.search_text_embed_jobs (
  document_type text not null,
  entity_id uuid not null,
  input_sha256 text check (input_sha256 is null or input_sha256 ~ '^[0-9a-f]{64}$'),
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_retry_at timestamptz,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  error text,
  error_category text check (error_category is null or error_category in ('transient', 'permanent')),
  primary key (document_type, entity_id),
  foreign key (document_type, entity_id)
    references public.dam_search_documents(document_type, entity_id) on update cascade on delete cascade
);
comment on table dam.search_text_embed_jobs is
  'Work queue for dam.search_text_vectors. A row exists while a document needs (re-)embedding; it is deleted when its vector is written.';
-- Claim order: style groups first, then oldest.
create index if not exists search_text_embed_jobs_claim_idx
  on dam.search_text_embed_jobs ((document_type <> 'style_group'), enqueued_at, document_type, entity_id)
  where error_category is distinct from 'permanent';

-- Seed cursor: documents that existed before this migration enter the queue in
-- primary-key order, a batch per claim, so no statement ever touches all ~183k.
-- New and changed documents are queued by the trigger regardless.
create table if not exists dam.search_text_seed_state (
  document_type text primary key check (document_type in ('style_group', 'asset')),
  last_entity_id uuid,
  done boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into dam.search_text_seed_state(document_type) values ('style_group'), ('asset')
on conflict (document_type) do nothing;
alter table dam.search_text_seed_state enable row level security;
revoke all on dam.search_text_seed_state from public, anon, authenticated, service_role;

alter table dam.search_text_vectors enable row level security;
alter table dam.search_text_embed_jobs enable row level security;
revoke all on dam.search_text_vectors, dam.search_text_embed_jobs
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- input
create or replace function dam.search_text_embedding_input(p_document_type text, p_entity_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_lines text[];
  v_path text;
  v_parts text[];
  v_n integer;
  v_out text;
begin
  if p_document_type = 'style_group' then
    select array[
        'Product type: ' || nullif(concat_ws(', ', variadic array(
          select distinct on (lower(btrim(x))) btrim(x)
            from unnest(array[sg.product_category, sg.mg01_name, sg.mg02_name, sg.mg03_name]) with ordinality u(x, o)
           where nullif(btrim(x), '') is not null
           order by lower(btrim(x)), o)), ''),
        'Item description: ' || nullif(btrim(sg.item_description), ''),
        'Cover description: ' || nullif(btrim(sg.cover_description), ''),
        'AI description: ' || nullif(btrim(sg.group_ai_description), ''),
        'Licensor: ' || nullif(btrim(sg.licensor_name), ''),
        'Property: ' || nullif(btrim(sg.property_name), ''),
        'Characters: ' || nullif(ch.names, ''),
        'Customer: ' || nullif(btrim(sg.customer), ''),
        'Program: ' || nullif(btrim(sg.program), '')],
      sg.folder_path
      into v_lines, v_path
      from public.style_groups sg
      left join lateral (
        select string_agg(n.name, ', ' order by n.k) names
          from (select distinct on (lower(btrim(c.name))) lower(btrim(c.name)) k, btrim(c.name) name
                  from (select pc.name from public.assets a
                          join public.asset_characters ac on ac.asset_id = a.id
                          join public.characters pc on pc.id = ac.character_id
                         where a.style_group_id = sg.id and not a.is_deleted
                        union all
                        select lc.name from public.assets a
                          join public.asset_licensor_characters alc on alc.asset_id = a.id
                          join core.character lc on lc.id = alc.character_id
                         where a.style_group_id = sg.id and not a.is_deleted) c
                 where nullif(btrim(c.name), '') is not null
                 order by lower(btrim(c.name)), btrim(c.name)) n) ch on true
     where sg.id = p_entity_id;
    if not found then return null; end if;
  elsif p_document_type = 'asset' then
    -- Only fields that also feed the asset's search_text (enqueue invariant).
    select array[
        'Product type: ' || nullif(btrim(a.product_category), ''),
        'Item description: ' || nullif(btrim(sg.item_description), ''),
        'Cover description: ' || nullif(btrim(a.cover_description), ''),
        'AI description: ' || nullif(btrim(coalesce(nullif(btrim(a.ai_description), ''), sg.group_ai_description)), ''),
        'Licensor: ' || nullif(btrim(case when a.style_group_id is null then a.licensor_name else sg.licensor_name end), ''),
        'Property: ' || nullif(btrim(case when a.style_group_id is null then a.property_name else sg.property_name end), ''),
        'Characters: ' || nullif(ch.names, ''),
        'Customer: ' || nullif(btrim(a.customer), ''),
        'Program: ' || nullif(btrim(a.program), '')],
      -- Folders only: drop the file name when the path ends with it.
      case when a.filename is not null
                and right(regexp_replace(coalesce(a.relative_path, ''), '[/\\]+$', ''), length(a.filename)) = a.filename
           then left(regexp_replace(a.relative_path, '[/\\]+$', ''),
                     length(regexp_replace(a.relative_path, '[/\\]+$', '')) - length(a.filename))
           else a.relative_path end
      into v_lines, v_path
      from public.assets a
      left join public.style_groups sg on sg.id = a.style_group_id
      left join lateral (
        select string_agg(n.name, ', ' order by n.k) names
          from (select distinct on (lower(btrim(c.name))) lower(btrim(c.name)) k, btrim(c.name) name
                  from (select pc.name from public.asset_characters ac
                          join public.characters pc on pc.id = ac.character_id
                         where ac.asset_id = a.id
                        union all
                        select lc.name from public.asset_licensor_characters alc
                          join core.character lc on lc.id = alc.character_id
                         where alc.asset_id = a.id) c
                 where nullif(btrim(c.name), '') is not null
                 order by lower(btrim(c.name)), btrim(c.name)) n) ch on true
     where a.id = p_entity_id and not a.is_deleted;
    if not found then return null; end if;
  else
    return null;
  end if;

  -- Last four folders, separators turned into spaces.
  v_parts := array_remove(regexp_split_to_array(coalesce(v_path, ''), '[/\\]+'), '');
  v_n := coalesce(array_length(v_parts, 1), 0);
  if v_n > 0 then
    v_lines := v_lines || ('Folders: ' || array_to_string(v_parts[greatest(1, v_n - 3):v_n], ' '));
  end if;

  select string_agg(regexp_replace(btrim(l), '\s+', ' ', 'g'), E'\n' order by o)
    into v_out
    from unnest(v_lines) with ordinality u(l, o)
   where l is not null and btrim(l) <> '';
  -- Model input limit (Step 0): keep under about 2,000 characters.
  return nullif(btrim(left(v_out, 2000)), '');
end;
$function$;
revoke all on function dam.search_text_embedding_input(text, uuid) from public, anon, authenticated;
grant execute on function dam.search_text_embedding_input(text, uuid) to service_role;
comment on function dam.search_text_embedding_input(text, uuid) is
  'Clean text embedded for a PopDAM search document (popdam3#1037): labelled lines Product type, Item description, Cover description, AI description, Licensor, Property, Characters (distinct), Customer, Program, Folders (last four); whitespace collapsed; truncated to 2,000 characters; null when empty.';

-- ---------------------------------------------------------------- enqueue
create or replace function dam.enqueue_search_text_embedding()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_text text;
  v_sha text;
begin
  v_text := dam.search_text_embedding_input(new.document_type, new.entity_id);
  v_sha := case when v_text is null then null
                else encode(sha256(convert_to(v_text, 'UTF8')), 'hex') end;
  if v_sha is not null and exists (
       select 1 from dam.search_text_vectors v
        where v.document_type = new.document_type and v.entity_id = new.entity_id
          and v.input_sha256 = v_sha and v.model = dam.search_text_embedding_model()) then
    -- Input is back to what is already embedded: nothing to do.
    delete from dam.search_text_embed_jobs j
     where j.document_type = new.document_type and j.entity_id = new.entity_id;
    return null;
  end if;
  insert into dam.search_text_embed_jobs as j (document_type, entity_id, input_sha256)
  values (new.document_type, new.entity_id, v_sha)
  on conflict (document_type, entity_id) do update
     set input_sha256 = excluded.input_sha256, enqueued_at = now(), attempts = 0,
         next_retry_at = null, error = null, error_category = null,
         lease_token = null, lease_owner = null, lease_expires_at = null
   where j.input_sha256 is distinct from excluded.input_sha256;
  return null;
end;
$function$;
revoke all on function dam.enqueue_search_text_embedding() from public, anon, authenticated;

drop trigger if exists trg_enqueue_search_text_embedding_insert on public.dam_search_documents;
create trigger trg_enqueue_search_text_embedding_insert
  after insert on public.dam_search_documents
  for each row execute function dam.enqueue_search_text_embedding();
drop trigger if exists trg_enqueue_search_text_embedding_update on public.dam_search_documents;
create trigger trg_enqueue_search_text_embedding_update
  after update of search_text on public.dam_search_documents
  for each row when (old.search_text is distinct from new.search_text)
  execute function dam.enqueue_search_text_embedding();

-- ---------------------------------------------------------------- worker RPCs
create or replace function public.claim_dam_search_text_embedding_documents(
  p_limit integer default 50, p_worker_id text default null, p_lease_seconds integer default 300)
returns table(document_type text, entity_id uuid, input_text text, input_sha256 text, model text,
              lease_token uuid, lease_expires_at timestamptz, attempt integer)
language plpgsql security definer set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_model text := dam.search_text_embedding_model();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
  v_lease interval := make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 3600)));
  v_scanned integer := 0;
  v_claimed integer := 0;
  r record;
  v_text text;
  v_sha text;
  s record;
  v_want integer;
  v_got integer;
  v_last uuid;
begin
  if (coalesce((select auth.role()) = 'service_role', false)
      or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true
     or nullif(btrim(p_worker_id), '') is null then
    raise exception 'authorized embedding actor and worker id required' using errcode = '42501';
  end if;
  if v_model is null then
    raise exception 'admin_config SEARCH_TEXT_EMBEDDING_MODEL is not set' using errcode = '22023';
  end if;
  -- Seed pre-existing documents from the cursor, a bounded batch per claim
  -- (style groups first). A cursor row locked by another worker is skipped.
  v_want := v_limit * 4;
  for s in
    select st.document_type, st.last_entity_id
      from dam.search_text_seed_state st
     where not st.done
     order by (st.document_type <> 'style_group')
     for update skip locked
  loop
    exit when v_want <= 0;
    with batch as materialized (
      select d.document_type, d.entity_id
        from public.dam_search_documents d
       where d.document_type = s.document_type
         and (s.last_entity_id is null or d.entity_id > s.last_entity_id)
       order by d.entity_id
       limit v_want
    ), ins as (
      insert into dam.search_text_embed_jobs (document_type, entity_id)
      select b.document_type, b.entity_id
        from batch b
       where not exists (select 1 from dam.search_text_vectors v
                          where v.document_type = b.document_type and v.entity_id = b.entity_id
                            and v.model = v_model)
      on conflict on constraint search_text_embed_jobs_pkey do nothing
      returning 1
    )
    select (select count(*) from batch),
           (select b.entity_id from batch b order by b.entity_id desc limit 1)
      into v_got, v_last;
    update dam.search_text_seed_state st
       set last_entity_id = coalesce(v_last, st.last_entity_id), done = (v_got < v_want), updated_at = now()
     where st.document_type = s.document_type;
    v_want := v_want - v_got;
  end loop;
  for r in
    select j.document_type, j.entity_id
      from dam.search_text_embed_jobs j
     where j.error_category is distinct from 'permanent'
       and j.attempts < j.max_attempts
       and (j.next_retry_at is null or j.next_retry_at <= now())
       and (j.lease_expires_at is null or j.lease_expires_at <= now())
     order by (j.document_type <> 'style_group'), j.enqueued_at, j.document_type, j.entity_id
     for update skip locked
  loop
    exit when v_claimed >= v_limit or v_scanned >= v_limit * 4;
    v_scanned := v_scanned + 1;
    v_text := dam.search_text_embedding_input(r.document_type, r.entity_id);
    if v_text is null then
      update dam.search_text_embed_jobs j
         set input_sha256 = null, error = 'empty embedding input', error_category = 'permanent',
             lease_token = null, lease_owner = null, lease_expires_at = null, next_retry_at = null
       where j.document_type = r.document_type and j.entity_id = r.entity_id;
      continue;
    end if;
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
    if exists (select 1 from dam.search_text_vectors v
                where v.document_type = r.document_type and v.entity_id = r.entity_id
                  and v.input_sha256 = v_sha and v.model = v_model) then
      delete from dam.search_text_embed_jobs j
       where j.document_type = r.document_type and j.entity_id = r.entity_id;
      continue;
    end if;
    update dam.search_text_embed_jobs j
       set input_sha256 = v_sha, lease_token = gen_random_uuid(), lease_owner = left(p_worker_id, 200),
           lease_expires_at = now() + v_lease, attempts = j.attempts + 1
     where j.document_type = r.document_type and j.entity_id = r.entity_id
    returning j.document_type, j.entity_id, v_text, j.input_sha256, v_model,
              j.lease_token, j.lease_expires_at, j.attempts
      into document_type, entity_id, input_text, input_sha256, model,
           lease_token, lease_expires_at, attempt;
    v_claimed := v_claimed + 1;
    return next;
  end loop;
end;
$function$;

create or replace function public.upsert_dam_search_text_embedding(
  p_document_type text, p_entity_id uuid, p_input_sha256 text, p_lease_token uuid,
  p_embedding extensions.halfvec, p_model text)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  v_model text := dam.search_text_embedding_model();
begin
  if (coalesce((select auth.role()) = 'service_role', false)
      or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true then
    raise exception 'authorized embedding actor required' using errcode = '42501';
  end if;
  if p_model is distinct from v_model then
    raise exception 'embedding model % does not match SEARCH_TEXT_EMBEDDING_MODEL', p_model using errcode = '22023';
  end if;
  if p_embedding is null or extensions.vector_dims(p_embedding) <> 1024 then
    raise exception 'text embedding must have 1024 dimensions' using errcode = '22023';
  end if;
  delete from dam.search_text_embed_jobs j
   where j.document_type = p_document_type and j.entity_id = p_entity_id
     and j.input_sha256 = p_input_sha256 and j.lease_token = p_lease_token
     and j.lease_expires_at > now();
  if not found then return false; end if;
  insert into dam.search_text_vectors as v (document_type, entity_id, model, input_sha256, embedding, embedded_at)
  values (p_document_type, p_entity_id, p_model, p_input_sha256, p_embedding, now())
  on conflict (document_type, entity_id) do update
     set model = excluded.model, input_sha256 = excluded.input_sha256,
         embedding = excluded.embedding, embedded_at = excluded.embedded_at;
  return true;
end;
$function$;

create or replace function public.mark_dam_search_text_embedding_error(
  p_document_type text, p_entity_id uuid, p_input_sha256 text, p_lease_token uuid,
  p_error text, p_category text default 'transient')
returns boolean
language plpgsql security definer set search_path = ''
as $function$
begin
  if (coalesce((select auth.role()) = 'service_role', false)
      or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true then
    raise exception 'authorized embedding actor required' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('transient', 'permanent') then
    raise exception 'invalid embedding error category' using errcode = '22023';
  end if;
  update dam.search_text_embed_jobs j
     set error = left(coalesce(p_error, 'unknown embedding error'), 1000),
         error_category = case when p_category = 'permanent' or j.attempts >= j.max_attempts
                               then 'permanent' else 'transient' end,
         next_retry_at = case when p_category = 'transient' and j.attempts < j.max_attempts
                              then now() + make_interval(secs => least(3600, 30 * (2 ^ greatest(0, j.attempts - 1))::int)) end,
         lease_token = null, lease_owner = null, lease_expires_at = null
   where j.document_type = p_document_type and j.entity_id = p_entity_id
     and j.input_sha256 = p_input_sha256 and j.lease_token = p_lease_token
     and j.lease_expires_at > now();
  return found;
end;
$function$;

create or replace function public.get_dam_search_text_embedding_status()
returns table(model text, total_documents bigint, embedded_documents bigint,
              current_model_documents bigint, pending_documents bigint, leased_documents bigint,
              errored_documents bigint, exhausted_documents bigint,
              oldest_pending_enqueued_at timestamptz, last_embedded_at timestamptz)
language sql stable security definer set search_path = ''
as $function$
  with m as (select dam.search_text_embedding_model() model),
  v as (select count(*) n, count(*) filter (where v.model = (select model from m)) cur, max(v.embedded_at) last
          from dam.search_text_vectors v),
  j as (select count(*) filter (where j.attempts < j.max_attempts and j.error_category is distinct from 'permanent') pending,
               count(*) filter (where j.lease_expires_at > now()) leased,
               count(*) filter (where j.error is not null) errored,
               count(*) filter (where j.attempts >= j.max_attempts or j.error_category = 'permanent') exhausted,
               min(j.enqueued_at) filter (where j.attempts < j.max_attempts and j.error_category is distinct from 'permanent') oldest
          from dam.search_text_embed_jobs j),
  -- Documents not yet reached by the seed cursor count as pending too.
  u as (select count(*) unseeded
          from dam.search_text_seed_state st
          join public.dam_search_documents d
            on d.document_type = st.document_type
           and (st.last_entity_id is null or d.entity_id > st.last_entity_id)
         where not st.done
           and not exists (select 1 from dam.search_text_embed_jobs j
                            where j.document_type = d.document_type and j.entity_id = d.entity_id)
           and not exists (select 1 from dam.search_text_vectors v
                            where v.document_type = d.document_type and v.entity_id = d.entity_id))
  select (select model from m), (select count(*) from public.dam_search_documents),
         v.n, v.cur, j.pending + u.unseeded, j.leased, j.errored, j.exhausted, j.oldest, v.last
    from v, j, u;
$function$;

revoke all on function public.claim_dam_search_text_embedding_documents(integer, text, integer),
                       public.upsert_dam_search_text_embedding(text, uuid, text, uuid, extensions.halfvec, text),
                       public.mark_dam_search_text_embedding_error(text, uuid, text, uuid, text, text),
                       public.get_dam_search_text_embedding_status()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_dam_search_text_embedding_documents(integer, text, integer),
                          public.upsert_dam_search_text_embedding(text, uuid, text, uuid, extensions.halfvec, text),
                          public.mark_dam_search_text_embedding_error(text, uuid, text, uuid, text, text),
                          public.get_dam_search_text_embedding_status()
  to dam_image_embed_worker;
-- The definer RPCs call these helpers as their owner; the worker needs no direct grant.
grant usage on schema dam to dam_image_embed_worker;

-- ---------------------------------------------------------------- health
-- Same signature and columns; adds corpus 'dam_text'. Pending excludes jobs
-- that can never drain (exhausted or permanent), as for the other corpora.
create or replace function public.get_search_embedding_health()
returns table(corpus text, pending bigint, errored bigint, last_write timestamptz,
              minutes_since_last_write numeric, stale boolean)
language plpgsql stable security definer set search_path = public
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role'
     and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role'
     and not coalesce(public.has_role(auth.uid(),'admin'),false) then
    raise exception 'admin required' using errcode='42501';
  end if;
  return query
  with sg_jobs as (
    select j.*
      from public.style_guide_search_embedding_jobs j
      join public.style_guide_search_documents d
        on d.style_guide_file_id = j.style_guide_file_id
       and d.content_sha256 = j.content_sha256
       and d.embedding is null
  ), counts as (
    select 'dam'::text name,
      (select count(*) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) pending_count,
      (select count(*) from public.dam_search_documents d where d.embedding_error is not null) error_count,
      (select max(d.embedding_updated_at) from public.dam_search_documents d where d.embedding_updated_at is not null) written,
      (select min(d.indexed_at) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) oldest
    union all
    select 'popsg',
      (select count(*) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null)),
      (select count(*) from sg_jobs j where j.error is not null),
      (select max(d.embedding_updated_at) from public.style_guide_search_documents d where d.is_active and d.embedding_updated_at is not null),
      (select min(d.document_updated_at) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null))
    union all
    select 'dam_text',
      (select pending_documents from public.get_dam_search_text_embedding_status()),
      (select count(*) from dam.search_text_embed_jobs j where j.error is not null),
      (select max(v.embedded_at) from dam.search_text_vectors v),
      (select min(j.enqueued_at) from dam.search_text_embed_jobs j
       where j.attempts<j.max_attempts and j.error_category is distinct from 'permanent')
  )
  select name,pending_count,error_count,written,extract(epoch from(now()-written))/60,
    pending_count>0 and (coalesce(written,oldest) is null or coalesce(written,oldest)<=now()-interval '120 minutes')
  from counts;
end;
$function$;

-- ---------------------------------------------------------------- verify
do $verify$
declare f text;
begin
  foreach f in array array[
    'public.claim_dam_search_text_embedding_documents(integer, text, integer)',
    'public.upsert_dam_search_text_embedding(text, uuid, text, uuid, extensions.halfvec, text)',
    'public.mark_dam_search_text_embedding_error(text, uuid, text, uuid, text, text)',
    'public.get_dam_search_text_embedding_status()'] loop
    if not has_function_privilege('dam_image_embed_worker', f, 'execute') then
      raise exception 'VERIFY FAILED: dam_image_embed_worker lacks execute on %', f;
    end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'VERIFY FAILED: a browser role may execute %', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'dam.search_text_vectors', 'select')
     or has_table_privilege('anon', 'dam.search_text_vectors', 'select') then
    raise exception 'VERIFY FAILED: a browser role can read dam.search_text_vectors';
  end if;
end
$verify$;

commit;
