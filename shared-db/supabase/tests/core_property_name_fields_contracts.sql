-- #6269: synthetic, rollback-only contract for the four property names on core.property.
begin;

create function pg_temp.auth6269(p_table text, p_cols text[]) returns void language sql as $$
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at)
  values (pg_backend_pid(), txid_current(), p_table, 'licensing_review_create',
    gen_random_uuid(), repeat('6', 64), 'issue-6269 synthetic contract', p_cols,
    clock_timestamp() + interval '1 minute');
$$;

do $$
declare
  v_lic uuid; v_a uuid; v_b uuid;
  v_opa bigint := -626900000001;
  v_exact constant text := 'SYNTH 6269  (DOUBLE)  - SPACE ';
  v_rejected boolean;
  r record;
begin
  perform pg_temp.auth6269('core.licensor', array['name','code','status']);
  insert into core.licensor (name, code, status) values ('ISSUE 6269 SYNTH LICENSOR', 'ISSUE6269', 'potential')
  returning id into v_lic;
  perform pg_temp.auth6269('core.property', array['licensor_id','name','code','status']);
  insert into core.property (licensor_id, name, code, status) values (v_lic, 'Synth 6269 A', 'S6269A', 'potential')
  returning id into v_a;
  perform pg_temp.auth6269('core.property', array['licensor_id','name','code','status']);
  insert into core.property (licensor_id, name, code, status) values (v_lic, 'Synth 6269 B', 'S6269B', 'potential')
  returning id into v_b;

  -- No link leaves NULL, and a typed name is discarded.
  update core.property set submission_property_name = 'typed by hand' where id = v_a;
  if (select submission_property_name from core.property where id = v_a) is not null then
    raise exception 'unlinked property kept a typed submission name';
  end if;

  -- Link to a scrape row: exact bytes copied, double spaces and trailing space kept.
  insert into plm.opa_property (licensed_property_id, property_name) values (v_opa, v_exact);
  update core.property set submission_source = 'disney_opa', submission_property_id = v_opa::text where id = v_a;
  if (select encode(convert_to(submission_property_name, 'UTF8'), 'hex') from core.property where id = v_a)
     is distinct from encode(convert_to(v_exact, 'UTF8'), 'hex') then
    raise exception 'submission name is not a byte-exact copy of the scrape';
  end if;

  -- A rename in the scrape flows through automatically.
  update plm.opa_property set property_name = v_exact || 'X' where licensed_property_id = v_opa;
  if (select submission_property_name from core.property where id = v_a) <> v_exact || 'X' then
    raise exception 'scrape rename did not refresh the submission name';
  end if;

  -- Duplicate licensor id rejected.
  v_rejected := false;
  begin
    update core.property set submission_source = 'disney_opa', submission_property_id = v_opa::text where id = v_b;
  exception when unique_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'duplicate licensor link accepted'; end if;

  -- A late writer of the old metadata key is moved into the columns.
  update core.property set metadata = coalesce(metadata, '{}') ||
    jsonb_build_object('submission_canonical', jsonb_build_object('source_system','disney_opa','licensed_property_id','-626900000002'))
   where id = v_b;
  if (select submission_source||':'||submission_property_id from core.property where id = v_b) <> 'disney_opa:-626900000002'
     or (select metadata ? 'submission_canonical' from core.property where id = v_b) then
    raise exception 'old metadata key was not moved into the columns';
  end if;
  update core.property set submission_source = null, submission_property_id = null where id = v_b;

  -- An unmovable old-key shape is rejected.
  v_rejected := false;
  begin
    update core.property set metadata = coalesce(metadata, '{}') || '{"submission_canonical":{}}' where id = v_b;
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'metadata submission_canonical accepted'; end if;

  -- View fallbacks.
  select * into r from api.property_names where id = v_b;
  if r.display_name <> 'Synth 6269 B' or r.description_name <> 'Synth 6269 B' then
    raise exception 'fallback to name failed';
  end if;
  update core.property set nickname = 'Nick B' where id = v_b;
  select * into r from api.property_names where id = v_b;
  if r.display_name <> 'Nick B' or r.description_name <> 'Nick B' then
    raise exception 'fallback to nickname failed';
  end if;
  update core.property set short_name = 'Short B' where id = v_b;
  select * into r from api.property_names where id = v_b;
  if r.display_name <> 'Nick B' or r.description_name <> 'Short B' then
    raise exception 'short name not used for description';
  end if;
  if (select count(*) from api.property_names) <> (select count(*) from core.property) then
    raise exception 'view row count differs from core.property';
  end if;
end
$$;

rollback;
