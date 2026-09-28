import test from 'node:test';
import assert from 'node:assert/strict';
import { previewIntent } from '../src/server/intentPreview.js';
import { createGeminiInterpreter } from '../src/server/geminiInterpreter.js';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';
const payload = { candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'explain', domain: 'biology', concepts: ['cell','cytoplasm'], relationships: [{from:'cell',relation:'contains',to:'cytoplasm'}], explanation:'Cells contain cytoplasm.' }) }] } }] };
test('cell asks for meaning without spending a model call', async () => {
 const p = await previewIntent({text:'cell'}, () => { throw Error('must not call'); }, true);
 assert.equal(p.status,'clarification'); assert.equal(p.choices.length,3);
});
test('preview uses Gemini relationships and execution reuses interpretation', async () => {
 let calls=0;
 const interpret=createGeminiInterpreter({apiKey:'test',fetchImpl:async()=>{calls++;return {ok:true,status:200,json:async()=>payload};}});
 const request={text:'Explain a biological cell'};
 const p=await previewIntent(request,interpret,true);
 assert.equal(p.relationships[0].relation,'contains');
 await createBiktingRuntime({interpret}).run({...request});
 assert.equal(calls,1);
});
test('503 retries recover and exhausted failures do not stay cached', async () => {
 let calls=0;
 const interpret=createGeminiInterpreter({apiKey:'test',sleep:async()=>{},fetchImpl:async()=>{calls++;return calls<=3?{ok:false,status:503}:{ok:true,status:200,json:async()=>payload};}});
 await assert.rejects(interpret({text:'biology'}),/temporarily unavailable/);
 assert.equal(calls,3);
 await interpret({text:'biology'}); assert.equal(calls,4);
});
test('decimal arithmetic is not truncated at the decimal point', async()=>{
 const result=await createBiktingRuntime().run({text:'Calculate 2.5 + 3'});
 assert.equal(result.outputs.numericData[0],5.5);
});
