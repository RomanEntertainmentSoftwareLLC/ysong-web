import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/sessionJobs.ts',import.meta.url),'utf8');
function moduleFor(api={},records=[]) {
  const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const exports={};const context={exports,localStorage:storage,JSON,Date,Math,encodeURIComponent,require:path=>path.includes('authApi')?api:{upsertGeneration:record=>records.push(record)}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
  return {exports,values,records};
}
const job={id:'v1',batch_id:'b1',project_id:'p1',version_index:2,quantity:4,state:'partially_ready',created_at:'2026-10-02',updated_at:'2026-10-02',source:{kind:'session',prompt:'source',lyrics:'lyrics',plan:{projectName:'Song',tracks:[{id:'bass',name:'Bass',mode:'midi'},{id:'voice',name:'Voice',mode:'audio'}]}},execution:{saved:true,parts:{bass:{state:'ready'},voice:{state:'ambiguous'}}}};
test('real progress includes finalization and partial work never falsely reaches 100%',()=>{
  const {exports}=moduleFor();assert.equal(exports.progressOf(job).percent,66);assert.equal(exports.progressOf({...job,execution:{saved:false,parts:{bass:{state:'ready'},voice:{state:'ready'}}}}).percent,66);
  assert.equal(exports.progressOf({...job,execution:{saved:true,parts:{bass:{state:'ready'},voice:{state:'ready'}}}}).percent,100);
});
test('page-independent server history merges into existing catalog with project and immutable parent links',async()=>{
  const records=[];const {exports}=moduleFor({apiGet:async path=>path.includes('entitlements')?{enabled:true}:{generations:[{...job,parent_generation_id:'parent'}]}},records);
  assert.equal((await exports.loadSessionJobs()).length,1);assert.equal(records[0].id,'v1');assert.equal(records[0].artifacts[0].projectId,'p1');assert.equal(records[0].source.lyrics,'lyrics');assert.equal(records[0].lineage.parentId,'parent');
});
test('SaaS-off does not query batch history or alter local history',async()=>{
  const calls=[];const {exports,records}=moduleFor({apiGet:async path=>{calls.push(path);return {enabled:false};}});
  assert.equal((await exports.loadSessionJobs()).length,0);assert.equal(calls.length,1);assert.equal(records.length,0);
});
test('opening a generated project retains server ID and preserves existing local edits',async()=>{
  const {exports,values}=moduleFor({apiGet:async()=>({projectId:'p1',name:'Song',project:{v:1,clips:[{id:'original'}]}})});
  assert.equal(await exports.hydrateJobProject('v1'),'p1');assert.equal(JSON.parse(values.get('ysong:daw:p1')).clips[0].id,'original');
  values.set('ysong:daw:p1',JSON.stringify({v:1,clips:[{id:'edited'}]}));await exports.hydrateJobProject('v1');assert.equal(JSON.parse(values.get('ysong:daw:p1')).clips[0].id,'edited');
  assert.equal(JSON.parse(values.get('ysong:projects:v1')).length,1);
});
test('Create Song preserves request identity before HTTP, quantity impact and existing DAW switch flow',()=>{
  const create=fs.readFileSync(new URL('../src/tabs/CreateSong.tsx',import.meta.url),'utf8'),ui=fs.readFileSync(new URL('../src/components/GenerationJobs.tsx',import.meta.url),'utf8');
  assert.ok(create.indexOf('localStorage.setItem(pendingKey')<create.indexOf("await apiPost('/api/generations/batches'"));
  assert.ok(create.includes('Quantity / Versions'));assert.ok(create.includes('pending-batch:v1:${owner}'));
  assert.ok(ui.includes('localProjectOpenRequest:request'));assert.ok(!ui.includes('generationImportRequest'));assert.ok(ui.includes('progress.done'));
});
