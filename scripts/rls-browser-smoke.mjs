import {mkdir,lstat,realpath,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openQualifiedBlankBrowser,fixedBrowserEnvironment} from './rls-browser-custody.mjs';
export const SMOKE_OUTPUT='/tmp/4427-chrome-smoke-private-01a17a03/receipt.json';
export function requireSmokeEnvironment(env) {
  const allowed=new Set(['PATH','HOME','TMPDIR','LANG','LC_ALL']);
  if(Object.keys(env).some(k=>!allowed.has(k)))throw new Error('smoke requires cleared environment');
  const expected=fixedBrowserEnvironment();
  if(Object.entries(expected).some(([k,v])=>env[k]!==v))throw new Error('smoke requires fixed environment');
}
export async function smoke(env=process.env) {
  requireSmokeEnvironment(env);
  const directory=resolve(SMOKE_OUTPUT,'..');
  await mkdir(directory,{recursive:true,mode:0o700});const stat=await lstat(directory);
  if(stat.isSymbolicLink()||await realpath(directory)!==directory||stat.uid!==process.getuid()||(stat.mode&0o077))throw new Error('private smoke directory');
  const output=await open(SMOKE_OUTPUT,'wx',0o600);
  const report={schema_version:1,passed:false,local_dom:false,chrome_version:null,unexpected_page_requests:0,context_closed:false,browser_closed:false};
  let local;
  try {local=await openQualifiedBlankBrowser(env);report.local_dom=true;report.chrome_version=local.version;}
  finally {
    if(local){
      report.unexpected_page_requests=local.blockedCount();
      try{await local.context.close();report.context_closed=true;}catch{/* retain failed cleanup */}
      try{await local.browser.close();report.browser_closed=true;}catch{/* retain failed cleanup */}
    }
    report.passed=report.local_dom&&report.unexpected_page_requests===0&&report.context_closed&&report.browser_closed;
    try{await output.writeFile(JSON.stringify(report)+'\n');await output.sync();}finally{await output.close();}
  }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const report=await smoke();console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;}
  catch{console.error('FAIL: fixed local Chrome smoke or private receipt');process.exitCode=1;}
}
