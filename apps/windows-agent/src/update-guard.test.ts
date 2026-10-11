import { test } from "node:test";
import assert from "node:assert/strict";
import { assertTrustedDownloadUrl, assertTrustedFinalUrl, normalizeChecksum } from "./update-guard";

const good =
  "https://github.com/u2giants/popdam3/releases/download/windows-agent-latest/popdam-windows-agent-dist.zip";

test("accepts pinned release URL", () => assertTrustedDownloadUrl(good));

test("rejects http, other hosts, other repos, userinfo, garbage", () => {
  for (const u of [
    good.replace("https:", "http:"),
    "https://evil.com/u2giants/popdam3/releases/x.zip",
    "https://github.com/attacker/popdam3/releases/x.zip",
    "https://github.com.evil.com/u2giants/popdam3/releases/x.zip",
    "https://x@github.com/u2giants/popdam3/releases/x.zip",
    "not a url",
  ]) {
    assert.throws(() => assertTrustedDownloadUrl(u), u);
  }
});

test("final URL must be https on GitHub hosts", () => {
  assertTrustedFinalUrl("https://release-assets.githubusercontent.com/a/b");
  assert.throws(() => assertTrustedFinalUrl("https://evil.com/a"));
  assert.throws(() => assertTrustedFinalUrl("http://github.com/a"));
});

test("checksum is mandatory and well-formed", () => {
  assert.equal(normalizeChecksum("A".repeat(64)), "a".repeat(64));
  for (const c of ["", null, undefined, "abc", "z".repeat(64)]) {
    assert.throws(() => normalizeChecksum(c));
  }
});

async function updaterHarness() {
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');const ts=await import('typescript');
 const source=readFileSync(new URL('./updater.ts',import.meta.url),'utf8');const parsed=ts.createSourceFile('updater.ts',source,ts.ScriptTarget.Latest,true);
 const functions=parsed.statements.filter(n=>ts.isFunctionDeclaration(n)&&['checkForUpdate','performUpdateCheck'].includes(n.name?.text||'')).map(n=>n.getText(parsed)).join('\n');
 const timers:Array<()=>void>=[];let leased=false,jobs=0;let httpDone!:(v:unknown)=>void;let applyDone!:()=>void;let requests=0,applies=0;
 const context:any={state:{updating:false},config:{version:'1.0.0'},logger:{info:()=>{},debug:()=>{},warn:()=>{},error:()=>{}},
  api:{getLatestBuild:()=>{requests++;return new Promise(r=>{httpDone=r})}},isNewer:()=>false,
  activeJobsRef:()=>jobs,maintenancePausesClaims:()=>leased,maintenanceBlocksConsumedUpdate:()=>leased,setTimeout:(r:()=>void)=>timers.push(r),
  applyUpdate:()=>{applies++;return new Promise<void>(r=>{applyDone=r})}};
 vm.runInNewContext(ts.transpileModule('let updateOperation;\n'+functions+'\nglobalThis.run=checkForUpdate;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const flush=()=>new Promise<void>(r=>setImmediate(r));
 return {run:context.run as (id:string,force:boolean,bypass:boolean)=>Promise<void>,timers,flush,
  setLease:(v:boolean)=>{leased=v},setJobs:(v:number)=>{jobs=v},finishHttp:()=>httpDone({latest_version:'1.0.0'}),finishApply:()=>applyDone(),
  requests:()=>requests,applies:()=>applies};
}
test('actual updater retains consumed update through delayed HTTP, lease arrival, expiry and jobs drain',async()=>{
 const h=await updaterHarness();let finished=false;const operation=h.run('agent',true,false).then(()=>{finished=true});
 h.setLease(true);h.finishHttp();await h.flush();assert.equal(h.applies(),0);assert.equal(finished,false);
 h.setLease(false);h.setJobs(1);h.timers.shift()!();await h.flush();assert.equal(h.applies(),0);assert.equal(finished,false);
 h.setJobs(0);h.timers.shift()!();await h.flush();assert.equal(h.applies(),1);assert.equal(finished,false);
 h.finishApply();await operation;assert.equal(finished,true); // Equal version still applies: forceApply retained.
});
test('actual updater serializes swaps and retains force bypass after finite lease',async()=>{
 const h=await updaterHarness();const first=h.run('agent',true,false);h.finishHttp();await h.flush();
 const second=h.run('agent',true,true);assert.equal(h.requests(),1);assert.equal(h.applies(),1);
 h.finishApply();await first;await h.flush();assert.equal(h.requests(),2);
 h.setJobs(2);h.setLease(true);h.finishHttp();await h.flush();assert.equal(h.applies(),1);
 h.setLease(false);h.timers.shift()!();await h.flush();assert.equal(h.applies(),2); // original bypass retained
 h.finishApply();await second;
});

test('consumed update lease inspection fails closed on protected read errors, resumes only after trusted expiry',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');const ts=await import('typescript');
 const source=readFileSync(new URL('./maintenance-lease.ts',import.meta.url),'utf8');const parsed=ts.createSourceFile('lease.ts',source,ts.ScriptTarget.Latest,true);
 const declaration=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='maintenanceBlocksConsumedUpdate')!;
 let inaccessible=true;let paused=true;
 const context:any={trustedRequest:()=>{if(inaccessible)throw Error('ACL inspection timeout');return '{}'},inspectMaintenanceLease:()=>({pause:paused})};
 vm.runInNewContext(ts.transpileModule(declaration.getText(parsed).replace('export ', '')+'\nglobalThis.block=maintenanceBlocksConsumedUpdate;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 assert.equal(context.block(),true);
 inaccessible=false;assert.equal(context.block(),true);
 paused=false;assert.equal(context.block(),false);
});
