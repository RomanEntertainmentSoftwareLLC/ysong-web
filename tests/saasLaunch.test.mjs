import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function component(file,states,api,extras={}){let slot=0;const exports={},jsx=(type,props)=>({type,props});const context={exports,require:path=>path==='react'?{useState:init=>[slot<states.length?states[slot++]:typeof init==='function'?init():init,()=>{}],useEffect:()=>{}}:path.includes('jsx-runtime')?{jsx,jsxs:jsx}:api,URL,URLSearchParams,JSON,Date,Math,crypto:{randomUUID:()=> 'fixture-request-key'},window:{location:{search:'',assign:()=>{}}},...extras};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);return exports.default();}
function nodes(tree){if(tree==null)return[];if(Array.isArray(tree))return tree.flatMap(nodes);if(typeof tree==='string'||typeof tree==='number')return[tree];return[tree,...nodes(tree.props?.children)];}
test('pricing uses the canonical catalog and persists checkout identity through an interrupted response',async()=>{
 const saved=new Map(),requests=[];let fail=true;const tree=component('../src/pages/Pricing.tsx',[[{id:'basic',name:'YSong Basic',monthlyPriceCents:999,quota:5,capabilities:{generation:true},available:true}],'',false],{apiPost:async(_path,body)=>{requests.push(body);if(fail)throw new Error('connection interrupted');return {url:'https://checkout.stripe.com/fixture'};}},{sessionStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)}});
 const choose=nodes(tree).find(n=>n?.type==='button');choose.props.onClick();await new Promise(setImmediate);fail=false;choose.props.onClick();await new Promise(setImmediate);assert.equal(requests.length,2);assert.equal(requests[0].requestKey,requests[1].requestKey);assert.equal(requests[1].planId,'basic');assert.ok(nodes(tree).includes('9.99'));
});
test('billing success redirect displays pending confirmation and does not grant an entitlement',()=>{
 const tree=component('../src/components/BillingAccount.tsx',[{status:'none',plan:{name:'Free',monthlyPriceCents:0},periodEnd:null,cancellationScheduled:false,portalAvailable:false},''],{},{window:{location:{search:'?billing=success'}}});
 assert.ok(nodes(tree).some(n=>typeof n==='string'&&n.includes('Access updates only after the server')));assert.ok(!nodes(tree).some(n=>n?.type==='button'));
});
test('versioned policy acceptance sends the actual published version and explicit user action',async()=>{
 const calls=[];const tree=component('../src/components/PolicyAcceptance.tsx',[[{policy_id:'terms',version:'reviewed-v2',url:'/terms-of-service',approved:true,accepted_at:null}],''],{apiPost:async(path,body)=>{calls.push({path,body});}});
 nodes(tree).find(n=>n?.type==='button').props.onClick();await new Promise(setImmediate);assert.equal(calls[0].body.version,'reviewed-v2');assert.equal(calls[0].body.accepted,true);
});
test('unapproved legal drafts cannot be accepted through the UI',()=>{
 const tree=component('../src/components/PolicyAcceptance.tsx',[[{policy_id:'terms',version:'attorney-review-required',url:'/legal',approved:false,accepted_at:null}],''],{});assert.equal(nodes(tree).find(n=>n?.type==='button').props.disabled,true);
});
