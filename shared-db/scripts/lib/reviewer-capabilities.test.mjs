import test from 'node:test'
import assert from 'node:assert/strict'
import { GOVERNED_VERDICT_WRAPPERS, VERDICT_CONTRACT_FLAG_WRAPPERS, wrapperBaseName, wrapperEmitsGovernedVerdict, forbiddenGovernedSubcommand, GOVERNED_SUBCOMMANDS } from './reviewer-capabilities.mjs'

test('#2831: wrapper names normalise across paths and Windows extensions',()=>{
  assert.equal(wrapperBaseName('C:\\tools\\AI-Muse.cmd'),'ai-muse')
  assert.equal(wrapperBaseName('/usr/local/bin/ai-qwen'),'ai-qwen')
  assert.equal(wrapperBaseName(undefined),'')
})
test('#2831: governed-verdict capability is an explicit list and fails closed',()=>{
  for(const w of GOVERNED_VERDICT_WRAPPERS)assert.equal(wrapperEmitsGovernedVerdict(w),true)
  for(const w of VERDICT_CONTRACT_FLAG_WRAPPERS)assert.ok(GOVERNED_VERDICT_WRAPPERS.includes(w))
  assert.equal(wrapperEmitsGovernedVerdict('ai-unknown'),false)
  assert.equal(wrapperEmitsGovernedVerdict(''),false)
})
test('#2831: ai-muse runs only through its allowlisted subcommands',()=>{
  assert.equal(forbiddenGovernedSubcommand('ai-muse',['review','prompt']),'review')
  assert.equal(forbiddenGovernedSubcommand('ai-muse.cmd',['--','--flag','REVIEW']),'REVIEW')
  assert.equal(forbiddenGovernedSubcommand('ai-muse',['future-sub']),'future-sub','an unknown subcommand fails closed')
  assert.equal(forbiddenGovernedSubcommand('ai-muse',[]),'(none)')
  assert.equal(forbiddenGovernedSubcommand('ai-muse',['new','review this']),null)
  assert.equal(forbiddenGovernedSubcommand('ai-muse',['ASK','x']),null)
  assert.equal(forbiddenGovernedSubcommand('ai-muse',['--review-kind','review','new'],new Set(['--review-kind'])),null,'an option value is never the subcommand')
  assert.equal(forbiddenGovernedSubcommand('ai-muse',['--review-kind','review','new']),'review')
  assert.equal(forbiddenGovernedSubcommand('ai-grok-review',['review']),null)
  assert.equal(forbiddenGovernedSubcommand('constructor',['x']),null,'prototype keys are not wrappers')
})
test('#2831: every subcommand-gated wrapper is a governed-verdict wrapper',()=>{
  for(const w of Object.keys(GOVERNED_SUBCOMMANDS))assert.ok(GOVERNED_VERDICT_WRAPPERS.includes(w),w)
})
