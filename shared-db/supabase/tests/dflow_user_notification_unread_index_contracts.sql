-- Contracts for 20260827132637_index_dflow_unread_notifications.sql.

begin;

create or replace function pg_temp.explain_notification_query(p_query text)
returns setof text language plpgsql as $$
begin
  return query execute 'explain (costs off) ' || p_query;
end $$;

do $contracts$
declare
  v_index_valid boolean;
  v_key_definition text;
  v_predicate text;
  v_plan text;
  v_first_id integer;
  v_second_id integer;
  v_count bigint;
  v_ids integer[];
begin
  select i.indisvalid and i.indisready,
         pg_get_indexdef(i.indexrelid),
         pg_get_expr(i.indpred, i.indrelid)
    into v_index_valid, v_key_definition, v_predicate
  from pg_index i
  where i.indexrelid = 'dflow.user_notification_unread_user_created_idx'::regclass;

  if v_index_valid is distinct from true then
    raise exception 'unread notification index is not valid and ready';
  end if;

  if v_key_definition !~ '\(user_id_fk, created_date DESC\)'
     or regexp_replace(v_predicate, '[()]', '', 'g') <> 'unread = true' then
    raise exception 'unread notification index has the wrong keys or predicate: % / %',
      v_key_definition, v_predicate;
  end if;

  perform set_config('enable_seqscan', 'off', true);

  select string_agg(p, E'\n') into v_plan
  from pg_temp.explain_notification_query(
    'select count(*) from dflow.user_notification where user_id_fk = -2147483000 and unread = true'
  ) p;
  if position('user_notification_unread_user_created_idx' in coalesce(v_plan, '')) = 0 then
    raise exception 'unread count did not plan through the required index: %', v_plan;
  end if;

  select string_agg(p, E'\n') into v_plan
  from pg_temp.explain_notification_query(
    'select * from dflow.user_notification where user_id_fk = -2147483000 and unread = true order by created_date desc limit 20'
  ) p;
  if position('user_notification_unread_user_created_idx' in coalesce(v_plan, '')) = 0
     or position('Sort' in coalesce(v_plan, '')) > 0 then
    raise exception 'bounded unread list did not use index order without a sort: %', v_plan;
  end if;

  insert into dflow.user_notification
    (type, created_date, event, unread, message, title, user_id_fk)
  values
    ('contract', date '2099-01-01', 'contract', true, 'contract', 'contract', -2147483000)
  returning id into v_first_id;

  insert into dflow.user_notification
    (type, created_date, event, unread, message, title, user_id_fk)
  values
    ('contract', date '2099-01-02', 'contract', true, 'contract', 'contract', -2147483000)
  returning id into v_second_id;

  select count(*) into v_count
  from dflow.user_notification
  where user_id_fk = -2147483000 and unread = true;
  if v_count <> 2 then
    raise exception 'insert/count contract failed: expected 2 unread rows, got %', v_count;
  end if;

  select array_agg(id order by created_date desc) into v_ids
  from (
    select id, created_date
    from dflow.user_notification
    where user_id_fk = -2147483000 and unread = true
    order by created_date desc
    limit 20
  ) listed;
  if v_ids is distinct from array[v_second_id, v_first_id] then
    raise exception 'bounded newest-first list contract failed: %', v_ids;
  end if;

  update dflow.user_notification
  set unread = false
  where id = v_first_id and user_id_fk = -2147483000;
  select count(*) into v_count
  from dflow.user_notification
  where user_id_fk = -2147483000 and unread = true;
  if v_count <> 1 then
    raise exception 'mark-one-read contract failed: expected 1 unread row, got %', v_count;
  end if;

  update dflow.user_notification
  set unread = false
  where user_id_fk = -2147483000 and unread = true;
  select count(*) into v_count
  from dflow.user_notification
  where user_id_fk = -2147483000 and unread = true;
  if v_count <> 0 then
    raise exception 'mark-all-read contract failed: expected 0 unread rows, got %', v_count;
  end if;
end
$contracts$;

rollback;
