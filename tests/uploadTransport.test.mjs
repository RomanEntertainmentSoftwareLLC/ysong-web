import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(path,globals={}){const context={exports:{},...globals};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);return context.exports;}
test('large asset is sliced sequentially and completion is required',async()=>{
 const calls=[];const {uploadAssetInParts}=load('../src/lib/multipartUpload.ts',{fetch:async(url,init)=>{calls.push({url,init});return{ok:true,json:async()=>url.endsWith('/multipart')?{session:'signed',partBytes:10*1024*1024}:{objectKey:'original',size:96364134}};}});
 const slices=[];const file={name:'song.wav',size:96364134,type:'audio/wav',slice:(start,end)=>{slices.push([start,Math.min(end,96364134)]);return 'slice';}};
 assert.equal((await uploadAssetInParts(file,'https://api',{})).objectKey,'original');assert.equal(slices.length,10);assert.equal(slices[0][0],0);assert.equal(slices.at(-1)[1],file.size);assert.ok(calls.at(-1).url.endsWith('/complete'));assert.equal(calls[1].init.headers['X-YSong-Upload-Session'],'signed');
});
test('failed part does not publish or complete an incomplete file',async()=>{
 let calls=0;const {uploadAssetInParts}=load('../src/lib/multipartUpload.ts',{fetch:async()=>++calls===1?{ok:true,json:async()=>({session:'signed',partBytes:10})}:{ok:false,status:503,json:async()=>({message:'Storage unavailable'})}});
 await assert.rejects(uploadAssetInParts({name:'x',size:20,type:'audio/wav',slice:()=>''},'',{}),/Storage unavailable/);assert.equal(calls,2);
});
test('Bridge transport coalesces in-flight updates, backs off offline and resumes automatically',async()=>{
 let now=0,calls=0,offline=true,release;const {createBridgeBackoff}=load('../src/lib/bridgeBackoff.ts',{Date});
 const send=createBridgeBackoff(async()=>{calls++;if(offline)throw Error('offline');await new Promise(resolve=>release=resolve);},()=>now);
 await send({});for(let i=0;i<100;i++)await send({});assert.equal(calls,1);now=2000;await send({});assert.equal(calls,2);
 now=6000;offline=false;const pending=send({});await send({});assert.equal(calls,3);release();await pending;const resumed=send({});assert.equal(calls,4);release();await resumed;
});
