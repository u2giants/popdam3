import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/check-business-rule-library.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /Business-rule library check passed/);
console.log('Business-rule library test passed.');
