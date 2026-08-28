#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditTimeline, parseEventComment, renderTimeline } from '../db-coordination-events.mjs'

export function auditCoordinationComments(comments) {
  return auditTimeline(comments.flatMap((comment)=>parseEventComment(comment?.body??comment??'')))
}

export function main(argv) {
  const json=argv.includes('--json')
  const fileIndex=argv.indexOf('--comments-file')
  if(fileIndex<0||!argv[fileIndex+1]){console.error('REFUSED: --comments-file <json> is required');return 2}
  try{
    const comments=JSON.parse(readFileSync(argv[fileIndex+1],'utf8'))
    if(!Array.isArray(comments))throw new Error('comments file must contain a JSON array')
    const audit=auditCoordinationComments(comments)
    console.log(json?JSON.stringify(audit,null,2):renderTimeline(audit))
    return audit.valid?0:2
  }catch(error){console.error(`REFUSED: ${error.message}`);return 2}
}

if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1]))process.exitCode=main(process.argv.slice(2))
