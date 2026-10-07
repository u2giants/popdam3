// Bounded static dependency closure of reviewed repository objects, never user source.
import {posix} from 'node:path';
export const RECOVERY_DEPENDENCY_ROOTS=Object.freeze(['scripts/manage-migration-author-lanes.mjs','scripts/lib/lanes/completed-claim-recovery.mjs','scripts/query-completed-claim-catalog.mjs','scripts/lib/claim-recovery-dependencies.mjs']);
export function recoveryDependencyPaths(readReviewedFile,{maxFiles=512,maxBytes=12*1024*1024}={}){
 const todo=[...RECOVERY_DEPENDENCY_ROOTS],seen=new Set();let bytes=0;
 while(todo.length){const file=todo.pop();if(seen.has(file))continue;if(seen.size>=maxFiles)throw Error('recovery dependency closure exceeds bound');seen.add(file);const source=readReviewedFile(file);if(typeof source!=='string'||(bytes+=Buffer.byteLength(source))>maxBytes)throw Error('reviewed dependency bytes unavailable or excessive');
  const imports=[...source.matchAll(/(?:^|[;\n])[ \t]*import\s+(?:(?:[\w$]+(?:\s*,\s*)?)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)?\s+from\s+)?['"]([^'"]+)['"]/g),...source.matchAll(/(?:^|[;\n])[ \t]*export\s+(?:\{[^}]*\}|\*\s*(?:as\s+[\w$]+)?)\s+from\s+['"]([^'"]+)['"]/g)];
  for(const match of imports){const imported=match[1];if(!imported.startsWith('.'))continue;const resolved=posix.normalize(posix.join(posix.dirname(file),imported));if(resolved.startsWith('../')||posix.isAbsolute(resolved)||!/\.(?:mjs|js|cjs|json)$/.test(resolved))throw Error('reviewed dependency path refused');todo.push(resolved)}
 }
 return [...seen].sort();
}
export function recoveryCodeUnchangedAt({toolSha,mainSha,readOnlyGit,extraPaths=[]}){
 try{
  const paths=recoveryDependencyPaths(path=>readOnlyGit(['show',`${toolSha}:${path}`]));
  for(const path of extraPaths)if(!paths.includes(path))paths.push(path);
  readOnlyGit(['diff','--quiet',toolSha,mainSha,'--',...paths]);
  readOnlyGit(['diff','--quiet',mainSha,'--',...paths]);
  return true;
 }catch{return false}
}
