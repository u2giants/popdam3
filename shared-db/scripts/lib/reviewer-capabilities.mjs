// Issue #2831 -- the single list of which reviewer wrappers can emit a GOVERNED verdict.
//
// A governed review is recorded only from one terminal line of the form
// `VERDICT: APPROVE|REVISE|REJECT <40-hex head sha>`. A wrapper that cannot be run in a
// way that ends with that line can be drawn, leased and never satisfied. The allocator
// (`scripts/manage-migration-author-lanes.mjs`) and the runner
// (`scripts/run-governed-review.mjs`) both read this module, so the capability fact and
// the runner's behaviour cannot drift apart.

// Every wrapper the governed runner will launch. A roster row whose wrapper is not here
// cannot produce a recordable governed verdict and is never drawn.
export const GOVERNED_VERDICT_WRAPPERS = Object.freeze(['ai-claude-review','ai-codex-review','ai-deepseek-agent','ai-gemini','ai-glm','ai-grok-review','ai-kimi','ai-muse','ai-qwen'])

// Wrappers that take the explicit `--governed-verdict <head>` contract flag.
export const VERDICT_CONTRACT_FLAG_WRAPPERS = Object.freeze(['ai-gemini','ai-qwen','ai-deepseek-agent'])

// Wrappers whose governed capability depends on the subcommand. The list is an
// ALLOWLIST, so an unknown or future subcommand fails closed. `ai-muse review` injects
// `VERDICT: FINDINGS|NO FINDINGS` (REQUIRE_VERDICT=1), which carries no decision and no
// head; only `new`/`ask` take the governed prompt as written. The runner enforces this
// before any reviewer starts, so ai-muse's place in GOVERNED_VERDICT_WRAPPERS is a fact
// the runner guarantees, not an operator choice.
export const GOVERNED_SUBCOMMANDS = Object.freeze({'ai-muse':Object.freeze(['new','ask'])})

export function wrapperBaseName(wrapper){
  return String(wrapper??'').split(/[\\/]/).pop().replace(/\.(cmd|bat|exe)$/i,'').toLowerCase()
}

export function wrapperEmitsGovernedVerdict(wrapper){
  return GOVERNED_VERDICT_WRAPPERS.includes(wrapperBaseName(wrapper))
}

// The first positional argument is the subcommand; the value of an option named in
// `valueOptions` is skipped, never mistaken for one. Returns the refused subcommand (or
// '(none)' when there is none), or null when the wrapper may run as given.
export function forbiddenGovernedSubcommand(wrapper,args,valueOptions=new Set()){
  const name=wrapperBaseName(wrapper)
  if(!Object.hasOwn(GOVERNED_SUBCOMMANDS,name))return null
  const allowed=GOVERNED_SUBCOMMANDS[name],list=[...(args??[])].map(String)
  let sub=null
  for(let i=list[0]==='--'?1:0;i<list.length;i+=1){
    if(list[i].startsWith('-')){if(valueOptions.has(list[i]))i+=1;continue}
    sub=list[i];break
  }
  if(sub===null)return '(none)'
  return allowed.includes(sub.toLowerCase())?null:sub
}
