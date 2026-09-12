import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchArrayMaster, fetchPagedMaster, masterUrl } from "./coldlion-landing/lib/master-http.mjs";
import { ITEM_SPECS, MASTER_SPECS, knownApiFields } from "./coldlion-landing/lib/master-specs.mjs";
import { assertKnownShape, projectCurrentRows, projectItemSlots } from "./coldlion-landing/lib/project-masters.mjs";
import { buildMasterLoadSql } from "./coldlion-landing/lib/load-masters.mjs";
import { assertRequestedScope, assertSameIdentitySet, collectMasters, dedupeSlots, main, parseArgs } from "./coldlion-landing/sync-masters.mjs";
import { assertExpectedTarget, masterFailureSql, redactPsqlError } from "./coldlion-landing/lib/db.mjs";

const RUN="11111111-1111-4111-8111-111111111111";
const NOW="2026-09-09T00:00:00.000Z";

function sourceFor(spec, overrides={}) {
  const row={};
  for (const field of spec.fields) {
    row[field.api]=field.type === "num" ? "1.25" : field.type === "date" ? "2026-01-02" : field.type === "ts" ? "2026-01-02T03:04:05Z" : `SYN-${field.api}`;
  }
  for (const ignored of spec.ignored ?? []) row[ignored]=null;
  if (spec.slots) for (let n=1;n<=14;n+=1) { const nn=String(n).padStart(2,"0"); row[`merchGroup${nn}`]=n===1?"SYN-MG":null; row[`merchGroup${nn}Desc`]=n===1?"Synthetic group":null; }
  return {...row,...overrides};
}

test("parameter snapshot predates loader implementation and covers every requested endpoint",()=>{
  const doc=JSON.parse(readFileSync("docs/verification/coldlion-api-parameters-20260909T022136Z.json","utf8"));
  for (const path of ["/customers","/vendors","/divisions","/salespersons","/seasons","/merchGroupHeaders","/merchGroupDetails","/items","/itemDetails"]) assert.ok(doc.endpoints[path]);
  assert.deepEqual(doc.endpoints["/merchGroupDetails"].filter((x)=>x.startsWith("query:")),["query:active(default=Y)","query:companyCode","query:divisionCode","query:mgCode","query:mgTypeCode"]);
});

test("operational probe proves merchGroupDetails works without retaining values",()=>{
  const proof=JSON.parse(readFileSync("docs/verification/coldlion-merch-group-details-probe-20260909T0224Z.json","utf8"));
  assert.equal(proof.response_shape,"plain array"); assert.ok(proof.nonempty_queries>0); assert.match(proof.privacy,/no ColdLion payload values/i);
});

test("merchandise detail identity includes category so live categories cannot collapse",()=>{
  assert.deepEqual(MASTER_SPECS.merch_group_detail.key,["company_code","division_code","mg_type_code","mg_category","mg_code"]);
  const source=sourceFor(MASTER_SPECS.merch_group_detail,{companyCode:"SYNCO",divisionCode:"SD001",mgTypeCode:"01",mgCategory:"",mgCode:"M1"});
  const projected=projectCurrentRows(MASTER_SPECS.merch_group_detail,[source],{runId:RUN,fetchedAt:NOW});
  assert.equal(projected.rows[0].mg_category,"");
});

test("master URL emits only declared parameters supplied by its caller",()=>{
  assert.equal(masterUrl("/seasons",{companyCode:"SYNCO",divisionCode:"SD001",active:"N"}).search,"?companyCode=SYNCO&divisionCode=SD001&active=N");
});

test("paged masters walk to last and prove the vendor total",async()=>{
  let calls=0;
  const fetchImpl=async(url)=>{ const page=Number(new URL(url).searchParams.get("page")); calls+=1; const content=page===0?[{id:1},{id:2}]:[{id:3}]; return {ok:true,status:200,text:async()=>JSON.stringify({content,number:page,size:2,numberOfElements:content.length,totalElements:3,totalPages:2,last:page===1})}; };
  const rows=await fetchPagedMaster("/customers",{companyCode:"SYNCO"},"hidden",{fetchImpl,pauseMs:0});
  assert.equal(rows.length,3); assert.equal(calls,2);
});

test("paged masters refuse an incomplete total",async()=>{
  const fetchImpl=async()=>({ok:true,status:200,text:async()=>JSON.stringify({content:[{}],number:0,size:2,numberOfElements:1,totalElements:2,totalPages:1,last:true})});
  await assert.rejects(fetchPagedMaster("/customers",{},"hidden",{fetchImpl,pauseMs:0}),/incomplete/);
});

test("plain-array endpoints refuse a paged envelope",async()=>{
  const fetchImpl=async()=>({ok:true,status:200,text:async()=>JSON.stringify({content:[]})});
  await assert.rejects(fetchArrayMaster("/itemDetails",{},"hidden",{fetchImpl,pauseMs:0}),/plain array/);
});

test("plain-array endpoints preserve a legitimate empty variant",async()=>{
  const fetchImpl=async()=>({ok:true,status:200,text:async()=>"[]"});
  assert.deepEqual(await fetchArrayMaster("/merchGroupDetails",{active:"N"},"hidden",{fetchImpl,pauseMs:0}),[]);
});

test("paged masters refuse envelopes missing required pagination evidence",async()=>{
  const fetchImpl=async()=>({ok:true,status:200,text:async()=>JSON.stringify({content:[],number:0,size:2,numberOfElements:0,totalElements:0,last:true})});
  await assert.rejects(fetchPagedMaster("/customers",{},"hidden",{fetchImpl,pauseMs:0}),/missing totalPages/);
});

test("plain-array non-JSON 4xx preserves wire status and is not retried",async()=>{
  let calls=0; const fetchImpl=async()=>{calls+=1;return{ok:false,status:404,text:async()=>"not json"}};
  await assert.rejects(fetchArrayMaster("/itemDetails",{active:"N"},"hidden",{fetchImpl,pauseMs:0}),error=>error.httpStatus===404 && error.permanent===true && error.requestParams.active==="N");
  assert.equal(calls,1);
});

test("plain-array masters use the same serialized request gate",async()=>{
  let gates=0; const evidence=[];
  const fetchImpl=async()=>({ok:true,status:200,text:async()=>"[{}]"});
  await fetchArrayMaster("/merchGroupDetails",{active:"Y"},"hidden",{fetchImpl,pauseMs:0,requestGate:async()=>{gates+=1;},onResponse:(entry)=>evidence.push(entry)});
  assert.equal(gates,1); assert.deepEqual(evidence,[{endpoint:"/merchGroupDetails",params:{active:"Y"},httpStatus:200,bodyStatus:null}]);
});

test("every live-shaped synthetic row maps or is deliberately ignored",()=>{
  for (const spec of [...Object.values(MASTER_SPECS),...Object.values(ITEM_SPECS)]) {
    const row=sourceFor(spec); assert.doesNotThrow(()=>assertKnownShape(spec,[row])); assert.ok(knownApiFields(spec).size>=spec.fields.length);
  }
});

test("unknown fields fail loudly before projection",()=>{
  assert.throws(()=>projectCurrentRows(MASTER_SPECS.vendor,[sourceFor(MASTER_SPECS.vendor,{newPrivateField:"x"})],{runId:RUN,fetchedAt:NOW}),/unreviewed field/);
});

test("current rows normalize sentinels, hash complete records, and exclude EP001",()=>{
  const spec=MASTER_SPECS.season;
  const good=sourceFor(spec,{companyCode:"SYNCO",divisionCode:"SD001",seasonCode:"S1",createdTime:"1900-01-01"});
  const excluded=sourceFor(spec,{companyCode:"SYNCO",divisionCode:"EP001",seasonCode:"S2"});
  const result=projectCurrentRows(spec,[good,excluded],{runId:RUN,fetchedAt:NOW});
  assert.equal(result.rows.length,1); assert.equal(result.excluded,1); assert.equal(result.rows[0].created_time,null); assert.match(result.rows[0].source_hash,/^[0-9a-f]{64}$/);
});

test("every duplicate natural key aborts so shifted pages cannot hide omissions",()=>{
  const spec=MASTER_SPECS.vendor;
  const a=sourceFor(spec,{companyCode:"SYNCO",vendorCode:"V1",vendorDesc:"A"});
  const b={...a,vendorDesc:"B"};
  assert.throws(()=>projectCurrentRows(spec,[a,a],{runId:RUN,fetchedAt:NOW}),/duplicate rows/);
  assert.throws(()=>projectCurrentRows(spec,[a,b],{runId:RUN,fetchedAt:NOW}),/duplicate rows/);
});

test("itemDetails accepts the verified itemWeightUom spelling only",()=>{
  assert.ok(knownApiFields(ITEM_SPECS.item_detail).has("itemWeightUom"));
  assert.equal(knownApiFields(ITEM_SPECS.item_detail).has("weightUOM"),false);
});

test("item slots preserve header/detail grain and omit cleared slots",()=>{
  const header=sourceFor(ITEM_SPECS.item_header,{companyCode:"SYNCO",divisionCode:"SD001",itemNo:"ITEM-A"});
  const detail=sourceFor(ITEM_SPECS.item_detail,{companyCode:"SYNCO",divisionCode:"SD001",itemNo:"ITEM-A",itemPkey:"PK-1"});
  const h=projectItemSlots([header],{runId:RUN,fetchedAt:NOW}); const d=projectItemSlots([detail],{runId:RUN,fetchedAt:NOW,itemPkey:"source"});
  assert.equal(h.length,1); assert.equal(h[0].item_pkey,null); assert.equal(d[0].item_pkey,"PK-1");
});

test("generated SQL is a re-runnable upsert, reconciles cleared slots, and never uses history sealing",()=>{
  const order=["division","customer","vendor","salesperson","season","merch_group_header","merch_group_detail","item_header","item_detail"];
  const loads=order.map((table)=>{ const spec=MASTER_SPECS[table]??ITEM_SPECS[table]; const source=sourceFor(spec); const rows=projectCurrentRows(spec,[source],{runId:RUN,fetchedAt:NOW}).rows; return {table,spec,rows,run:{id:RUN,endpoint:spec.endpoint,companyCode:"SYNCO",requestParams:{fullSnapshot:true},requestedBy:"test",startedAt:NOW,finishedAt:NOW,durationMs:0,rowsFetched:1}}; });
  const source=sourceFor(ITEM_SPECS.item_header,{companyCode:"SYNCO",divisionCode:"SD001",itemNo:"ITEM-A"});
  const sql=buildMasterLoadSql({loads,itemSlots:projectItemSlots([source],{runId:RUN,fetchedAt:NOW}),affectedItemGrains:[{company_code:"SYNCO",division_code:"SD001",item_no:"ITEM-A",item_pkey:null,run_id:RUN}]});
  assert.match(sql,/on conflict \(company_code, customer_code\) do update/i); assert.match(sql,/source_raw jsonb/i); assert.match(sql,/select cl\.new_raw from coldlion\.change_log/i); assert.match(sql,/case when t\.company_code is null then 'inserted'/i); assert.match(sql,/extensions\.digest/i); assert.match(sql,/absent from current source snapshot/i); assert.match(sql,/delete from coldlion\.item_merch_group/i); assert.match(sql,/not exists \(select 1 from _stage_item_merch_group/i); assert.doesNotMatch(sql,/truncate|window_ledger|history_page_ledger/i); assert.equal((sql.match(/\bbegin;/gi)??[]).length,1); assert.equal((sql.match(/\bcommit;/gi)??[]).length,1);
});

test("an empty item snapshot still generates valid reconciliation SQL",()=>{
  const sql=buildMasterLoadSql({loads:[],itemSlots:[],affectedItemGrains:[]});
  assert.doesNotMatch(sql,/insert into _affected_item_grains values\s*;/i);
  assert.match(sql,/create temp table _affected_item_grains/i);
});

test("terminal master failures produce a failed run and alert without payload data",()=>{
  const error=Object.assign(new Error("synthetic failure"),{httpStatus:503,bodyStatus:91,requestParams:{active:"N",divisionCode:"SD001",page:2,size:2000}});
  const sql=masterFailureSql({endpoint:"/customers",companyCode:"SYNCO",requestedBy:"test",error});
  assert.match(sql,/coldlion\.sync_run/i); assert.match(sql,/'failed'/); assert.match(sql,/active.*N.*divisionCode.*SD001.*page.*2.*size.*2000/); assert.match(sql,/503, 91/); assert.match(sql,/pg_notify\('coldlion_sync_alert'/i);
});

test("database errors retain diagnosis while redacting row values and URLs",()=>{
  const redacted=redactPsqlError(`DETAIL: Key (customer_code)=(PRIVATE) already exists.\npsql: ERROR: invalid input syntax for numeric: "PRIVATE" at postgresql://user:secret@host/db`);
  assert.match(redacted,/invalid input syntax for numeric/); assert.doesNotMatch(redacted,/PRIVATE|secret@host/);
});

test("database error redaction preserves safe object identity",()=>{
  assert.equal(redactPsqlError('psql: ERROR: relation "coldlion.item_merch_group" does not exist'),'psql: ERROR: relation "coldlion.item_merch_group" does not exist');
});

test("requested company, division, and active scope are positively checked",()=>{
  const spec=MASTER_SPECS.season;
  assert.doesNotThrow(()=>assertRequestedScope(spec,[{companyCode:"SYNCO",divisionCode:"SD001",active:"Y"}],{companyCode:"SYNCO",divisionCode:"SD001",active:"Y"}));
  assert.throws(()=>assertRequestedScope(spec,[{companyCode:"SYNCO",divisionCode:"WRONG",active:"Y"}],{companyCode:"SYNCO",divisionCode:"SD001",active:"Y"}),/another division/);
});

test("target guard accepts exact host or pool-user identity and rejects refs hidden elsewhere",()=>{
  const ref="abcdefghijklmnopqrst";
  assert.doesNotThrow(()=>assertExpectedTarget({expectedProjectRef:ref,databaseUrl:`postgresql://postgres:secret@db.${ref}.supabase.co/db`}));
  assert.doesNotThrow(()=>assertExpectedTarget({expectedProjectRef:ref,databaseUrl:`postgresql://postgres.${ref}:secret@pool.example.com/db`}));
  assert.throws(()=>assertExpectedTarget({expectedProjectRef:ref,databaseUrl:`postgresql://user:${ref}@wrong.example/db`}),/does not name project/);
});

test("CLI proves target before collection and write",async()=>{
  const calls=[];
  await main(["--dry-run"],{proveTarget:()=>{calls.push("prove");return{database:"synthetic",host:"local"}},readApiKey:()=>"hidden",collectMasters:async()=>{calls.push("collect");return{loads:[],itemSlots:[],affectedItemGrains:[]}},runSql:()=>calls.push("write")});
  assert.deepEqual(calls,["prove","collect"]);
});

test("CLI records a non-dry-run collection failure after proving target",async()=>{
  const calls=[]; const failure=Object.assign(new Error("synthetic failure"),{endpoint:"/vendors"});
  await assert.rejects(main([],{proveTarget:()=>{calls.push("prove");return{database:"synthetic",host:"local"}},readApiKey:()=>"hidden",collectMasters:async()=>{calls.push("collect");throw failure},recordMasterFailure:({endpoint})=>calls.push(`failure:${endpoint}`)}),/synthetic failure/);
  assert.deepEqual(calls,["prove","collect","failure:/vendors"]);
});

test("CLI dry-run failures do not write failure evidence",async()=>{
  const calls=[];
  await assert.rejects(main(["--dry-run"],{proveTarget:()=>({database:"synthetic",host:"local"}),readApiKey:()=>"hidden",collectMasters:async()=>{throw new Error("synthetic failure")},recordMasterFailure:()=>calls.push("failure")}),/synthetic failure/);
  assert.deepEqual(calls,[]);
});

test("CLI records database execution failure without exposing row details",async()=>{
  const calls=[]; const error=Object.assign(new Error("Database command failed; sensitive row details suppressed"),{code:"DATABASE_COMMAND_FAILED"});
  await assert.rejects(main([],{proveTarget:()=>({database:"synthetic",host:"local"}),readApiKey:()=>"hidden",collectMasters:async()=>({loads:[],itemSlots:[],affectedItemGrains:[]}),runSql:()=>{throw error},recordMasterFailure:({endpoint,error:recorded})=>calls.push([endpoint,recorded.message])}),/sensitive row details suppressed/);
  assert.deepEqual(calls,[["/masters-write","Database command failed; sensitive row details suppressed"]]);
});

test("CLI is fixed to EDGEHOME and exposes neither alternate-company nor history controls",()=>{
  assert.deepEqual(parseArgs([]),{company:"EDGEHOME",dryRun:false}); assert.throws(()=>parseArgs(["--company","SPRUCE"]),/unknown argument/); assert.throws(()=>parseArgs(["--windows","3"]),/unknown argument/);
});

test("identical repeated source items cannot create duplicate slot conflict keys",()=>{
  const source=sourceFor(ITEM_SPECS.item_header,{companyCode:"SYNCO",divisionCode:"SD001",itemNo:"ITEM-A"});
  const slots=projectItemSlots([source,source],{runId:RUN,fetchedAt:NOW});
  assert.equal(slots.length,2); assert.equal(dedupeSlots(slots).length,1);
});

test("declined field changes remain observable through the complete-record hash",()=>{
  const spec=MASTER_SPECS.vendor;
  const a=sourceFor(spec,{companyCode:"SYNCO",vendorCode:"V1",address1:"private-a"});
  const b={...a,address1:"private-b"};
  const first=projectCurrentRows(spec,[a],{runId:RUN,fetchedAt:NOW}).rows[0];
  const second=projectCurrentRows(spec,[b],{runId:RUN,fetchedAt:NOW}).rows[0];
  assert.notEqual(first.source_hash,second.source_hash);
  assert.equal(first.source_raw.address1,"private-a");
});

test("missing approved fields fail before they can null existing values",()=>{
  const source=sourceFor(MASTER_SPECS.vendor,{companyCode:"SYNCO",vendorCode:"V1"});
  delete source.vendorDesc;
  assert.throws(()=>projectCurrentRows(MASTER_SPECS.vendor,[source],{runId:RUN,fetchedAt:NOW}),/omitted approved field.*vendorDesc/);
});

test("master transport is pinned to the documented ColdLion origin",()=>{
  const url=masterUrl("/customers",{companyCode:"SYNCO"});
  assert.equal(url.origin,"http://x5.coldlion.com"); assert.match(url.pathname,/^\/EhpApi\//);
});

test("workflow is the sole live path and preserves history before masters",()=>{
  const yaml=readFileSync(".github/workflows/coldlion-landing-sync.yml","utf8");
  assert.match(yaml,/SUPABASE_DB_URL_PRODUCTION/); assert.match(yaml,/COLDLION_EXPECTED_PROJECT_REF: qsllyeztdwjgirsysgai/); assert.match(yaml,/COLDLION_API_KEY/); assert.doesNotMatch(yaml,/pull_request:|push:/);
  assert.ok(yaml.indexOf("sync-history.mjs")<yaml.indexOf("sync-masters.mjs")); assert.match(yaml,/coldlion-landing-masters\.test\.mjs/);
  assert.match(yaml,/Validate masters live; report history work; write nothing/);
});

test("itemDetails company snapshot must equal the per-division identity proof",()=>{
  const spec=ITEM_SPECS.item_detail;
  const row=sourceFor(spec,{companyCode:"SYNCO",divisionCode:"SD001",itemNo:"I1",itemPkey:"P1"});
  assert.doesNotThrow(()=>assertSameIdentitySet(spec,[row],[row]));
  assert.throws(()=>assertSameIdentitySet(spec,[row],[]),/does not match/);
});

test("EP001 itemDetails are excluded before the division completeness comparison",()=>{
  const spec=ITEM_SPECS.item_detail;
  const kept=sourceFor(spec,{companyCode:"EDGEHOME",divisionCode:"SD001",itemNo:"I1",itemPkey:"P1"});
  const retired=sourceFor(spec,{companyCode:"EDGEHOME",divisionCode:"EP001",itemNo:"I2",itemPkey:"P2"});
  assert.doesNotThrow(()=>assertSameIdentitySet(spec,[kept,retired].filter((row)=>row.divisionCode!=="EP001"),[kept]));
});

test("collector fans seasons per division, merges active variants, and proves itemDetails",async()=>{
  const byEndpoint=new Map([...Object.values(MASTER_SPECS),...Object.values(ITEM_SPECS)].map((spec)=>[spec.endpoint,spec]));
  const calls=[];
  const fetchImpl=async(rawUrl)=>{
    const url=new URL(rawUrl), endpoint=url.pathname.replace("/EhpApi",""); const spec=byEndpoint.get(endpoint); calls.push(`${endpoint}?${url.searchParams}`);
    const active=url.searchParams.get("active"); let rows=[];
    if (active!=="N") rows=[sourceFor(spec,{companyCode:"EDGEHOME",...(spec.fields.some((field)=>field.api==="divisionCode")?{divisionCode:"SD001"}:{}),...(active?{active}:{}),...(endpoint==="/divisions"?{divisionCode:"SD001",active:"Y"}:{}),...(endpoint==="/itemDetails"?{itemNo:"I1",itemPkey:"P1"}:{}),...(endpoint==="/items"?{itemNo:"I1"}:{})})];
    const body=spec.paged?{content:rows,number:0,size:2000,numberOfElements:rows.length,totalElements:rows.length,totalPages:1,last:true}:rows;
    return{ok:true,status:200,text:async()=>JSON.stringify(body)};
  };
  const result=await collectMasters({companyCode:"EDGEHOME",apiKey:"hidden",fetchOptions:{fetchImpl,pauseMs:0}});
  assert.equal(result.loads.length,9); assert.ok(calls.some((call)=>call.startsWith("/seasons?")&&call.includes("divisionCode=SD001"))); assert.equal(calls.filter((call)=>call.startsWith("/itemDetails?")).length,2);
});
