import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function component(file,states,api,extras={}){let slot=0;const exports={},jsx=(type,props)=>({type,props});const context={exports,require:path=>path==='react'?{useState:init=>[slot<states.length?states[slot++]:typeof init==='function'?init():init,()=>{}],useEffect:()=>{},useRef:init=>({current:init})}:path.includes('jsx-runtime')?{jsx,jsxs:jsx}:path.includes('billingRedirect')?{billingDestination:(raw,host)=>{const url=new URL(raw);if(url.protocol!=='https:'||url.hostname!==host||url.username||url.password||url.port)throw new Error('Invalid Stripe destination.');return url.href;}}:api,URL,URLSearchParams,JSON,Date,Math,crypto:{randomUUID:()=> 'fixture-request-key'},window:{location:{search:'',assign:()=>{}}},...extras};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);return exports.default({});}
function nodes(tree){if(tree==null)return[];if(Array.isArray(tree))return tree.flatMap(nodes);if(typeof tree==='string'||typeof tree==='number')return[tree];return[tree,...nodes(tree.props?.children)];}
test('pricing uses the canonical catalog and persists checkout identity through an interrupted response',async()=>{
 const saved=new Map(),requests=[];let fail=true;const tree=component('../src/pages/Pricing.tsx',[[{id:'basic',name:'YSong Basic',monthlyPriceCents:999,quota:5,capabilities:{generation:true},available:true}],'',false],{apiPost:async(_path,body)=>{requests.push(body);if(fail)throw new Error('connection interrupted');return {url:'https://checkout.stripe.com/fixture'};}},{sessionStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)}});
 const choose=nodes(tree).find(n=>n?.type==='button');choose.props.onClick();await new Promise(setImmediate);fail=false;choose.props.onClick();await new Promise(setImmediate);assert.equal(requests.length,2);assert.equal(requests[0].requestKey,requests[1].requestKey);assert.equal(requests[1].planId,'basic');assert.ok(nodes(tree).includes('9.99'));
});
test('billing success redirect displays pending confirmation and does not grant an entitlement',()=>{
 const tree=component('../src/components/BillingAccount.tsx',[{status:'none',plan:{name:'Free',monthlyPriceCents:0},periodEnd:null,cancellationScheduled:false,portalAvailable:false},''],{},{window:{location:{search:'?billing=success'}}});
 assert.ok(nodes(tree).some(n=>typeof n==='string'&&n.includes('Access updates only after the server')));assert.ok(!nodes(tree).some(n=>n?.type==='button'));
});
test('pricing disables unavailable plans and ignores repeated checkout clicks while pending',async()=>{
 let calls=0;let release;const pending=new Promise(resolve=>{release=resolve;});const plans=[{id:'free',name:'Free',monthlyPriceCents:0,quota:null,capabilities:{},available:true},{id:'basic',name:'Basic',monthlyPriceCents:999,quota:5,capabilities:{},available:true},{id:'pro',name:'Pro',monthlyPriceCents:1999,quota:10,capabilities:{},available:false},{id:'premium',name:'Premium',monthlyPriceCents:2999,quota:20,capabilities:{},available:true}];const saved=new Map();const tree=component('../src/pages/Pricing.tsx',[plans,'',false],{apiPost:async()=>{calls++;return pending;}},{sessionStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)}});
 const buttons=nodes(tree).filter(n=>n?.type==='button');assert.equal(buttons.length,3);assert.equal(buttons[1].props.disabled,true);assert.ok(nodes(tree).includes('19.99'));assert.ok(nodes(tree).includes('29.99'));buttons[0].props.onClick();buttons[0].props.onClick();assert.equal(calls,1);release({url:'https://checkout.stripe.com/fixture'});await new Promise(setImmediate);
});
test('portal opens once and scheduled cancellation offers resume guidance',async()=>{
 let calls=0;let release;const pending=new Promise(resolve=>{release=resolve;});const tree=component('../src/components/BillingAccount.tsx',[{status:'active',plan:{name:'Basic',monthlyPriceCents:999},periodEnd:'2026-11-01',cancellationScheduled:true,portalAvailable:true},'',false],{apiPost:async()=>{calls++;return pending;}});const button=nodes(tree).find(n=>n?.type==='button');button.props.onClick();button.props.onClick();assert.equal(calls,1);assert.ok(nodes(tree).some(n=>typeof n==='string'&&n.includes('resume it')));release({url:'https://billing.stripe.com/fixture'});await new Promise(setImmediate);
});
test('disabled SaaS entitlement renders no account billing controls',()=>{
 const tree=component('../src/components/AccountPlan.tsx',[{enabled:false,name:'Free',planId:'free',superadmin:false,admin:false,quota:null,used:0,reserved:0,remaining:null,resetAt:null}],{});assert.equal(tree,null);
});
test('Stripe redirects reject spoofed hosts and credentials',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/billingRedirect.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL});
 assert.equal(exports.billingDestination('https://checkout.stripe.com/session','checkout.stripe.com'),'https://checkout.stripe.com/session');
 for(const url of ['https://checkout.stripe.com.evil.test/session','http://checkout.stripe.com/session','https://user@checkout.stripe.com/session'])assert.throws(()=>exports.billingDestination(url,'checkout.stripe.com'));
});
test('versioned policy acceptance sends the actual published version and explicit user action',async()=>{
 const calls=[];const tree=component('../src/components/PolicyAcceptance.tsx',[[{policy_id:'terms',version:'reviewed-v2',url:'/terms-of-service',approved:true,accepted_at:null}],''],{apiPost:async(path,body)=>{calls.push({path,body});}});
 nodes(tree).find(n=>n?.type==='button').props.onClick();await new Promise(setImmediate);assert.equal(calls[0].body.version,'reviewed-v2');assert.equal(calls[0].body.accepted,true);
});
test('unapproved legal drafts cannot be accepted through the UI',()=>{
 const tree=component('../src/components/PolicyAcceptance.tsx',[[{policy_id:'terms',version:'attorney-review-required',url:'/legal',approved:false,accepted_at:null}],''],{});assert.equal(nodes(tree).find(n=>n?.type==='button').props.disabled,true);
});
