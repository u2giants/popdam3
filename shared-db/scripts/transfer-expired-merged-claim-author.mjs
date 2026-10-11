#!/usr/bin/env node
// Explicit #3618 expired-MERGED operation; the ordinary lane-manager CLI stays unchanged.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { transferExpiredMergedClaimAuthor, validateMergedAdoptionRequest } from './lib/lanes/expired-merged-claim-adoption.mjs'
const FLAGS={'--issue':'issue','--claim-number':'claim','--pr':'pr','--head-sha':'headSha','--old-owner':'oldOwner','--new-owner':'newOwner','--branch':'branch','--worktree':'worktree','--target-worktree':'targetWorktree','--abandonment-issue':'abandonmentIssue','--worktree-state':'worktreeState','--authorization-chat-id':'authorizationChatId','--authorization-quote-file':'quoteFile','--recovery-artifact':'recoveryArtifact','--lease-hours':'leaseHours'}
export function parseArgs(argv){
  const out={}
  for(let i=0;i<argv.length;i+=2){const key=FLAGS[argv[i]],value=argv[i+1];if(!key||Object.hasOwn(out,key)||!value||value.startsWith('--'))throw Error('unknown, duplicate or missing guarded adoption argument');out[key]=value}
  if(!out.quoteFile)throw Error('authorization quote file required')
  for(const key of ['issue','claim','pr','abandonmentIssue','leaseHours'])out[key]=Number(out[key])
  out.authorizationQuote=readFileSync(out.quoteFile,'utf8').trim();delete out.quoteFile
  return validateMergedAdoptionRequest(out)
}
export function main(argv,now=new Date(),io,output=console){
  try{const result=transferExpiredMergedClaimAuthor(parseArgs(argv),now,io);output.log(JSON.stringify(result,null,2));return 0}catch(error){output.error(error.message);return 1}
}
if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1]))process.exitCode=main(process.argv.slice(2))
