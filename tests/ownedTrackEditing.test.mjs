import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const owned={id:'owned',releaseId:'release',title:'Never Trending',artistName:'Artist',albumName:'Album',genre:'Rock',tags:['original'],isOwner:true,isSaved:false,playCount:3,likes:2,commentCount:0,trackNumber:1};
const foreign={...owned,id:'foreign',isOwner:false};
const jsx=(type,props)=>({type,props});
function module(file,extra={}) {
  const exports={},states=[];let slot=0;
  const react={useState:init=>{const i=slot++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useEffect:()=>{}};
  const context={exports,require:path=>path==='react'?react:path==='react-dom'?{createPortal:x=>x}:path.includes('jsx-runtime')?{jsx,jsxs:jsx}:path.includes('worldApi')?{worldArtworkUrl:(id,v)=>'cover/'+id+(v?'?v='+v:''),uploadWorldAsset:extra.uploadWorldAsset??(async()=>({objectKey:'uploaded-cover'}))}:{YSButton:'button'},Error,document:{body:{}},window:{innerWidth:1000,innerHeight:800},...extra};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
  return props=>{slot=0;return exports.default(props);};
}
function nodes(tree){if(tree==null)return[];if(Array.isArray(tree))return tree.flatMap(nodes);if(typeof tree==='string'||typeof tree==='number')return[tree];return[tree,...nodes(tree.props?.children)];}
test('original uploader gets the edit ellipsis; other listeners get no edit control',()=>{
  const render=module('../src/components/OwnedTrackActions.tsx');assert.equal(render({track:foreign,onEdit:()=>assert.fail('foreign edit')}),null);
  const calls=[],props={track:owned,onEdit:t=>calls.push(t.id)};let tree=render(props);const button=nodes(tree).find(n=>n?.type==='button');assert.match(button.props['aria-label'],/Never Trending/);assert.ok(nodes(button).includes('⋮'));
  let stopped=false;button.props.onClick({stopPropagation:()=>{stopped=true;},currentTarget:{getBoundingClientRect:()=>({right:900,bottom:790})}});tree=render(props);const menu=nodes(tree).find(n=>n?.props?.role==='menu');assert.ok(menu.props.style.top<=724);nodes(menu).find(n=>n?.props?.role==='menuitem').props.onClick();assert.equal(stopped,true);assert.deepEqual(calls,['owned']);
});
test('shared editor saves existing track metadata and ID; non-owner cannot render or invoke save',async()=>{
  assert.equal(module('../src/components/WorldTrackEditor.tsx')({track:foreign,onCancel:()=>{},onSave:()=>assert.fail('foreign save')}),null);const render=module('../src/components/WorldTrackEditor.tsx');
  const saved=[],props={track:owned,onCancel:()=>{},onSave:async t=>saved.push(t)};let tree=render(props);nodes(tree).find(n=>n?.type==='input'&&n.props.value==='Never Trending').props.onChange({target:{value:'Updated title'}});tree=render(props);await nodes(tree).find(n=>n?.type==='button'&&nodes(n).includes('Save Changes')).props.onClick();assert.equal(saved[0].id,'owned');assert.equal(saved[0].title,'Updated title');assert.equal(saved[0].releaseId,'release');
});
function view(file,name,props) {
  const text=fs.readFileSync(new URL(file,import.meta.url),'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text===name);assert.ok(fn);
  const context={exports:{},require:()=>({jsx,jsxs:jsx}),useState:init=>[typeof init==='function'?init():init,()=>{}],useEffect:()=>{},OwnedTrackActions:p=>p.track.isOwner?jsx('button',{'aria-label':'edit '+p.track.id,onClick:()=>p.onEdit(p.track)}):null,Artwork:'artwork',HorizontalShelf:'shelf',SectionTitle:'title',YSButton:'button',CommentThread:'comments',Cover:'cover',Empty:'empty',prettyCount:String,durationLabel:()=>'',Intl};
  vm.runInNewContext(ts.transpileModule('export '+fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
  const expand=tree=>{if(!tree)return tree;if(Array.isArray(tree))return tree.map(expand);if(typeof tree!=='object')return tree;if(typeof tree.type==='function')return expand(tree.type(tree.props));return{...tree,props:{...tree.props,children:expand(tree.props?.children)}};};
  return expand(context.exports[name](props));
}
test('World release shelves and song details expose editing for the uploaded track without Trending',()=>{
  const calls=[];const onEdit=t=>calls.push(t.id);const shelf=view('../src/tabs/World.tsx','ReleaseShelf',{title:'Fresh Finds',items:[owned,foreign],onOpen:()=>{},onEdit});
  const buttons=nodes(shelf).filter(n=>n?.props?.['aria-label']?.startsWith('edit '));assert.equal(buttons.length,1);buttons[0].props.onClick();assert.deepEqual(calls,['owned']);
  const detail=view('../src/tabs/World.tsx','TrackDetailView',{track:owned,onEdit});assert.ok(nodes(detail).find(n=>n?.props?.['aria-label']==='edit owned'));
  assert.ok(!nodes(view('../src/tabs/World.tsx','TrackDetailView',{track:foreign,onEdit})).find(n=>n?.props?.['aria-label']==='edit foreign'));
});
test('Library rows expose edit only for original uploader in mixed saved/upload lists',()=>{
  const calls=[],tree=view('../src/tabs/Library.tsx','TrackListEmptyAware',{tracks:[owned,foreign],onOpen:()=>{},onEdit:t=>calls.push(t.id),onRemove:()=>{}});
  const edit=nodes(tree).filter(n=>n?.props?.['aria-label']?.startsWith('edit '));assert.equal(edit.length,1);edit[0].props.onClick();assert.deepEqual(calls,['owned']);assert.equal(nodes(tree).filter(n=>n?.type==='button'&&nodes(n).includes('Remove')).length,1);
});
test('playlist ownership does not give permission to edit another uploader’s song',()=>{
  for(const isOwner of [true,false]) {
    const calls=[],tree=view('../src/tabs/World.tsx','PlaylistView',{detail:{playlist:{id:'playlist',title:'Playlist',isOwner,coverTrackId:null},tracks:[owned,foreign]},onEditTrack:t=>calls.push(t.id)});
    const edit=nodes(tree).filter(n=>n?.props?.['aria-label']?.startsWith('edit '));assert.equal(edit.length,1);edit[0].props.onClick();assert.deepEqual(calls,['owned']);
  }
});
test('editor shows current cover, calendar and record label, uploads replacement before saving metadata',async()=>{
  const order=[],saved=[];const render=module('../src/components/WorldTrackEditor.tsx',{uploadWorldAsset:async file=>{order.push('upload');assert.equal(file.name,'new.png');return{objectKey:'owner/new.png'};}});
  const props={track:{...owned,hasArtwork:true,artworkVersion:'old',releaseDate:'2024-02-29',recordLabel:'Old Label'},onCancel:()=>{},onSave:async t=>{order.push('save');saved.push(t);}};let tree=render(props);
  assert.equal(nodes(tree).find(n=>n?.type==='img').props.src,'cover/owned?v=old');nodes(tree).find(n=>n?.type==='input'&&n.props.type==='date').props.onChange({target:{value:'2026-10-02'}});tree=render(props);nodes(tree).find(n=>n?.type==='input'&&n.props.value==='Old Label').props.onChange({target:{value:'New Label'}});tree=render(props);nodes(tree).find(n=>n?.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'new.png',type:'image/png'}]}});tree=render(props);
  await nodes(tree).find(n=>n?.type==='button'&&nodes(n).includes('Save Changes')).props.onClick();assert.deepEqual(order,['upload','save']);assert.equal(saved[0].releaseDate,'2026-10-02');assert.equal(saved[0].recordLabel,'New Label');assert.equal(saved[0].artworkObjectKey,'owner/new.png');assert.equal(saved[0].id,'owned');
});
test('a failed metadata save reuses the uploaded cover on explicit retry',async()=>{
  let uploads=0,attempts=0;const render=module('../src/components/WorldTrackEditor.tsx',{uploadWorldAsset:async()=>{uploads++;return{objectKey:'owner/new.png'};}});const props={track:owned,onCancel:()=>{},onSave:async()=>{attempts++;if(attempts===1)throw Error('interrupted');}};
  let tree=render(props);nodes(tree).find(n=>n?.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'new.png',type:'image/png'}]}});tree=render(props);await nodes(tree).find(n=>n?.type==='button'&&nodes(n).includes('Save Changes')).props.onClick();tree=render(props);assert.ok(nodes(tree).includes('interrupted'));await nodes(tree).find(n=>n?.type==='button'&&nodes(n).includes('Save Changes')).props.onClick();assert.equal(uploads,1);assert.equal(attempts,2);
});
test('cover edits refresh queued album artwork without changing sibling titles or track identities',()=>{
  const text=fs.readFileSync(new URL('../src/components/WorldPlayer.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('WorldPlayer.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
  function find(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.getText(ast).includes('"ysong:world-track-patch",edited'))effect=node;ts.forEachChild(node,find);}find(ast);assert.ok(effect);
  let current={...owned,id:'sibling',title:'Sibling'},queue=[owned,current,{...foreign,releaseId:'unrelated'}];const currentRef={current},queueRef={current:queue},listeners=new Map();
  const context={useEffect:fn=>fn(),window:{addEventListener:(name,fn)=>listeners.set(name,fn)},setCurrent:fn=>{current=fn(current);},setQueue:fn=>{queue=fn(queue);},currentRef,queueRef};
  vm.runInNewContext(ts.transpileModule(effect.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
  listeners.get('ysong:world-track-patch')({detail:{trackId:'owned',patch:{releaseId:'release',title:'Updated title',artworkVersion:'fresh-cover',hasArtwork:true,releaseDate:'2026-10-02',recordLabel:'Records'}}});
  assert.equal(current.id,'sibling');assert.equal(current.title,'Sibling');assert.equal(current.artworkVersion,'fresh-cover');assert.equal(queue[0].title,'Updated title');assert.equal(queue[2].artworkVersion,undefined);assert.deepEqual(queue.map(t=>t.id),['owned','sibling','foreign']);
});

test('metadata save rejects older or mismatched API responses instead of closing the form',async()=>{
 const source=fs.readFileSync(new URL('../src/lib/worldApi.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('worldApi.ts',source,ts.ScriptTarget.Latest,true);const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='updateWorldTrack');let track={id:'owned'};const context={exports:{},Error,request:async()=>({ok:true,track})};vm.runInNewContext(ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);const save=context.exports.updateWorldTrack;
 await assert.rejects(save('owned',{releaseDate:'2024-02-29',recordLabel:'Label'}),/server did not save/);track={id:'owned',releaseDate:'2024-02-29',recordLabel:'Wrong'};await assert.rejects(save('owned',{releaseDate:'2024-02-29',recordLabel:'Label'}),/server did not save/);track.recordLabel='Label';assert.equal((await save('owned',{releaseDate:'2024-02-29',recordLabel:' Label '})).track.recordLabel,'Label');track={id:'owned',releaseDate:null,recordLabel:''};assert.equal((await save('owned',{releaseDate:null,recordLabel:''})).track.releaseDate,null);await save('owned',{title:'Title only'});
});
