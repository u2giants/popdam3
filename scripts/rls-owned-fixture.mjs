import {successfulLibraryResponse} from './rls-library-live-proof.mjs';
// Fixed #4427 fixture protocol. No arbitrary SQL, table, actor or callback input.
import { createHash } from 'node:crypto';
export const FIXTURE_ID = 'acfe841c-e9ab-4e37-a064-ad77fe83583b';
export const MANIFEST_SHA256 = 'de98b15b35c04e03802edc562045731b322177a798742250440edd0b26a76bce';
export const FIXED_COUNTS = `SELECT
 (SELECT count(*)::int FROM public.style_groups WHERE id=$1::uuid OR sku=$2 OR folder_path=$3) AS groups,
 (SELECT count(*)::int FROM public.dam_search_documents WHERE (document_type='style_group' AND entity_id=$1::uuid) OR style_group_id=$1::uuid) AS documents,
 (SELECT count(*)::int FROM public.dam_search_keys WHERE (document_type='style_group' AND entity_id=$1::uuid) OR style_group_id=$1::uuid) AS keys,
 (SELECT count(*)::int FROM public.assets WHERE style_group_id=$1::uuid) AS assets,
 (SELECT count(*)::int FROM public.style_group_tags WHERE style_group_id=$1::uuid) AS tags,
 (SELECT count(*)::int FROM plm.style_tracker_item_bridge WHERE style_group_id=$1::uuid) AS bridges`;
export const countKeys = ['groups','documents','keys','assets','tags','bridges'];
const NULL_REFS = ['primary_asset_id','licensor_id','property_id','customer_id'];
const check = (ok) => { if (!ok) throw new Error('fixture guard'); };
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function validateManifest(m) {
  check(m.schema_version === 1 && m.issue === 4427 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(m.id));
  check(m.id === FIXTURE_ID);
  check(m.sku === `AI-QA-4427-${m.id}` && m.folder_path === `__AI_QA_4427__/${m.id}`);
  check(m.original === 'other' && m.temporary === 'product_ideas' && new Date(m.latest_file_date).toISOString() === m.latest_file_date);
  check(m.project === 'qsllyeztdwjgirsysgai' && m.host === 'aws-1-us-east-1.pooler.supabase.com' && m.port === 6543);
  check(/^[a-f0-9]{64}$/.test(m.ca_sha256) && m.dependencies.sdk === '2.97.0' && m.dependencies.pg === '8.23.1');
  return m;
}
export function fixturePayload(m) {
  validateManifest(m);
  return {id:m.id,sku:m.sku,folder_path:m.folder_path,asset_count:0,is_licensed:false,
    primary_asset_id:null,licensor_id:null,property_id:null,customer_id:null,
    workflow_status:m.original,latest_file_date:m.latest_file_date};
}
export function invariant(row, m, status) {
  check(row && row.id === m.id && row.sku === m.sku && row.folder_path === m.folder_path);
  check(row.asset_count === 0 && row.is_licensed === false && row.workflow_status === status);
  check(NULL_REFS.every(k => row[k] === null) && ['stage','customer','program'].every(k => row[k] === null));
  check(Date.parse(row.latest_file_date) === Date.parse(m.latest_file_date) && Number.isFinite(Date.parse(row.updated_at)));
  return row;
}
export function unchangedBusiness(row, original) {
  const strip = value => Object.fromEntries(Object.entries(value).filter(([k]) => !['updated_at','workflow_status'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
  check(digest(strip(row)) === digest(strip(original)));
}
export function zeroReferences(c) {
  check(c && countKeys.every(k => Number.isInteger(c[k]) && c[k] >= 0));
  check(c.assets === 0 && c.tags === 0 && c.bridges === 0);
}
export async function protectedCounts({Client,password,ca,manifest}) {
  const m = validateManifest(manifest);
  check(digest(ca) === m.ca_sha256);
  const db = new Client({host:m.host,port:m.port,user:`postgres.${m.project}`,database:'postgres',password,
    ssl:{rejectUnauthorized:true,ca},connectionTimeoutMillis:12000});
  let begun = false;
  try {
    await db.connect(); begun = true;
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL default_transaction_read_only='on'");
    const identity = (await db.query("SELECT current_setting('transaction_read_only') AS ro,current_setting('default_transaction_read_only') AS default_ro,current_database() AS database_name,current_setting('supabase.project_ref',true) AS project_ref")).rows[0];
    check(identity.ro === 'on' && identity.default_ro === 'on' && identity.database_name === 'postgres' && (!identity.project_ref || identity.project_ref === m.project));
    await db.query("SET LOCAL statement_timeout='15s'");
    await db.query("SET LOCAL lock_timeout='3s'");
    const result = await db.query(FIXED_COUNTS,[m.id,m.sku,m.folder_path]);
    check(result.rows.length === 1); zeroReferences(result.rows[0]); return result.rows[0];
  } finally { try { if (begun) await db.query('ROLLBACK'); } finally { await db.end(); } }
}
export function createFixtureProtocol({client,counts,manifest,credentials}) {
  const m = validateManifest(manifest);
  const result = {created:false,ui_changed:false,ui_restored:false,deleted:false,derived_absent:false,sdk_auth_attempted:false,sdk_signed_out:false,pending_fixture:false,passed:false};
  let baseline, expected, nextStatus = null, changes = 0;
  const read = async () => { const r = await client.from('style_groups').select('*').eq('id',m.id); check(!r.error && Array.isArray(r.data) && r.data.length === 1); return r.data[0]; };
  const safeRead = async status => { const row = invariant(await read(),m,status); if (baseline) unchangedBusiness(row,baseline); return row; };
  async function uiTransition(page,status) {
    const current = await safeRead(status === m.temporary ? m.original : m.temporary);
    if (expected) check(current.updated_at === expected.updated_at);
    const card = page.getByRole('button').filter({has:page.getByText(m.sku,{exact:true})});
    check(await card.count() === 1); await card.click();
    const picker = page.getByRole('combobox').filter({hasText:'Set workflow…'});
    check(await picker.count() === 1); nextStatus = status;
    await picker.click();
    const response = page.waitForResponse(r => r.url().includes('/rest/v1/style_groups?') && r.request().method() === 'PATCH' && r.status() >= 200 && r.status() < 300, {timeout:15000});
    await page.getByRole('option',{name:new RegExp(`^${status.replaceAll('_',' ')}$`,'i')}).click();
    const responseRows = await (await response).json();
    check(Array.isArray(responseRows) && responseRows.length === 1 && Object.keys(responseRows[0] || {}).length === 1 && responseRows[0].id === m.id);
    check(nextStatus === null);
    expected = await safeRead(status);
    const reloaded = page.waitForResponse(successfulLibraryResponse,{timeout:15000});
    await page.reload({waitUntil:'domcontentloaded'});
    const browserRows = await (await reloaded).json();
    check(Array.isArray(browserRows) && browserRows.length <= 1000);
    const owned = browserRows.filter(row=>row.id===m.id); check(owned.length===1); invariant(owned[0],m,status);
    await page.getByText(m.sku,{exact:true}).first().waitFor({state:'visible',timeout:15000});
    const after = await safeRead(status); check(after.updated_at === expected.updated_at);
  }
  return {
    async prepare() {
      check(credentials?.email==='ai-admin@designflow.app'&&typeof credentials.password==='string'&&credentials.password.length>0);
      result.sdk_auth_attempted=true;
      const auth=await client.auth.signInWithPassword(credentials);check(!auth.error);
      const before = await counts(); check(countKeys.every(k=>before[k]===0));
      const actor = await client.auth.getUser(); check(!actor.error && actor.data.user?.email === 'ai-admin@designflow.app');
      const roles = await client.from('user_roles').select('role').eq('user_id',actor.data.user.id).limit(10);
      check(!roles.error && roles.data.some(r=>r.role==='admin'));
      // An ambiguous insert leaves pending truth; never retry or delete an unproved row.
      result.pending_fixture = true;
      const insert = await client.from('style_groups').insert(fixturePayload(m)).select('*');
      check(!insert.error && insert.data?.length === 1);
      baseline = invariant(insert.data[0],m,m.original); expected = baseline; result.created = true;
    },
    permitPatch(url,body) {
      if (!nextStatus || changes >= 2 || url.origin !== `https://${m.project}.supabase.co` || url.pathname !== '/rest/v1/style_groups') return false;
      if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || body.workflow_status !== nextStatus) return false;
      if (![...url.searchParams.keys()].every(k=>['id','select'].includes(k)) || url.searchParams.getAll('id').length !== 1) return false;
      if (![ `in.(${m.id})`, `in.("${m.id}")` ].includes(url.searchParams.get('id')) || url.searchParams.get('select') !== 'id') return false;
      nextStatus = null; changes++; return true;
    },
    async exercise(page) {
      try { await uiTransition(page,m.temporary); result.ui_changed = true; }
      finally {
        // Actual read decides whether restoration is required after uncertain UI receipt.
        const current = await read();
        if (current.workflow_status === m.temporary && changes === 1) { expected = invariant(current,m,m.temporary); unchangedBusiness(expected,baseline); await uiTransition(page,m.original); result.ui_restored = true; }
      }
    },
    async cleanup() {
      try {
        if (result.created) {
          const row = await safeRead(m.original); check(expected && row.updated_at === expected.updated_at);
          const before = await counts(); check(before.groups === 1); zeroReferences(before);
          const again = await safeRead(m.original); check(again.updated_at === row.updated_at);
          let q = client.from('style_groups').delete().eq('id',m.id).eq('sku',m.sku).eq('folder_path',m.folder_path)
            .eq('workflow_status',m.original).eq('updated_at',again.updated_at).eq('asset_count',0).eq('is_licensed',false).eq('latest_file_date',again.latest_file_date);
          for (const k of NULL_REFS) q = q.is(k,null);
          const deleted = await q.select('id'); check(!deleted.error && deleted.data?.length === 1 && deleted.data[0].id === m.id); result.deleted = true;
          const absence = await client.from('style_groups').select('id').eq('id',m.id); check(!absence.error && absence.data?.length === 0);
          const after = await counts(); check(countKeys.every(k=>after[k]===0)); result.derived_absent = true; result.pending_fixture = false;
        }
      } finally {
        if(result.sdk_auth_attempted){const signedOut = await client.auth.signOut({scope:'local'}); result.sdk_signed_out = !signedOut.error;}
        result.passed = result.created && result.ui_changed && result.ui_restored && result.deleted && result.derived_absent && result.sdk_signed_out;
      }
    },
    summary() { return {...result}; }
  };
}
