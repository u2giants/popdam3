import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({ manifestBytes: 262144, requirements: 100, migrations: 200,
  contracts: 200, columns: 256, roles: 20, files: 2000, sourceBytes: 16777216, contentBytes: 8388608 });
const REPOSITORIES = new Set(['backend', 'bff', 'frontend', 'item-master', 'tracking', 'data-syncing'].map(n => `popcre/designflow-${n}`));
const SCHEMAS = new Set(['dflow_prod', 'hts_rag', 'plm', 'core', 'coldlion']);
const PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES']);
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const PROJECT = 'qsllyeztdwjgirsysgai';
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const PATH = /^supabase\/migrations\/(\d{14})_([a-z0-9][a-z0-9_-]{0,119})\.sql$/;
function reject(message) { throw new TypeError(`Invalid DesignFlow database release: ${message}`); }
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
// Accept parsed plain data only. Never invoke caller getters/toJSON or custom prototypes.
function dataCopy(value, maxBytes) {
  const active = new Set(); let nodes = 0; let budget = 0;
  const charge = n => { budget += n; if (budget > maxBytes) reject('payload byte limit exceeded'); };
  function visit(v, depth) {
    if (++nodes > 50000 || depth > 12) reject('payload complexity limit exceeded');
    if (v === null || typeof v === 'boolean') { charge(5); return v; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) reject('nonfinite number'); charge(24); return v; }
    if (typeof v === 'string') { charge(Buffer.byteLength(v, 'utf8') + 2); return v; }
    if (typeof v !== 'object') reject('only parsed JSON data is accepted');
    if (active.has(v)) reject('cyclic data');
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) reject('nonplain object');
    const keys = Reflect.ownKeys(v);
    if (keys.some(k => typeof k !== 'string' || FORBIDDEN.has(k))) reject('prototype or symbol key');
    if (keys.length > 10000) reject('too many object fields');
    active.add(v); charge(2);
    let copy;
    if (array) {
      const length = Object.getOwnPropertyDescriptor(v, 'length').value;
      if (length > 10000 || keys.length !== length + 1) reject('sparse or decorated array');
      copy = [];
      for (let i = 0; i < length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !('value' in d) || !d.enumerable) reject('array accessor or missing element');
        copy.push(visit(d.value, depth + 1)); charge(1);
      }
    } else {
      copy = {};
      for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!('value' in d) || !d.enumerable) reject('accessor or hidden field');
        charge(Buffer.byteLength(key, 'utf8') + 3);
        copy[key] = visit(d.value, depth + 1);
      }
    }
    active.delete(v); return copy;
  }
  const copied = visit(value, 0);
  // JSON escaping can expand strings. Enforce the actual encoded payload bound too.
  if (Buffer.byteLength(JSON.stringify(copied), 'utf8') > maxBytes) reject('encoded payload byte limit exceeded');
  return copied;
}
function object(v, keys, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) reject(`${label} must be an object`);
  const actual = Object.keys(v);
  if (actual.length !== keys.length || actual.some(k => !keys.includes(k))) reject(`${label} has missing or unknown fields`);
}
function list(v, max, label, min = 0) {
  if (!Array.isArray(v) || v.length < min || v.length > max) reject(`${label} count invalid`);
}
function identifier(v, label) { if (typeof v !== 'string' || !IDENTIFIER.test(v)) reject(`${label} identifier invalid`); }
function positive(v, label) { if (!Number.isSafeInteger(v) || v <= 0) reject(`${label} must be a positive safe integer`); }
function unique(values, label) { if (new Set(values).size !== values.length) reject(`duplicate ${label}`); }
function freeze(v) { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; }
function migrationRecord(m) {
  object(m, ['version', 'path', 'sha256'], 'migration');
  if (typeof m.version !== 'string' || !/^\d{14}$/.test(m.version)) reject('migration version invalid');
  if (typeof m.path !== 'string' || !PATH.test(m.path) || PATH.exec(m.path)[1] !== m.version) reject('migration path/version invalid');
  if (typeof m.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(m.sha256)) reject('migration sha256 invalid');
}
function requirementRecord(r) {
  object(r, ['work_issue', 'source_pr', 'migrations'], 'requirement');
  positive(r.work_issue, 'work_issue'); positive(r.source_pr, 'source_pr');
  list(r.migrations, LIMITS.migrations, 'requirement migrations', 1);
  r.migrations.forEach(migrationRecord);
  unique(r.migrations.map(m => m.version), 'migration version'); unique(r.migrations.map(m => m.path), 'migration path');
}
function contractRecord(c) {
  object(c, ['schema', 'relation', 'columns', 'privileges'], 'contract');
  if (!SCHEMAS.has(c.schema)) reject('contract schema is not allowed');
  identifier(c.relation, 'relation');
  list(c.columns, LIMITS.columns, 'contract columns', 1);
  c.columns.forEach(column => identifier(column, 'column')); unique(c.columns, 'column');
  list(c.privileges, LIMITS.roles, 'contract privilege roles');
  for (const p of c.privileges) {
    object(p, ['role', 'privileges'], 'privilege'); identifier(p.role, 'role');
    list(p.privileges, PRIVILEGES.size, 'privileges', 1);
    if (p.privileges.some(v => !PRIVILEGES.has(v))) reject('unsupported privilege');
    unique(p.privileges, 'privilege');
  }
  unique(c.privileges.map(p => p.role), 'contract role');
}
export function validateManifest(input) {
  const m = dataCopy(input, LIMITS.manifestBytes);
  object(m, ['schema_version', 'repository', 'production_project_ref', 'requirements', 'contracts'], 'manifest');
  if (m.schema_version !== 1) reject('schema_version must be 1');
  if (!REPOSITORIES.has(m.repository)) reject('repository is not one of the six DesignFlow repositories');
  if (m.production_project_ref !== PROJECT) reject('production target mismatch');
  list(m.requirements, LIMITS.requirements, 'requirements');
  m.requirements.forEach(requirementRecord);
  unique(m.requirements.map(r => `${r.work_issue}:${r.source_pr}`), 'requirement pair'); unique(m.requirements.map(r => r.source_pr), 'source PR');
  const migrations = m.requirements.flatMap(r => r.migrations);
  if (migrations.length > LIMITS.migrations) reject('total migrations limit exceeded');
  unique(migrations.map(r => r.version), 'migration version'); unique(migrations.map(r => r.path), 'migration path');
  list(m.contracts, LIMITS.contracts, 'contracts'); m.contracts.forEach(contractRecord);
  unique(m.contracts.map(c => `${c.schema}.${c.relation}`), 'contract relation');
  return freeze(m);
}
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function manifestDigest(input) { return sha256(canonical(validateManifest(input))); }

// Source booleans and identity are authenticated internal-I/O facts supplied by caller.
// They are never accepted as fields inside a manifest. This module performs no I/O.
export function verifyRequirementSource(requirement, sourceFacts) {
  const r = dataCopy(requirement, LIMITS.manifestBytes); requirementRecord(r);
  const s = dataCopy(sourceFacts, LIMITS.sourceBytes);
  object(s, ['repository', 'base_branch', 'merged', 'source_pr', 'work_issue', 'head_sha40', 'merge_sha40', 'merge_in_main', 'files'], 'source facts');
  if (s.repository !== 'popcre/shared-db' || s.base_branch !== 'main') reject('canonical source repository/base mismatch');
  if (s.merged !== true || s.merge_in_main !== true) reject('source PR is unmerged or absent from main');
  positive(s.source_pr, 'source source_pr'); positive(s.work_issue, 'source work_issue');
  if (s.source_pr !== r.source_pr || s.work_issue !== r.work_issue) reject('source PR/issue identity mismatch');
  for (const key of ['head_sha40', 'merge_sha40']) if (typeof s[key] !== 'string' || !/^[a-f0-9]{40}$/.test(s[key])) reject(`${key} invalid`);
  list(s.files, LIMITS.files, 'source files');
  const paths = [];
  const authored = [];
  for (const file of s.files) {
    object(file, ['path', 'content'], 'source file');
    if (typeof file.path !== 'string' || !file.path || file.path.startsWith('/') || file.path.length > 512 || /[\x00-\x1f\\]/.test(file.path) || file.path.split('/').some(p => p === '..' || p === '.')) reject('source file path invalid');
    if (typeof file.content !== 'string' || Buffer.byteLength(file.content, 'utf8') > LIMITS.contentBytes) reject('source content limit/type invalid');
    paths.push(file.path);
    if (!file.path.startsWith('supabase/migrations/')) continue;
    if (!PATH.test(file.path)) reject('canonical migration file path malformed');
    authored.push({ version: PATH.exec(file.path)[1], path: file.path, sha256: sha256(file.content) });
  }
  unique(paths, 'source path'); unique(authored.map(m => m.version), 'source migration version');
  if (authored.length !== r.migrations.length) reject('declared/authored migration set differs');
  const actual = new Map(authored.map(m => [m.path, m]));
  for (const declared of r.migrations) {
    const got = actual.get(declared.path);
    if (!got || got.version !== declared.version || got.sha256 !== declared.sha256) reject('migration source/hash mismatch');
  }
  return freeze(r);
}
