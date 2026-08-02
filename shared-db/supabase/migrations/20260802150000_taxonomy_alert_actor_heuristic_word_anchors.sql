-- =====================================================================================
-- Post-review hardening of the acknowledgement path added by 20260802140000.
--
-- WHY A THIRD FILE. 20260802140000 and 20260802141000 are already applied to preview.
-- Supabase's ledger keys on the VERSION, so editing either would change the repo without
-- changing the database and desync file from ledger. Every fix is FORWARD (AGENTS.md §4
-- rule 4). This file is not yet applied anywhere.
--
-- Two changes, from two independent sources.
--
-- =====================================================================================
-- CHANGE 1 — word-anchor the automation-name heuristic (found by exercising it on preview)
-- =====================================================================================
-- plm.taxonomy_alert_actor_looks_automated() matched several tokens as bare substrings, or
-- as words short enough for ordinary names to collide with. Verified misfires on preview
-- 2026-08-02, by calling the function rather than by reading it:
--
--   'Abbot'          -> true   (matched `bot\M`)
--   'Talbot'         -> true   (matched `bot\M`)
--   'Ai Tanaka'      -> true   (matched `\mai\M`)
--   'Job Vermeulen'  -> true   (matched `job\M`)
--   'Scriptor'       -> true   (matched `script`)
--   'Cronin'         -> true   (matched `cron`)
--
-- GLM 5.2's independent review found the same class of defect by inspection, and added
-- 'Botany' (matched `\mbot`).
--
-- This is fail-CLOSED, not fail-open, so nothing was ever wrongly acknowledged. It is still
-- a real bug: a person named Abbot could not acknowledge an alert at all, and the error
-- message told them to record themselves as actor_type = 'automation', which would have put
-- a FALSE automation label into the permanent audit record. A guard that pushes a human
-- towards a wrong self-description is worse than no guard.
--
-- Fix: two tiers. Short or name-like tokens must match as WHOLE WORDS; only unambiguous
-- compound machine markers stay as substrings. Bare `ai`, `ci` and `job` are dropped — they
-- are false-positive magnets, and every automation this repo runs is already caught by
-- `agent`, `workflow`, `github-actions`, `cron` or `service_role`.
--
-- =====================================================================================
-- CHANGE 2 — bind actor_type to the effective database role (GLM 5.2 review, question 4)
-- =====================================================================================
-- GLM's finding, verbatim: "A `service_role`/CI caller can mint `actor_type='human'`,
-- `actor='John Smith'` as long as the name evades the regex — and the regex only catches
-- obvious bot tokens, so any normal human name passes. […] Fix: tie `actor_type` to the
-- effective role — reject `actor_type='human'` when `v_role in ('service_role',
-- 'supabase_admin')`, forcing those connections through `actor_type='automation'` +
-- a regex-checked `on_behalf_of`; and persist `auth.uid()`/JWT subject beside the claimed
-- actor so a "human" record minted by a service key is visibly inconsistent."
--
-- Correct, and adopted in full. This converts the weakest link from a name heuristic into a
-- structural property: `service_role` is by definition a machine credential — an API key
-- baked into CI or a worker — so a caller holding it CANNOT be a person at a keyboard, and
-- may no longer claim to be one. `postgres` is deliberately still allowed to record
-- actor_type='human', because a direct admin connection IS how a human operator acts here.
--
-- Also persists auth.uid() (the JWT subject, NULL on direct connections) in the connection
-- block, so a 'human' record minted through a JWT-bearing path can be checked against a real
-- identity.
--
-- Not adopted here, and reported instead — GLM's question 3: the audit lives in the alert
-- row's own `payload`, which the same roles that may acknowledge can also rewrite, so a
-- wrongful acknowledgement is not provably detectable after the fact. That is a real gap.
-- Closing it needs a separate insert-only ack ledger with tamper-resisting triggers, which
-- is a larger design change than this RPC, affects the sibling evidence tables listed in
-- AGENTS.md §6.3, and belongs to the coordinator to sequence.
-- =====================================================================================

create or replace function plm.taxonomy_alert_actor_looks_automated(p_name text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select
    -- Tier 1 — whole-word tokens, anchored so 'Abbot', 'Talbot', 'Botany', 'Cronin',
    -- 'Scriptor', 'Aiden' and 'Marci' no longer collide with them.
    coalesce(p_name, '') ~* '\m(bot|bots|agent|agents|robot|robots|daemon|worker|workers|runner|runners|cron|crond|script|scripts|scripted|scheduler|pipeline|pipelines|llm|gpt|glm|claude|codex|copilot|gemini)\M'
    -- Tier 2 — compound markers unambiguous enough to match anywhere in the string.
    or coalesce(p_name, '') ~* '(automation|automated|automatic|sub[_ -]?agent|github[_ -]?actions|service[_ -]?role|workflow|chatgpt|openai|anthropic)';
$$;

comment on function plm.taxonomy_alert_actor_looks_automated(text) is
  'Heuristic only, word-anchored as of 20260802150000. Two tiers: short/name-like tokens must match as whole words, so real surnames (Abbot, Talbot, Cronin, Scriptor) and words like Botany are no longer rejected; unambiguous compound machine markers still match as substrings. Bare ai/ci/job were removed as false-positive magnets. It is NOT the integrity guarantee — that is the mandatory actor_type declaration, the role binding added by this same migration, the constructed prefix, the mandatory named human behind any automation, and the server-observed connection facts.';

create or replace function plm.acknowledge_taxonomy_sync_alert(
  p_alert_id uuid,
  p_acknowledgement jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = plm, public, auth
as $$
declare
  v_role         text;
  v_uid          text;
  v_actor_type   text;
  v_actor        text;
  v_on_behalf    text;
  v_reason       text;
  v_evidence     text;
  v_by           text;
  v_now          timestamptz;
  v_alert        plm.taxonomy_sync_alert%rowtype;
  v_ack          jsonb;
begin
  v_role := plm.assert_taxonomy_alert_ack_authority();

  -- JWT subject, when there is one. NULL on a direct admin connection.
  begin
    v_uid := nullif(btrim(coalesce(auth.uid()::text, '')), '');
  exception when others then
    v_uid := null;
  end;

  if p_alert_id is null then
    raise exception 'acknowledging a taxonomy sync alert requires p_alert_id'
      using errcode = 'P0001';
  end if;

  if p_acknowledgement is null or jsonb_typeof(p_acknowledgement) <> 'object' then
    raise exception
      'acknowledging a taxonomy sync alert requires an explicit acknowledgement object'
      using errcode = 'P0001';
  end if;

  v_actor_type := nullif(btrim(lower(coalesce(p_acknowledgement->>'actor_type', ''))), '');
  v_actor      := nullif(btrim(coalesce(p_acknowledgement->>'actor', '')), '');
  v_on_behalf  := nullif(btrim(coalesce(p_acknowledgement->>'on_behalf_of', '')), '');
  v_reason     := nullif(btrim(coalesce(p_acknowledgement->>'reason', '')), '');
  v_evidence   := nullif(btrim(coalesce(p_acknowledgement->>'evidence', '')), '');

  if v_actor_type is null or v_actor_type not in ('human', 'automation') then
    raise exception
      'acknowledgement.actor_type must be exactly ''human'' or ''automation'' (got %)',
      coalesce(p_acknowledgement->>'actor_type', '<missing>')
      using errcode = 'P0001';
  end if;

  if v_actor is null then
    raise exception 'acknowledgement.actor is required (the name of the acknowledger)'
      using errcode = 'P0001';
  end if;

  if v_reason is null or length(v_reason) < 20 then
    raise exception
      'acknowledgement.reason is required and must be at least 20 characters — an alert may not be closed without a stated reason'
      using errcode = 'P0001';
  end if;

  -- ROLE BINDING (GLM 5.2 review, question 4). service_role and supabase_admin are machine
  -- credentials — an API key held by CI or a worker. A caller holding one is not a person,
  -- and may not record itself as one. This is structural, not a name heuristic.
  -- `postgres` is intentionally exempt: a direct admin connection IS the human operator path.
  if v_actor_type = 'human' and v_role in ('service_role', 'supabase_admin') then
    raise exception
      'a caller connected as % may not record actor_type=''human'' — that is a machine credential. Use actor_type=''automation'' with on_behalf_of naming the responsible human.',
      v_role
      using errcode = 'P0001';
  end if;

  if v_actor_type = 'automation' then
    if v_on_behalf is null then
      raise exception
        'an automation acknowledgement requires acknowledgement.on_behalf_of (the named human who authorized it)'
        using errcode = 'P0001';
    end if;
    if plm.taxonomy_alert_actor_looks_automated(v_on_behalf) then
      raise exception
        'acknowledgement.on_behalf_of must name a human, not another automated actor (got %)', v_on_behalf
        using errcode = 'P0001';
    end if;
    v_by := format('automation:%s (on behalf of human:%s)', v_actor, v_on_behalf);
  else
    if plm.taxonomy_alert_actor_looks_automated(v_actor) then
      raise exception
        'acknowledgement.actor looks like an automated actor (%); record it as actor_type=''automation'' with on_behalf_of naming the responsible human',
        v_actor
        using errcode = 'P0001';
    end if;
    if v_on_behalf is not null then
      raise exception
        'acknowledgement.on_behalf_of is only meaningful for actor_type=''automation'''
        using errcode = 'P0001';
    end if;
    v_by := format('human:%s', v_actor);
  end if;

  select * into v_alert from plm.taxonomy_sync_alert where id = p_alert_id;
  if not found then
    raise exception 'taxonomy sync alert % does not exist', p_alert_id using errcode = 'P0001';
  end if;

  if v_alert.acknowledged_at is not null then
    raise exception
      'taxonomy sync alert % was already acknowledged at % by %',
      p_alert_id, v_alert.acknowledged_at, coalesce(v_alert.acknowledged_by, '<unknown>')
      using errcode = 'P0001';
  end if;

  v_now := now();

  v_ack := jsonb_build_object(
    'acknowledged_at', v_now,
    'acknowledged_by', v_by,
    'actor_type',      v_actor_type,
    'actor',           v_actor,
    'on_behalf_of',    v_on_behalf,
    'reason',          v_reason,
    'evidence',        v_evidence,
    'connection', jsonb_build_object(
      'session_user',   session_user::text,
      'current_user',   current_user::text,
      'effective_role', v_role,
      -- JWT subject when present. A 'human' record carrying a jwt_sub can be checked
      -- against a real identity; one minted by a service key is visibly inconsistent.
      'jwt_sub',        v_uid
    )
  );

  update plm.taxonomy_sync_alert
     set acknowledged_at = v_now,
         acknowledged_by = v_by,
         payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('acknowledgement', v_ack)
   where id = p_alert_id
     and acknowledged_at is null;

  if not found then
    raise exception
      'taxonomy sync alert % was acknowledged concurrently; nothing was written', p_alert_id
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'alert_id',        p_alert_id,
    'acknowledged_at', v_now,
    'acknowledged_by', v_by,
    'acknowledgement', v_ack
  );
end;
$$;

comment on function plm.acknowledge_taxonomy_sync_alert(uuid, jsonb) is
  'The ONLY supported way to set plm.taxonomy_sync_alert.acknowledged_at. Requires actor_type (''human''|''automation''), actor, a >=20 character reason, and — for automation — the named human it acts for. As of 20260802150000 a caller connected as service_role or supabase_admin may NOT record actor_type=''human'': those are machine credentials, so the claim is refused structurally rather than by name heuristic (postgres is exempt — a direct admin connection is the human operator path). Stores a prefixed, function-constructed acknowledged_by (human:… / automation:… (on behalf of human:…)) so an automated acknowledger can never be mistaken for a person, the way plm.taxonomy_circuit_breaker.reset_by was. Records session_user, current_user, effective_role and auth.uid() as server-observed evidence. Append-only: the payload is merged, the row is never deleted, and re-acknowledging RAISES rather than overwriting. SECURITY INVOKER, so the UPDATE grant on plm.taxonomy_sync_alert is the primary guard. KNOWN GAP (GLM 5.2 review Q3, not closed here): the audit lives in the row payload, which the same roles that may acknowledge can also rewrite — a tamper-resistant insert-only ack ledger is a separate, larger change.';

revoke all on function plm.taxonomy_alert_actor_looks_automated(text) from public;
revoke all on function plm.acknowledge_taxonomy_sync_alert(uuid, jsonb) from public;
grant execute on function plm.taxonomy_alert_actor_looks_automated(text) to service_role;
grant execute on function plm.acknowledge_taxonomy_sync_alert(uuid, jsonb) to service_role;
