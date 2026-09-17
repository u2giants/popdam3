import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { inspect, inspectMigrations, KNOWN_LICENSED_DIVISION_HEADS } from './check-prepack-exclusion.mjs';

// 1. The repository as it stands must pass.
const result = spawnSync(process.execPath, ['scripts/check-prepack-exclusion.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /Prepack exclusion check passed/);

// 2. The guard must be able to FAIL. A check that has only ever been shown a
// clean tree is not evidence. Each dirty case below is a way the exclusion has
// actually been got wrong, or was got wrong in issue #2611 itself.

const CLEAN = `
create or replace function plm.prepack_role(p_item_no text, p_company_code text, p_division_code text)
returns text language sql stable as $$
  select case
    when exists (select 1 from coldlion.prod_history_component c
                 where btrim(c.prepack_item_no) = btrim(p_item_no)) then 'head'
    when exists (select 1 from coldlion.item_detail d
                 where d.company_code = p_company_code
                   and btrim(d.item_no) = btrim(p_item_no)
                   and nullif(btrim(d.pre_pack_code), '') is not null) then 'member'
    else null
  end;
$$;

create or replace view plm.item_missing_attribution as
select item.id from plm.item item
where (item.licensor_id is null or item.property_id is null)
  and coalesce(item.raw ->> 'divisionCode', '') not in ('EH001', 'EP001')
  and plm.prepack_role(item.item_number, item.raw ->> 'companyCode', item.raw ->> 'divisionCode') is null;
`;

assert.deepEqual(inspect(CLEAN), [], 'a correct definition must produce no failures');

// The exclusion reverted to prose: the filter is simply gone.
const noFilter = CLEAN.replace(
  /\n\s*and plm\.prepack_role[\s\S]*?is null;/,
  ';',
);
assert.ok(
  inspect(noFilter).some((f) => f.includes(KNOWN_LICENSED_DIVISION_HEADS[0])),
  'dropping the prepack filter must fail, naming a known head',
);

// The test is called but its result is ignored -- excludes nothing.
const roleIgnored = CLEAN.replace(
  /plm\.prepack_role\(item\.item_number, item\.raw ->> 'companyCode', item\.raw ->> 'divisionCode'\) is null/,
  "plm.prepack_role(item.item_number, item.raw ->> 'companyCode', item.raw ->> 'divisionCode') is not null or true",
);
assert.ok(
  inspect(roleIgnored).some((f) => f.includes('does not require it to be null')),
  'calling the role function without requiring null must fail',
);

// Only heads excluded, members left in -- the #2611 framing, which the
// re-derivation showed accounts for 7 of 1,770 excluded rows.
const headsOnly = CLEAN.replace(/then 'member'/, "then null");
assert.ok(
  inspect(headsOnly).some((f) => f.includes("no longer returns 'member'")),
  'dropping the member role must fail',
);

// The head source swapped back to the frozen DesignFlow snapshot.
const wrongSource = CLEAN.replace(
  /coldlion\.prod_history_component c\s*\n\s*where btrim\(c\.prepack_item_no\)/,
  'public.erp_items_current c\n                 where btrim(c.prepack_code)',
).replace(
  'from plm.item item',
  'from plm.item item join public.erp_items_current e on e.item_number = item.item_number',
);
const wrongSourceFailures = inspect(wrongSource);
assert.ok(
  wrongSourceFailures.some((f) => f.includes('erp_items_current')),
  'reintroducing the retired DesignFlow snapshot must fail',
);
assert.ok(
  wrongSourceFailures.some((f) => f.includes('prod_history_component')),
  'losing the transaction-attested head source must fail',
);

// The non-licensed-division exclusion dropped.
const noDivisions = CLEAN.replace(
  /\n\s*and coalesce\(item\.raw ->> 'divisionCode', ''\) not in \('EH001', 'EP001'\)/,
  '',
);
assert.equal(
  inspect(noDivisions).filter((f) => f.includes('non-licensed division')).length,
  2,
  'dropping the non-licensed divisions must fail for both of them',
);

// A comment mentioning the function does not count as calling it.
const commentedOut = noFilter.replace(
  'create or replace view plm.item_missing_attribution as',
  '-- and plm.prepack_role(...) is null\ncreate or replace view plm.item_missing_attribution as',
);
assert.ok(
  inspect(commentedOut).some((f) => f.includes(KNOWN_LICENSED_DIVISION_HEADS[0])),
  'a commented-out filter must not satisfy the guard',
);

// Only members excluded, heads left in -- the symmetric weakening.
const membersOnly = CLEAN.replace(/then 'head'/, 'then null');
assert.ok(
  inspect(membersOnly).some((f) => f.includes("no longer returns 'head'")),
  'dropping the head role must fail',
);

// The retired snapshot reintroduced inside the role function only.
const snapshotInFunction = CLEAN.replace(
  'else null',
  "when exists (select 1 from public.erp_items_current e where e.item_number = p_item_no) then 'member'\n    else null",
);
assert.ok(
  inspect(snapshotInFunction).some((f) => f.includes('plm.prepack_role references public.erp_items_current')),
  'reintroducing the retired snapshot inside the role function must fail',
);

// A LATER migration replaces only the role function and never names the view.
// The newest definition of each object must be judged on its own.
const fnOnly = CLEAN.slice(0, CLEAN.indexOf('create or replace view')).replace(/then 'member'/, 'then null');
const split = inspectMigrations([
  { name: '20260101000000_prepack_exclusion.sql', sql: CLEAN },
  { name: '20260201000000_weaken_role_only.sql', sql: fnOnly },
]);
assert.ok(
  split.failures.some((f) => f.startsWith('20260201000000_weaken_role_only.sql') && f.includes("no longer returns 'member'")),
  'a later function-only migration that weakens the role must fail',
);
assert.equal(split.view, '20260101000000_prepack_exclusion.sql');
assert.deepEqual(
  inspectMigrations([{ name: '20260101000000_prepack_exclusion.sql', sql: CLEAN }]).failures,
  [],
  'a correct single migration must produce no failures',
);

console.log('Prepack exclusion test passed: guard verified green on the tree and red on 10 dirty cases.');
