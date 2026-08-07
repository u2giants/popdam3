#!/usr/bin/env node
const { Client } = require('pg');
const { createHash } = require('crypto');
const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');

const outDir = process.argv[2];
if (!outDir || (!process.env.DATABASE_URL && !process.env.PROD_DB_PASSWORD)) {
  throw new Error('usage: PROD_DB_PASSWORD=... node script OUT_DIR');
}
mkdirSync(outDir, { recursive: true });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function coldlion(path, params = {}) {
  const url = new URL(`http://x5.coldlion.com/EhpApi/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { 'X-API-Key': process.env.COLDLION_API_KEY } });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return { url: url.toString(), body: await response.json() };
}

async function main() {
  const connectionString = process.env.DATABASE_URL || `postgresql://postgres.qsllyeztdwjgirsysgai:${encodeURIComponent(process.env.PROD_DB_PASSWORD)}@aws-1-us-east-1.pooler.supabase.com:6543/postgres`;
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const wanted = [
    ['core','packaging_type'], ['core','product_size'], ['core','creative_designer'],
    ['core','factory'], ['core','factory_source_ref'], ['plm','erp_vendor'],
    ['dflow','itemDepth'], ['dflow','merchGroup'], ['dflow','merchGroupHeaders'],
    ['dflow','itemHeader'], ['dflow','productUserAssignment'], ['dflow','Factory'], ['dflow','users']
  ];
  const database = (await client.query(`select current_database() database, current_user db_user,
    inet_server_addr()::text server_addr, version()`)).rows[0];
  const tables = {};
  for (const [schema, table] of wanted) {
    const exists = (await client.query(`select to_regclass($1) is not null as exists`, [`${schema}."${table}"`])).rows[0].exists;
    const key = `${schema}.${table}`;
    if (!exists) { tables[key] = { exists: false }; continue; }
    const columns = (await client.query(`select column_name, data_type, is_nullable
      from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position`, [schema, table])).rows;
    const count = Number((await client.query(`select count(*)::bigint n from "${schema}"."${table}"`)).rows[0].n);
    tables[key] = { exists: true, count, columns };
  }
  const ledger = (await client.query(`select version, name from supabase_migrations.schema_migrations
    where lower(coalesce(name,'')) like '%product%size%' or lower(coalesce(name,'')) like '%depth%'
    order by version`)).rows;
  const snapshots = {};
  for (const [key, meta] of Object.entries(tables)) {
    if (!meta.exists || meta.count > 5000) continue;
    const [schema, table] = key.split('.');
    snapshots[key] = (await client.query(`select * from "${schema}"."${table}" order by 1`)).rows.map(row => {
      const safe = { ...row };
      for (const field of ['passw', 'password', 'token', 'secret']) if (field in safe) safe[field] = '[REDACTED]';
      return safe;
    });
  }
  const analyses = {};
  const analysisSql = {
    packagingUsage: `select coalesce(nullif(btrim(udf_freeform_06),''),'(blank)') value, count(*)::bigint usage_count from dflow."itemHeader" group by 1 order by 2 desc,1`,
    mg04Mirror: `select "divisionCode_fk", "divisionCode_id_fk", mg_code, mg_desc, is_active, mg_id from dflow."merchGroup" where "mgTypeCode"='04' order by "divisionCode_fk",mg_code,mg_id`,
    mg04Usage: `select udf_merchgroup04_id, udf_merchgroup04, count(*)::bigint usage_count from dflow."itemHeader" where udf_merchgroup04_id is not null or nullif(btrim(udf_merchgroup04),'') is not null group by 1,2 order by 3 desc`,
    depthUsage: `select coalesce(nullif(btrim(item_depth_size),''),'(blank)') value, count(*)::bigint usage_count from dflow."itemHeader" group by 1 order by 2 desc,1`,
    vendorUsage: `select vendor_code_fk, count(*)::bigint usage_count from dflow."itemHeader" where vendor_code_fk is not null group by 1 order by 2 desc,1`,
    assignments: `select * from dflow."productUserAssignment" order by id`,
    assignmentRoles: `select role, count(*)::bigint assignment_count, count(distinct item_id_fk)::bigint item_count, count(distinct user_id_fk)::bigint person_count from dflow."productUserAssignment" group by role order by role`,
    depthMirrorFreshness: `select max("itemDepth_airbyte_emitted_at") latest_airbyte_at from dflow."itemDepth"`,
    relevantConstraints: `select tc.table_schema,tc.table_name,tc.constraint_name,kcu.column_name,ccu.table_schema foreign_schema,ccu.table_name foreign_table,ccu.column_name foreign_column from information_schema.table_constraints tc join information_schema.key_column_usage kcu using (constraint_catalog,constraint_schema,constraint_name) join information_schema.constraint_column_usage ccu using (constraint_catalog,constraint_schema,constraint_name) where tc.constraint_type='FOREIGN KEY' and tc.table_schema='dflow' and tc.table_name in ('productUserAssignment','itemHeader') order by tc.table_name,kcu.column_name`
  };
  for (const [name, sql] of Object.entries(analysisSql)) analyses[name] = (await client.query(sql)).rows;
  await client.end();

  const priorPath = join(outDir, 'baseline.json');
  const prior = require('fs').existsSync(priorPath) ? JSON.parse(require('fs').readFileSync(priorPath, 'utf8')) : null;
  if (!process.env.COLDLION_API_KEY && !prior?.coldlion) throw new Error('COLDLION_API_KEY required for the first capture');
  let coldlionOutput = prior?.coldlion;
  if (process.env.COLDLION_API_KEY) {
  const headersCall = await coldlion('merchGroupHeaders', { companyCode: 'EDGEHOME', size: '200', page: '0' });
  const headerRows = Array.isArray(headersCall.body) ? headersCall.body : headersCall.body.content;
  if (!Array.isArray(headerRows)) throw new Error('merchGroupHeaders payload shape changed');
  const sizeHeaders = headerRows.filter(r => /size/i.test(String(r.mgTypeDesc ?? r.mg_type_desc ?? '')));
  const detailCalls = [];
  for (const row of sizeHeaders) {
    const divisionCode = String(row.divisionCode ?? row.division_code ?? '');
    const mgTypeCode = String(row.mgTypeCode ?? row.mg_type_code ?? '');
    const call = await coldlion('merchGroupDetails', { companyCode: 'EDGEHOME', divisionCode, mgTypeCode });
    if (!Array.isArray(call.body)) throw new Error(`merchGroupDetails ${divisionCode}/${mgTypeCode} was not a plain array`);
    detailCalls.push({ divisionCode, mgTypeCode, rowCount: call.body.length, sha256: hash(call.body), rows: call.body });
  }
  coldlionOutput = {
      headersRequest: headersCall.url, headersPayloadKind: Array.isArray(headersCall.body) ? 'plain-array' : 'paged-envelope',
      headersCount: headerRows.length, headersSha256: hash(headerRows),
      headersPagination: Array.isArray(headersCall.body) ? null : {
        number: headersCall.body.number, size: headersCall.body.size,
        totalElements: headersCall.body.totalElements, totalPages: headersCall.body.totalPages,
        first: headersCall.body.first, last: headersCall.body.last,
        numberOfElements: headersCall.body.numberOfElements
      },
      sizeHeaders, detailCalls
    };
  }
  const output = {
    capturedAt: new Date().toISOString(), database, tables, ledger,
    coldlion: coldlionOutput, snapshots, analyses
  };
  writeFileSync(join(outDir, 'baseline.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ database, tableCounts: Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.exists?v.count:null])), ledger, coldlion: output.coldlion }, null, 2));
}
main().catch(error => { console.error(error.message); process.exit(1); });
