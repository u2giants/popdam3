import fs from 'node:fs';
import path from 'node:path';

export const CLASSES = new Set(['guard-false-alarm','guard-true-block','reviewer-harness','credential','other']);
export const REQUIRED = ['id','opened_at','resolved_at','first_red_check_at','diagnosis_proved_at','class','issue_or_pr','guard','symptom','proof_command','resolution','fixed_by','corpus_fixture','active_minutes_lost','wall_minutes_blocked','estimate'];
export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function readLedger(root) {
  const dir = path.join(root, 'config/blocker-ledger');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(v => v.endsWith('.json')).sort().map(name => ({ file: name, ...readJson(path.join(dir, name)) }));
}
export function validateEntry(entry) {
  for (const key of REQUIRED) if (!(key in entry)) throw new Error(`${entry.file}: missing ${key}`);
  if (`${entry.id}.json` !== entry.file) throw new Error(`${entry.file}: filename/id mismatch`);
  if (!/^blk_[0-9a-f]{32}$/.test(entry.id)) throw new Error(`${entry.file}: invalid id`);
  if (!CLASSES.has(entry.class)) throw new Error(`${entry.file}: invalid class`);
  if (typeof entry.estimate !== 'boolean') throw new Error(`${entry.file}: estimate must be boolean`);
  for (const key of ['active_minutes_lost','wall_minutes_blocked']) if (entry[key] !== null && (!Number.isFinite(entry[key]) || entry[key] < 0)) throw new Error(`${entry.file}: ${key} must be a non-negative number or null`);
  if (entry.active_minutes_lost !== null && entry.wall_minutes_blocked !== null && entry.active_minutes_lost > entry.wall_minutes_blocked) throw new Error(`${entry.file}: active minutes cannot exceed wall minutes`);
  if (entry.resolved_at === null && (entry.active_minutes_lost !== null || entry.wall_minutes_blocked !== null)) throw new Error(`${entry.file}: unresolved incident cannot carry final duration metrics`);
  for (const key of ['opened_at','resolved_at','first_red_check_at','diagnosis_proved_at']) {
    if (entry[key] !== null && Number.isNaN(Date.parse(entry[key]))) throw new Error(`${entry.file}: invalid ${key}`);
  }
  const ordered = ['opened_at','first_red_check_at','diagnosis_proved_at','resolved_at'].map(k => entry[k] && Date.parse(entry[k])).filter(Boolean);
  if (ordered.some((v, i) => i && v < ordered[i - 1])) throw new Error(`${entry.file}: impossible timestamp order`);
  if (entry.fixed_by !== null && !/^[0-9a-f]{7,40}$/.test(entry.fixed_by)) throw new Error(`${entry.file}: invalid fixed_by SHA`);
  if ('recurrence_of' in entry && entry.recurrence_of !== null && !/^blk_[0-9a-f]{32}$/.test(entry.recurrence_of)) throw new Error(`${entry.file}: invalid recurrence_of`);
}
export function fixtureIndex(root) {
  const file = path.join(root, 'scripts/fixtures/guard-false-alarms/index.json');
  return fs.existsSync(file) ? readJson(file).fixtures : [];
}
export function validateAll(root) {
  const entries = readLedger(root); const ids = new Set();
  for (const entry of entries) { validateEntry(entry); if (ids.has(entry.id)) throw new Error(`duplicate id ${entry.id}`); ids.add(entry.id); }
  const fixtures = fixtureIndex(root); const linked = new Map();
  for (const fixture of fixtures) {
    if (!fixture.landed_at || Number.isNaN(Date.parse(fixture.landed_at))) throw new Error(`${fixture.id}: fixture requires valid landed_at`);
    if (typeof fixture.executable_test !== 'string' || fixture.executable_test.length < 20) throw new Error(`${fixture.id}: fixture requires executable_test`);
    if (fixture.origin === 'incident') {
      if (!fixture.ledger_id || linked.has(fixture.ledger_id)) throw new Error(`${fixture.id}: incident ledger link must be unique`);
      linked.set(fixture.ledger_id, fixture.id);
    } else if (fixture.origin === 'synthetic-shape') {
      if (fixture.ledger_id) throw new Error(`${fixture.id}: synthetic fixture cannot cite ledger`);
      if (!fixture.source_evidence) throw new Error(`${fixture.id}: synthetic fixture needs source evidence`);
    } else throw new Error(`${fixture.id}: invalid origin`);
  }
  for (const [id, fixture] of linked) {
    const entry = entries.find(v => v.id === id); if (!entry || entry.corpus_fixture !== fixture) throw new Error(`${fixture}: dangling/non-bijective ledger link`);
  }
  for (const entry of entries) if (entry.corpus_fixture && linked.get(entry.id) !== entry.corpus_fixture) throw new Error(`${entry.id}: dangling corpus fixture`);
  for (const entry of entries) if (entry.recurrence_of && !entries.some(v=>v.id===entry.recurrence_of&&v.class==='guard-false-alarm')) throw new Error(`${entry.id}: recurrence_of must cite an existing false-alarm incident`);
  for (const entry of entries) if (entry.class==='guard-false-alarm'&&!entry.corpus_fixture&&!entry.recurrence_of) {
    const unresolvedStub=entry.estimate===true&&entry.resolved_at===null&&entry.diagnosis_proved_at===null&&entry.resolution===null&&entry.fixed_by===null;
    if(!unresolvedStub)throw new Error(`${entry.id}: resolved false-alarm incident requires a corpus fixture or recurrence_of link`);
  }
  return { entries, fixtures };
}
export const median = values => {if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
export const percentile = (values, p) => values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1] : null;
