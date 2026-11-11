import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { transformSync } = require('@babel/core');

async function loadTypeScript(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    filename: path, configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-typescript')],
  });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { loadBuySheetItemInfo } = await loadTypeScript('../lib/buy-sheet-item-info.ts');
const { suggestAssortmentDescription } = await loadTypeScript('../lib/assortment-description.ts');

const row = (sku, description = null, licensor = null) => ({
  sku_normalized: sku, item_description: description, master_data_licensor: licensor,
});

test('lowercase database keys supply Item Master product and licensor', async () => {
  const info = await loadBuySheetItemInfo(['ncv3sp1'], async (skus) => {
    assert.deepEqual(skus, ['ncv3sp1']);
    return { data: [row('ncv3sp1', 'Molded Shadowbox', 'MARVEL')], error: null };
  });
  assert.equal(suggestAssortmentDescription([
    { sku: 'NCV3SP1', sheetDescription: '12X15 ART', ...info.ncv3sp1 },
  ]), 'Marvel Molded Shadowbox 12x15"');
});

test('reads beyond 2000 historical lines and fills initially null details', async () => {
  const rows = [...Array.from({ length: 2100 }, () => row('a')), row('a', 'Canvas', 'DISNEY'), row('b', 'Printed Glass', 'MARVEL')];
  const offsets = [];
  const info = await loadBuySheetItemInfo(['a', 'b'], async (_, offset, size) => {
    offsets.push(offset);
    return { data: rows.slice(offset, offset + size), error: null };
  });
  assert.deepEqual(offsets, [0, 500, 1000, 1500, 2000]);
  assert.deepEqual(info.a, { itemDescription: 'Canvas', licensor: 'DISNEY' });
  assert.equal(info.b.licensor, 'MARVEL');
});

test('batches large sheets and finishes exact-sized pages', async () => {
  const batches = [];
  await loadBuySheetItemInfo(Array.from({ length: 51 }, (_, i) => String(i)), async (skus, offset) => {
    batches.push([skus.length, offset]);
    return { data: offset === 0 ? Array.from({ length: 500 }, () => row(skus[0])) : [], error: null };
  });
  assert.deepEqual(batches, [[50, 0], [50, 500], [1, 0], [1, 500]]);
});

test('query errors, absent data, and rejected requests propagate', async () => {
  await assert.rejects(loadBuySheetItemInfo(['a'], async () => ({ data: null, error: new Error('denied') })), /denied/);
  await assert.rejects(loadBuySheetItemInfo(['a'], async () => ({ data: null, error: null })), /unavailable/);
  await assert.rejects(loadBuySheetItemInfo(['a'], async () => { throw new Error('offline'); }), /offline/);
});

test('component normalizes query and map keys, hides unavailable suggestions, and awaits clipboard', () => {
  const source = readFileSync(new URL('../components/orders/BuySheetImportDialog.tsx', import.meta.url), 'utf8');
  assert.match(source, /map\(\(l\) => normalizeOrderSku\(l.sku\)\)/);
  assert.match(source, /itemInfo\[normalizeOrderSku\(l.sku\)/);
  assert.match(source, /\.order\("order_line_id"\)\.range\(/);
  assert.match(source, /itemInfoState === "ready" &&/);
  assert.match(source, /await navigator.clipboard.writeText\(a.description\);\s*toast.success/);
  assert.match(source, /catch \{\s*toast.error\("Description could not be copied"\)/);
});
