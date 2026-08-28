#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAll,median,percentile } from './throughput-guard/ledger-lib.mjs';

// Headline diagnosis comparisons start only after triage-gate and its fixture
// runner existed. Older incidents remain context and never enter the headline.
export const TRIAGE_MEASUREMENT_START='2026-08-28T16:30:00.000Z';
export function report(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
  const {entries,fixtures}=validateAll(root);
  const start=Date.parse(TRIAGE_MEASUREMENT_START);
  const evidenced=entries.filter(v=>!v.estimate&&v.class!=='other'&&v.resolved_at);
  const postTriage=evidenced.filter(v=>Date.parse(v.opened_at)>=start);
  const lines=[];
  for(const cls of [...new Set(entries.map(v=>v.class))].sort()){
    const classRows=evidenced.filter(v=>v.class===cls);
    const walls=classRows.filter(v=>v.wall_minutes_blocked!==null).map(v=>v.wall_minutes_blocked);
    const active=classRows.filter(v=>v.active_minutes_lost!==null).map(v=>v.active_minutes_lost);
    const diagnosis=postTriage.filter(v=>v.class===cls&&v.first_red_check_at&&v.diagnosis_proved_at).map(v=>(Date.parse(v.diagnosis_proved_at)-Date.parse(v.first_red_check_at))/60000);
    lines.push(`${cls} diagnosis median=${median(diagnosis)??'n/a'} minutes n=${diagnosis.length}`);
    lines.push(`${cls} wall median=${median(walls)??'n/a'} p90=${percentile(walls,.9)??'n/a'} minutes n=${walls.length}`);
    lines.push(`${cls} active median=${median(active)??'n/a'} minutes n=${active.length}`);
  }
  const landed=new Map(fixtures.filter(v=>v.landed_at).map(v=>[v.id,Date.parse(v.landed_at)]));
  const byId=new Map(entries.map(v=>[v.id,v]));
  const fixtureFor=v=>v.corpus_fixture??byId.get(v.recurrence_of)?.corpus_fixture;
  const falseAlarms=evidenced.filter(v=>{const fixture=fixtureFor(v);return v.class==='guard-false-alarm'&&fixture&&Date.parse(v.opened_at)>=landed.get(fixture)});
  const recurrences=falseAlarms.filter(v=>v.recurrence_of).length;
  lines.push(falseAlarms.length>=20?`false-alarm recurrence=${((recurrences/falseAlarms.length)*100).toFixed(1)}% (${recurrences}/${falseAlarms.length}) n=${falseAlarms.length}`:`false-alarm recurrence=not published n=${falseAlarms.length} (minimum 20 post-fixture evidenced incidents)`);
  return lines.join('\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(report())}catch(e){console.error(e.message);process.exit(1)}}
