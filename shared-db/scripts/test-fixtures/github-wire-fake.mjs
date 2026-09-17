// Wire-level fake GitHub for scripts/reviewer-wire-budget.test.mjs (issue #3187, Refs #2773).
// Loaded with NODE_OPTIONS=--import, it replaces every gh/git execFileSync in the
// process with answers from the JSON model at WIRE_STATE and logs each call to
// WIRE_LOG as {kind,label}. kind rest|graphql = one GitHub API request.
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { currentRepository } from '../lib/repository-identity.mjs'
const STATE=process.env.WIRE_STATE, LOG=process.env.WIRE_LOG, REPO=currentRepository()
const load=()=>JSON.parse(readFileSync(STATE,'utf8')), save=(s)=>writeFileSync(STATE,JSON.stringify(s))
const log=(kind,label)=>appendFileSync(LOG,JSON.stringify({kind,label})+'\n')
const fail=(msg)=>{const e=new Error(msg);e.stderr=msg;e.status=1;throw e}
const hdr=(body,extra='')=>`HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nX-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4000\r\nX-Ratelimit-Reset: 9999999999\r\n${extra}\r\n${body}`
let counter=0
const newSha=(x)=>createHash('sha1').update(JSON.stringify(x)+process.pid+Date.now()+(counter++)).digest('hex')
function commitObj(s,oid){const c=s.commits[oid];if(!c)return null;return{oid,sha:oid,message:c.message,committedDate:c.date??'2026-09-17T00:00:00Z',tree:{oid:c.tree,sha:c.tree},parents:(c.parents??[]).map(p=>({sha:p,oid:p}))}}
function resolveExpr(s,expr){if(/^[0-9a-f]{40}$/.test(expr))return commitObj(s,expr);const t=s.refs[expr];return t?commitObj(s,t):null}
function prGql(s,n){const p=s.prs[n];if(!p)return null;return{number:+n,state:p.state.toUpperCase(),merged:!!p.merged,isDraft:!!p.draft,mergedAt:p.mergedAt??null,mergeCommit:p.mergeCommit?{oid:p.mergeCommit}:null,headRefOid:p.head,files:{pageInfo:{hasNextPage:false},nodes:p.files.map(f=>({path:f.filename,changeType:'ADDED'}))},closingIssuesReferences:{pageInfo:{hasNextPage:false},nodes:(p.closing??[]).map(i=>({number:+i,state:s.issues[i].state.toUpperCase(),body:s.issues[i].body,createdAt:'2026-09-01T00:00:00Z',comments:issueGql(s,i).comments}))},comments:{pageInfo:{hasNextPage:false},totalCount:0,nodes:[]},reviews:{pageInfo:{hasNextPage:false},totalCount:0,nodes:[]},reviewThreads:{totalCount:0,nodes:[]},body:p.body??'',title:p.title??'',labels:{nodes:[]}}}
function issueGql(s,n){const i=s.issues[n];if(!i)return null;return{number:+n,state:i.state.toUpperCase(),body:i.body,title:i.title,comments:{pageInfo:{hasNextPage:false},nodes:[]},labels:{nodes:(i.labels??[]).map(name=>({name}))}}}
function selections(body){const out=[];let i=0;while(i<body.length){const m=/^\s*(?:(\w+)\s*:\s*)?(\w+)\s*(\(([^)]*)\))?\s*/.exec(body.slice(i));if(!m||!m[2]){i++;continue}i+=m[0].length;let sub='';if(body[i]==='{'){let d=0,j=i;for(;j<body.length;j++){if(body[j]==='{')d++;else if(body[j]==='}'){d--;if(!d)break}}sub=body.slice(i+1,j);i=j+1}out.push({alias:m[1]??m[2],name:m[2],args:m[4]??'',sub})}return out}
function graphql(s,query,vars){
  const data={}
  const top=/query\s*(\([^)]*\))?\s*\{([\s\S]*)\}\s*$/.exec(query)[2]
  for(const sel of selections(top)){
    if(sel.name==='rateLimit'){data[sel.alias]={limit:5000,remaining:4000,resetAt:'2286-01-01T00:00:00Z',cost:1};continue}
    if(sel.name!=='repository')fail(`fake graphql: unsupported top-level ${sel.name}`)
    const repo={}
    for(const f of selections(sel.sub)){
      const arg=(k)=>{const m=new RegExp(`${k}\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|\\$\\w+|\\d+)`).exec(f.args);if(!m)return undefined;const v=m[1];return v.startsWith('$')?vars[v.slice(1)]:JSON.parse(v)}
      if(f.name==='object'&&arg('oid')!==undefined)repo[f.alias]={statusCheckRollup:null}
      else if(f.name==='object')repo[f.alias]=resolveExpr(s,arg('expression'))
      else if(f.name==='defaultBranchRef')repo[f.alias]={name:'main',target:commitObj(s,s.refs['refs/heads/main'])}
      else if(f.name==='pullRequest')repo[f.alias]=prGql(s,arg('number'))
      else if(f.name==='issue')repo[f.alias]=issueGql(s,arg('number'))
      else fail(`fake graphql: unsupported repository field ${f.name}`)
    }
    data[sel.alias]=repo
  }
  return {data}
}
function restGet(s,path){
  let m
  if(path.startsWith(`repos/${REPO}/actions/runs?head_sha=`))return{total_count:0,workflow_runs:[]}
  if(path==='rate_limit')return{resources:{core:{limit:5000,remaining:4000,reset:9999999999},graphql:{limit:5000,remaining:4000,reset:9999999999}},rate:{limit:5000,remaining:4000,reset:9999999999}}
  if((m=new RegExp(`^repos/${REPO}/pulls/(\\d+)/files`).exec(path))){const p=s.prs[m[1]]??fail('HTTP 404: Not Found');return p.files}
  if((m=new RegExp(`^repos/${REPO}/pulls/(\\d+)$`).exec(path))){const p=s.prs[m[1]]??fail('HTTP 404: Not Found');return{number:+m[1],state:p.state,merged:!!p.merged,merge_commit_sha:p.mergeCommit??null,head:{sha:p.head,ref:p.branch??'b'},base:{ref:'main'},body:p.body??'',title:p.title??'',labels:[],user:{login:'u2giants'}}}
  if((m=new RegExp(`^repos/${REPO}/issues/(\\d+)$`).exec(path))){const i=s.issues[m[1]]??fail('HTTP 404: Not Found');return{number:+m[1],state:i.state,body:i.body,title:i.title,labels:(i.labels??[]).map(name=>({name})),user:{login:'u2giants'}}}
  if((m=new RegExp(`^repos/${REPO}/git/ref/(.+)$`).exec(path))){const r='refs/'+m[1];const t=s.refs[r]??fail('gh: Not Found (HTTP 404)');return{ref:r,object:{sha:t,type:'commit'}}}
  if((m=new RegExp(`^repos/${REPO}/git/matching-refs/([^?]+)`).exec(path))){const pre='refs/'+decodeURIComponent(m[1]);return Object.keys(s.refs).filter(r=>r.startsWith(pre)).sort().map(r=>({ref:r,object:{sha:s.refs[r],type:'commit'}}))}
  if((m=new RegExp(`^repos/${REPO}/git/commits/([0-9a-f]{40})$`).exec(path))){const c=commitObj(s,m[1])??fail('HTTP 404: Not Found');return{sha:c.oid,message:c.message,tree:{sha:c.tree.oid},parents:c.parents,committer:{date:c.committedDate},author:{date:c.committedDate}}}
  if(new RegExp(`^repos/${REPO}/issues(\\?|$)`).test(path)){return Object.entries(s.issues).filter(([,i])=>i.state==='open').map(([n,i])=>({number:+n,state:i.state,title:i.title,body:i.body,labels:(i.labels??[]).map(name=>({name})),user:{login:'u2giants'},updated_at:'2026-09-17T00:00:00Z',created_at:'2026-09-01T00:00:00Z'}))}
  if(new RegExp(`^repos/${REPO}/labels([?]|$)`).test(path))return (s.labels??["orchestrator-marker","db-claim"]).map(name=>({name}))
  fail(`fake: unsupported GET ${path}`)
}
function field(a,flag,key){const out=[];for(let i=0;i<a.length;i++)if(a[i]===flag&&String(a[i+1]).startsWith(key+'='))out.push(String(a[i+1]).slice(key.length+1));return out}
function handleGh(a){
  const s=load()
  if(a[0]!=='api'){log('rest','gh '+a.slice(0,2).join(' '));fail(`fake: unsupported gh ${a.slice(0,3).join(' ')}`)}
  const method=a.includes('-X')?a[a.indexOf('-X')+1]:'GET', include=a.includes('-i')
  let p;for(let i=1;i<a.length;i++){if(["-X","-f","-F","-H","--jq"].includes(a[i])){i++;continue}if(a[i].startsWith("-"))continue;p=a[i];break}
  if(p==='graphql'){
    const query=field(a,'-f','query')[0], vars={}
    for(let i=0;i<a.length;i++)if(a[i]==='-F'){const [k,...r]=String(a[i+1]).split('=');const v=r.join('=');vars[k]=/^\d+$/.test(v)?+v:v}
    const names=(query.match(/\b(\w+)\s*(?=\()/g)||[]).filter(n=>!['query','repository'].includes(n))
    log('graphql',[...new Set(names)].join(',')||'rateLimit')
    const out=JSON.stringify(graphql(s,query,vars));return include?hdr(out):out
  }
  log('rest',`${method} ${p.replace(`repos/${REPO}/`,'')}${a.includes('--paginate')?' [paginate]':''}`)
  if(method==='GET'){let body=restGet(s,p);if(a.includes('--slurp'))body=[body];return include?hdr(JSON.stringify(body)):JSON.stringify(body)}
  if(method==='POST'&&p===`repos/${REPO}/git/commits`){const oid=newSha(a);s.commits[oid]={message:field(a,'-f','message')[0],tree:field(a,'-f','tree')[0],parents:field(a,'-f','parents[]'),date:new Date().toISOString()};save(s);const out=JSON.stringify({sha:oid,message:s.commits[oid].message,tree:{sha:s.commits[oid].tree},parents:s.commits[oid].parents.map(x=>({sha:x}))});return include?hdr(out,"X-Ratelimit-Resource: core\r\n"):out}
  if(method==='POST'&&p===`repos/${REPO}/git/refs`){const ref=field(a,'-f','ref')[0],t=field(a,'-f','sha')[0];if(s.refs[ref])fail('gh: Reference already exists (HTTP 422)');s.refs[ref]=t;save(s);return JSON.stringify({ref,object:{sha:t}})}
  let m
  if(method==='PATCH'&&(m=new RegExp(`^repos/${REPO}/git/refs/(.+)$`).exec(p))){const ref='refs/'+m[1];if(!s.refs[ref])fail('gh: Reference does not exist (HTTP 422)');s.refs[ref]=field(a,'-f','sha')[0];save(s);return JSON.stringify({ref,object:{sha:s.refs[ref]}})}
  if(method==='DELETE'&&(m=new RegExp(`^repos/${REPO}/git/refs/(.+)$`).exec(p))){const ref='refs/'+m[1];if(!s.refs[ref])fail('gh: Reference does not exist (HTTP 422)');delete s.refs[ref];save(s);return ''}
  fail(`fake: unsupported ${method} ${p}`)
}
const nl=String.fromCharCode(10)
function handleGit(a,opts){
  const s=load(), args=a[0]==='-C'?a.slice(2):a, sub=args[0]
  if(sub==='remote'&&args[1]==='get-url'){log('git-local','remote get-url');return `https://github.com/${REPO}.git`}
  if(sub==='cat-file'&&args[1]==='--batch'){log('git-local','cat-file --batch');const parts=[];for(const sha of String(opts?.input??'').split(nl).filter(Boolean)){const c=s.commits[sha];if(!c){parts.push(Buffer.from(sha+' missing'+nl));continue}const body=Buffer.from('tree '+c.tree+nl+(c.parents??[]).map(p=>'parent '+p+nl).join('')+'author A <a@x> 1789000000 +0000'+nl+'committer A <a@x> 1789000000 +0000'+nl+nl+c.message);parts.push(Buffer.from(sha+' commit '+body.length+nl),body,Buffer.from(nl))}return Buffer.concat(parts)}
  if(sub==='cat-file'){log('git-local','cat-file');if(!s.commits[String(args.at(-1)).replace('^{commit}','')])fail('unknown commit');return ''}
  if(sub==='fetch'){log('git-wire','fetch');return ''}
  if(sub==='ls-remote'){log('git-wire','ls-remote');return Object.entries(s.refs).map(([r,t])=>`${t}\t${r}`).join('\n')+'\n'}
  if(sub==='push'){
    log('git-wire','push')
    const leases=new Map(args.filter(x=>x.startsWith('--force-with-lease=')).map(x=>{const [r,...e]=x.slice(19).split(':');return[r,e.join(':')]}))
    const specs=args.slice(1).filter(x=>!x.startsWith('-')&&x!=='origin'&&!/^https?:/.test(x))
    const ops=specs.map(sp=>{const [src,dst]=sp.replace(/^\+/,'').split(':');return{src,dst}})
    for(const {dst} of ops)if(leases.has(dst)){const e=leases.get(dst)||'';const cur=s.refs[dst]??'';if(e!==cur)fail(`! [rejected] ${dst} (stale info)`)}
    for(const {src,dst} of ops){if(!src)delete s.refs[dst];else s.refs[dst]=src}
    save(s);return ''
  }
  log('git-local',args.slice(0,3).join(' '));fail(`fake: unsupported git ${args.slice(0,3).join(' ')}`)
}
const orig=cp.execFileSync
const nodeName=process.execPath.split(/[\\/]/).pop().replace(/\.exe$/i,'')
cp.execFileSync=function(bin,args,opts){
  const name=String(bin).split(/[\\/]/).pop().replace(/\.exe$/i,'')
  if(name==='gh')return handleGh((args??[]).map(String))
  if(name==='git')return handleGit((args??[]).map(String),opts)
  if(name===nodeName)return orig.apply(this,arguments)
  if(name==='where'||name==='which'){log('local','where');return `C:\\fake\\${args[0]}.exe\r\n`}
  if(name==='ai-review-preflight'){log('local','preflight');return ['grok','glm','kimi','qwen','muse','codex','deepseek','gemini'].map(provider=>JSON.stringify({provider,usable:true,status:'qualified',admission:{schema_version:1,provider,state:'unknown',quota_state:'unknown',reset_at:null,reason:'unscopable',credential_profile_scope:null,model_scope:null}})).join('\n')+'\n'}
  log('other',name);fail(`fake: unsupported binary ${name}`)
}
syncBuiltinESMExports()
