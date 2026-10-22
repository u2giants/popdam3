import test from "node:test";
import assert from "node:assert/strict";
import { validateCharacterReferences, normalizeCharacterIds, CharacterCatalogDependencyError, CharacterReferenceValidationError, buildImageTaggingPrompt, buildImageTaggingMessages, tagAssetSchemaForCharacters, validateTagCharacterBinding, TAG_ASSET_SCHEMA } from "./ai-tagging-shared.js";
import { applyBatchTagResult } from "./ai-tagging.js";
import { buildStructuredOutputRequest, executeStructuredOutput } from "../structured-output.js";
const character="123e4567-e89b-42d3-a456-426614174000", other="223e4567-e89b-42d3-a456-426614174001", assetId="323e4567-e89b-42d3-a456-426614174002";
function client(known=[character],fault=false){
 const writes:Array<{stage:string;rows?:unknown}>=[];
 return {writes,db:{rpc:async()=>{writes.push({stage:"asset_tags"});return {error:null};},from:(table:string)=>{
  const chain={select:()=>chain,eq:()=>chain,in:()=>Promise.resolve({data:known.map(id=>({id})),error:fault?{code:"57014",message:"private suppressed"}:null}),single:async()=>({data:{id:assetId,filename:"fixture.png",file_type:"png",sku:null},error:null}),upsert:async(rows:unknown)=>{writes.push({stage:table,rows});return {error:null};},update:(rows:unknown)=>({eq:async()=>{writes.push({stage:"asset_metadata",rows});return {error:null};}})};return chain;
 }} as never};
}
function result(ids:unknown){return {asset_tags:["red","blue","green","yellow"].map(tag=>({tag,category:"color",confidence:.9,evidence:["Visible color"]})),ai_description:"Four colored areas",scene_description:"A colored illustration",content_type:"other",character_ids:ids};}
test("unknown, malformed and out-of-bound character references perform zero writes",async()=>{
 for(const [ids,binding] of [[[other],[character]],[["invalid"],[character]],[[other],[other]]] as Array<[unknown,string[]]>){const c=client();await assert.rejects(applyBatchTagResult(assetId,result(ids),"fixture",c.db,binding),CharacterReferenceValidationError);assert.equal(c.writes.length,0);}
});
test("duplicate normalized UUIDs preserve exactly one legitimate link and mark asset last",async()=>{
 const c=client();await applyBatchTagResult(assetId,result([character,character.toUpperCase()]),"fixture",c.db,[character]);const link=c.writes.find(w=>w.stage==="asset_characters");assert.deepEqual(link?.rows,[{asset_id:assetId,character_id:character}]);assert.equal(c.writes.at(-1)?.stage,"asset_metadata");assert.deepEqual(normalizeCharacterIds([character.toUpperCase(),character]),[character]);
});
test("character lookup failure is a dependency hold, not invalid model data or an empty catalog",async()=>{
 const c=client([character],true);await assert.rejects(validateCharacterReferences([character],[character],c.db),CharacterCatalogDependencyError);assert.equal(c.writes.length,0);await assert.rejects(applyBatchTagResult(assetId,result([character]),"fixture",c.db,[character]),CharacterCatalogDependencyError);assert.equal(c.writes.length,0);
});
function promptClient(fault=false){
 return {from:(table:string)=>{const data=table==="dam_character_catalog"?[{id:character,name:"Fixture character"}]:[];const answer={data,error:table==="dam_character_catalog"&&fault?{code:"57014"}:null};const chain={select:()=>chain,eq:()=>chain,order:()=>chain,limit:()=>chain,maybeSingle:async()=>({data:null,error:null}),then:(resolve:(v:unknown)=>void)=>Promise.resolve(answer).then(resolve)};return chain;},schema:()=>({from:(table:string)=>{const chain={select:()=>chain,limit:()=>chain,then:(resolve:(v:unknown)=>void)=>Promise.resolve({data:[],error:null}).then(resolve)};return chain;}})} as never;
}
test("capturing exact supplied catalog leaves healthy prompt, image and structured request byte-identical",async()=>{
 const asset={id:assetId,filename:"fixture.png",relative_path:null,file_type:"png",tags:null,licensor_id:null,property_id:null,thumbnail_url:"fixture",status:"pending",ai_tagged_at:null,sku:null,division_code:null,style_group_id:null};let binding:string[]=[];
 const old=await buildImageTaggingPrompt(asset,{client:promptClient()});const current=await buildImageTaggingPrompt(asset,{client:promptClient(),requireCharacterReadSuccess:true,onCharacterCatalog:ids=>{binding=ids;}});assert.equal(current,old);assert.deepEqual(binding,[character]);
 const image={base64:"AA",mimeType:"image/png"};const messages=buildImageTaggingMessages(old,image,"Analyze this design asset image and return structured tags matching the tag_asset schema.");
 assert.equal(JSON.stringify(buildStructuredOutputRequest({model:"fixture",messages,schemaName:"tag_asset",schema:{},maxTokens:4000},"json_schema")),JSON.stringify(buildStructuredOutputRequest({model:"fixture",messages:buildImageTaggingMessages(current,image,"Analyze this design asset image and return structured tags matching the tag_asset schema."),schemaName:"tag_asset",schema:{},maxTokens:4000},"json_schema")));
 await assert.rejects(buildImageTaggingPrompt(asset,{client:promptClient(true),requireCharacterReadSuccess:true}),CharacterCatalogDependencyError);
});

test("existing character UUIDs normalize case and malformed catalog rows are dependency faults",async()=>{
 const upper=client([character.toUpperCase()]);assert.deepEqual(await validateCharacterReferences([character],[character],upper.db),[character]);
 const bad=client(["invalid-db-uuid"]);await assert.rejects(validateCharacterReferences([character],[character],bad.db),CharacterCatalogDependencyError);
});

test("null catalog data with no error and thrown transports never become an empty Meta binding",async()=>{
 const asset={id:assetId,filename:"fixture.png",relative_path:null,file_type:"png",tags:null,licensor_id:null,property_id:null,thumbnail_url:"fixture",status:"pending",ai_tagged_at:null,sku:null,division_code:null,style_group_id:null};
 for(const transport of [false,true]){
  const base=promptClient() as unknown as {from:(table:string)=>unknown;schema:(name:string)=>unknown};const originalFrom=base.from;
  base.from=(table:string)=>{if(table!=="dam_character_catalog")return originalFrom(table);const chain={select:()=>chain,eq:()=>chain,order:()=>chain,limit:()=>chain,then:(resolve:(v:unknown)=>void,reject:(e:unknown)=>void)=>transport?Promise.reject(new Error("transport failed")).then(resolve,reject):Promise.resolve({data:null,error:null}).then(resolve,reject)};return chain;};
  let captured=false;await assert.rejects(buildImageTaggingPrompt(asset,{client:base as never,requireCharacterReadSuccess:true,onCharacterCatalog:()=>{captured=true;}}),CharacterCatalogDependencyError);assert.equal(captured,false);
 }
 const c=client();(c.db as unknown as {from:()=>unknown}).from=()=>{throw new Error("transport failure");};await assert.rejects(validateCharacterReferences([character],[character],c.db),CharacterCatalogDependencyError);
});

test("parallel schema binds character IDs without changing the shared contract", () => {
 const before=JSON.stringify(TAG_ASSET_SCHEMA);
 assert.equal(tagAssetSchemaForCharacters(),TAG_ASSET_SCHEMA);
 const schema=tagAssetSchemaForCharacters([character,character.toUpperCase()]) as {properties:Record<string,{items?:unknown;maxItems?:number}>};
 assert.deepEqual(schema.properties.character_ids.items,{type:"string",enum:[character]});
 assert.equal((tagAssetSchemaForCharacters([]) as typeof schema).properties.character_ids.maxItems,0);
 assert.equal(JSON.stringify(TAG_ASSET_SCHEMA),before);
 assert.doesNotThrow(()=>validateTagCharacterBinding([character.toUpperCase()],[character]));
 assert.doesNotThrow(()=>validateTagCharacterBinding([],[]));
 assert.doesNotThrow(()=>validateTagCharacterBinding(undefined,[]));
 for(const value of [[other],["invented"],null])assert.throws(()=>validateTagCharacterBinding(value,[character]),CharacterReferenceValidationError);
});

test("a fabricated character ID triggers same-model output repair before a result is accepted", async () => {
 let calls=0;
 const output=await executeStructuredOutput({apiKey:"fixture",model:"fixture/model",messages:[],schemaName:"tag_asset",schema:tagAssetSchemaForCharacters([character]),validate:value=>{validateTagCharacterBinding(value.character_ids,[character]);return value;},capabilities:{modelId:"fixture/model",imageInput:true,tools:false,toolChoice:false,toolChoiceModes:[],structuredOutputs:true,jsonObject:true,prefer:["json_schema","json_object"],source:"override",fetchedAt:"test"},completion:async(_key,request)=>{
   assert.equal(request.model,"fixture/model");calls++;
   return {content:JSON.stringify(result([calls===1?other:character])),toolCalls:[]} as never;
 }});
 assert.equal(calls,2);assert.equal(output.attempts[0].validation,"failed");assert.deepEqual(output.value.character_ids,[character]);
});
