import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dispatchCommands } from "./dispatch";
import {
  WINDOWS_HEARTBEAT_COMMANDS,
  createWindowsCommandHandlers,
  type WindowsBusyFlags,
  type WindowsCommandContext,
  type WindowsCommands,
} from "./heartbeat-commands";

function makeCtx(flagOverrides: Partial<WindowsBusyFlags> = {}) {
  const calls: string[] = [];
  const done = (name: string) => async () => { calls.push(name); };
  const flags: WindowsBusyFlags = {
    isSamplingPdfText: false, isBackfillingPdfText: false, isBackfillingSgPdfText: false,
    isRunningCompatAudit: false, isRunningCompatAuditPreview: false, stopAcceptingJobs: false,
    activeJobs: 0, ...flagOverrides,
  };
  const ctx: WindowsCommandContext = {
    flags,
    logger: { info: () => {}, error: () => {} },
    runPdfTextSample: done("runPdfTextSample"),
    runPdfBackfill: done("runPdfBackfill"),
    runStyleGuidePdfBackfill: done("runStyleGuidePdfBackfill"),
    triggerImmediateUpdate: async (force) => { calls.push(force ? "forceUpdate" : "triggerUpdate"); },
    forceRestart: () => { calls.push("forceRestart"); },
    waitForIdleThenRestart: () => { calls.push("waitForIdleThenRestart"); },
    setPairingCode: (code) => { calls.push(`setPairingCode:${code}`); },
    doPairing: done("doPairing"),
    runCompatAudit: done("runCompatAudit"),
    runCompatAuditPreview: done("runCompatAuditPreview"),
    handleDirBrowse: done("handleDirBrowse"),
  };
  return { ctx, calls, flags };
}

const allCommands: WindowsCommands = {
  trigger_update: true,
  trigger_pdf_text_sample: true,
  pdf_text_sample_assets: [],
  trigger_pdf_backfill: true,
  trigger_popsg_pdf_backfill: true,
  force_restart: true,
  force_apply_update: true,
  force_stop_jobs: true,
  repair_pairing_code: "ABC",
  audit_compat_thumbnails: true,
  audit_compat_preview: true,
  browse_dir: { request_id: "r", path: "" },
};

test("windows dispatch table registers the same handlers, in the original order", () => {
  const { ctx } = makeCtx();
  assert.deepEqual(createWindowsCommandHandlers(ctx).map((h) => h.name), [...WINDOWS_HEARTBEAT_COMMANDS]);
});

test("every heartbeat command reaches its handler", async () => {
  const { ctx, calls, flags } = makeCtx();
  await dispatchCommands(allCommands, createWindowsCommandHandlers(ctx));
  assert.deepEqual(calls, [
    // the sample starts first, so both backfills are held back by the original guards
    "runPdfTextSample",
    "triggerUpdate", "forceUpdate", "forceRestart", "waitForIdleThenRestart",
    "setPairingCode:ABC", "doPairing",
    "runCompatAudit", "runCompatAuditPreview", "handleDirBrowse",
  ]);
  assert.equal(flags.stopAcceptingJobs, true);
});

test("backfills run when idle and no sample is requested", async () => {
  const { ctx, calls } = makeCtx();
  await dispatchCommands({ trigger_pdf_backfill: true }, createWindowsCommandHandlers(ctx));
  assert.deepEqual(calls, ["runPdfBackfill"]);
  const busy = makeCtx({ activeJobs: 1 });
  await dispatchCommands({ trigger_popsg_pdf_backfill: true }, createWindowsCommandHandlers(busy.ctx));
  assert.deepEqual(busy.calls, []);
});

test("missing or empty commands trigger nothing", async () => {
  const { ctx, calls } = makeCtx();
  await dispatchCommands(undefined, createWindowsCommandHandlers(ctx));
  await dispatchCommands({}, createWindowsCommandHandlers(ctx));
  assert.deepEqual(calls, []);
});

test("entrypoint wires heartbeat commands through the dispatch table", () => {
  const src = readFileSync(path.join(__dirname, "..", "index.ts"), "utf-8");
  assert.match(src, /createWindowsCommandHandlers\(/);
  assert.match(src, /dispatchCommands\(response\.commands, heartbeatCommandHandlers\)/);
  assert.doesNotMatch(src, /response\.commands\?\.(trigger_pdf_backfill|force_restart|browse_dir)/);
});

test('actual update handlers retain heartbeat delivery accounting until updater operation resolves',async()=>{
 const {HeartbeatDelivery}=await import('../maintenance-lease');
 for(const command of ['trigger_update','force_apply_update'] as const) {
  const {ctx}=makeCtx();let complete!:()=>void;let forceSeen:boolean|undefined;
  ctx.triggerImmediateUpdate=(force)=>{forceSeen=force;return new Promise<void>(r=>{complete=r})};
  const delivery=new HeartbeatDelivery();let finished=false;
  const operation=delivery.deliver(undefined,async()=>({commands:{[command]:true}}),async response=>{
   await dispatchCommands(response.commands,createWindowsCommandHandlers(ctx));
  }).then(()=>{finished=true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(delivery.inFlight,1);assert.equal(finished,false);
  assert.equal(forceSeen,command==='force_apply_update'?true:undefined);
  complete();await operation;assert.equal(delivery.inFlight,0);assert.equal(finished,true);
 }
});

test('actual heartbeat continues authenticated HTTP during counted updater wait without overlapping requests',async()=>{
 const vm=await import('node:vm');const ts=await import('typescript');const {HeartbeatDelivery}=await import('../maintenance-lease');
 const source=readFileSync(path.join(__dirname,'..','index.ts'),'utf8');const parsed=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);
 const declaration=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='startHeartbeat')!;
 const timers:Array<{fn:()=>Promise<void>,delay:number}>=[];const responses:Array<(r:any)=>void>=[];
 let httpActive=0,maxHttpActive=0,requests=0,configUpdates=0;let finishUpdate!:()=>void;
 const lease={nonce:'a'.repeat(32),expires_at:Date.now()+300000};let deferral:typeof lease|undefined=undefined;
 const delivery=new HeartbeatDelivery();
 const context:any={heartbeatDelivery:delivery,agentId:'agent',lastError:null,healthStatus:{},config:{version:'1',buildSha:'a'.repeat(40)},
  getUpdateState:()=>({}),currentCommandDeferral:()=>deferral,getLogTail:()=>[],consecutiveHeartbeatFailures:0,
  applyCloudConfig:()=>{configUpdates++},heartbeatCommandHandlers:[],
  dispatchCommands:async(commands:any)=>{if(commands?.trigger_update)await new Promise<void>(r=>{finishUpdate=r})},
  logger:{info:()=>{},debug:()=>{},error:()=>{}},process:{exit:()=>{throw Error('unexpected restart')}},
  setTimeout:(fn:()=>Promise<void>,delay:number)=>timers.push({fn,delay}),
  api:{suggestedHeartbeatDelayMs:()=>45000,isAuthFailure:()=>false,
   heartbeat:()=>{requests++;httpActive++;maxHttpActive=Math.max(maxHttpActive,httpActive);return new Promise(r=>responses.push(value=>{httpActive--;r(value)}))}}};
 vm.runInNewContext(ts.transpileModule(declaration.getText(parsed)+'\nstartHeartbeat();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const first=timers.shift()!.fn();assert.equal(requests,1);assert.equal(timers.length,0);
 responses.shift()!({commands:{trigger_update:true}});await new Promise(r=>setImmediate(r));
 assert.equal(delivery.inFlight,1);assert.equal(configUpdates,1);assert.equal(timers[0].delay,45000);
 deferral=lease;const second=timers.shift()!.fn();assert.equal(requests,2);assert.equal(delivery.inFlight,2);
 responses.shift()!({commands:{},command_deferral:lease});await second;
 assert.equal(configUpdates,2);assert.equal(maxHttpActive,1);assert.equal(delivery.inFlight,1);
 assert.equal(delivery.confirmedFor(lease,Date.now()),false);
 finishUpdate();await first;assert.equal(delivery.inFlight,0);assert.equal(delivery.confirmedFor(lease,Date.now()),true);
 assert.equal(timers.length,1); // no duplicate timer when earlier command finally completes
});
