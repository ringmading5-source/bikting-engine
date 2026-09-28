import test from 'node:test';
import assert from 'node:assert/strict';
import { readGrounding } from '../src/server/knowledgeFeed.js';
import { createGeminiInterpreter } from '../src/server/geminiInterpreter.js';
const research = { candidates: [{ content: {parts:[{text:'Cells contain cytoplasm.'}]}, groundingMetadata: { groundingChunks:[{web:{uri:'https://example.org/cell',title:'Cell reference'}},{web:{uri:'javascript:alert(1)'}}],groundingSupports:[{segment:{text:'Cells contain cytoplasm.'},groundingChunkIndices:[0,1,99]}] } }], usageMetadata:{promptTokenCount:10,candidatesTokenCount:5} };
const semantic = { candidates:[{content:{parts:[{text:JSON.stringify({intent:'explain',domain:'biology',concepts:['cell'],relationships:[{from:'cell',relation:'contains',to:'cytoplasm'}],explanation:'Cells contain cytoplasm.'})}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:10} };
test('grounding only retains safe source URLs and valid evidence references',()=>{
 const k=readGrounding(research); assert.equal(k.sources.length,1);assert.deepEqual(k.supports[0].sourceIds,[0]);assert.equal(k.mode,'web-grounded');
 assert.equal(readGrounding({}).mode,'model');
});
test('web feed precedes structured extraction, counts usage, reuses and expires',async()=>{
 let calls=0,time=0;
 const interpret=createGeminiInterpreter({apiKey:'test',now:()=>time,cacheTtlMs:100,fetchImpl:async(url,options)=>{
 const body=JSON.parse(options.body);calls++;
 if(calls%2===1){assert.deepEqual(body.tools,[{google_search:{}}]);assert.equal(body.generationConfig,undefined);return {ok:true,status:200,json:async()=>research};}
 assert.match(JSON.stringify(body.contents),/Cells contain cytoplasm/);
 return {ok:true,status:200,json:async()=>semantic};
 }});
 const request={text:'Explain a biological cell',knowledgeMode:'web'};
 const result=await interpret({...request});assert.equal(result.context.knowledge.sources.length,1);assert.equal(result.context.modelUsage.calls,2);assert.equal(result.context.modelUsage.inputTokens,30);
 await interpret({...request});assert.equal(calls,2);
 time=101;await interpret({...request});assert.equal(calls,4);
});
test('model-only mode never sends search tools',async()=>{
 const interpret=createGeminiInterpreter({apiKey:'test',fetchImpl:async(url,options)=>{assert.equal(JSON.parse(options.body).tools,undefined);return {ok:true,status:200,json:async()=>semantic};}});
 const result=await interpret({text:'Explain a biological cell'});assert.equal(result.context.knowledge.mode,'model');assert.deepEqual(result.context.knowledge.sources,[]);
});
