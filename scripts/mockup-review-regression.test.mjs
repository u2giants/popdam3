import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('../public/mockup/index.html',import.meta.url),'utf8');
const native=html.match(/<script id="aiNativeSrc">([\s\S]*?)<\/script>/)[1];
function reader(extra={}){
  const context=vm.createContext({TextDecoder, Uint8Array, Blob, document:{}, ...extra});
  vm.runInContext(native,context);
  return {context,api:vm.runInContext('AINative',context)};
}
test('all inline JavaScript parses and pinned ICC hook remains present',()=>{
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
    if(/type="(?:application\/json|importmap)"/.test(m[1]) || /type="module"/.test(m[1])) continue;
    new vm.Script(m[2]);
  }
  const worker=html.match(/<script[^>]*id="pdfWorkerSrc"[^>]*>([\s\S]*?)<\/script>/)[1];
  const hook='case"ICCBased":const f=t.fetchIfRef(e[1]).dict;o=f.get("N");';
  assert.equal(worker.split(hook).length,2);
  assert.match(worker,/class ColorSpace\b/);
});
test('zstd raw, RLE and compressed FSE/Huffman frames decode; truncation rejects',()=>{
  const {context}=reader();
  for(const [hex,expected] of [
    ['28b52ffd2003190000616263','abc'],
    ['28b52ffd20031b000078','xxx'],
    ['28b52ffd602809150100d0417274776f726b207265706561746564207061747465726e2e2001002ea8fd3906','Artwork repeated pattern. '.repeat(100)]
  ]){
    context.bytes=Uint8Array.from(Buffer.from(hex,'hex'));
    assert.equal(Buffer.from(vm.runInContext('zstdDecode(bytes)',context)).toString(),expected);
    for(let n=0;n<context.bytes.length;n++){
      context.partial=context.bytes.subarray(0,n);
      assert.throws(()=>vm.runInContext('zstdDecode(partial)',context),undefined,`truncated at ${n}`);
    }
  }
});
test('missing indirect lengths return PDF fallback',async()=>{
  const {api}=reader();
  for(const tail of ['', '\n9 0 obj\nnot-a-number\nendobj']){
    const data=Buffer.from('%PDF\n<< /AIPrivateData1 2 0 R >>\n2 0 obj\n<< /Length 9 0 R >>\nstream\nabc'+tail);
    assert.equal(await api.extract(data),null);
  }
});
test('native jobs contain allocation failures, limit large files, and release resources',async()=>{
  let terminated=0, revoked=0, created=0;
  const {api}=reader({URL:{createObjectURL(){created++;return 'blob:test'},revokeObjectURL(){revoked++}},
    document:{getElementById(){return {textContent:''}}},
    Worker:class {postMessage(){} terminate(){terminated++}}});
  assert.equal(api.open({byteLength:65*1024*1024,slice(){throw Error('unexpected copy')}}),null);
  assert.equal(api.open({byteLength:4,slice(){throw RangeError('allocation')}}),null);
  const job=api.open(new Uint8Array(4)); job.close();
  assert.equal(await job.ready,null);
  assert.equal(await job.draw({}),null);
  assert.equal(created,1);assert.equal(terminated,1);assert.equal(revoked,1);
});
test('worker construction failures revoke their object URL',()=>{
  let revoked=0;
  const {api}=reader({URL:{createObjectURL(){return 'blob:test'},revokeObjectURL(){revoked++}},
    document:{getElementById(){return {textContent:''}}},Worker:class {constructor(){throw Error('unavailable')}}});
  assert.equal(api.open(new Uint8Array(4)),null);assert.equal(revoked,1);
});
test('compiler handles repeated spaces in numeric operands',()=>{
  class Path2D {moveTo(){} lineTo(){} closePath(){}}
  const {api}=reader({Path2D});
  const compile=spacing=>api.compile(Buffer.from('%AI5_BeginLayer\n1 Lb\n(Art) Ln\n0'+spacing+'1'+spacing+'0'+spacing+'0 k\n0 0 m\n10 0 l\n10 10 l\nf\n'));
  assert.equal(compile('  ').cmds[0].f,compile(' ').cmds[0].f);
  assert.ok(!compile('  ').cmds[0].f.includes('NaN'));
});
test('export messages, exact bleed matching, cleanup, and per-edge acceptance stay guarded',()=>{
  assert.ok(!html.includes('setStatus(`Exported '));
  for(const m of html.matchAll(/api.loadMockup=d=>\{([\s\S]*?)const keep=/g)) assert.match(m[1],/S.nativeJob.close\(\)/);
  assert.ok(!html.includes('/bleed/i.test(x.name)'));
  assert.ok(!html.includes('Math.min(1,150/ppi)'));
  assert.ok(!html.includes('m.all<=0.04 ? "all"'));
  const re=/^BLEED\s*-\s*DO NOT PRINT$/i;
  assert.ok(re.test('BLEED - DO NOT PRINT')); assert.ok(!re.test('Bleeding notes'));
});
test('ICC interpolation preserves grid corners and midpoint; malformed LUTs reject',()=>{
  const start=html.indexOf('function iccWorkerPart(){');
  const end=html.indexOf('\n(function(){',start);
  const self={};vm.runInNewContext(html.slice(start,end)+'\niccWorkerPart();',{self});
  const grid=new Float32Array(16*3);
  for(let i=0;i<16;i++) grid.set([(i>>3&1)*100,(i>>2&1)*100,(i&1)*100],i*3);
  const dest=[];
  self.__iccLook({G:2,grid},0.5,0.5,0.5,0.5,dest,0);assert.deepEqual(dest,[50,50,50]);
  self.__iccLook({G:2,grid},1,1,1,1,dest,0);assert.deepEqual(dest,[100,100,100]);
  const p=new Uint8Array(160);p.set(Buffer.from('CMYK'),16);p.set(Buffer.from('acsp'),36);p[131]=1;
  p.set(Buffer.from('A2B0'),132);p[139]=148;p.set(Buffer.from('mft2'),148);
  assert.equal(self.__iccBuild(p),null);
});
test('one bad edge cannot be accepted by the overall mismatch threshold',()=>{
  const expression=html.match(/S.nativeOK\[nd.key\] = ([^;]+);/)[1];
  const m={all:0.01,l:0.03,r:0,t:0,b:0};
  const result=vm.runInNewContext(expression,{m});
  assert.equal(result.l,false);assert.equal(result.r,true);
});
test('native-only outside rendering keeps its conservative shape-count boundary',()=>{
  const {api}=reader();let transforms=0;
  const ctx={getTransform(){transforms++;return {}}};
  api.draw({stats:{outside:0},layers:[],cmds:[]},ctx,null,true);
  api.draw({stats:{outside:401},layers:[],cmds:[]},ctx,null,true);
  assert.equal(transforms,0);
  api.draw({stats:{outside:400},layers:[],cmds:[]},ctx,null,true);
  assert.equal(transforms,1);
});
