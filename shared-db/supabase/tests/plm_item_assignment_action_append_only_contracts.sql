begin;

-- shared-db#3595: the plm final homes are append-only and carry the four source
-- lookup indexes. Exercised with throwaway rows; everything is rolled back.
do $test$
declare
  v_item integer;
  v_step integer;
  v_asg bigint;
  v_closed bigint;
  v_act bigint;
  v_closed_at timestamptz;
  r record;
begin
  -- Exact definitions (copied from the dflow sources 20260901221310 / 20260905053422).
  for r in select * from (values
    ('item_user_assignment_active_lookup',
     'CREATE INDEX item_user_assignment_active_lookup ON plm.item_user_assignment USING btree (rfq_item_id, function_key, effective_from, id) INCLUDE (user_id) WHERE (effective_to IS NULL)'),
    ('item_workflow_action_item_time',
     'CREATE INDEX item_workflow_action_item_time ON plm.item_workflow_action USING btree (rfq_item_id, occurred_at, id)'),
    ('item_workflow_action_open_handoff_lookup',
     'CREATE INDEX item_workflow_action_open_handoff_lookup ON plm.item_workflow_action USING btree (rfq_item_id, occurred_at DESC, id DESC) INCLUDE (actor_user_id)'),
    ('item_workflow_action_admin_review',
     'CREATE INDEX item_workflow_action_admin_review ON plm.item_workflow_action USING btree (rfq_item_id, occurred_at) WHERE requires_admin_review')
  ) as e(name, def) loop
    if pg_catalog.to_regclass('plm.' || r.name) is null then
      raise exception 'missing index plm.%', r.name;
    end if;
    if pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('plm.' || r.name)) is distinct from r.def then
      raise exception 'index plm.% is %, expected %', r.name,
        pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('plm.' || r.name)), r.def;
    end if;
    if not exists (select 1 from pg_catalog.pg_index
                    where indexrelid = pg_catalog.to_regclass('plm.' || r.name)
                      and indisvalid and indisready and indislive and not indisunique) then
      raise exception 'index plm.% is not a valid, live, non-unique index', r.name;
    end if;
  end loop;

  -- Guard functions: pinned search_path, no direct EXECUTE for API roles.
  for r in select * from (values
    ('plm.reject_item_assignment_history_rewrite()'),
    ('plm.reject_item_workflow_action_rewrite()')
  ) as f(sig) loop
    if not exists (select 1 from pg_catalog.pg_proc
                    where oid = r.sig::regprocedure
                      and proconfig @> array['search_path=pg_catalog, plm']) then
      raise exception '% must pin search_path=pg_catalog, plm', r.sig;
    end if;
    if pg_catalog.has_function_privilege('anon', r.sig, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', r.sig, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', r.sig, 'EXECUTE') then
      raise exception '% is executable by an API role', r.sig;
    end if;
  end loop;

  v_item := (select coalesce(max("rfqItem_id"), 0) + 1000000 from plm."RFQItem");
  v_step := (select coalesce(max("RFQStep_id"), 0) + 1000000 from plm."RFQStep");
  insert into plm."RFQItem"("rfqItem_id") overriding system value values (v_item);
  insert into plm."RFQStep"("RFQStep_id") overriding system value values (v_step);

  insert into plm.item_user_assignment (rfq_item_id, function_key, user_id, assigned_by_user_id)
  values (v_item, 'sales', 1, 1) returning id into v_asg;
  -- Already-closed history must still be insertable (identity-preserving row move).
  insert into plm.item_user_assignment (rfq_item_id, function_key, user_id, assigned_by_user_id,
                                        effective_from, effective_to)
  values (v_item, 'sales', 2, 1, now() - interval '2 day', now() - interval '1 day')
  returning id into v_closed;

  -- Rewriting a fact is refused and the row is unchanged.
  begin
    update plm.item_user_assignment set user_id = 3 where id = v_asg;
    raise exception 'assignment fact rewrite was accepted';
  exception when sqlstate '55000' then null;
  end;
  if not exists (select 1 from plm.item_user_assignment where id = v_asg and user_id = 1) then
    raise exception 'assignment row changed after a refused rewrite';
  end if;
  -- Deleting is refused and the row survives.
  begin
    delete from plm.item_user_assignment where id = v_asg;
    raise exception 'assignment delete was accepted';
  exception when sqlstate '55000' then null;
  end;
  if not exists (select 1 from plm.item_user_assignment where id = v_asg) then
    raise exception 'assignment row vanished after a refused delete';
  end if;
  -- Closing an active assignment once is the one permitted change, and it lands.
  update plm.item_user_assignment set effective_to = clock_timestamp() + interval '1 second' where id = v_asg;
  select effective_to into v_closed_at from plm.item_user_assignment where id = v_asg;
  if v_closed_at is null then
    raise exception 'permitted close did not persist';
  end if;
  -- Re-closing or reopening is refused.
  begin
    update plm.item_user_assignment set effective_to = clock_timestamp() + interval '1 hour' where id = v_asg;
    raise exception 'second close was accepted';
  exception when sqlstate '55000' then null;
  end;
  if (select effective_to from plm.item_user_assignment where id = v_asg) is distinct from v_closed_at then
    raise exception 'closed assignment changed after a refused second close';
  end if;
  begin
    update plm.item_user_assignment set effective_to = null where id = v_closed;
    raise exception 'reopen was accepted';
  exception when sqlstate '55000' then null;
  end;
  -- RFQItem deletion cascading into assignment history is refused.
  begin
    delete from plm."RFQItem" where "rfqItem_id" = v_item;
    raise exception 'RFQItem delete cascaded through assignment history';
  exception when sqlstate '55000' then null;
  end;
  if (select count(*) from plm.item_user_assignment where rfq_item_id = v_item) <> 2 then
    raise exception 'assignment history lost after a refused RFQItem delete';
  end if;

  perform pg_catalog.set_config('request.designflow.actor_id', '1', true);
  perform pg_catalog.set_config('request.designflow.actor_email', 'contract@example.test', true);
  insert into plm.item_workflow_action (rfq_item_id, actor_user_id, new_step_id, action_key, correlation_key)
  values (v_item, 1, v_step, 'send_to_sourcing', gen_random_uuid()) returning id into v_act;

  begin
    update plm.item_workflow_action set action_key = 'other' where id = v_act;
    raise exception 'workflow action update was accepted';
  exception when sqlstate '55000' then null;
  end;
  begin
    update plm.item_workflow_action set requires_admin_review = true where id = v_act;
    raise exception 'workflow action flag update was accepted';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from plm.item_workflow_action where id = v_act;
    raise exception 'workflow action delete was accepted';
  exception when sqlstate '55000' then null;
  end;
  if not exists (select 1 from plm.item_workflow_action
                  where id = v_act and action_key = 'send_to_sourcing' and not requires_admin_review) then
    raise exception 'workflow action changed or vanished after refused writes';
  end if;

  -- Deny-by-default is unchanged: RLS on, no policies, no API-role table access.
  if exists (select 1 from pg_catalog.pg_class
              where oid in ('plm.item_user_assignment'::regclass, 'plm.item_workflow_action'::regclass)
                and not relrowsecurity)
     or exists (select 1 from pg_catalog.pg_policies
                 where schemaname = 'plm' and tablename in ('item_user_assignment', 'item_workflow_action'))
     or exists (
    select 1 from unnest(array['anon','authenticated','service_role']) ro(role_name)
    cross join unnest(array['plm.item_user_assignment','plm.item_workflow_action']) t(rel)
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
    where pg_catalog.has_table_privilege(ro.role_name, t.rel, p.priv)
  ) then
    raise exception 'deny-by-default boundary changed';
  end if;
end
$test$;

rollback;
