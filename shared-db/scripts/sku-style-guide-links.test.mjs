import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const combined = readFileSync(new URL('../supabase/migrations/20261030043848_sku_style_guide_links.sql', import.meta.url), 'utf8');
// One claim reserves one migration version, so both halves ship in one file.
// Split on the resolver-half banner so each test can scope its assertions.
const splitAt = combined.indexOf('-- Item -> licensor-scrape style guide links (resolver half).');
const schema = splitAt === -1 ? combined : combined.slice(0, splitAt);
const resolver = splitAt === -1 ? '' : combined.slice(splitAt);
const sql = schema.replace(/--[^\n]*/g, '');
const view = sql.match(/create or replace view plm\.asset_file_style_guide_index[\s\S]*?;/i)[0];

test('internal invoker index cannot advertise browser access to restricted ASGARD data', () => {
  assert.match(view, /security_invoker = true/);
  assert.match(view, /plm\.marvel_asgard_node_asset_observation/);
  assert.match(sql, /revoke all on plm\.asset_file_style_guide_index from public, anon, authenticated;/);
  assert.match(sql, /grant select on plm\.asset_file_style_guide_index to service_role;/);
  assert.doesNotMatch(sql, /grant[^;]*on plm\.asset_file_style_guide_index to[^;]*authenticated/);
  assert.match(sql, /grant select on public\.sku_style_guide_links to authenticated;/);
});

test('direct-source index retains all eight direct portals and excludes inferred candidates', () => {
  const portals = [...view.matchAll(/'([^']+)'(?:::text)?\s*(?:as source_system)?\s*,/g)]
    .map(m => m[1]).filter(s => !s.includes(' '));
  for (const name of ['disney_dcpvault', 'lucasfilm_dcpvault', 'marvel_dcpvault', 'marvel_asgard', 'nbcu', 'warner_starlabs', 'peanuts_tenovos', 'sesame_netx']) {
    assert.ok(portals.includes(name), `missing direct portal ${name}`);
  }
  assert.doesNotMatch(view, /plm\.(sega_|wildbrain_)/);
  assert.equal((view.match(/union all/gi) || []).length, 7);
});

test('nightly resolver remains service-only and scheduled after file resolution', () => {
  assert.match(resolver, /revoke all on function public\.resolve_sku_style_guide_links\(\) from public, anon, authenticated;/);
  assert.match(resolver, /grant execute on function public\.resolve_sku_style_guide_links\(\) to service_role, postgres;/);
  assert.match(resolver, /'resolve-sku-style-guide-links-nightly',\s*'30 4 \* \* \*',\s*\$\$select public\.resolve_sku_style_guide_links\(\)\$\$/);
});


test('browser privileges are explicitly cleared before narrow grants', () => {
  assert.match(sql, /revoke all on public\.sku_style_guide_links from public, anon, authenticated;/);
  for (const signature of ['backfill_pdf_files_used()', 'backfill_pdf_files_used_v2()', 'parse_pdf_files_used(uuid)', 'parse_pdf_files_used_v2(uuid)', 'parse_pdf_declared_style_guide(uuid)']) {
    assert.ok(resolver.includes(`revoke all on function public.${signature} from public, anon, authenticated;`), signature);
    assert.ok(resolver.includes(`grant execute on function public.${signature} to service_role, postgres;`), signature);
  }
  assert.doesNotMatch(combined, /20261030040817/);
});

test('parser logic lives in migration-owned names the harness cannot restore', () => {
  // database-contract-tests.yml re-applies the pre-adoption baseline after the
  // migrations replay, restoring any routine the baseline also defines. The real
  // parser must therefore live under a name the baseline has never seen.
  assert.match(resolver, /create or replace function public\.parse_pdf_files_used_v2\(p_asset_id uuid\)/);
  assert.match(resolver, /create or replace function public\.backfill_pdf_files_used_v2\(\)/);
  assert.match(resolver, /regexp_split_to_array\(v_inline, '\[,;\|\]'\)/);
  assert.match(resolver, /is_plausible_source_file_name\(v_entry\)/);
  // Legacy names delegate instead of duplicating the logic.
  assert.match(resolver, /return public\.parse_pdf_files_used_v2\(p_asset_id\);/);
  assert.match(resolver, /return public\.backfill_pdf_files_used_v2\(\);/);
});


test('resolver folds repeated evidence to each conflict identity and refreshes the method', () => {
  assert.match(resolver, /group by s\.sku, s\.file_name, i\.source_system, i\.source_style_guide_key\s*\)/);
  assert.match(resolver, /bool_or\(lower\(btrim\(s\.file_name\)\) = lower\(btrim\(i\.matched_file_name\)\)\)/);
  assert.match(resolver, /match_method\s*= excluded\.match_method/);
  assert.match(resolver, /group by sku, public\.style_guide_label_norm\(label\)/);
  assert.match(resolver, /group by d\.sku, g\.source_system, g\.source_style_guide_key/);
});

test('migration invokes the historical backfill after restricting execution', () => {
  const invocation = resolver.indexOf('select public.backfill_pdf_files_used_v2();');
  assert.ok(invocation > resolver.indexOf('grant execute on function public.backfill_pdf_files_used_v2() to service_role, postgres;'));
});
