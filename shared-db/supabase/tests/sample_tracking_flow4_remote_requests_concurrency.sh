#!/usr/bin/env bash
set -euo pipefail

# Required two-client proof for issue #1607. The workflow supplies credentials
# for its throwaway Supabase CLI database; this script never accepts a URL.
: "${PGHOST:?required}"
: "${PGPORT:?required}"
: "${PGUSER:?required}"
: "${PGPASSWORD:?required}"
: "${PGDATABASE:?required}"

event_ready="${RUNNER_TEMP:?required}/flow4-event-writer-ready"
reserve_ready="$RUNNER_TEMP/flow4-reserve-writer-ready"
pack_ready="$RUNNER_TEMP/flow4-pack-writer-ready"
competing_pack_ready="$RUNNER_TEMP/flow4-competing-pack-lock-ready"
event_log="$RUNNER_TEMP/flow4-event-writer.log"
reserve_log="$RUNNER_TEMP/flow4-reserve-writer.log"
pack_log="$RUNNER_TEMP/flow4-pack-writer.log"
competing_pack_log="$RUNNER_TEMP/flow4-competing-pack-lock.log"
rm -f "$event_ready" "$reserve_ready" "$pack_ready" "$competing_pack_ready" \
  "$event_log" "$reserve_log" "$pack_log" "$competing_pack_log"

cleanup() {
  psql -v ON_ERROR_STOP=1 --no-psqlrc >/dev/null <<'SQL' || true
delete from dflow.sample_remote_request_history
 where sample_remote_request_item_id in ('16070000-0000-4000-8000-000000000001','16070000-0000-4000-8000-000000000002');
delete from dflow.sample_reservation where sample_reservation_id='16070000-0000-4000-8000-000000000003';
delete from dflow.sample_shipment_line where idempotency_key in ('pack-overlap','pack-competing');
delete from dflow.sample_shipment_item where box_id_fk=160700001;
delete from dflow.sample_shipment where sample_shipment_id=160700000001;
delete from dflow.sample_box where box_id_pk=160700001;
delete from dflow.sample_remote_request_item where sample_remote_request_id='16070000-0000-4000-8000-000000000000';
delete from dflow.sample_remote_request where sample_remote_request_id='16070000-0000-4000-8000-000000000000';
delete from dflow.sample_workflow where created_by_user='flow4-concurrency-contract';
delete from dflow.sample where sample_name in ('flow4-event-concurrency-contract','flow4-reserve-concurrency-contract');
SQL
}
trap cleanup EXIT

psql -v ON_ERROR_STOP=1 --no-psqlrc <<'SQL'
with inserted as (
  insert into dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  values('china_warehouse','inbound','flow4-event-concurrency-contract','created','known')
  returning sample_id_pk
)
insert into dflow.sample_workflow(sample_id_fk,workflow_type,business_path,created_by_user)
select sample_id_pk,'nyo_remote_china_inventory_request','china_warehouse_ningbo_nyo','flow4-concurrency-contract' from inserted;

with inserted as (
  insert into dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  values('china_warehouse','inbound','flow4-reserve-concurrency-contract','created','known')
  returning sample_id_pk
)
insert into dflow.sample_workflow(sample_id_fk,workflow_type,business_path,created_by_user)
select sample_id_pk,'nyo_remote_china_inventory_request','china_warehouse_ningbo_nyo','flow4-concurrency-contract' from inserted;

insert into dflow.sample_remote_request(
  sample_remote_request_id,request_source,business_path,destination_type,destination_id,
  requested_by_user,requested_by_role,idempotency_key,request_hash
) values(
  '16070000-0000-4000-8000-000000000000','mixed','mixed','office','nyo',
  'nyo-user','nyo','flow4-concurrency-request','flow4-concurrency-request-hash'
);

insert into dflow.sample_remote_request_item(
  sample_remote_request_item_id,sample_remote_request_id,workflow_id,sample_id_fk,
  source_type,business_path,source_reference,current_state,idempotency_key,request_hash,
  created_by_user,created_by_role
)
select '16070000-0000-4000-8000-000000000001','16070000-0000-4000-8000-000000000000',
       w.sample_workflow_id,s.sample_id_pk,'china_warehouse','china_warehouse_ningbo_nyo',
       'event-concurrency','requested','event-concurrency-item','event-concurrency-item-hash','nyo-user','nyo'
  from dflow.sample s join dflow.sample_workflow w on w.sample_id_fk=s.sample_id_pk
 where s.sample_name='flow4-event-concurrency-contract';

insert into dflow.sample_remote_request_item(
  sample_remote_request_item_id,sample_remote_request_id,workflow_id,sample_id_fk,
  source_type,business_path,source_reference,current_state,idempotency_key,request_hash,
  created_by_user,created_by_role
)
select '16070000-0000-4000-8000-000000000002','16070000-0000-4000-8000-000000000000',
       w.sample_workflow_id,s.sample_id_pk,'china_warehouse','china_warehouse_ningbo_nyo',
       'reserve-concurrency','received','reserve-concurrency-item','reserve-concurrency-item-hash','nyo-user','nyo'
  from dflow.sample s join dflow.sample_workflow w on w.sample_id_fk=s.sample_id_pk
 where s.sample_name='flow4-reserve-concurrency-contract';
SQL

export FLOW4_EVENT_READY="$event_ready"
psql -v ON_ERROR_STOP=1 --no-psqlrc >"$event_log" 2>&1 <<'SQL' &
begin;
select 1 from dflow.sample_remote_request_item
 where sample_remote_request_item_id='16070000-0000-4000-8000-000000000001' for update;
\! touch "$FLOW4_EVENT_READY"
select pg_sleep(1.25);
update dflow.sample_remote_request_item set current_state='awaiting_qc',updated_at=now()
 where sample_remote_request_item_id='16070000-0000-4000-8000-000000000001';
insert into dflow.sample_remote_request_history(
  sample_remote_request_item_id,from_state,to_state,actor_user,actor_role,idempotency_key,request_hash
) values(
  '16070000-0000-4000-8000-000000000001','requested','awaiting_qc','nyo-user','nyo','event-overlap','event-overlap-hash'
);
commit;
SQL
event_pid=$!
for _ in $(seq 1 100); do [[ -f "$event_ready" ]] && break; sleep 0.02; done
[[ -f "$event_ready" ]] || { echo 'event writer never proved it held the row lock' >&2; exit 1; }
event_started=$(date +%s%3N)
event_returned=$(psql -v ON_ERROR_STOP=1 --no-psqlrc -Atqc "select sample_remote_request_history_id from dflow.post_sample_remote_request_event('16070000-0000-4000-8000-000000000001','awaiting_qc','nyo-user','nyo','event-overlap','event-overlap-hash')")
event_elapsed=$(( $(date +%s%3N) - event_started ))
wait "$event_pid" || { cat "$event_log" >&2; exit 1; }
event_committed=$(psql -v ON_ERROR_STOP=1 --no-psqlrc -Atqc "select sample_remote_request_history_id from dflow.sample_remote_request_history where sample_remote_request_item_id='16070000-0000-4000-8000-000000000001' and idempotency_key='event-overlap'")
[[ "$event_returned" == "$event_committed" && "$event_elapsed" -ge 700 ]] || {
  echo "event overlap failed: returned=$event_returned committed=$event_committed blocked_ms=$event_elapsed" >&2; exit 1;
}
echo "FLOW4 EVENT CONCURRENCY PASS returned=$event_returned blocked_ms=$event_elapsed"

export FLOW4_RESERVE_READY="$reserve_ready"
psql -v ON_ERROR_STOP=1 --no-psqlrc >"$reserve_log" 2>&1 <<'SQL' &
begin;
select 1 from dflow.sample_remote_request_item
 where sample_remote_request_item_id='16070000-0000-4000-8000-000000000002' for update;
\! touch "$FLOW4_RESERVE_READY"
select pg_sleep(1.25);
insert into dflow.sample_reservation(
  sample_reservation_id,sample_remote_request_item_id,sample_id_fk,reserved_by_user,idempotency_key,request_hash
)
select '16070000-0000-4000-8000-000000000003',sample_remote_request_item_id,sample_id_fk,
       'ningbo-user','reserve-overlap','reserve-overlap-hash'
  from dflow.sample_remote_request_item
 where sample_remote_request_item_id='16070000-0000-4000-8000-000000000002';
update dflow.sample_remote_request_item set current_state='reserved_for_next_box',updated_at=now()
 where sample_remote_request_item_id='16070000-0000-4000-8000-000000000002';
insert into dflow.sample_remote_request_history(
  sample_remote_request_item_id,from_state,to_state,actor_user,actor_role,idempotency_key,request_hash
) values(
  '16070000-0000-4000-8000-000000000002','received','reserved_for_next_box','ningbo-user','ningbo','reserve-overlap','reserve-overlap-hash'
);
commit;
SQL
reserve_pid=$!
for _ in $(seq 1 100); do [[ -f "$reserve_ready" ]] && break; sleep 0.02; done
[[ -f "$reserve_ready" ]] || { echo 'reservation writer never proved it held the row lock' >&2; exit 1; }
reserve_started=$(date +%s%3N)
reserve_returned=$(psql -v ON_ERROR_STOP=1 --no-psqlrc -Atqc "select sample_reservation_id from dflow.reserve_sample_remote_request_item('16070000-0000-4000-8000-000000000002','ningbo-user','ningbo','reserve-overlap','reserve-overlap-hash')")
reserve_elapsed=$(( $(date +%s%3N) - reserve_started ))
wait "$reserve_pid" || { cat "$reserve_log" >&2; exit 1; }
reserve_committed=$(psql -v ON_ERROR_STOP=1 --no-psqlrc -Atqc "select sample_reservation_id from dflow.sample_reservation where idempotency_key='reserve-overlap'")
[[ "$reserve_returned" == "$reserve_committed" && "$reserve_elapsed" -ge 700 ]] || {
  echo "reservation overlap failed: returned=$reserve_returned committed=$reserve_committed blocked_ms=$reserve_elapsed" >&2; exit 1;
}
echo "FLOW4 RESERVATION CONCURRENCY PASS returned=$reserve_returned blocked_ms=$reserve_elapsed"

psql -v ON_ERROR_STOP=1 --no-psqlrc <<'SQL'
insert into dflow.sample_box(box_id_pk,box_label,status,origin_office,dest_office)
values(160700001,'flow4-pack-concurrency-box','open','ningbo','nyo');
insert into dflow.sample_shipment(
  sample_shipment_id,origin_location_type,origin_location_id,destination_location_type,
  destination_location_id,state,actor_user,actor_role,idempotency_key,request_hash
) values(
  160700000001,'office','ningbo','office','nyo','packed','ningbo-user','ningbo',
  'flow4-pack-concurrency-shipment','flow4-pack-concurrency-shipment-hash'
);
SQL

# The first client completes the pack operation but holds the reservation lock
# until commit. The replay client must block, then return that exact committed
# reservation/line identity without creating another membership or line.
export FLOW4_PACK_READY="$pack_ready"
psql -v ON_ERROR_STOP=1 --no-psqlrc >"$pack_log" 2>&1 <<'SQL' &
begin;
select sample_reservation_id
  from dflow.pack_sample_reservation(
    '16070000-0000-4000-8000-000000000003',160700001,160700000001,
    'ningbo','office','nyo','ningbo_to_nyc','ningbo-user','ningbo',
    'pack-overlap','pack-overlap-hash'
  );
\! touch "$FLOW4_PACK_READY"
select pg_sleep(1.25);
commit;
SQL
pack_pid=$!
for _ in $(seq 1 100); do [[ -f "$pack_ready" ]] && break; sleep 0.02; done
[[ -f "$pack_ready" ]] || { echo 'pack writer never proved it held the reservation lock' >&2; exit 1; }
pack_started=$(date +%s%3N)
pack_returned=$(psql -v ON_ERROR_STOP=1 --no-psqlrc -Atqc "select sample_reservation_id::text||'|'||packed_shipment_line_id::text from dflow.pack_sample_reservation('16070000-0000-4000-8000-000000000003',160700001,160700000001,'ningbo','office','nyo','ningbo_to_nyc','ningbo-user','ningbo','pack-overlap','pack-overlap-hash')")
pack_elapsed=$(( $(date +%s%3N) - pack_started ))
wait "$pack_pid" || { cat "$pack_log" >&2; exit 1; }
pack_committed=$(psql -v ON_ERROR_STOP=1 --no-psqlrc -Atqc "select sample_reservation_id::text||'|'||packed_shipment_line_id::text from dflow.sample_reservation where sample_reservation_id='16070000-0000-4000-8000-000000000003'")
pack_counts=$(psql -v ON_ERROR_STOP=1 --no-psqlrc -Atqc "select (select count(*) from dflow.sample_shipment_item where box_id_fk=160700001)::text||'|'||(select count(*) from dflow.sample_shipment_line where idempotency_key='pack-overlap')::text")
[[ "$pack_returned" == "$pack_committed" && "$pack_counts" == "1|1" && "$pack_elapsed" -ge 700 ]] || {
  echo "pack replay overlap failed: returned=$pack_returned committed=$pack_committed counts=$pack_counts blocked_ms=$pack_elapsed" >&2; exit 1;
}
echo "FLOW4 PACK REPLAY CONCURRENCY PASS returned=$pack_returned counts=$pack_counts blocked_ms=$pack_elapsed"

# A different pack identity must also wait for the reservation lock, then fail
# with the contract's 23505 conflict while leaving the committed pack singular.
export FLOW4_COMPETING_PACK_READY="$competing_pack_ready"
psql -v ON_ERROR_STOP=1 --no-psqlrc >"$competing_pack_log" 2>&1 <<'SQL' &
begin;
select 1 from dflow.sample_reservation
 where sample_reservation_id='16070000-0000-4000-8000-000000000003' for update;
\! touch "$FLOW4_COMPETING_PACK_READY"
select pg_sleep(1.25);
commit;
SQL
competing_pack_pid=$!
for _ in $(seq 1 100); do [[ -f "$competing_pack_ready" ]] && break; sleep 0.02; done
[[ -f "$competing_pack_ready" ]] || { echo 'competing pack blocker never proved it held the reservation lock' >&2; exit 1; }
competing_pack_started=$(date +%s%3N)
set +e
competing_pack_output=$(psql --no-psqlrc -v ON_ERROR_STOP=1 2>&1 <<'SQL'
\set VERBOSITY verbose
select sample_reservation_id from dflow.pack_sample_reservation(
  '16070000-0000-4000-8000-000000000003',160700001,160700000001,
  'ningbo','office','nyo','ningbo_to_nyc','ningbo-user','ningbo',
  'pack-competing','pack-competing-hash'
);
SQL
)
competing_pack_status=$?
set -e
competing_pack_elapsed=$(( $(date +%s%3N) - competing_pack_started ))
wait "$competing_pack_pid" || { cat "$competing_pack_log" >&2; exit 1; }
competing_pack_counts=$(psql -v ON_ERROR_STOP=1 --no-psqlrc -Atqc "select (select count(*) from dflow.sample_shipment_item where box_id_fk=160700001)::text||'|'||(select count(*) from dflow.sample_shipment_line where box_id_fk=160700001)::text")
[[ "$competing_pack_status" -ne 0 && "$competing_pack_output" == *"23505"* \
   && "$competing_pack_counts" == "1|1" && "$competing_pack_elapsed" -ge 700 ]] || {
  echo "competing pack overlap failed: status=$competing_pack_status counts=$competing_pack_counts blocked_ms=$competing_pack_elapsed" >&2
  echo "$competing_pack_output" >&2
  exit 1
}
echo "FLOW4 COMPETING PACK CONCURRENCY PASS sqlstate=23505 counts=$competing_pack_counts blocked_ms=$competing_pack_elapsed"
