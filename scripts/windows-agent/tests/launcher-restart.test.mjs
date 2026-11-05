import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const launcher = fileURLToPath(new URL('../popdam-launcher.bat', import.meta.url));

test('restart status inside the cmd IF block contains no syntax parentheses', async () => {
  const body = await readFile(launcher, 'utf8');
  const line = body.split(/\r?\n/).find(line => /echo.*exited with code 77/.test(line));
  assert.ok(line);
  assert.doesNotMatch(line, /[()]/);
  assert.match(body, /if %EXIT_CODE% equ 77 \([\s\S]*?goto map_drive\s*\)/);
});

test('real Windows cmd restarts after exit 77 and preserves ordinary crash recovery', {
  skip: process.platform !== 'win32' ? 'requires Windows cmd.exe; exercised on the render host' : false,
  timeout: 25000,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'popdam launcher regression '));
  const isolatedLauncher = path.join(directory, 'popdam-launcher.bat');
  const count = path.join(directory, 'starts.txt');
  let child;
  try {
    await mkdir(path.join(directory, 'dist'));
    await copyFile(launcher, isolatedLauncher);
    await copyFile(process.execPath, path.join(directory, 'node.exe'));
    await writeFile(path.join(directory, 'dist', 'index.js'), `
const fs = require('node:fs');
const counter = process.env.POPDAM_LAUNCHER_TEST_COUNTER;
const starts = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) + 1 : 1;
fs.writeFileSync(counter, String(starts));
process.exit(starts === 1 ? 77 : 0);
`);
    // This private child has no agent config and cannot map production drives.
    child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${isolatedLauncher}""`], {
      cwd: directory,
      windowsVerbatimArguments: true,
      env: { ...process.env, ProgramData: path.join(directory, 'private-program-data'), POPDAM_LAUNCHER_TEST_COUNTER: count },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`launcher did not restart: ${output} ${errors}`)), 18000);
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (/Agent exited with code 0/.test(output)) { clearTimeout(deadline); resolve(); }
      });
      child.stderr.on('data', chunk => { errors += chunk.toString(); });
      child.once('error', error => { clearTimeout(deadline); reject(error); });
      child.once('close', code => { clearTimeout(deadline); reject(new Error(`launcher exited ${code}: ${output} ${errors}`)); });
    });
    assert.match(output, /code 77 - update\/rollback - restarting immediately/);
    assert.match(output, /code 0.*restarting in 5 seconds/);
    assert.equal(await readFile(count, 'utf8'), '2');
    assert.doesNotMatch(errors, /unexpected at this time/i);
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve));
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
