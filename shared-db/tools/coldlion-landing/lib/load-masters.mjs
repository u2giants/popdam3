import { sqlDate, sqlNumber, sqlText, sqlTimestamp, sqlUuid } from "./values.mjs";

const PG = { text: "text", keytext: "text", num: "numeric", date: "date", ts: "timestamptz" };
const emitters = { text: sqlText, keytext: sqlText, num: sqlNumber, date: sqlDate, ts: sqlTimestamp };
const BATCH = 300;

function stageSql(name, spec, rows) {
  const columns = [...spec.fields.map((x) => [x.column, PG[x.type]]), ["source_hash","text"], ["source_raw","jsonb"], ["run_id","uuid"], ["fetched_at","timestamptz"]];
  const create = `create temp table ${name} (\n  ${columns.map(([c,t]) => `${c} ${t}`).join(",\n  ")}\n) on commit drop;`;
  const statements = [];
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    statements.push(`insert into ${name} (${columns.map(([c]) => c).join(", ")}) values\n${batch.map((row) => `  (${[
      ...spec.fields.map((field) => emitters[field.type](row[field.column])), sqlText(row.source_hash), `${sqlText(JSON.stringify(row.source_raw))}::jsonb`, sqlUuid(row.run_id), sqlTimestamp(row.fetched_at),
    ].join(", ")})`).join(",\n")};`);
  }
  return [create, ...statements].join("\n");
}

function currentTableSql(table, spec, rows) {
  const stage = `_stage_${table}`;
  const keys = spec.key;
  const data = spec.fields.map((x) => x.column);
  const all = [...data, "run_id", "fetched_at", "source_hash", "first_seen_at", "last_seen_at"];
  const join = keys.map((key) => `t.${key} = s.${key}`).join(" and ");
  const naturalKey = `jsonb_build_object(${keys.flatMap((key) => [sqlText(key), `s.${key}`]).join(", ")})`;
  const previous = `(to_jsonb(t) - array['run_id','fetched_at','first_seen_at','last_seen_at']::text[])`;
  const priorRaw = `coalesce((select cl.new_raw from coldlion.change_log cl where cl.table_name=${sqlText(table)} and cl.natural_key=${naturalKey} order by cl.changed_at desc limit 1), ${previous})`;
  const updates = [...data.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`), "run_id = excluded.run_id", "fetched_at = excluded.fetched_at", "source_hash = excluded.source_hash", "last_seen_at = excluded.last_seen_at"].join(",\n      ");
  return `${stageSql(stage, spec, rows)}
create temp table _counts_${table} on commit drop as
select count(*) filter (where t.${keys[0]} is null) as inserted,
       count(*) filter (where t.${keys[0]} is not null and t.source_hash <> s.source_hash) as updated,
       count(*) filter (where t.${keys[0]} is not null and t.source_hash = s.source_hash) as unchanged
  from ${stage} s left join coldlion.${table} t on ${join};

insert into coldlion.change_log
  (table_name, natural_key, change_kind, previous_source_hash, new_source_hash, previous_raw, new_raw, run_id)
select ${sqlText(table)}, ${naturalKey}, case when t.${keys[0]} is null then 'inserted' else 'updated' end,
       t.source_hash, s.source_hash, case when t.${keys[0]} is null then null else ${priorRaw} end, s.source_raw, s.run_id
  from ${stage} s left join coldlion.${table} t on ${join}
 where t.${keys[0]} is null or t.source_hash <> s.source_hash;

insert into coldlion.${table} (${all.join(", ")})
select ${data.map((c) => `s.${c}`).join(", ")}, s.run_id, s.fetched_at, s.source_hash, s.fetched_at, s.fetched_at
  from ${stage} s
on conflict (${keys.join(", ")}) do update set
      ${updates};`;
}

function slotStageSql(rows) {
  const columns = [["company_code","text"],["division_code","text"],["item_no","text"],["item_pkey","text"],["slot_no","smallint"],["mg_code","text"],["mg_desc","text"],["run_id","uuid"],["fetched_at","timestamptz"],["source_hash","text"]];
  const out = [`create temp table _stage_item_merch_group (${columns.map(([c,t]) => `${c} ${t}`).join(", ")}) on commit drop;`];
  for (let start=0; start<rows.length; start+=BATCH) {
    out.push(`insert into _stage_item_merch_group (${columns.map(([c])=>c).join(", ")}) values\n${rows.slice(start,start+BATCH).map((r)=>`  (${sqlText(r.company_code)}, ${sqlText(r.division_code)}, ${sqlText(r.item_no)}, ${sqlText(r.item_pkey)}, ${sqlNumber(r.slot_no)}, ${sqlText(r.mg_code)}, ${sqlText(r.mg_desc)}, ${sqlUuid(r.run_id)}, ${sqlTimestamp(r.fetched_at)}, ${sqlText(r.source_hash)})`).join(",\n")};`);
  }
  return out.join("\n");
}

function itemSlotSql(rows, affected) {
  const affectedValues = affected.map((r) => `  (${sqlText(r.company_code)}, ${sqlText(r.division_code)}, ${sqlText(r.item_no)}, ${sqlText(r.item_pkey)}, ${sqlUuid(r.run_id)})`).join(",\n");
  const affectedInsert = affected.length === 0 ? "" : `insert into _affected_item_grains values\n${affectedValues};`;
  return `${slotStageSql(rows)}
create temp table _affected_item_grains (company_code text, division_code text, item_no text, item_pkey text, run_id uuid) on commit drop;
${affectedInsert}

insert into coldlion.change_log
  (table_name,natural_key,change_kind,previous_source_hash,new_source_hash,previous_raw,new_raw,run_id)
select 'item_merch_group', jsonb_build_object('company_code',s.company_code,'division_code',s.division_code,'item_no',s.item_no,'item_pkey',s.item_pkey,'slot_no',s.slot_no),
       case when t.company_code is null then 'inserted' else 'updated' end, t.source_hash, s.source_hash,
       case when t.company_code is null then null else to_jsonb(t)-array['run_id','fetched_at','first_seen_at','last_seen_at']::text[] end,
       to_jsonb(s)-array['run_id','fetched_at']::text[], s.run_id
  from _stage_item_merch_group s
  left join coldlion.item_merch_group t on t.company_code=s.company_code and t.division_code=s.division_code and t.item_no=s.item_no and t.item_pkey is not distinct from s.item_pkey and t.slot_no=s.slot_no
 where t.company_code is null or t.source_hash<>s.source_hash;

insert into coldlion.change_log
  (table_name,natural_key,change_kind,previous_source_hash,new_source_hash,previous_raw,new_raw,run_id)
select 'item_merch_group', jsonb_build_object('company_code',t.company_code,'division_code',t.division_code,'item_no',t.item_no,'item_pkey',t.item_pkey,'slot_no',t.slot_no),
       'updated', t.source_hash, encode(extensions.digest('absent from current source snapshot','sha256'),'hex'),
       to_jsonb(t)-array['run_id','fetched_at','first_seen_at','last_seen_at']::text[],
       jsonb_build_object('_state','absent from current source snapshot'), a.run_id
  from coldlion.item_merch_group t join _affected_item_grains a
    on t.company_code=a.company_code and t.division_code=a.division_code and t.item_no=a.item_no and t.item_pkey is not distinct from a.item_pkey
 where not exists (select 1 from _stage_item_merch_group s where s.company_code=t.company_code and s.division_code=t.division_code and s.item_no=t.item_no and s.item_pkey is not distinct from t.item_pkey and s.slot_no=t.slot_no);

delete from coldlion.item_merch_group t
 using _affected_item_grains a
 where t.company_code=a.company_code and t.division_code=a.division_code and t.item_no=a.item_no
   and t.item_pkey is not distinct from a.item_pkey
   and not exists (select 1 from _stage_item_merch_group s where s.company_code=t.company_code and s.division_code=t.division_code and s.item_no=t.item_no and s.item_pkey is not distinct from t.item_pkey and s.slot_no=t.slot_no);

insert into coldlion.item_merch_group
  (company_code,division_code,item_no,item_pkey,slot_no,mg_code,mg_desc,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
select company_code,division_code,item_no,item_pkey,slot_no,mg_code,mg_desc,run_id,fetched_at,source_hash,fetched_at,fetched_at
from _stage_item_merch_group
on conflict on constraint item_merch_group_slot_identity do update set
  mg_code=excluded.mg_code, mg_desc=excluded.mg_desc, run_id=excluded.run_id,
  fetched_at=excluded.fetched_at, source_hash=excluded.source_hash, last_seen_at=excluded.last_seen_at;`;
}

function runStartSql(run) {
  return `insert into coldlion.sync_run (id,endpoint,company_code,request_params,status,requested_by,started_at,http_status,body_status,rows_fetched)
values (${sqlUuid(run.id)},${sqlText(run.endpoint)},${sqlText(run.companyCode)},${sqlText(JSON.stringify(run.requestParams))}::jsonb,'running',${sqlText(run.requestedBy)},${sqlTimestamp(run.startedAt)},${sqlNumber(run.httpStatus)},${sqlNumber(run.bodyStatus)},${sqlNumber(run.rowsFetched)});`;
}

function runFinishSql(table, run) {
  return `update coldlion.sync_run set status='succeeded', finished_at=${sqlTimestamp(run.finishedAt)}, duration_ms=${sqlNumber(run.durationMs)},
 rows_inserted=(select inserted from _counts_${table}), rows_updated=(select updated from _counts_${table}), rows_unchanged=(select unchanged from _counts_${table})
 where id=${sqlUuid(run.id)};`;
}

export function buildMasterLoadSql({ loads, itemSlots, affectedItemGrains }) {
  const pieces = ["begin;"];
  for (const load of loads) pieces.push(runStartSql(load.run));
  // FK parents before children.
  for (const load of loads) pieces.push(currentTableSql(load.table, load.spec, load.rows));
  pieces.push(itemSlotSql(itemSlots, affectedItemGrains));
  for (const load of loads) pieces.push(runFinishSql(load.table, load.run));
  pieces.push("commit;");
  return pieces.join("\n\n");
}
