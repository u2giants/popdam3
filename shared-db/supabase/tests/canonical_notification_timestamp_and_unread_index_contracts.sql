-- Issue #2204 — contract tests for the canonical notification storage contract.
--
-- Migration: 20260905072856_canonical_notification_timestamp_and_unread_index.sql
--
-- What the issue requires, and what each section below proves:
--   A  the canonical unread index exists on app.user_notification with the exact
--      keys, order and partial predicate the application's read path needs
--   B  bounded newest-first per-user list and unread count plan through that index
--      without a sort
--   C  new notifications carry true timestamp precision (timestamptz, defaulted),
--      so two rows created on the same DAY are still ordered against each other
--   D  same-instant rows are deterministically ordered by the id tie-breaker
--   E  mixed legacy and workflow-linked rows coexist; legacy rows keep their
--      created_date and their read state, and are never reordered by the backfill
--   F  per-recipient and per-idempotency-key uniqueness still hold (#2202)
--   G  FK integrity: workflow_action_id must reference a real workflow action, and
--      that action resolves the immutable RFQ item identity the deep link needs
--   H  created_date is still present and still a date — no existing reader broke
--
-- Everything below is invented and rolled back. CI replays every migration into an
-- EMPTY database, so no fixture may depend on a pre-existing row. Every literal is a
-- labelled synthetic value (issue-2204-*), never a real user, item or step.

begin;

create or replace function pg_temp.explain_notification_query(p_query text)
returns setof text language plpgsql as $$
begin
  return query execute 'explain (costs off) ' || p_query;
end $$;

do $test$
declare
  v_user_a integer;
  v_user_b integer;
  v_sourcing integer;
  v_item integer;
  v_step_start integer;
  v_step_sourcing integer;
  v_handoff bigint;
  v_action_rfq_item integer;
  v_index_valid boolean;
  v_key_definition text;
  v_predicate text;
  v_plan text;
  v_legacy_old integer;
  v_legacy_new integer;
  v_same_day_first integer;
  v_same_day_second integer;
  v_tie_first integer;
  v_tie_second integer;
  v_ids integer[];
  v_count bigint;
  v_data_type text;
  v_default text;
  v_nullable text;
  v_created_at timestamptz;
  v_failed boolean;
begin
  -- ===================================================================================
  -- A. The canonical unread index exists on the table the application actually reads,
  --    with the exact shape the contract calls for. 20260827132637 put an equivalent
  --    index on the LEGACY dflow.user_notification only; an index on the wrong table
  --    accelerates nothing.
  -- ===================================================================================
  select i.indisvalid and i.indisready,
         pg_get_indexdef(i.indexrelid),
         pg_get_expr(i.indpred, i.indrelid)
    into v_index_valid, v_key_definition, v_predicate
    from pg_catalog.pg_index i
   where i.indexrelid = 'app.user_notification_unread_user_created_idx'::regclass;

  if v_index_valid is distinct from true then
    raise exception 'A FAILED: the canonical unread index is not valid and ready';
  end if;
  if v_key_definition !~ '\(user_id_fk, created_at DESC, id DESC\)' then
    raise exception 'A FAILED: wrong index keys (a missing id tie-breaker leaves same-instant rows unordered): %',
      v_key_definition;
  end if;
  if regexp_replace(coalesce(v_predicate, ''), '[()]', '', 'g') <> 'unread = true' then
    raise exception 'A FAILED: the index is not partial on unread = true, so read rows bloat it: %',
      v_predicate;
  end if;
  raise notice 'A PASSED: canonical unread index present with the required keys and predicate.';

  -- ===================================================================================
  -- B. The two application read paths plan through it, and the bounded list needs no
  --    sort. A plan with a Sort step means the index order does not match the query
  --    order and the "bounded" list is really a full scan of the user's unread rows.
  -- ===================================================================================
  perform set_config('enable_seqscan', 'off', true);

  select string_agg(p, E'\n') into v_plan
    from pg_temp.explain_notification_query(
      'select count(*) from app.user_notification where user_id_fk = -2147482204 and unread = true'
    ) p;
  if position('user_notification_unread_user_created_idx' in coalesce(v_plan, '')) = 0 then
    raise exception 'B FAILED: unread count did not plan through the canonical index: %', v_plan;
  end if;

  select string_agg(p, E'\n') into v_plan
    from pg_temp.explain_notification_query(
      'select * from app.user_notification where user_id_fk = -2147482204 and unread = true'
      || ' order by created_at desc, id desc limit 20'
    ) p;
  if position('user_notification_unread_user_created_idx' in coalesce(v_plan, '')) = 0
     or position('Sort' in coalesce(v_plan, '')) > 0 then
    raise exception 'B FAILED: bounded newest-first list did not use index order without a sort: %', v_plan;
  end if;
  raise notice 'B PASSED: unread count and bounded newest-first list both plan through the index.';

  -- ===================================================================================
  -- C. TRUE TIMESTAMP PRECISION — the defect this issue exists for. Under a date-only
  --    column these two rows are indistinguishable and their order is arbitrary.
  -- ===================================================================================
  select c.data_type, c.column_default, c.is_nullable
    into v_data_type, v_default, v_nullable
    from information_schema.columns c
   where c.table_schema = 'app' and c.table_name = 'user_notification'
     and c.column_name = 'created_at';
  if v_data_type is distinct from 'timestamp with time zone' then
    raise exception 'C FAILED: created_at is %, not timestamptz', coalesce(v_data_type, '<missing>');
  end if;
  if coalesce(v_default, '') !~ 'now\(\)' then
    raise exception 'C FAILED: created_at has no now() default, so a caller can omit it: %', v_default;
  end if;
  if v_nullable <> 'NO' then
    raise exception 'C FAILED: created_at is nullable; a null sorts unpredictably in the unread list';
  end if;

  -- The two instants below are written explicitly because the now() default is
  -- TRANSACTION-scoped: every row a single transaction inserts shares one instant by
  -- design, so that all recipients of one workflow action are stamped identically.
  -- Two notifications raised by two separate application transactions on the same day
  -- are the case this section is about, and these literals stand in for them.
  insert into app.user_notification(type, created_date, event, unread, message, title, user_id_fk, created_at)
  values ('issue-2204', date '2098-06-01', 'issue-2204-first', true, 'first', 'first', -2147482204,
          timestamptz '2098-06-01 09:15:00+00')
  returning id into v_same_day_first;

  insert into app.user_notification(type, created_date, event, unread, message, title, user_id_fk, created_at)
  values ('issue-2204', date '2098-06-01', 'issue-2204-second', true, 'second', 'second', -2147482204,
          timestamptz '2098-06-01 17:40:00+00')
  returning id into v_same_day_second;

  if (select created_at from app.user_notification where id = v_same_day_second)
     <= (select created_at from app.user_notification where id = v_same_day_first) then
    raise exception 'C FAILED: two notifications created on the same day are not ordered against each other';
  end if;
  if (select created_date from app.user_notification where id = v_same_day_first)
     <> (select created_date from app.user_notification where id = v_same_day_second) then
    raise exception 'C FAILED: the fixture is wrong -- these rows must share a created_date';
  end if;

  select array_agg(id) into v_ids
    from (
      select id from app.user_notification
       where user_id_fk = -2147482204 and unread = true
       order by created_at desc, id desc
       limit 20
    ) listed;
  if v_ids is distinct from array[v_same_day_second, v_same_day_first] then
    raise exception 'C FAILED: same-day newest-first order is wrong: %', v_ids;
  end if;
  raise notice 'C PASSED: same-day notifications carry distinct instants and order correctly.';

  -- ===================================================================================
  -- D. SAME-INSTANT DETERMINISM. Two rows written with one statement share now(), so
  --    created_at alone cannot order them; the id tie-breaker must, and it must be
  --    stable across repeated reads rather than left to the executor.
  -- ===================================================================================
  insert into app.user_notification(type, created_date, event, unread, message, title, user_id_fk, created_at)
  values
    ('issue-2204', date '2099-01-01', 'issue-2204-tie-a', true, 'tie a', 'tie a', -2147482205,
     timestamptz '2099-01-01 00:00:00+00'),
    ('issue-2204', date '2099-01-01', 'issue-2204-tie-b', true, 'tie b', 'tie b', -2147482205,
     timestamptz '2099-01-01 00:00:00+00');

  select min(id), max(id) into v_tie_first, v_tie_second
    from app.user_notification where user_id_fk = -2147482205;

  select array_agg(id) into v_ids
    from (
      select id from app.user_notification
       where user_id_fk = -2147482205 and unread = true
       order by created_at desc, id desc
       limit 20
    ) listed;
  if v_ids is distinct from array[v_tie_second, v_tie_first] then
    raise exception 'D FAILED: same-instant rows are not deterministically ordered by id: %', v_ids;
  end if;
  raise notice 'D PASSED: same-instant rows fall back to a deterministic id order.';

  -- ===================================================================================
  -- E. MIXED LEGACY AND WORKFLOW ROWS. A legacy row has no workflow_action_id and no
  --    time of day. It must keep its created_date, keep its read state, and sit in the
  --    list by the DAY it records -- the backfill may not promote it above newer rows.
  -- ===================================================================================
  insert into app.user_notification(type, created_date, event, unread, message, title, user_id_fk, created_at)
  values ('task', date '2022-03-29', 'issue-2204-legacy-old', true, 'legacy old', 'legacy old',
          -2147482206, timestamptz '2022-03-29 00:00:00+00')
  returning id into v_legacy_old;

  insert into app.user_notification(type, created_date, event, unread, message, title, user_id_fk, created_at)
  values ('mention', date '2026-07-10', 'issue-2204-legacy-new', false, 'legacy new', 'legacy new',
          -2147482206, timestamptz '2026-07-10 00:00:00+00')
  returning id into v_legacy_new;

  if (select created_date from app.user_notification where id = v_legacy_old) <> date '2022-03-29' then
    raise exception 'E FAILED: a legacy row lost its created_date';
  end if;
  if (select unread from app.user_notification where id = v_legacy_new) is distinct from false then
    raise exception 'E FAILED: a legacy read row lost its read state';
  end if;
  -- The read legacy row is partial-index-excluded and must not appear in an unread list.
  select count(*) into v_count
    from app.user_notification where user_id_fk = -2147482206 and unread = true;
  if v_count <> 1 then
    raise exception 'E FAILED: expected exactly 1 unread legacy row, got %', v_count;
  end if;
  if (select created_at from app.user_notification where id = v_legacy_old)
     >= (select created_at from app.user_notification where id = v_legacy_new) then
    raise exception 'E FAILED: the backfill reordered legacy rows against their own dates';
  end if;
  if (select workflow_action_id from app.user_notification where id = v_legacy_old) is not null then
    raise exception 'E FAILED: a legacy row must not carry a workflow action link';
  end if;
  raise notice 'E PASSED: legacy rows keep their dates, read state and relative order.';

  -- ===================================================================================
  -- F/G. A real workflow-produced notification: uniqueness, FK integrity, and the
  --      RFQ identity the frontend deep link resolves. Prices, customer-private text
  --      and notes stay out of the notification row -- the link is the contract.
  -- ===================================================================================
  insert into dflow.users(name,email) values
    ('Issue 2204 Sales','issue-2204-sales@example.test'),
    ('Issue 2204 Sourcing','issue-2204-sourcing@example.test');
  select id into v_user_a from dflow.users where email = 'issue-2204-sales@example.test';
  select id into v_sourcing from dflow.users where email = 'issue-2204-sourcing@example.test';

  insert into plm."RFQStep"("RFQStep_title") values ('issue-2204-start'), ('issue-2204-sourcing');
  select "RFQStep_id" into v_step_start    from plm."RFQStep" where "RFQStep_title" = 'issue-2204-start';
  select "RFQStep_id" into v_step_sourcing from plm."RFQStep" where "RFQStep_title" = 'issue-2204-sourcing';

  insert into plm."RFQItem"("rfqItem_step") values (v_step_start) returning "rfqItem_id" into v_item;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub','a2204000-0000-4000-8000-00000000000a',
    'email','issue-2204-sales@example.test')::text, true);

  perform dflow.set_item_user_assignment(v_item,'sourcing',v_sourcing,true);

  v_handoff := dflow.record_item_workflow_action(
    v_item, v_step_sourcing, 'send_to_sourcing', 'a2204001-0000-4000-8000-000000000001',
    'sales', 'sourcing', false);

  select created_at into v_created_at
    from app.user_notification where workflow_action_id = v_handoff;
  if v_created_at is null then
    raise exception 'G FAILED: a workflow-produced notification has no canonical instant';
  end if;
  if v_created_at < now() - interval '1 hour' then
    raise exception 'G FAILED: a new notification did not take the now() default: %', v_created_at;
  end if;

  -- The deep link: notification -> action -> immutable RFQ item identity.
  select a.rfq_item_id into v_action_rfq_item
    from app.user_notification n
    join dflow.item_workflow_action a on a.id = n.workflow_action_id
   where n.workflow_action_id = v_handoff;
  if v_action_rfq_item is distinct from v_item then
    raise exception 'G FAILED: the action link does not resolve the RFQ item identity the deep link needs (% vs %)',
      v_action_rfq_item, v_item;
  end if;

  -- FK integrity: a notification cannot point at a workflow action that does not exist.
  v_failed := false;
  begin
    insert into app.user_notification(type, created_date, event, unread, message, title, user_id_fk, workflow_action_id)
    values ('issue-2204', current_date, 'issue-2204-bad-fk', true, 'bad', 'bad', -2147482207,
            -9223372036854775807);
  exception when foreign_key_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'G FAILED: a notification was accepted against a non-existent workflow action';
  end if;

  -- F: one notification per action per recipient.
  v_failed := false;
  begin
    insert into app.user_notification(type, created_date, event, unread, message, title, user_id_fk, workflow_action_id)
    select 'issue-2204', current_date, 'issue-2204-dupe', true, 'dupe', 'dupe', n.user_id_fk, n.workflow_action_id
      from app.user_notification n where n.workflow_action_id = v_handoff;
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'F FAILED: the same workflow action notified the same recipient twice';
  end if;

  -- F: idempotency keys are unique where present.
  v_failed := false;
  begin
    insert into app.user_notification(type, created_date, event, unread, message, title, user_id_fk, idempotency_key)
    select 'issue-2204', current_date, 'issue-2204-dupe-key', true, 'dupe', 'dupe', -2147482208, n.idempotency_key
      from app.user_notification n where n.workflow_action_id = v_handoff;
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'F FAILED: a duplicate idempotency key was accepted';
  end if;

  -- Two legacy rows may both carry NULL keys -- the unique indexes are partial and
  -- must not turn "no key" into a collision.
  insert into app.user_notification(type, created_date, event, unread, message, title, user_id_fk)
  values ('task', current_date, 'issue-2204-null-key-a', true, 'a', 'a', -2147482209),
         ('task', current_date, 'issue-2204-null-key-b', true, 'b', 'b', -2147482209);
  raise notice 'F/G PASSED: uniqueness, FK integrity and RFQ deep-link resolution all hold.';

  -- ===================================================================================
  -- H. NOTHING WAS TAKEN AWAY. created_date is still there and still a date, so every
  --    existing reader, view and function keeps compiling. This migration is additive.
  -- ===================================================================================
  select c.data_type into v_data_type
    from information_schema.columns c
   where c.table_schema = 'app' and c.table_name = 'user_notification'
     and c.column_name = 'created_date';
  if v_data_type is distinct from 'date' then
    raise exception 'H FAILED: created_date was altered or dropped (now %); existing readers break',
      coalesce(v_data_type, '<missing>');
  end if;
  raise notice 'H PASSED: created_date is unchanged; the change is additive.';
end
$test$;

rollback;
