#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const MANDATORY_VERSIONS = [
  '20260621151155','20260701154948','20260710135600','20260710135700',
  '20260710135900','20260710135950','20260727154500','20260807030000',
  '20260823233716','20260825010603','20260825031841','20260825050407','20260825082910'
];

export function resolveBase({ candidateRefs, git }) {
  for (const ref of candidateRefs) if (git(['rev-parse', '--verify', ref])) return ref;
  throw new Error(`UNVERIFIABLE: no comparison base resolved from ${candidateRefs.join(', ')}`);
}

export function changedMigrationVersions(base, gitText) {
  if (!base) return [];
  const mergeBase = gitText(['merge-base', base, 'HEAD']).trim();
  if (!mergeBase) throw new Error('UNVERIFIABLE: merge base is empty');
  const migrations=gitText(['diff','--name-only','--diff-filter=AMR',`${mergeBase}..HEAD`,'--','supabase/migrations']).split(/\r?\n/).filter(Boolean).map(value => path.basename(value).split('_', 1)[0]);
  const deletedSidecars=gitText(['diff','--name-only','--diff-filter=D',`${mergeBase}..HEAD`,'--','scripts/production-verification-sidecars']).split(/\r?\n/).filter(Boolean).map(value=>path.basename(value,'.json'));
  return [...new Set([...migrations,...deletedSidecars])];
}
export function verifyHistoricalInventory(baseline,live){const liveByPath=new Map(live.matched_paths.map(row=>[row.path,row]));const historical=baseline.matched_paths.map(row=>liveByPath.get(row.path));if(live.total_migration_files<baseline.total_migration_files||historical.some((row,index)=>!row||row.version!==baseline.matched_paths[index].version||row.marker_count!==baseline.matched_paths[index].marker_count)||baseline.matched_count!==baseline.matched_paths.length)throw new Error('UNVERIFIABLE: reviewed historical baseline no longer matches the current detector')}
export function verifyBaseline(root){const baseline=JSON.parse(fs.readFileSync(path.join(root,'docs/verification/throughput-guard-truth-baseline-20260828.json'),'utf8'));const detector=path.join(root,'scripts/production_catalog_verification.py');const digest=crypto.createHash('sha256').update(fs.readFileSync(detector,'utf8').replace(/\r\n/g,'\n')).digest('hex');if(baseline.detector_source_sha256!==digest)throw new Error('UNVERIFIABLE: detector source changed without regenerating the reviewed baseline');const code=`import json,sys\nfrom pathlib import Path\nroot=Path(sys.argv[1]);sys.path.insert(0,str(root/'scripts'))\nfrom production_catalog_verification import dynamic_execution_marker_lines as d\nfiles=sorted((root/'supabase/migrations').glob('*.sql'));rows=[]\nfor p in files:\n m=d(p.read_text(encoding='utf-8'))\n if m: rows.append({'version':p.name.split('_',1)[0],'path':p.relative_to(root).as_posix(),'marker_count':len(m)})\nprint(json.dumps({'total_migration_files':len(files),'matched_paths':rows}))`;const live=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',['-c',code,root],{encoding:'utf8'}));verifyHistoricalInventory(baseline,live);if(JSON.stringify(baseline.enforced_versions)!==JSON.stringify(MANDATORY_VERSIONS))throw new Error('UNVERIFIABLE: reviewed enforced-version set differs from the mandatory scan');}

export function run(argv = process.argv.slice(2), deps = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  verifyBaseline(root);
  const baseIndex = argv.indexOf('--base');
  let base = baseIndex >= 0 ? argv[baseIndex + 1] : null;
  const gitText = deps.gitText ?? (args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }));
  if (baseIndex >= 0 && !base) throw new Error('UNVERIFIABLE: --base requires a value');
  if (!base && process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const candidate = `origin/${process.env.GITHUB_BASE_REF || ''}`;
    base = resolveBase({ candidateRefs: [candidate], git: args => { try { gitText(args); return true; } catch { return false; } } });
  }
  if (!base) {
    base = resolveBase({ candidateRefs: ['origin/main'], git: args => { try { gitText(args); return true; } catch { return false; } } });
  }
  const versions = [...new Set([...MANDATORY_VERSIONS, ...changedMigrationVersions(base, gitText)])];
  const args = [path.join(root, 'scripts/check_production_verification_sidecars.py'), '--repo', root];
  for (const version of versions) args.push('--scan-version', version);
  const invoke = deps.invoke ?? ((command, values) => execFileSync(command, values, { cwd: root, stdio: 'inherit' }));
  invoke(process.platform === 'win32' ? 'python' : 'python3', args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) { console.error(error.message); process.exit(error.status === 1 ? 1 : 2); }
}
