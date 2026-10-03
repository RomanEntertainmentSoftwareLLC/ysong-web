import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const releases=[{id:'release-one',title:'Golden Darkness',artistName:'Angeli et Diaboli',releaseType:'album',publishedAt:'2026-01-01',hasArtwork:true,coverTrackId:'track-one'},{id:'release-two',title:'The Choir Beyond the Void',artistName:'Angeli et Diaboli',releaseType:'single',publishedAt:null,hasArtwork:false,coverTrackId:null}];
function harness(props,api,file='../src/components/LinkExistingReleases.tsx',extras={}){
  let cursor=0;const states=[],effects=[],deps=[];const exports={},jsx=(type,props)=>({type,props});
  const react={useState:init=>{const i=cursor++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect:(fn,next)=>{const i=cursor++;if(!deps[i]||next.some((v,j)=>v!==deps[i][j])){deps[i]=next;effects.push(fn);}}};
  const context={exports,require:path=>path==='react'?react:path.includes('jsx-runtime')?{jsx,jsxs:jsx}:path==='./core'?{useTabManager:()=>({tabs:[],openTab:()=>{},activateTab:()=>{}})}:path.includes('YSButton')?{YSButton:'button'}:path.includes('worldApi')?{worldArtworkUrl:id=>'cover/'+id,...api}:api,Date,Set,Event,Error,window:{dispatchEvent:()=>{}},...extras};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
  return{render:()=>{cursor=0;const tree=exports.default(props);for(const fn of effects.splice(0))fn();return tree;}};
}
function nodes(tree){if(tree==null)return[];if(Array.isArray(tree))return tree.flatMap(nodes);if(typeof tree==='string'||typeof tree==='number')return[tree];return[tree,...nodes(tree.props?.children)];}
function button(tree,label){return nodes(tree).find(n=>n?.type==='button'&&nodes(n.props.children).includes(label));}
const tick=()=>new Promise(setImmediate);
test('creation queries name suggestions and requires selection; Band persists before each selected release link',async()=>{
  const order=[],messages=[];const h=harness({name:'Angeli et Diaboli',creating:true,ensureArtist:async()=>{order.push('save');return 'stable-band';},onDone:m=>messages.push(m)},{fetchReleaseCandidates:async name=>{assert.equal(name,'Angeli et Diaboli');return{releases,nextOffset:null};},linkArtistReleases:async(id,ids)=>{order.push('link');assert.equal(id,'stable-band');assert.deepEqual(Array.from(ids),['release-one','release-two']);return{results:[{id:'release-one',linked:true},{id:'release-two',linked:false,error:'release_link_failed'}]};}});
  h.render();await tick();let tree=h.render();assert.ok(nodes(tree).includes('Golden Darkness'));assert.ok(nodes(tree).includes('Angeli et Diaboli'));assert.equal(nodes(tree).filter(n=>n?.type==='input').some(n=>n.props.checked),false);assert.deepEqual(order,[]);
  button(tree,'Select All').props.onClick();tree=h.render();button(tree,'Create Band and continue').props.onClick();await tick();tree=h.render();assert.deepEqual(order,['save','link']);assert.deepEqual(messages,[]);assert.ok(nodes(tree).some(n=>typeof n==='string'&&n.includes('Band saved. 1 release(s) linked; 1')));assert.ok(!nodes(tree).includes('Golden Darkness'));assert.ok(nodes(tree).includes('The Choir Beyond the Void'));
});
test('Skip for now creates the Band without any link call, even if releases were selected',async()=>{
  let saves=0,links=0,done='';const h=harness({name:'Band',creating:true,ensureArtist:async()=>{saves++;return'id';},onDone:m=>{done=m;}},{fetchReleaseCandidates:async()=>({releases,nextOffset:null}),linkArtistReleases:async()=>{links++;}});
  h.render();await tick();let tree=h.render();button(tree,'Select All').props.onClick();tree=h.render();button(tree,'Skip for now').props.onClick();await tick();assert.equal(saves,1);assert.equal(links,0);assert.match(done,/link existing releases later/);
});
test('management can query all owned unlinked metadata and exposes uncertain linking retry without losing the Band',async()=>{
  let query,attempts=0;const ids=[];const h=harness({name:'Band',creating:false,ensureArtist:async()=> 'stable-band',onDone:()=>{}},{fetchReleaseCandidates:async name=>{query=name;return{releases,nextOffset:null};},linkArtistReleases:async(id,selected)=>{attempts++;ids.push(id);assert.deepEqual(Array.from(selected),['release-one']);if(attempts===1)throw new Error('interrupted');return{results:[{id:'release-one',linked:true}]};}});
  h.render();await tick();let tree=h.render();assert.equal(query,'');nodes(tree).find(n=>n?.type==='input').props.onChange({target:{checked:true}});tree=h.render();button(tree,'Link selected releases').props.onClick();await tick();tree=h.render();assert.ok(nodes(tree).some(n=>typeof n==='string'&&n.includes('Band saved, but linking could not be confirmed')));button(tree,'Link selected releases').props.onClick();await tick();assert.deepEqual(ids,['stable-band','stable-band']);
});
test('failed Band persistence cannot submit links; candidate outage still permits Skip',async()=>{
  let links=0,saves=0;const h=harness({name:'Band',creating:true,ensureArtist:async()=>{saves++;throw new Error('save failed');},onDone:()=>{}},{fetchReleaseCandidates:async()=>{throw new Error('unavailable');},linkArtistReleases:async()=>{links++;}});
  h.render();await tick();let tree=h.render();assert.equal(button(tree,'Skip for now').props.disabled,false);button(tree,'Skip for now').props.onClick();await tick();tree=h.render();assert.equal(saves,1);assert.equal(links,0);assert.ok(nodes(tree).includes('save failed'));
});
test('Upload Music refreshes owned Band choices after creation and preserves the current selection',async()=>{
  const listeners=new Map();let artists=[{id:'original',name:'Original Band',type:'band'}];
  const h=harness({}, {fetchAccountArtists:async()=>({artists})},'../src/tabs/UploadMusic.tsx',{window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:()=>{}}});
  h.render();await tick();let tree=h.render();let select=nodes(tree).find(n=>n?.type==='select'&&n.props.value==='original');assert.ok(select);
  artists=[{id:'new-band',name:'Angeli et Diaboli',type:'band'},...artists];listeners.get('ysong:bands-changed')();await tick();tree=h.render();select=nodes(tree).find(n=>n?.type==='select'&&n.props.value==='original');assert.ok(select);assert.ok(nodes(select).includes('Angeli et Diaboli'));select.props.onChange({target:{value:'new-band'}});tree=h.render();assert.ok(nodes(tree).find(n=>n?.type==='select'&&n.props.value==='new-band'));
});

test('Upload Music publishes selected calendar date and record label; blank fields are omitted',async()=>{
 const calls=[];const h=harness({}, {fetchAccountArtists:async()=>({artists:[{id:'band',name:'Band'}]}),uploadWorldAsset:async()=>({objectKey:'owned/audio.wav'}),publishWorldTrack:async payload=>{calls.push(payload);}},'../src/tabs/UploadMusic.tsx',{window:{addEventListener:()=>{},removeEventListener:()=>{}},URL:{createObjectURL:()=> 'preview',revokeObjectURL:()=>{}},document:{createElement:()=>({})},setTimeout:()=>{}});
 h.render();await tick();let tree=h.render();const field=(label)=>nodes(tree).find(n=>n?.props?.label===label).props.children;
 field('Song Title').props.onChange({target:{value:'Song'}});nodes(tree).find(n=>n?.type==='input'&&n.props.accept?.startsWith('audio/')).props.onChange({target:{files:[{name:'audio.wav',type:'audio/wav'}]}});nodes(tree).find(n=>n?.type==='input'&&n.props.type==='checkbox'&&n.props.className==='mt-1').props.onChange({target:{checked:true}});
 field('Release Date').props.onChange({target:{value:'2024-02-29'}});field('Record Label').props.onChange({target:{value:' My Records '}});tree=h.render();assert.equal(field('Release Date').props.type,'date');assert.equal(field('Record Label').props.maxLength,180);await button(tree,'Publish to YSong World').props.onClick();assert.equal(calls[0].releaseDate,'2024-02-29');assert.equal(calls[0].recordLabel,'My Records');assert.equal(calls[0].artistId,'band');
 field('Release Date').props.onChange({target:{value:''}});field('Record Label').props.onChange({target:{value:''}});tree=h.render();await button(tree,'Publish to YSong World').props.onClick();assert.equal('releaseDate' in calls[1],false);assert.equal('recordLabel' in calls[1],false);
});
