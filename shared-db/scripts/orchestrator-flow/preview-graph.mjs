import { sha256, canonicalJson } from './evidence-bundle.mjs'

export class PreviewGraphError extends Error {}

export function buildPreviewGraph({mainVersions,previewVersions,claims=[]}){
  for(const [name,values] of Object.entries({mainVersions,previewVersions}))if(!Array.isArray(values)||values.some((value)=>!/^\d{14}$/.test(String(value))))throw new PreviewGraphError(`${name} must contain 14-digit versions`)
  const main=new Set(mainVersions.map(String)),preview=new Set(previewVersions.map(String)),nodes=new Map()
  for(const version of [...new Set([...main,...preview])].sort())nodes.set(version,{version,onMain:main.has(version),onPreview:preview.has(version),claim:null})
  for(const claim of claims){
    if(!Number.isInteger(claim.issue)||!Number.isInteger(claim.pr)||!Array.isArray(claim.versions))throw new PreviewGraphError('claim identity is malformed')
    for(const version of claim.versions){if(!nodes.has(version))nodes.set(version,{version,onMain:false,onPreview:false,claim:null});if(nodes.get(version).claim)throw new PreviewGraphError(`version ${version} has multiple claims`);nodes.get(version).claim={issue:claim.issue,pr:claim.pr,merged:Boolean(claim.merged)}}
  }
  const edges=[]
  const previewOnly=[...preview].filter((version)=>!main.has(version)).sort()
  for(const blocker of previewOnly)for(const target of [...nodes.keys()].filter((version)=>version>blocker&&!preview.has(version)))edges.push({from:blocker,to:target,reason:'preview-ledger-predecessor-not-on-main'})
  return {schema_version:1,nodes:[...nodes.values()].sort((a,b)=>a.version.localeCompare(b.version)),edges,digest:sha256(canonicalJson({nodes:[...nodes.values()],edges}))}
}

export function assertAcyclic(graph){
  const outgoing=new Map();for(const edge of graph.edges){if(!outgoing.has(edge.from))outgoing.set(edge.from,[]);outgoing.get(edge.from).push(edge.to)}
  const visiting=new Set(),visited=new Set()
  function visit(node){if(visiting.has(node))throw new PreviewGraphError(`preview dependency cycle at ${node}`);if(visited.has(node))return;visiting.add(node);for(const next of outgoing.get(node)??[])visit(next);visiting.delete(node);visited.add(node)}
  for(const node of graph.nodes)visit(node.version);return graph
}
