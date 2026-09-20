// ISSUE #2678 -- THE REVIEWER WRAPPERS NEED TO BE TOLD WHO IS CALLING THEM.
//
// Every credentialed reviewer wrapper (`ai-muse`, `ai-kimi`, ...) refuses to run
// unless its own `AI_<PROVIDER>_CALLER` variable names the assistant driving it:
// `credentialed execution never guesses the caller`. When the governed runner or
// the lane preflight spawned the wrapper (including its `doctor` probe) without
// that variable, the wrapper exited 1 before printing a single `PASS`/`FAIL`
// check line, and the probe reported `doctor could not be run (exit 1) and named
// no check -- this is a LOCAL dependency fault on this machine`. Both reviewers
// were completely healthy; the runner simply had not said who it was.
//
// This module is the ONE place that maps a wrapper to its caller variable and
// decides the caller value, so the governed review runner and the author-lane
// preflight can never drift apart on it.
export const REVIEW_CALLER_VARIABLES=Object.freeze({'ai-muse':'AI_MUSE_CALLER','ai-grok-review':'AI_GROK_CALLER','ai-glm':'AI_GLM_CALLER','ai-kimi':'AI_KIMI_CALLER','ai-qwen':'AI_QWEN_CALLER','ai-gemini':'AI_GEMINI_CALLER','ai-deepseek-agent':'AI_DEEPSEEK_CALLER','ai-codex-review':'AI_CODEX_REVIEW_CALLER'})

// A wrapper may be named bare (`ai-muse`) or as a resolved path
// (`C:/bin/ai-muse.cmd`); both must reach the same caller variable.
export function reviewerWrapperBaseName(wrapper){
  return String(wrapper??'').split(/[\\/]/).pop().replace(/\.(cmd|bat|exe)$/i,'').toLowerCase()
}

export function reviewerCallerVariable(wrapper){
  return REVIEW_CALLER_VARIABLES[reviewerWrapperBaseName(wrapper)]??null
}

// The caller the environment already names wins -- an operator who exported
// `AI_MUSE_CALLER=codex` is running Codex and is not overruled here. Otherwise
// the engine is detected from the harness's own markers.
export function detectReviewCaller(env=process.env){
  if(env.CLAUDECODE==='1'||env.CLAUDE_CODE_SESSION_ID)return 'claude'
  if(env.CODEX_THREAD_ID||env.CODEX_SANDBOX)return 'codex'
  return ''
}

// `required:true` (the governed runner, which is about to spend a review round)
// refuses when the caller cannot be determined, naming the exact repair.
// `required:false` (the doctor probe) returns `{}` instead: a probe must never
// turn an undetectable caller into a reviewer failure of its own.
export function reviewCallerEnvironment(wrapper,env=process.env,{required=true}={}){
  const variable=reviewerCallerVariable(wrapper)
  if(!variable)return {}
  const current=String(env[variable]??'').trim()
  if(current)return {[variable]:current}
  const detected=detectReviewCaller(env)
  if(detected)return {[variable]:detected}
  if(!required)return {}
  throw new Error(`${reviewerWrapperBaseName(wrapper)} needs ${variable} set to the assistant running this review, and it could not be detected. No reviewer was started. Rerun with ${variable}=claude (or codex) in the environment.`)
}
