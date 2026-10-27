import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
export const BROWSER_PACKAGE='/tmp/popdam-4427-runtime-01a17a03/node_modules/playwright';
export const CHROME='/opt/google/chrome/chrome';
export const BROWSER_MANIFEST='/tmp/4427-browser-custody-01a17b07.json';
export const BROWSER_MANIFEST_SHA='01859db6b82549ec9c5c7d617cb62654e3cf56a954e8ee423bf238fe6f945451';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireOK=ok=>{if(!ok)throw new Error('browser custody or local capability refused');};
export function rejectBrowserOverrides(env) {
  for(const [k,v] of Object.entries(env)) if(v && (/^PLAYWRIGHT_/.test(k)||['NODE_OPTIONS','NODE_DEBUG','DEBUG','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','CHROME_PATH','CHROMIUM_PATH'].includes(k))) throw new Error('browser override refused');
}
export function safeMetadata(stat,{uid=process.getuid(),rootOwned=false}={}) {
  requireOK(!stat.isSymbolicLink() && (stat.isFile()||stat.isDirectory()) && stat.uid===(rootOwned?0:uid) && (stat.mode&0o022)===0);
}
export function compareInventory(expected,actual) {
  requireOK(JSON.stringify(Object.keys(expected).sort())===JSON.stringify(Object.keys(actual).sort()));
  for(const [name,hash]of Object.entries(expected)) requireOK(/^[a-f0-9]{64}$/.test(hash)&&actual[name]===hash);
}
function inventory(root) {
  const result={};
  const visit=dir=>{
    safeMetadata(fs.lstatSync(dir)); requireOK(fs.realpathSync(dir)===dir);
    for(const leaf of fs.readdirSync(dir).sort()) {
      const file=path.join(dir,leaf),stat=fs.lstatSync(file);safeMetadata(stat);
      if(stat.isDirectory())visit(file);else result[path.relative(root,file)]=sha(fs.readFileSync(file));
    }
  };visit(root);return result;
}
export function validateBrowserCustody(env=process.env) {
  rejectBrowserOverrides(env);
  const manifestStat=fs.lstatSync(BROWSER_MANIFEST);
  safeMetadata(manifestStat);requireOK(manifestStat.isFile()&&(manifestStat.mode&0o077)===0&&manifestStat.size<1024*1024&&fs.realpathSync(BROWSER_MANIFEST)===BROWSER_MANIFEST);
  const bytes=fs.readFileSync(BROWSER_MANIFEST);requireOK(sha(bytes)===BROWSER_MANIFEST_SHA);
  const m=JSON.parse(bytes);
  requireOK(m.schema_version===1&&m.runtime_root==='/tmp/popdam-4427-runtime-01a17a03/node_modules'&&m.chrome.path===CHROME&&m.chrome.version==='156.0.8078.47');
  for(const dir of [m.runtime_root,path.dirname(m.runtime_root)]) {safeMetadata(fs.lstatSync(dir));requireOK(fs.realpathSync(dir)===dir);}
  requireOK(Object.keys(m.packages).sort().join(',')==='playwright,playwright-core');
  for(const name of ['playwright','playwright-core']) {
    const root=path.join(m.runtime_root,name);
    requireOK(m.packages[name].version==='1.56.1'&&JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version==='1.56.1');
    compareInventory(m.packages[name].files,inventory(root));
  }
  for(const file of [CHROME,'/opt/google/chrome','/opt/google','/opt']) {safeMetadata(fs.lstatSync(file),{rootOwned:true});requireOK(fs.realpathSync(file)===file);}
  requireOK((fs.lstatSync(CHROME).mode&0o111)!==0);
  requireOK(sha(fs.readFileSync(CHROME))===m.chrome.sha256);
  requireOK(sha(fs.readFileSync(m.integrity_file))===m.integrity_sha256&&sha(fs.readFileSync(m.assessment_file))===m.assessment_sha256);
  return m;
}
export function fixedBrowserEnvironment() {
  return {PATH:'/usr/bin:/bin',HOME:'/tmp/popdam-4427-runtime-01a17a03/home',TMPDIR:'/tmp'};
}
export async function openQualifiedBlankBrowser(env=process.env) {
  const m=validateBrowserCustody(env);
  const {chromium}=createRequire(import.meta.url)(BROWSER_PACKAGE);
  let browser,context,page,blocked=0;
  const deny=async route=>{blocked++;await route.abort('blockedbyclient');};
  try {
    browser=await chromium.launch({channel:'chrome',headless:true,env:fixedBrowserEnvironment()});
    requireOK(browser.version()===m.chrome.version);
    context=await browser.newContext({viewport:{width:1600,height:1000},serviceWorkers:'block'});
    await context.route('**/*',deny);
    page=await context.newPage();
    await page.goto('about:blank');
    await page.setContent('<!doctype html><html><body><label for="probe">Local probe</label><input id="probe"></body></html>');
    await page.getByLabel('Local probe',{exact:true}).fill('4427-local-only');
    requireOK(await page.getByLabel('Local probe',{exact:true}).inputValue()==='4427-local-only'&&page.url()==='about:blank'&&blocked===0);
    return {browser,context,page,version:m.chrome.version,releaseProbeGuard:()=>context.unroute('**/*',deny),blockedCount:()=>blocked};
  } catch(error) {
    try{if(context)await context.close();}finally{if(browser)await browser.close();}
    throw error;
  }
}
