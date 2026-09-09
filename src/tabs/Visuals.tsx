import { useEffect, useRef, useState } from "react";
import { useWorldPlayer } from "../components/WorldPlayer";
import { bridgeApi, type VisualAudioFrame, type VisualScenePreset, type VisualTransportState } from "../lib/bridgeApi";
import { sendDawSessionCommand, subscribeDawSessionSnapshot, type DawSessionSnapshot } from "../lib/dawSessionBus";
import {
	DEFAULT_VISUAL_SCENE,
	PERFORMANCE_BEHAVIORS,
	SPECTRUM_PRESETS,
	normalizeVisualScene,
	type VisualAudioSource,
	type VisualLayer,
	type VisualLayerType,
	type VisualParticleEmitter,
	type VisualPerformanceDirectorMode,
	type VisualSceneState,
	type VisualSpectrumMode,
} from "../lib/visualsScene";
import {
	YSONG_VISUALS_CHANNEL,
	openVisualOutput,
	type VisualModelInfo,
	type VisualOutputMessage,
	type VisualPerformanceState,
	type VisualOutputStats,
} from "../lib/visualsBus";

const AUDIO_SOURCES: VisualAudioSource[] = ["bass", "mids", "highs", "energy", "kick", "rms", "peak"];
const PARTICLE_EMITTERS: VisualParticleEmitter[] = ["box", "sphere", "ring", "fountain", "tunnel"];
const ZERO_AUDIO: VisualAudioFrame = { sequence:0,timestampUnixMs:0,source:"idle",rms:0,peak:0,bass:0,mids:0,highs:0,energy:0,kick:0,spectrum:Array.from({length:64},()=>0) };
type OutputState = "offline" | "online" | "error";
type SingletonLayerType = Exclude<VisualLayerType, "media">;

export default function VisualsPane() {
	const world = useWorldPlayer();
	const [scene,setScene]=useState<VisualSceneState>(()=>structuredClone(DEFAULT_VISUAL_SCENE));
	const [selectedId,setSelectedId]=useState("object");
	const [audio,setAudio]=useState<VisualAudioFrame>(ZERO_AUDIO);
	const [audioConnected,setAudioConnected]=useState(false);
	const [session,setSession]=useState<DawSessionSnapshot|null>(null);
	const [transport,setTransport]=useState<VisualTransportState>({source:"idle",playing:false,positionSeconds:0,durationSeconds:0,updatedAt:0});
	const [stats,setStats]=useState<VisualOutputStats|null>(null);
	const [outputState,setOutputState]=useState<OutputState>("offline");
	const [outputError,setOutputError]=useState("");
	const [importing,setImporting]=useState("");
	const [notice,setNotice]=useState("");
	const [presets,setPresets]=useState<VisualScenePreset<VisualSceneState>[]>([]);
	const [presetName,setPresetName]=useState("");
	const [modelInfo,setModelInfo]=useState<VisualModelInfo|null>(null);
	const [livePerformance,setLivePerformance]=useState<VisualPerformanceState|null>(null);
	const imageInputRef=useRef<HTMLInputElement|null>(null);
	const videoInputRef=useRef<HTMLInputElement|null>(null);
	const modelInputRef=useRef<HTMLInputElement|null>(null);
	const sceneReadyRef=useRef(false);

	const refreshLibrary=()=>void bridgeApi.getVisualLibrary<VisualSceneState>().then(r=>setPresets(r.presets||[])).catch(()=>{});
	useEffect(()=>{
		let cancelled=false;
		void bridgeApi.getVisualScene<VisualSceneState>().then(payload=>{
			if(cancelled)return;
			const next=normalizeVisualScene(payload.scene);setScene(next);sceneReadyRef.current=true;
			if(!next.layers.some(l=>l.id===selectedId))setSelectedId(next.layers[0]?.id||"");
			if(!payload.scene||(payload.scene as VisualSceneState).version!==7)void bridgeApi.setVisualScene(next).catch(()=>{});
		}).catch(()=>{sceneReadyRef.current=true;void bridgeApi.setVisualScene(DEFAULT_VISUAL_SCENE).catch(()=>{})});
		refreshLibrary();
		return()=>{cancelled=true};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	},[]);
	useEffect(()=>{if(!sceneReadyRef.current)return;const t=window.setTimeout(()=>void bridgeApi.setVisualScene({...scene,updatedAt:Date.now()}).catch(()=>{}),90);return()=>clearTimeout(t)},[scene]);
	useEffect(()=>bridgeApi.subscribeVisualAudio(setAudio,setAudioConnected),[]);
	useEffect(()=>bridgeApi.subscribeVisualTransport(setTransport),[]);
	useEffect(()=>subscribeDawSessionSnapshot(setSession),[]);
	useEffect(()=>{
		const channel=new BroadcastChannel(YSONG_VISUALS_CHANNEL);let lastSeen=0;
		channel.onmessage=(event:MessageEvent<VisualOutputMessage>)=>{const m=event.data;if(!m||typeof m!=="object")return;lastSeen=Date.now();if(m.type==="visual-output-stats"){setStats(m);setOutputError("");setOutputState("online")}else if(m.type==="visual-output-error"){setOutputError(m.message);setOutputState("error")}else if(m.type==="visual-model-info")setModelInfo(m);else if(m.type==="visual-performance-state")setLivePerformance(m)};
		const heartbeat=window.setInterval(()=>{if(lastSeen&&Date.now()-lastSeen>2500){lastSeen=0;setOutputState("offline");setStats(null)}},500);
		return()=>{clearInterval(heartbeat);channel.close()};
	},[]);

	const selected=scene.layers.find(l=>l.id===selectedId)||null;
	const dawSeconds=session?barsToSeconds(session.playheadBar-1,session):0;
	const dawDuration=session?barsToSeconds(session.endBar-1,session):0;
	const worldIsCurrent=transport.source==="world"&&Date.now()-transport.updatedAt<1800;
	const positionSeconds=worldIsCurrent?transport.positionSeconds:dawSeconds;
	const durationSeconds=Math.max(transport.durationSeconds||0,dawDuration||0,scene.timeline.durationSeconds||0,1);
	const playing=worldIsCurrent?transport.playing:!!session?.playing;

	const patchLayer=(id:string,patch:Partial<VisualLayer>)=>setScene(prev=>({...prev,layers:prev.layers.map(l=>l.id===id?{...l,...patch}:l)}));
	const patchTimeline=(id:string,patch:Partial<NonNullable<VisualLayer["timeline"]>>)=>setScene(prev=>({...prev,layers:prev.layers.map(l=>l.id===id?{...l,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...l.timeline,...patch}}:l)}));
	const ensureSingleton=(type:SingletonLayerType)=>{
		const existing=scene.layers.find(l=>l.type===type);if(existing){setSelectedId(existing.id);return}
		const spec:{[K in SingletonLayerType]:{id:string;name:string}}={stage:{id:"stage",name:"Stage Lighting & Fog"},particles:{id:"particles",name:"3D Particles"},spectrum:{id:"spectrum",name:"Spectrum"},object:{id:"object",name:"3D Performer"},nowPlaying:{id:"now-playing",name:"Now Playing"}};
		const v=spec[type];const layer:VisualLayer={id:`${v.id}-${crypto.randomUUID().slice(0,6)}`,type,name:v.name,visible:true,opacity:1,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}};
		setScene(prev=>({...prev,layers:[...prev.layers,layer]}));setSelectedId(layer.id);
	};
	const removeSelected=()=>{if(!selected)return;setScene(prev=>{const layers=prev.layers.filter(l=>l.id!==selected.id);queueMicrotask(()=>setSelectedId(layers[0]?.id||""));return{...prev,layers}})};
	const moveSelected=(dir:-1|1)=>{if(!selected)return;setScene(prev=>{const a=[...prev.layers],i=a.findIndex(l=>l.id===selected.id),j=i+dir;if(i<0||j<0||j>=a.length)return prev;[a[i],a[j]]=[a[j],a[i]];return{...prev,layers:a}})};

	const addAssetToTimeline=(asset:VisualSceneState["assets"][number],startAt=positionSeconds)=>{
		const clipDuration=asset.kind==="video"&&asset.duration>0?asset.duration:Math.max(5,durationSeconds);
		const layer:VisualLayer={id:`media-${crypto.randomUUID()}`,type:"media",name:asset.name,visible:true,locked:false,opacity:1,blendMode:"normal",mediaKind:asset.kind,mediaUrl:asset.url,fileName:asset.name,fit:"cover",loop:true,speed:1,sourceDuration:asset.duration,timeline:{start:Math.max(0,startAt),duration:clipDuration,trimIn:0,trimOut:asset.duration,fadeIn:0,fadeOut:0}};
		setScene(prev=>({...prev,timeline:{...prev.timeline,durationSeconds:Math.max(prev.timeline.durationSeconds,layer.timeline!.start+clipDuration)},layers:[layer,...prev.layers]}));
		setSelectedId(layer.id);
	};
	const importMedia=async(file:File,kind:"image"|"video")=>{
		setImporting(`Importing ${file.name}…`);setNotice("");
		try{
			const uploaded=await bridgeApi.uploadVisualMedia(file);
			const sourceDuration=kind==="video"?await readVideoDuration(file):0;
			const asset={id:`asset-${crypto.randomUUID()}`,name:file.name,kind,url:uploaded.url,duration:sourceDuration};
			setScene(prev=>({...prev,assets:[asset,...prev.assets]}));
			queueMicrotask(()=>addAssetToTimeline(asset,positionSeconds));
			setNotice(`${file.name} imported to the Media Bin and added at ${formatTime(positionSeconds)}.`);
		}catch(e){setNotice(e instanceof Error?e.message:"Could not import media.")}finally{setImporting("")}
	};
	const removeAsset=(assetId:string)=>setScene(prev=>({...prev,assets:prev.assets.filter(a=>a.id!==assetId)}));
	const importModel=async(file:File)=>{
		setImporting(`Importing ${file.name}…`);setNotice("");
		try{
			const uploaded=await bridgeApi.uploadVisualMedia(file);
			let selectedObjectId="";
			setScene(prev=>{
				const existing=prev.layers.find(l=>l.type==="object");
				selectedObjectId=existing?.id||`object-${crypto.randomUUID().slice(0,6)}`;
				const layers=existing?prev.layers.map(l=>l.id===existing.id?{...l,visible:true,name:file.name}:l):[...prev.layers,{id:selectedObjectId,type:"object" as const,name:file.name,visible:true,opacity:1,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}}];
				return{...prev,object:{...prev.object,model:"glb",modelUrl:uploaded.url,modelFileName:file.name,animation:"",positionY:0,baseScale:1},layers};
			});
			queueMicrotask(()=>selectedObjectId&&setSelectedId(selectedObjectId));
			setModelInfo(null);setNotice(`${file.name} loaded. YSong will discover its meshes, bones and animation clips.`);
		}catch(e){setNotice(e instanceof Error?e.message:"Could not import GLB.")}finally{setImporting("")}
	};
	const saveScene=async()=>{const name=presetName.trim()||window.prompt("Scene name",`Scene ${presets.length+1}`)?.trim();if(!name)return;try{const r=await bridgeApi.saveVisualPreset(name,{...scene,updatedAt:Date.now()});setPresetName("");setPresets(prev=>[r.preset,...prev.filter(p=>p.id!==r.preset.id)]);setNotice(`Saved visual scene “${name}”. It can now be assigned to YSong World playlist songs.`)}catch(e){setNotice(e instanceof Error?e.message:"Could not save scene.")}};
	const loadScene=(preset:VisualScenePreset<VisualSceneState>)=>{const next=normalizeVisualScene(preset.scene);setScene(next);setSelectedId(next.layers[0]?.id||"");setNotice(`Loaded “${preset.name}”.`)};
	const deleteScene=async(preset:VisualScenePreset<VisualSceneState>)=>{if(!confirm(`Delete visual scene “${preset.name}”?`))return;await bridgeApi.deleteVisualPreset(preset.id);refreshLibrary()};

	const seek=(seconds:number)=>{const next=Math.max(0,Math.min(durationSeconds,seconds));if(worldIsCurrent&&world.current)world.seek(next);else sendDawSessionCommand({type:"transport-seek-seconds",value:next});void bridgeApi.setVisualTransport({...transport,positionSeconds:next,updatedAt:Date.now()}).catch(()=>{})};
	const togglePlayback=()=>{if(worldIsCurrent&&world.current)world.toggle();else sendDawSessionCommand({type:"transport-toggle"})};
	const stopPlayback=()=>{if(worldIsCurrent&&world.current)world.stop();else sendDawSessionCommand({type:"transport-stop"})};
	useEffect(()=>{
		const onKey=(event:KeyboardEvent)=>{
			const target=event.target as HTMLElement|null;
			if(target?.closest("input,textarea,select,button,[contenteditable='true']"))return;
			if(event.code==="Space"){event.preventDefault();togglePlayback();}
			else if(event.key==="Home"){event.preventDefault();seek(0);}
			else if(event.key.toLowerCase()==="s"){event.preventDefault();splitSelected();}
			else if(event.key.toLowerCase()==="m"){event.preventDefault();addMarker();}
			else if(event.key==="Delete"||event.key==="Backspace"){event.preventDefault();deleteSelected();}
			else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="d"){event.preventDefault();duplicateSelected();}
		};
		window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
	});
	const splitSelected=()=>{
		if(!selected||selected.type!=="media"||selected.locked)return;
		const tl=selected.timeline;if(!tl)return;
		const local=positionSeconds-tl.start;
		if(local<=0.05||tl.duration<=0||local>=tl.duration-0.05){setNotice("Move the playhead inside the selected clip before splitting.");return}
		const speed=Math.max(.01,selected.speed||1);
		const splitSource=tl.trimIn+local*speed;
		const left={...selected,timeline:{...tl,duration:local,trimOut:splitSource}};
		const right:VisualLayer={...selected,id:`media-${crypto.randomUUID()}`,name:`${selected.name} B`,timeline:{...tl,start:tl.start+local,duration:tl.duration-local,trimIn:splitSource}};
		setScene(prev=>({...prev,layers:prev.layers.flatMap(l=>l.id===selected.id?[left,right]:[l])}));
		setSelectedId(right.id);setNotice("Clip split at the playhead.");
	};
	const duplicateSelected=()=>{
		if(!selected)return;
		const tl={start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...selected.timeline};
		const copy:VisualLayer={...selected,id:`${selected.type}-${crypto.randomUUID()}`,name:`${selected.name} copy`,locked:false,timeline:{...tl,start:tl.start+Math.max(.5,tl.duration||.5)}};
		setScene(prev=>({...prev,layers:[...prev.layers,copy]}));setSelectedId(copy.id);
	};
	const addMarker=()=>{
		const label=window.prompt("Marker name",`Marker ${scene.timeline.markers.length+1}`)?.trim();if(!label)return;
		setScene(prev=>({...prev,timeline:{...prev.timeline,markers:[...prev.timeline.markers,{id:`marker-${crypto.randomUUID()}`,time:positionSeconds,label}]}}));
	};
	const deleteSelected=()=>{if(!selected||selected.locked)return;removeSelected();};
	const copyObsSource=async()=>{const url=`${window.location.origin}/visual-output?obs=1`;try{await navigator.clipboard.writeText(url);setNotice("OBS Browser Source copied. 1920 × 1080, 60 FPS.")}catch{setNotice(url)}};

	return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#090b10] text-neutral-100">
		<input ref={imageInputRef} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void importMedia(f,"image");e.currentTarget.value=""}}/>
		<input ref={videoInputRef} type="file" accept="video/mp4,video/webm,.mp4,.webm" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void importMedia(f,"video");e.currentTarget.value=""}}/>
		<input ref={modelInputRef} type="file" accept="model/gltf-binary,.glb" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void importModel(f);e.currentTarget.value=""}}/>
		<header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0e1118] px-4">
			<div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-400">YSong Visual Broadcast Engine</div><div className="truncate text-sm font-semibold">Visual DAW <span className="ml-2 text-[10px] font-normal text-neutral-500">Phase 3D · Performance Director</span></div></div>
			<div className="ml-auto flex items-center gap-2"><StatusPill label={audioConnected?`AUDIO ${audio.source.toUpperCase()}`:"AUDIO OFFLINE"} active={audioConnected}/><StatusPill label={outputState==="online"&&stats?`${stats.fps.toFixed(1)} FPS`:outputState.toUpperCase()} active={outputState==="online"} error={outputState==="error"}/><button onClick={()=>void copyObsSource()} className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">Copy OBS Source</button><button onClick={()=>openVisualOutput()} className="rounded-md border border-violet-400/40 bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-100">Open Program Output</button></div>
		</header>
		<div className="grid min-h-0 flex-1 grid-cols-[252px_minmax(0,1fr)_330px] grid-rows-[minmax(0,1fr)_250px]">
			<aside className="min-h-0 overflow-auto border-r border-white/10 bg-[#0b0e14]">
				<PanelHeading title="Visual Library"/>
				<div className="p-3"><div className="flex gap-1"><input value={presetName} onChange={e=>setPresetName(e.target.value)} placeholder="Scene name" className="min-w-0 flex-1 rounded border border-white/10 bg-[#121620] px-2 py-1.5 text-xs"/><button onClick={()=>void saveScene()} className="rounded border border-violet-400/30 bg-violet-500/10 px-2 text-[10px]">SAVE</button></div><div className="mt-2 max-h-28 space-y-1 overflow-auto">{presets.map(p=><div key={p.id} className="flex items-center gap-1 rounded bg-white/[.03] px-1"><button onClick={()=>loadScene(p)} className="min-w-0 flex-1 truncate px-1 py-1.5 text-left text-[10px] hover:text-violet-300">{p.name}</button><button onClick={()=>void deleteScene(p)} className="px-1 text-[10px] text-neutral-600 hover:text-red-300">×</button></div>)}{!presets.length?<div className="text-[10px] text-neutral-600">Save scenes here, then assign them to playlist songs in YSong World.</div>:null}</div></div>
				<PanelHeading title="Media Bin" action={<span className="text-[9px] text-neutral-600">{scene.assets.length} assets</span>}/>
				<div className="max-h-36 space-y-1 overflow-auto px-2 py-2">{scene.assets.map(asset=><div key={asset.id} className="flex items-center gap-1 rounded border border-white/5 bg-white/[.025] px-1.5 py-1"><span className="w-4 text-center text-[10px] text-neutral-500">{asset.kind==="video"?"▶":"▧"}</span><button onClick={()=>addAssetToTimeline(asset,positionSeconds)} className="min-w-0 flex-1 truncate text-left text-[10px] hover:text-violet-300" title="Add a new clip at the playhead">{asset.name}</button>{asset.duration>0?<span className="text-[8px] text-neutral-600">{formatTime(asset.duration)}</span>:null}<button onClick={()=>removeAsset(asset.id)} className="px-1 text-[10px] text-neutral-700 hover:text-red-300" title="Remove from media bin">×</button></div>)}{scene.assets.length===0?<div className="px-1 text-[10px] text-neutral-600">Import an image or video. It stays here so you can reuse it on the timeline without uploading it again.</div>:null}</div>
				<PanelHeading title="Scene" action={<div className="flex gap-2"><button onClick={()=>moveSelected(-1)} className="text-[10px] text-neutral-500">↑</button><button onClick={()=>moveSelected(1)} className="text-[10px] text-neutral-500">↓</button><button onClick={removeSelected} className="text-[10px] text-neutral-500 hover:text-red-300">REMOVE</button></div>}/>
				<div className="space-y-1 px-2 pb-3">{scene.layers.map(layer=><button key={layer.id} onClick={()=>setSelectedId(layer.id)} className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs ${selectedId===layer.id?"border-violet-400/40 bg-violet-500/15":"border-transparent hover:bg-white/5"}`}><span className="w-4 text-center text-[11px] text-neutral-500">{layerIcon(layer)}</span><span className="min-w-0 flex-1 truncate">{layer.name}</span><span onClick={e=>{e.stopPropagation();patchLayer(layer.id,{locked:!layer.locked})}} className={layer.locked?"text-amber-300":"text-neutral-700"} title={layer.locked?"Unlock":"Lock"}>{layer.locked?"▣":"▢"}</span><span onClick={e=>{e.stopPropagation();patchLayer(layer.id,{visible:!layer.visible})}} className={layer.visible?"text-emerald-400":"text-neutral-600"}>{layer.visible?"●":"○"}</span></button>)}</div>
				<div className="border-t border-white/10 p-3"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-neutral-500">Add Layer</div><div className="grid grid-cols-2 gap-1.5"><AddButton label="Image" onClick={()=>imageInputRef.current?.click()}/><AddButton label="Video" onClick={()=>videoInputRef.current?.click()}/><AddButton label="3D Model" onClick={()=>modelInputRef.current?.click()}/><AddButton label="Stage" onClick={()=>ensureSingleton("stage")}/><AddButton label="3D Particles" onClick={()=>ensureSingleton("particles")}/><AddButton label="Spectrum" onClick={()=>ensureSingleton("spectrum")}/><AddButton label="Now Playing" onClick={()=>ensureSingleton("nowPlaying")}/></div>{importing?<div className="mt-3 text-[10px] text-violet-300">{importing}</div>:null}</div>
			</aside>

			<main className="relative min-h-0 overflow-hidden bg-[#050609] p-4"><div className="absolute left-6 top-5 z-10 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-neutral-400"><span>Live Viewport</span><span className="rounded bg-black/50 px-1.5 py-.5 text-neutral-500">960 × 540 PREVIEW</span></div><div className="grid h-full place-items-center"><div className="relative aspect-video w-full max-w-[min(100%,1200px)] overflow-hidden rounded-lg border border-white/10 bg-black"><iframe title="YSong Visuals live viewport" src="/visual-output?embedded=1" className="absolute inset-0 h-full w-full border-0"/></div></div><div className="absolute bottom-5 left-6 right-6 flex items-end gap-2"><AudioMeter label="BASS" value={audio.bass}/><AudioMeter label="MIDS" value={audio.mids}/><AudioMeter label="HIGHS" value={audio.highs}/><AudioMeter label="ENERGY" value={audio.energy}/><AudioMeter label="KICK" value={audio.kick}/></div></main>

			<aside className="min-h-0 overflow-auto border-l border-white/10 bg-[#0b0e14]">{worldIsCurrent?<><PanelHeading title="Broadcast Monitor"/><div className="border-b border-white/10 p-3 text-[10px]"><div className="rounded-lg border border-violet-400/20 bg-violet-500/5 p-2"><div className="flex items-center justify-between gap-2"><span className="font-bold uppercase tracking-[.16em] text-violet-300">{transport.playlistName||"YSong World"}</span><span className="text-neutral-500">{transport.transitionMode||"regular"}</span></div><div className="mt-2 truncate text-xs font-semibold text-neutral-100">{transport.title||world.current?.title||"No track"}</div><div className="truncate text-neutral-500">Scene: {transport.visualSceneName||"Current / fallback"}</div>{transport.nextTitle?<div className="mt-2 rounded border border-white/5 bg-black/20 px-2 py-1.5"><span className="text-neutral-600">UP NEXT</span><div className="truncate text-neutral-300">{transport.nextTitle}</div></div>:null}<div className="mt-2 grid grid-cols-2 gap-2"><div><div className="flex justify-between text-neutral-600"><span>Audio</span><span>{Math.round((transport.audioTransitionProgress||0)*100)}%</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-cyan-400" style={{width:`${Math.max(0,Math.min(1,transport.audioTransitionProgress||0))*100}%`}}/></div></div><div><div className="flex justify-between text-neutral-600"><span>{transport.visualTransition||"cut"}</span><span>{transport.visualTransitionSeconds?.toFixed(1)||"0.0"}s</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-violet-400" style={{width:`${Math.max(0,Math.min(1,transport.transitionProgress||0))*100}%`}}/></div></div></div></div></div></>:null}<PanelHeading title="Inspector"/>{selected?<div className="space-y-5 p-3"><div><div className="text-sm font-semibold">{selected.name}</div><div className="mt-.5 text-[10px] uppercase tracking-[.16em] text-neutral-500">{selected.type==="media"?selected.mediaKind:selected.type}</div></div><InspectorSection title="Layer"><Toggle label="Visible" checked={selected.visible} onChange={v=>patchLayer(selected.id,{visible:v})}/><Toggle label="Locked" checked={selected.locked===true} onChange={v=>patchLayer(selected.id,{locked:v})}/><RangeRow label="Opacity" value={selected.opacity} min={0} max={1} step={.01} onChange={v=>patchLayer(selected.id,{opacity:v})}/>{selected.type==="media"?<SelectRow label="Blend" value={selected.blendMode||"normal"} options={["normal","screen","add","multiply"]} onChange={v=>patchLayer(selected.id,{blendMode:v as VisualLayer["blendMode"]})}/>:null}</InspectorSection>{selected.type==="media"?<MediaInspector layer={selected} patch={p=>patchLayer(selected.id,p)} patchTimeline={p=>patchTimeline(selected.id,p)} split={splitSelected} duplicate={duplicateSelected}/>:null}{selected.type==="stage"?<StageInspector scene={scene} setScene={setScene}/>:null}{selected.type==="object"?<ObjectInspector scene={scene} setScene={setScene} info={modelInfo} live={livePerformance} position={positionSeconds} onImport={()=>modelInputRef.current?.click()}/>:null}{selected.type==="particles"?<ParticlesInspector scene={scene} setScene={setScene}/>:null}{selected.type==="spectrum"?<SpectrumInspector scene={scene} setScene={setScene}/>:null}{selected.type==="nowPlaying"?<NowPlayingInspector scene={scene} setScene={setScene} session={session}/>:null}</div>:<div className="p-4 text-xs text-neutral-600">Select a layer.</div>}{notice||outputError?<div className="m-3 rounded border border-amber-400/20 bg-amber-500/5 p-2 text-[10px] leading-relaxed text-amber-100">{outputError||notice}</div>:null}</aside>

			<section className="col-span-3 min-h-0 border-t border-white/10 bg-[#0a0d13]"><VisualTimeline scene={scene} setScene={setScene} selectedId={selectedId} setSelectedId={setSelectedId} position={positionSeconds} duration={durationSeconds} playing={playing} source={worldIsCurrent?"YSong World":"DAW"} title={worldIsCurrent?(transport.title||world.current?.title||"YSong World"):(session?.projectName||"No active song")} seek={seek} toggle={togglePlayback} stop={stopPlayback} previous={worldIsCurrent?world.previous:undefined} next={worldIsCurrent?world.next:undefined} session={session}/></section>
		</div>
	</div>;
}

function VisualTimeline({scene,setScene,selectedId,setSelectedId,position,duration,playing,source,title,seek,toggle,stop,previous,next,session}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;selectedId:string;setSelectedId:(id:string)=>void;position:number;duration:number;playing:boolean;source:string;title:string;seek:(s:number)=>void;toggle:()=>void;stop:()=>void;previous?:()=>void;next?:()=>void;session:DawSessionSnapshot|null}){
	const scrollRef=useRef<HTMLDivElement|null>(null);
	const pxPerSecond=10*Math.max(.5,scene.timeline.zoom);
	const trackWidth=Math.max(1100,duration*pxPerSecond);
	const playX=Math.max(0,Math.min(trackWidth,position*pxPerSecond));
	const beatSeconds=session?(60/Math.max(1,session.bpm))*(4/Math.max(1,session.sigDen)):0;
	const barSeconds=session?beatSeconds*Math.max(1,session.sigNum):0;
	const snapInterval=scene.timeline.snapMode==="beat"&&beatSeconds>0?beatSeconds:scene.timeline.snapMode==="bar"&&barSeconds>0?barSeconds:scene.timeline.snapSeconds;
	const snapTime=(value:number)=>{
		let v=Math.max(0,value);
		if(snapInterval>0)v=Math.round(v/snapInterval)*snapInterval;
		const magnets=[position,...scene.timeline.markers.map(m=>m.time),...scene.performance.timelineCues.map(c=>c.time),...scene.layers.flatMap(l=>{const tl=l.timeline;if(!tl||tl.duration<=0)return[];return[tl.start,tl.start+tl.duration]})];
		for(const point of magnets)if(Math.abs(v-point)<=Math.max(.04,6/pxPerSecond)){v=point;break}
		return Math.max(0,v);
	};
	const rulerStep=pxPerSecond>=30?5:pxPerSecond>=12?10:20;
	const rulerTicks=Array.from({length:Math.ceil(duration/rulerStep)+2},(_,i)=>i*rulerStep);
	const musicalLines=session&&beatSeconds>0?Array.from({length:Math.min(3000,Math.ceil(duration/beatSeconds)+1)},(_,i)=>i*beatSeconds):[];
	const seekFromEvent=(e:React.PointerEvent<HTMLDivElement>)=>{
		if((e.target as HTMLElement).closest("[data-clip],[data-marker]"))return;
		const rect=e.currentTarget.getBoundingClientRect();
		const x=e.clientX-rect.left+(scrollRef.current?.scrollLeft||0);
		seek(Math.max(0,Math.min(duration,x/pxPerSecond)));
	};
	const addTimelineMarker=()=>{
		const label=window.prompt("Marker name",`Marker ${scene.timeline.markers.length+1}`)?.trim();if(!label)return;
		setScene(prev=>({...prev,timeline:{...prev.timeline,markers:[...prev.timeline.markers,{id:`marker-${crypto.randomUUID()}`,time:position,label}]}}));
	};
	const removeMarker=(id:string)=>setScene(prev=>({...prev,timeline:{...prev.timeline,markers:prev.timeline.markers.filter(m=>m.id!==id)}}));
	const removePerformanceCue=(id:string)=>setScene(prev=>({...prev,performance:{...prev.performance,timelineCues:prev.performance.timelineCues.filter(c=>c.id!==id)}}));
	const patchLayer=(id:string,patch:Partial<VisualLayer>)=>setScene(prev=>({...prev,layers:prev.layers.map(l=>l.id===id?{...l,...patch}:l)}));
	const patchTimeline=(id:string,patch:Partial<NonNullable<VisualLayer["timeline"]>>)=>setScene(prev=>({...prev,layers:prev.layers.map(l=>l.id===id?{...l,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...l.timeline,...patch}}:l)}));

	return <div className="grid h-full grid-cols-[270px_minmax(0,1fr)] grid-rows-[56px_minmax(0,1fr)] text-xs">
		<div className="flex items-center gap-1 border-r border-white/10 px-3">
			<button onClick={previous} disabled={!previous} className="transport-btn">|◀</button>
			<button onClick={toggle} className="transport-btn">{playing?"Ⅱ":"▶"}</button>
			<button onClick={stop} className="transport-btn">■</button>
			<button onClick={next} disabled={!next} className="transport-btn">▶|</button>
			<div className="ml-2 min-w-0"><div className="truncate font-semibold">{title}</div><div className="text-[9px] uppercase tracking-wider text-neutral-500">{source}{session?` · ${session.bpm} BPM · ${session.sigNum}/${session.sigDen}`:""}</div></div>
		</div>
		<div className="flex items-center gap-3 overflow-x-auto px-3">
			<span className="font-mono text-[11px] whitespace-nowrap">{formatTimePrecise(position)} / {formatTime(duration)}</span>
			<button onClick={addTimelineMarker} className="timeline-tool" title="Add marker at playhead (M)">+ Marker</button>
			<label className="ml-auto flex items-center gap-2 text-[10px] text-neutral-500 whitespace-nowrap">Zoom<input type="range" min={.5} max={8} step={.25} value={scene.timeline.zoom} onChange={e=>setScene(p=>({...p,timeline:{...p.timeline,zoom:Number(e.target.value)}}))} className="w-24 accent-violet-500"/></label>
			<label className="flex items-center gap-1 text-[10px] text-neutral-500 whitespace-nowrap">Snap<select value={scene.timeline.snapMode} onChange={e=>setScene(p=>({...p,timeline:{...p.timeline,snapMode:e.target.value as VisualSceneState["timeline"]["snapMode"]}}))} className="rounded border border-white/10 bg-[#121620] px-1 py-1"><option value="seconds">Time</option><option value="beat" disabled={!session}>Beat</option><option value="bar" disabled={!session}>Bar</option></select></label>
			{scene.timeline.snapMode==="seconds"?<select value={scene.timeline.snapSeconds} onChange={e=>setScene(p=>({...p,timeline:{...p.timeline,snapSeconds:Number(e.target.value)}}))} className="rounded border border-white/10 bg-[#121620] px-1 py-1 text-[10px] text-neutral-400"><option value={0}>Off</option><option value={.05}>0.05s</option><option value={.1}>0.1s</option><option value={.25}>0.25s</option><option value={.5}>0.5s</option><option value={1}>1s</option></select>:null}
		</div>

		<div className="min-h-0 overflow-y-auto border-r border-t border-white/10 bg-[#090c12]">
			<div className="flex h-8 items-center gap-2 border-b border-white/10 px-3 text-[9px] font-bold uppercase tracking-wider text-neutral-600"><span className="w-5">V</span><span className="w-5">L</span><span>Visual tracks</span></div>
			{scene.layers.map(l=><div key={l.id} className={`flex h-[34px] items-center gap-1 border-b border-white/5 px-2 ${selectedId===l.id?"bg-violet-500/10 text-violet-100":"text-neutral-400"}`}>
				<button onClick={()=>patchLayer(l.id,{visible:!l.visible})} className={`w-5 text-[10px] ${l.visible?"text-emerald-400":"text-neutral-700"}`} title="Visibility">{l.visible?"●":"○"}</button>
				<button onClick={()=>patchLayer(l.id,{locked:!l.locked})} className={`w-5 text-[10px] ${l.locked?"text-amber-300":"text-neutral-700"}`} title="Lock track">{l.locked?"▣":"▢"}</button>
				<button onClick={()=>setSelectedId(l.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[10px]"><span>{layerIcon(l)}</span><span className="truncate">{l.name}</span></button>
			</div>)}
		</div>

		<div ref={scrollRef} className="relative min-h-0 overflow-auto border-t border-white/10" onPointerDown={seekFromEvent}>
			<div className="relative" style={{width:trackWidth,minHeight:Math.max(180,scene.layers.length*35+34)}}>
				<div className="sticky top-0 z-20 h-8 border-b border-white/10 bg-[#0a0d13]/95">
					{rulerTicks.map(t=><div key={t} className="absolute top-0 h-full border-l border-white/10 pl-1 pt-1 text-[8px] text-neutral-600" style={{left:t*pxPerSecond}}>{formatTime(t)}</div>)}
				</div>
				{musicalLines.map((t,i)=><div key={`beat-${i}`} className={`pointer-events-none absolute top-8 bottom-0 border-l ${session&&i%Math.max(1,session.sigNum)===0?"border-violet-400/12":"border-white/[.035]"}`} style={{left:t*pxPerSecond}}/>)}
				{scene.timeline.markers.map(marker=><div key={marker.id} data-marker className="absolute top-0 bottom-0 z-25 w-px bg-amber-400/70" style={{left:marker.time*pxPerSecond}}><button onDoubleClick={()=>removeMarker(marker.id)} onClick={e=>{e.stopPropagation();seek(marker.time)}} className="absolute left-1 top-1 max-w-28 truncate rounded bg-amber-400/15 px-1.5 py-.5 text-[8px] text-amber-200" title={`${marker.label} · ${formatTimePrecise(marker.time)} · double-click to delete`}>{marker.label}</button></div>)}
				{scene.performance.timelineCues.map(cue=>{const meta=PERFORMANCE_BEHAVIORS.find(x=>x.id===cue.cueId);return <div key={cue.id} data-marker className="absolute top-8 bottom-0 z-24 w-px bg-violet-400/45" style={{left:cue.time*pxPerSecond}}><button onDoubleClick={()=>removePerformanceCue(cue.id)} onClick={e=>{e.stopPropagation();seek(cue.time)}} className="absolute -left-2 top-1 h-4 w-4 rotate-45 border border-violet-300/60 bg-violet-500/35" title={`${meta?.label||cue.cueId} · ${formatTimePrecise(cue.time)} · double-click to delete`}><span className="sr-only">{meta?.label||cue.cueId}</span></button></div>})}
				{scene.layers.map((l,i)=><TimelineClip key={l.id} layer={l} row={i} duration={duration} pxPerSecond={pxPerSecond} selected={l.id===selectedId} select={()=>setSelectedId(l.id)} patch={patch=>patchTimeline(l.id,patch)} snapTime={snapTime}/>)}
				<div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-fuchsia-400" style={{left:playX}}><div className="-ml-1 h-2 w-2 rotate-45 bg-fuchsia-400"/></div>
			</div>
		</div>
		<style>{`.transport-btn{height:28px;min-width:30px;border:1px solid rgb(255 255 255 / .1);border-radius:6px;background:rgb(255 255 255 / .04);color:#ddd}.transport-btn:disabled{opacity:.25}.timeline-tool{border:1px solid rgb(255 255 255 / .1);border-radius:6px;background:rgb(255 255 255 / .04);padding:4px 7px;font-size:9px;color:#aaa}.timeline-tool:hover{border-color:rgb(167 139 250 / .4);color:#ddd}`}</style>
	</div>
}

function TimelineClip({layer,row,duration,pxPerSecond,selected,select,patch,snapTime}:{layer:VisualLayer;row:number;duration:number;pxPerSecond:number;selected:boolean;select:()=>void;patch:(p:Partial<NonNullable<VisualLayer["timeline"]>>)=>void;snapTime:(v:number)=>number}){
	const tl={start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...layer.timeline};
	const d=tl.duration>0?tl.duration:duration;
	const left=tl.start*pxPerSecond;
	const width=Math.max(10,d*pxPerSecond);
	const beginDrag=(e:React.PointerEvent,mode:"move"|"left"|"right")=>{
		e.preventDefault();e.stopPropagation();select();if(layer.locked)return;
		const startX=e.clientX,initial={...tl};const speed=Math.max(.01,layer.speed||1);
		const move=(ev:PointerEvent)=>{
			const delta=(ev.clientX-startX)/pxPerSecond;
			if(mode==="move"){patch({start:snapTime(initial.start+delta)});return}
			if(mode==="left"){
				const proposed=snapTime(initial.start+delta);
				const maxStart=initial.start+initial.duration-.05;
				const nextStart=Math.min(maxStart,Math.max(0,proposed));
				const consumed=(nextStart-initial.start)*speed;
				const nextTrimIn=Math.max(0,initial.trimIn+consumed);
				if(initial.trimOut>0&&nextTrimIn>=initial.trimOut-.01)return;
				patch({start:nextStart,duration:Math.max(.05,initial.duration-(nextStart-initial.start)),trimIn:nextTrimIn});
				return;
			}
			const rawEnd=snapTime(initial.start+initial.duration+delta);
			const nextDuration=Math.max(.05,rawEnd-initial.start);
			const sourceOut=initial.trimOut>0?initial.trimOut:layer.sourceDuration||0;
			if(layer.type==="media"&&layer.mediaKind==="video"&&layer.loop===false&&sourceOut>initial.trimIn){
				const maxDuration=(sourceOut-initial.trimIn)/speed;
				patch({duration:Math.min(maxDuration,nextDuration)});
			}else patch({duration:nextDuration});
		};
		const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
		window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
	};
	const fadeInWidth=Math.min(width,tl.fadeIn*pxPerSecond);
	const fadeOutWidth=Math.min(width,tl.fadeOut*pxPerSecond);
	const clipClass=layer.type==="media"?(layer.mediaKind==="video"?"bg-cyan-500/22":"bg-blue-500/20"):layer.type==="object"?"bg-violet-500/22":layer.type==="particles"?"bg-fuchsia-500/18":layer.type==="spectrum"?"bg-emerald-500/16":layer.type==="stage"?"bg-amber-500/12":"bg-white/[.07]";
	return <div data-clip onPointerDown={e=>beginDrag(e,"move")} onClick={e=>{e.stopPropagation();select()}} className={`absolute h-7 overflow-hidden rounded border ${clipClass} ${selected?"border-violet-300 text-white":"border-white/10 text-neutral-300"} ${layer.locked?"opacity-65":""}`} style={{top:36+row*35,left,width}} title={`${layer.name} · ${formatTimePrecise(tl.start)} → ${formatTimePrecise(tl.start+d)}`}>
		{fadeInWidth>1?<div className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/65 to-transparent" style={{width:fadeInWidth}}/>:null}
		{fadeOutWidth>1?<div className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/65 to-transparent" style={{width:fadeOutWidth}}/>:null}
		<div className="pointer-events-none flex h-full items-center gap-1 px-2 text-[9px]"><span>{layerIcon(layer)}</span><span className="truncate">{layer.name}</span>{layer.locked?<span className="ml-auto text-amber-300">▣</span>:null}</div>
		{!layer.locked&&layer.type==="media"?<><div onPointerDown={e=>beginDrag(e,"left")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize border-r border-white/20 bg-white/5"/><div onPointerDown={e=>beginDrag(e,"right")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize border-l border-white/20 bg-white/5"/></>:null}
	</div>
}

function MediaInspector({layer,patch,patchTimeline,split,duplicate}:{layer:VisualLayer;patch:(p:Partial<VisualLayer>)=>void;patchTimeline:(p:Partial<NonNullable<VisualLayer["timeline"]>>)=>void;split:()=>void;duplicate:()=>void}){
	const tl={start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...layer.timeline};
	const speed=Math.max(.25,layer.speed||1);
	const sourceLength=Math.max(0,layer.sourceDuration||0);
	const sourceOut=tl.trimOut>tl.trimIn?tl.trimOut:sourceLength;
	const maxSourceDuration=Math.max(.05,sourceOut-tl.trimIn);
	return <><InspectorSection title="Media">
		<SelectRow label="Fit" value={layer.fit||"cover"} options={["cover","contain"]} onChange={v=>patch({fit:v as "cover"|"contain"})}/>
		<SelectRow label="Blend Mode" value={layer.blendMode||"normal"} options={["normal","screen","add","multiply"]} onChange={v=>patch({blendMode:v as VisualLayer["blendMode"]})}/>
		{layer.mediaKind==="video"?<><Toggle label="Loop selected source range" checked={layer.loop!==false} onChange={v=>patch({loop:v})}/><RangeRow label="Playback Speed" value={speed} min={.25} max={2} step={.05} onChange={v=>patch({speed:v})}/><div className="text-[10px] text-neutral-600">Source length: {formatTimePrecise(sourceLength)}</div></>:null}
	</InspectorSection>
	<InspectorSection title="Visual DAW Clip">
		<NumberRow label="Timeline Start" value={tl.start} min={0} step={.05} onChange={v=>patchTimeline({start:v})} suffix="s"/>
		<NumberRow label="Clip Duration" value={tl.duration} min={.05} step={.05} onChange={v=>patchTimeline({duration:v})} suffix="s"/>
		<NumberRow label="Source In" value={tl.trimIn} min={0} max={sourceLength||undefined} step={.05} onChange={v=>patchTimeline({trimIn:Math.min(sourceOut||sourceLength,v)})} suffix="s"/>
		{layer.mediaKind==="video"&&sourceLength>0?<NumberRow label="Source Out" value={sourceOut} min={tl.trimIn+.01} max={sourceLength} step={.05} onChange={v=>patchTimeline({trimOut:v})} suffix="s"/>:null}
		<NumberRow label="Fade In" value={Math.min(tl.fadeIn,tl.duration)} min={0} max={tl.duration} step={.05} onChange={v=>patchTimeline({fadeIn:v})} suffix="s"/>
		<NumberRow label="Fade Out" value={Math.min(tl.fadeOut,tl.duration)} min={0} max={tl.duration} step={.05} onChange={v=>patchTimeline({fadeOut:v})} suffix="s"/>
		{layer.mediaKind==="video"?<div className="rounded border border-white/5 bg-white/[.025] p-2 text-[9px] leading-relaxed text-neutral-500">Using {formatTimePrecise(maxSourceDuration)} of the source. Drag the clip body to move it. Drag the left/right handles to trim it directly on the timeline.</div>:null}
		<div className="grid grid-cols-2 gap-2"><button onClick={split} className="inspector-btn">Split at playhead (S)</button><button onClick={duplicate} className="inspector-btn">Duplicate (Ctrl+D)</button></div>
	</InspectorSection></>
}
function StageInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){const patch=(p:Partial<VisualSceneState["stage"]>)=>setScene(v=>({...v,stage:{...v.stage,...p}}));return <><InspectorSection title="Atmosphere"><Toggle label="Fog" checked={scene.stage.fogEnabled} onChange={v=>patch({fogEnabled:v})}/><ColorRow label="Fog Color" value={scene.stage.fogColor} onChange={v=>patch({fogColor:v})}/><RangeRow label="Fog Near" value={scene.stage.fogNear} min={1} max={30} step={.25} onChange={v=>patch({fogNear:v})}/><RangeRow label="Fog Far" value={scene.stage.fogFar} min={4} max={60} step={.5} onChange={v=>patch({fogFar:v})}/><SelectRow label="Fog React" value={scene.stage.fogSource} options={AUDIO_SOURCES} onChange={v=>patch({fogSource:v as VisualAudioSource})}/><RangeRow label="Fog Amount" value={scene.stage.fogAmount} min={0} max={2} step={.05} onChange={v=>patch({fogAmount:v})}/></InspectorSection><InspectorSection title="Lighting"><RangeRow label="Ambient" value={scene.stage.ambientIntensity} min={0} max={4} step={.05} onChange={v=>patch({ambientIntensity:v})}/><ColorRow label="Sun Color" value={scene.stage.sunColor} onChange={v=>patch({sunColor:v})}/><RangeRow label="Sun Intensity" value={scene.stage.sunIntensity} min={0} max={6} step={.05} onChange={v=>patch({sunIntensity:v})}/><RangeRow label="Sun X" value={scene.stage.sunX} min={-12} max={12} step={.1} onChange={v=>patch({sunX:v})}/><RangeRow label="Sun Y" value={scene.stage.sunY} min={-8} max={14} step={.1} onChange={v=>patch({sunY:v})}/><RangeRow label="Sun Z" value={scene.stage.sunZ} min={-12} max={14} step={.1} onChange={v=>patch({sunZ:v})}/><SelectRow label="Sun React" value={scene.stage.sunSource} options={AUDIO_SOURCES} onChange={v=>patch({sunSource:v as VisualAudioSource})}/><RangeRow label="Sun Amount" value={scene.stage.sunAmount} min={0} max={5} step={.05} onChange={v=>patch({sunAmount:v})}/><ColorRow label="Key Color" value={scene.stage.keyColor} onChange={v=>patch({keyColor:v})}/><RangeRow label="Key Intensity" value={scene.stage.keyIntensity} min={0} max={10} step={.1} onChange={v=>patch({keyIntensity:v})}/><RangeRow label="Key X" value={scene.stage.keyX} min={-12} max={12} step={.1} onChange={v=>patch({keyX:v})}/><RangeRow label="Key Y" value={scene.stage.keyY} min={-6} max={14} step={.1} onChange={v=>patch({keyY:v})}/><RangeRow label="Key Z" value={scene.stage.keyZ} min={-12} max={14} step={.1} onChange={v=>patch({keyZ:v})}/><RangeRow label="Key Cone" value={scene.stage.keyAngle} min={5} max={88} step={1} onChange={v=>patch({keyAngle:v})}/><RangeRow label="Key Penumbra" value={scene.stage.keyPenumbra} min={0} max={1} step={.02} onChange={v=>patch({keyPenumbra:v})}/><RangeRow label="Key Range" value={scene.stage.keyDistance} min={0} max={80} step={1} onChange={v=>patch({keyDistance:v})}/><SelectRow label="Key React" value={scene.stage.keySource} options={AUDIO_SOURCES} onChange={v=>patch({keySource:v as VisualAudioSource})}/><RangeRow label="Key Amount" value={scene.stage.keyAmount} min={0} max={5} step={.05} onChange={v=>patch({keyAmount:v})}/><ColorRow label="Rim Color" value={scene.stage.rimColor} onChange={v=>patch({rimColor:v})}/><RangeRow label="Rim Intensity" value={scene.stage.rimIntensity} min={0} max={12} step={.1} onChange={v=>patch({rimIntensity:v})}/><RangeRow label="Rim X" value={scene.stage.rimX} min={-12} max={12} step={.1} onChange={v=>patch({rimX:v})}/><RangeRow label="Rim Y" value={scene.stage.rimY} min={-8} max={12} step={.1} onChange={v=>patch({rimY:v})}/><RangeRow label="Rim Z" value={scene.stage.rimZ} min={-12} max={14} step={.1} onChange={v=>patch({rimZ:v})}/><SelectRow label="Rim React" value={scene.stage.rimSource} options={AUDIO_SOURCES} onChange={v=>patch({rimSource:v as VisualAudioSource})}/><RangeRow label="Rim Amount" value={scene.stage.rimAmount} min={0} max={5} step={.05} onChange={v=>patch({rimAmount:v})}/><ColorRow label="Fill Color" value={scene.stage.fillColor} onChange={v=>patch({fillColor:v})}/><RangeRow label="Fill Intensity" value={scene.stage.fillIntensity} min={0} max={10} step={.1} onChange={v=>patch({fillIntensity:v})}/><RangeRow label="Fill X" value={scene.stage.fillX} min={-12} max={12} step={.1} onChange={v=>patch({fillX:v})}/><RangeRow label="Fill Y" value={scene.stage.fillY} min={-8} max={12} step={.1} onChange={v=>patch({fillY:v})}/><RangeRow label="Fill Z" value={scene.stage.fillZ} min={-12} max={14} step={.1} onChange={v=>patch({fillZ:v})}/><SelectRow label="Fill React" value={scene.stage.fillSource} options={AUDIO_SOURCES} onChange={v=>patch({fillSource:v as VisualAudioSource})}/><RangeRow label="Fill Amount" value={scene.stage.fillAmount} min={0} max={5} step={.05} onChange={v=>patch({fillAmount:v})}/></InspectorSection><InspectorSection title="Floor + Post"><Toggle label="Floor" checked={scene.stage.floorVisible} onChange={v=>patch({floorVisible:v})}/><ColorRow label="Floor Color" value={scene.stage.floorColor} onChange={v=>patch({floorColor:v})}/><RangeRow label="Floor Size" value={scene.stage.floorSize} min={10} max={80} step={1} onChange={v=>patch({floorSize:v})}/><Toggle label="Program Shadows" checked={scene.stage.shadows} onChange={v=>patch({shadows:v})}/><RangeRow label="Exposure" value={scene.stage.exposure} min={.2} max={3} step={.05} onChange={v=>patch({exposure:v})}/><RangeRow label="Bloom" value={scene.stage.bloomStrength} min={0} max={3} step={.05} onChange={v=>patch({bloomStrength:v})}/><RangeRow label="Bloom Radius" value={scene.stage.bloomRadius} min={0} max={1} step={.02} onChange={v=>patch({bloomRadius:v})}/><RangeRow label="Bloom Threshold" value={scene.stage.bloomThreshold} min={0} max={1} step={.02} onChange={v=>patch({bloomThreshold:v})}/></InspectorSection></>}
function ObjectInspector({scene,setScene,info,live,position,onImport}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;info:VisualModelInfo|null;live:VisualPerformanceState|null;position:number;onImport:()=>void}){
	const patch=(p:Partial<VisualSceneState["object"]>)=>setScene(v=>({...v,object:{...v.object,...p}}));
	const patchPerf=(p:Partial<VisualSceneState["performance"]>)=>setScene(v=>({...v,performance:{...v.performance,...p}}));
	const patchGrid=(p:Partial<VisualSceneState["grid"]>)=>setScene(v=>({...v,grid:{...v.grid,...p}}));
	const trigger=(id=scene.performance.manualCueId)=>setScene(v=>({...v,performance:{...v.performance,manualCueId:id,manualCueSequence:v.performance.manualCueSequence+1}}));
	const schedule=()=>setScene(v=>({...v,performance:{...v.performance,timelineCues:[...v.performance.timelineCues,{id:crypto.randomUUID(),time:Math.max(0,position),cueId:v.performance.manualCueId,strength:v.performance.manualCueStrength}].sort((a,b)=>a.time-b.time)}}));
	const surprise=()=>{const pool=PERFORMANCE_BEHAVIORS.filter(cue=>cue.id!=="still");const cue=pool[Math.floor(Math.random()*pool.length)];if(cue)trigger(cue.id)};
	const scheduleShowcase=()=>{const cues=[[0,"watch-audience"],[2.2,"reach-camera"],[4.6,"pound-screen"],[6.2,"dual-lightning"],[8.4,"open-arms"]] as const;setScene(v=>({...v,performance:{...v.performance,timelineCues:[...v.performance.timelineCues,...cues.map(([offset,cueId])=>({id:crypto.randomUUID(),time:Math.max(0,position+offset),cueId,strength:1}))].sort((a,b)=>a.time-b.time)}}))};
	const removeScheduled=(id:string)=>setScene(v=>({...v,performance:{...v.performance,timelineCues:v.performance.timelineCues.filter(c=>c.id!==id)}}));
	const behaviorLabels=Object.fromEntries(PERFORMANCE_BEHAVIORS.map(cue=>[cue.id,cue.label]));
	const quick=["reach-camera","pound-screen","lightning-left","lightning-right","dual-lightning","grab-camera","push-glass","open-arms","scream"];
	return <>
		<InspectorSection title="3D Model">
			<div className="grid grid-cols-3 gap-1"><button onClick={()=>patch({model:"mannequin",modelUrl:""})} className={`inspector-btn ${scene.object.model==="mannequin"?"active":""}`}>Rig Dummy</button><button onClick={()=>patch({model:"crystal",modelUrl:""})} className={`inspector-btn ${scene.object.model==="crystal"?"active":""}`}>Crystal</button><button onClick={onImport} className={`inspector-btn ${scene.object.model==="glb"?"active":""}`}>Load GLB</button></div>
			<button onClick={()=>patch({model:"glb",modelUrl:"/visuals/YSong-Test-Rig.glb",modelFileName:"YSong-Test-Rig.glb",animation:"Wave",positionY:0,baseScale:1})} className="inspector-btn w-full">Load bundled rig test (Wave / Reach / Bow)</button>
			{scene.object.model==="glb"?<div className="rounded border border-cyan-400/15 bg-cyan-500/5 p-2 text-[10px] text-cyan-100/75"><div className="font-semibold">{scene.object.modelFileName||"GLB model"}</div>{info&&info.fileName===scene.object.modelFileName?<div className="mt-1">{info.meshes} meshes • {info.bones.length} bones • {info.animations.length} clips</div>:<div className="mt-1">Waiting for model discovery…</div>}</div>:null}
			{info?.animations.length&&scene.object.model==="glb"?<SelectRow label="Animation" value={scene.object.animation} options={["",...info.animations]} labels={{"":"None"}} onChange={v=>patch({animation:v})}/>:null}
			<RangeRow label="Animation Speed" value={scene.object.animationSpeed} min={.1} max={3} step={.05} onChange={v=>patch({animationSpeed:v})}/>
		</InspectorSection>
		<InspectorSection title="Performance Director">
			<div className="rounded border border-violet-400/20 bg-violet-500/5 p-2 text-[10px] text-violet-100/80"><div className="flex items-center justify-between gap-2"><span className="font-bold">{PERFORMANCE_BEHAVIORS.length} performance behaviors loaded</span><span className="uppercase text-violet-300">Phase 3D</span></div><div className="mt-1 text-neutral-400">Manual cues work without music. Auto Director chooses non-repeating reactions from musical events.</div></div>
			{live?<div className="rounded border border-cyan-400/15 bg-cyan-500/5 p-2 text-[10px]"><div className="flex justify-between gap-2"><span className="font-semibold text-cyan-200">LIVE: {live.label}</span><span className="uppercase text-neutral-500">{live.source}</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-cyan-400" style={{width:`${Math.max(0,Math.min(1,live.progress))*100}%`}}/></div></div>:null}
			<Toggle label="Auto Director" checked={scene.performance.autoDirector} onChange={v=>patchPerf({autoDirector:v})}/>
			<SelectRow label="Director Mood" value={scene.performance.directorMode} options={["balanced","aggressive","ethereal","emotional"]} onChange={v=>patchPerf({directorMode:v as VisualPerformanceDirectorMode})}/>
			<RangeRow label="Director Intensity" value={scene.performance.directorIntensity} min={.2} max={1.5} step={.05} onChange={v=>patchPerf({directorIntensity:v})}/>
			<RangeRow label="Minimum Cooldown" value={scene.performance.minimumCooldown} min={.5} max={8} step={.1} onChange={v=>patchPerf({minimumCooldown:v})} suffix="s"/>
			<SelectRow label="Manual Behavior" value={scene.performance.manualCueId} options={PERFORMANCE_BEHAVIORS.map(c=>c.id)} labels={behaviorLabels} onChange={v=>patchPerf({manualCueId:v})}/>
			<RangeRow label="Cue Strength" value={scene.performance.manualCueStrength} min={.2} max={2} step={.05} onChange={v=>patchPerf({manualCueStrength:v})}/>
			<button onClick={()=>trigger()} className="inspector-btn w-full border-violet-300/40 bg-violet-500/20 font-bold">TRIGGER BEHAVIOR</button>
			<div className="grid grid-cols-2 gap-2"><button onClick={surprise} className="inspector-btn">SURPRISE ME</button><button onClick={scheduleShowcase} className="inspector-btn">Schedule Showcase</button></div>
			<button onClick={schedule} className="inspector-btn w-full">Schedule at {formatTimePrecise(position)}</button>
			{scene.performance.timelineCues.length?<div className="max-h-28 space-y-1 overflow-auto rounded border border-white/10 bg-black/20 p-1">{scene.performance.timelineCues.slice(-12).map(cue=><div key={cue.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 text-[9px] text-neutral-400"><button onClick={()=>{const c=PERFORMANCE_BEHAVIORS.find(x=>x.id===cue.cueId);if(c)trigger(c.id)}} className="min-w-0 flex-1 truncate text-left hover:text-violet-200"><span className="font-mono text-neutral-600">{formatTimePrecise(cue.time)}</span> {behaviorLabels[cue.cueId]||cue.cueId}</button><button onClick={()=>removeScheduled(cue.id)} className="text-neutral-600 hover:text-red-300">×</button></div>)}</div>:null}
			<div className="grid grid-cols-3 gap-1">{quick.map(id=><button key={id} onClick={()=>trigger(id)} className="inspector-btn">{behaviorLabels[id]}</button>)}</div>
		</InspectorSection>
		<InspectorSection title="Performance FX">
			<Toggle label="Head Tracking" checked={scene.performance.headTracking} onChange={v=>patchPerf({headTracking:v})}/>
			<RangeRow label="Head Track Amount" value={scene.performance.headTrackAmount} min={0} max={1.5} step={.05} onChange={v=>patchPerf({headTrackAmount:v})}/>
			<ColorRow label="Lightning Color" value={scene.performance.lightningColor} onChange={v=>patchPerf({lightningColor:v})}/>
			<RangeRow label="Lightning Power" value={scene.performance.lightningIntensity} min={.2} max={5} step={.05} onChange={v=>patchPerf({lightningIntensity:v})}/>
			<RangeRow label="Lightning Branches" value={scene.performance.lightningBranches} min={1} max={4} step={1} onChange={v=>patchPerf({lightningBranches:Math.round(v)})}/>
			<RangeRow label="Impact Strength" value={scene.performance.impactStrength} min={0} max={2} step={.05} onChange={v=>patchPerf({impactStrength:v})}/>
			<RangeRow label="Fog Burst" value={scene.performance.fogBurst} min={0} max={2} step={.05} onChange={v=>patchPerf({fogBurst:v})}/>
			<RangeRow label="Camera Shake" value={scene.performance.cameraShake} min={0} max={2} step={.05} onChange={v=>patchPerf({cameraShake:v})}/>
			<Toggle label="Screen Shockwave" checked={scene.performance.screenShockwave} onChange={v=>patchPerf({screenShockwave:v})}/>
		</InspectorSection>
		<InspectorSection title="Transform + Camera"><RangeRow label="Position X" value={scene.object.positionX} min={-10} max={10} step={.05} onChange={v=>patch({positionX:v})}/><RangeRow label="Position Y" value={scene.object.positionY} min={-8} max={8} step={.05} onChange={v=>patch({positionY:v})}/><RangeRow label="Position Z" value={scene.object.positionZ} min={-16} max={10} step={.05} onChange={v=>patch({positionZ:v})}/><RangeRow label="Scale" value={scene.object.baseScale} min={.1} max={12} step={.02} onChange={v=>patch({baseScale:v})}/><RangeRow label="Rotate X" value={scene.object.rotationX} min={-3.14} max={3.14} step={.02} onChange={v=>patch({rotationX:v})}/><RangeRow label="Rotate Y" value={scene.object.rotationY} min={-3.14} max={3.14} step={.02} onChange={v=>patch({rotationY:v})}/><RangeRow label="Rotate Z" value={scene.object.rotationZ} min={-3.14} max={3.14} step={.02} onChange={v=>patch({rotationZ:v})}/><RangeRow label="Camera Distance" value={scene.object.cameraDistance} min={3} max={30} step={.1} onChange={v=>patch({cameraDistance:v})}/><RangeRow label="Camera Height" value={scene.object.cameraHeight} min={-6} max={10} step={.05} onChange={v=>patch({cameraHeight:v})}/><RangeRow label="Camera Target Y" value={scene.object.cameraTargetY} min={-5} max={8} step={.05} onChange={v=>patch({cameraTargetY:v})}/><RangeRow label="Camera FOV" value={scene.object.cameraFov} min={20} max={100} step={1} onChange={v=>patch({cameraFov:v})} suffix="°"/></InspectorSection>
		<InspectorSection title="Imported Material"><Toggle label="Override GLB Material" checked={scene.object.materialOverride} onChange={v=>patch({materialOverride:v})}/><ColorRow label="Tint" value={scene.object.materialTint} onChange={v=>patch({materialTint:v})}/><RangeRow label="Metallic" value={scene.object.materialMetalness} min={0} max={1} step={.01} onChange={v=>patch({materialMetalness:v})}/><RangeRow label="Roughness" value={scene.object.materialRoughness} min={0} max={1} step={.01} onChange={v=>patch({materialRoughness:v})}/></InspectorSection>
		<InspectorSection title="Continuous Audio React"><div className="rounded border border-violet-400/15 bg-violet-500/5 p-2 text-[10px] text-violet-100/70">Continuous motion is separate from the performance behaviors above. Keep it subtle and let cues provide the dramatic movement.</div><RangeRow label="Idle Motion" value={scene.object.idleAmount} min={0} max={1} step={.01} onChange={v=>patch({idleAmount:v})}/><RangeRow label="Manual Test Signal" value={scene.object.testSignal} min={0} max={1} step={.01} onChange={v=>patch({testSignal:v})}/><RangeRow label="Sensitivity" value={scene.object.sensitivity} min={.25} max={6} step={.05} onChange={v=>patch({sensitivity:v})}/><RangeRow label="Dead Zone" value={scene.object.deadZone} min={0} max={.5} step={.01} onChange={v=>patch({deadZone:v})}/><RangeRow label="Attack" value={scene.object.attack} min={.02} max={1} step={.02} onChange={v=>patch({attack:v})}/><RangeRow label="Release" value={scene.object.release} min={.02} max={1} step={.02} onChange={v=>patch({release:v})}/><SelectRow label="Body Source" value={scene.object.bodySource} options={AUDIO_SOURCES} onChange={v=>patch({bodySource:v as VisualAudioSource})}/><RangeRow label="Body Motion" value={scene.object.bodyAmount} min={0} max={3} step={.05} onChange={v=>patch({bodyAmount:v})}/><SelectRow label="Arms Source" value={scene.object.armSource} options={AUDIO_SOURCES} onChange={v=>patch({armSource:v as VisualAudioSource})}/><RangeRow label="Arm Motion" value={scene.object.armAmount} min={0} max={3} step={.05} onChange={v=>patch({armAmount:v})}/><RangeRow label="Spring/Recoil" value={scene.object.springAmount} min={0} max={2} step={.05} onChange={v=>patch({springAmount:v})}/><SelectRow label="Glow Source" value={scene.object.glowSource} options={AUDIO_SOURCES} onChange={v=>patch({glowSource:v as VisualAudioSource})}/><ColorRow label="Emissive Color" value={scene.object.emissiveColor} onChange={v=>patch({emissiveColor:v})}/><RangeRow label="Glow" value={scene.object.glowAmount} min={0} max={4} step={.05} onChange={v=>patch({glowAmount:v})}/></InspectorSection>
		<InspectorSection title="3D Grid Stage"><Toggle label="Visible" checked={scene.grid.visible} onChange={v=>patchGrid({visible:v})}/><RangeRow label="Grid Size" value={scene.grid.size} min={6} max={30} step={1} onChange={v=>patchGrid({size:Math.round(v)})}/><RangeRow label="Intensity" value={scene.grid.intensity} min={0} max={1} step={.01} onChange={v=>patchGrid({intensity:v})}/></InspectorSection>
	</>
}
function ParticlesInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){const patch=(p:Partial<VisualSceneState["particles"]>)=>setScene(v=>({...v,particles:{...v.particles,...p}}));return <InspectorSection title="World-Space 3D Particles"><SelectRow label="Emitter" value={scene.particles.emitter} options={PARTICLE_EMITTERS} onChange={v=>patch({emitter:v as VisualParticleEmitter})}/><RangeRow label="Count" value={scene.particles.count} min={100} max={8000} step={100} onChange={v=>patch({count:Math.round(v)})}/><RangeRow label="Size" value={scene.particles.size} min={1} max={18} step={.2} onChange={v=>patch({size:v})}/><RangeRow label="Depth" value={scene.particles.depth} min={2} max={30} step={.25} onChange={v=>patch({depth:v})}/><RangeRow label="Spread" value={scene.particles.spread} min={1} max={20} step={.25} onChange={v=>patch({spread:v})}/><RangeRow label="Velocity" value={scene.particles.speed} min={.01} max={4} step={.05} onChange={v=>patch({speed:v})}/><RangeRow label="Gravity" value={scene.particles.gravity} min={-3} max={3} step={.05} onChange={v=>patch({gravity:v})}/><RangeRow label="Turbulence" value={scene.particles.turbulence} min={0} max={4} step={.05} onChange={v=>patch({turbulence:v})}/><RangeRow label="Orbit" value={scene.particles.orbit} min={-3} max={3} step={.05} onChange={v=>patch({orbit:v})}/><SelectRow label="Audio Source" value={scene.particles.source} options={AUDIO_SOURCES} onChange={v=>patch({source:v as VisualAudioSource})}/><RangeRow label="Audio Amount" value={scene.particles.amount} min={0} max={5} step={.05} onChange={v=>patch({amount:v})}/></InspectorSection>}
function SpectrumInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){const patch=(p:Partial<VisualSceneState["spectrum"]>)=>setScene(v=>({...v,spectrum:{...v.spectrum,...p}}));const apply=(id:string)=>{const preset=SPECTRUM_PRESETS.find(x=>x.id===id);if(preset)patch({preset:id,mode:preset.mode,...preset.patch})};return <><InspectorSection title="Spectrum Presets"><div className="grid grid-cols-3 gap-1">{SPECTRUM_PRESETS.map(p=><button key={p.id} onClick={()=>apply(p.id)} className={`rounded border px-1 py-2 text-[9px] ${scene.spectrum.preset===p.id?"border-violet-300/50 bg-violet-500/20":"border-white/10 bg-white/[.03] hover:bg-white/[.06]"}`}>{p.label}</button>)}</div></InspectorSection><InspectorSection title="Spectrum Controls"><SelectRow label="Mode" value={scene.spectrum.mode} options={SPECTRUM_PRESETS.map(x=>x.mode)} onChange={v=>patch({mode:v as VisualSpectrumMode,preset:"custom"})}/><RangeRow label="Position X" value={scene.spectrum.positionX} min={0} max={1} step={.01} onChange={v=>patch({positionX:v,preset:"custom"})}/><RangeRow label="Position Y" value={scene.spectrum.positionY} min={0} max={1} step={.01} onChange={v=>patch({positionY:v,preset:"custom"})}/><RangeRow label="Scale" value={scene.spectrum.scale} min={.1} max={2} step={.02} onChange={v=>patch({scale:v,preset:"custom"})}/><RangeRow label="Rotation" value={scene.spectrum.rotation} min={-3.14} max={3.14} step={.02} onChange={v=>patch({rotation:v,preset:"custom"})}/><RangeRow label="Height" value={scene.spectrum.height} min={.03} max={.8} step={.01} onChange={v=>patch({height:v,preset:"custom"})}/><RangeRow label="Thickness" value={scene.spectrum.thickness} min={.05} max={1} step={.02} onChange={v=>patch({thickness:v,preset:"custom"})}/><RangeRow label="Smoothing" value={scene.spectrum.smoothing} min={0} max={.98} step={.01} onChange={v=>patch({smoothing:v,preset:"custom"})}/><RangeRow label="Glow" value={scene.spectrum.glow} min={0} max={3} step={.05} onChange={v=>patch({glow:v,preset:"custom"})}/></InspectorSection></>}
function NowPlayingInspector({scene,setScene,session}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;session:DawSessionSnapshot|null}){const patch=(p:Partial<VisualSceneState["nowPlaying"]>)=>setScene(v=>({...v,nowPlaying:{...v.nowPlaying,...p}}));return <InspectorSection title="Broadcast Metadata"><TextRow label="Title" value={scene.nowPlaying.title} onChange={v=>patch({title:v})}/><TextRow label="Artist" value={scene.nowPlaying.artist} onChange={v=>patch({artist:v})}/><TextRow label="Album" value={scene.nowPlaying.album} onChange={v=>patch({album:v})}/><RangeRow label="Position X" value={scene.nowPlaying.positionX} min={0} max={1} step={.01} onChange={v=>patch({positionX:v})}/><RangeRow label="Position Y" value={scene.nowPlaying.positionY} min={0} max={1} step={.01} onChange={v=>patch({positionY:v})}/><RangeRow label="Width" value={scene.nowPlaying.width} min={.15} max={.9} step={.01} onChange={v=>patch({width:v})}/><RangeRow label="Font Scale" value={scene.nowPlaying.fontScale} min={.5} max={3} step={.05} onChange={v=>patch({fontScale:v})}/><SelectRow label="Align" value={scene.nowPlaying.align} options={["left","center","right"]} onChange={v=>patch({align:v as VisualSceneState["nowPlaying"]["align"]})}/>{session?<button onClick={()=>patch({title:session.projectName})} className="inspector-btn w-full">Use DAW project name</button>:null}</InspectorSection>}
function InspectorSection({title,children}:{title:string;children:React.ReactNode}){return <section className="space-y-2 border-t border-white/10 pt-3 first:border-t-0 first:pt-0"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-neutral-500">{title}</div>{children}<style>{`.inspector-btn{border:1px solid rgb(255 255 255 / .1);background:rgb(255 255 255 / .04);border-radius:6px;padding:6px;font-size:10px;color:#d4d4d4}.inspector-btn:hover,.inspector-btn.active{border-color:rgb(167 139 250 / .45);background:rgb(139 92 246 / .14)}`}</style></section>}
function RangeRow({label,value,min,max,step,onChange,suffix=""}:{label:string;value:number;min:number;max:number;step:number;onChange:(v:number)=>void;suffix?:string}){return <label className="block"><div className="mb-1 flex items-center justify-between text-[10px] text-neutral-400"><span>{label}</span><span className="font-mono text-neutral-500">{Number.isInteger(step)?Math.round(value):value.toFixed(step<.1?2:1)}{suffix}</span></div><input type="range" value={value} min={min} max={max} step={step} onChange={e=>onChange(Number(e.target.value))} className="w-full accent-violet-500"/></label>}
function NumberRow({label,value,min,max,step,onChange,suffix=""}:{label:string;value:number;min:number;max?:number;step:number;onChange:(v:number)=>void;suffix?:string}){return <label className="flex items-center justify-between gap-2 text-[10px] text-neutral-400"><span>{label}</span><span className="flex items-center gap-1"><input type="number" value={Number(value.toFixed(2))} min={min} max={max} step={step} onChange={e=>{const raw=Number(e.target.value);const safe=Number.isFinite(raw)?raw:min;onChange(Math.min(max??Number.POSITIVE_INFINITY,Math.max(min,safe)))}} className="w-20 rounded border border-white/10 bg-[#121620] px-2 py-1 text-right text-[10px] text-neutral-100"/>{suffix}</span></label>}
function SelectRow({label,value,options,onChange,labels}:{label:string;value:string;options:readonly string[];onChange:(v:string)=>void;labels?:Record<string,string>}){return <label className="flex items-center justify-between gap-2 text-[10px] text-neutral-400"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)} className="max-w-[170px] rounded border border-white/10 bg-[#121620] px-2 py-1 text-[10px] text-neutral-200">{[...new Set(options)].map(o=><option key={o} value={o}>{labels?.[o]||o}</option>)}</select></label>}
function TextRow({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <label className="block text-[10px] text-neutral-400"><span>{label}</span><input value={value} onChange={e=>onChange(e.target.value)} className="mt-1 w-full rounded border border-white/10 bg-[#121620] px-2 py-1.5 text-xs text-neutral-100"/></label>}
function ColorRow({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <label className="flex items-center justify-between gap-2 text-[10px] text-neutral-400"><span>{label}</span><span className="flex items-center gap-2"><input type="color" value={/^#[0-9a-f]{6}$/i.test(value)?value:"#ffffff"} onChange={e=>onChange(e.target.value)} className="h-6 w-8 rounded border border-white/10 bg-transparent p-0"/><input value={value} onChange={e=>onChange(e.target.value)} className="w-20 rounded border border-white/10 bg-[#121620] px-1.5 py-1 font-mono text-[9px] text-neutral-200"/></span></label>}
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}){return <label className="flex cursor-pointer items-center justify-between text-[10px] text-neutral-400"><span>{label}</span><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} className="accent-violet-500"/></label>}
function PanelHeading({title,action}:{title:string;action?:React.ReactNode}){return <div className="flex h-10 items-center justify-between border-b border-white/10 px-3"><span className="text-[10px] font-bold uppercase tracking-[.18em] text-neutral-500">{title}</span>{action}</div>}
function AddButton({label,onClick}:{label:string;onClick:()=>void}){return <button onClick={onClick} className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] text-neutral-300 hover:border-violet-400/30 hover:bg-violet-500/10">+ {label}</button>}
function AudioMeter({label,value}:{label:string;value:number}){return <div className="w-16 rounded border border-white/10 bg-black/50 px-2 py-1 backdrop-blur"><div className="text-[8px] font-bold tracking-wider text-neutral-500">{label}</div><div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full rounded bg-violet-400 transition-[width] duration-75" style={{width:`${Math.max(0,Math.min(1,value))*100}%`}}/></div></div>}
function StatusPill({label,active,error=false}:{label:string;active:boolean;error?:boolean}){return <span className={`rounded-full border px-2 py-1 text-[9px] font-bold tracking-wider ${error?"border-red-400/30 bg-red-500/10 text-red-300":active?"border-emerald-400/30 bg-emerald-500/10 text-emerald-300":"border-white/10 bg-white/5 text-neutral-500"}`}>{label}</span>}
function layerIcon(layer:VisualLayer){if(layer.type==="media")return layer.mediaKind==="video"?"▶":layer.mediaKind==="model"?"♙":"▧";if(layer.type==="particles")return"✦";if(layer.type==="spectrum")return"▥";if(layer.type==="object")return"♙";if(layer.type==="stage")return"☀";return"T"}
function barsToSeconds(bars:number,s:DawSessionSnapshot){const beatSeconds=(60/Math.max(1,s.bpm))*(4/Math.max(1,s.sigDen));return Math.max(0,bars)*beatSeconds*Math.max(1,s.sigNum)}
function formatTime(seconds:number){if(!Number.isFinite(seconds)||seconds<=0)return"00:00";const whole=Math.max(0,Math.floor(seconds)),m=Math.floor(whole/60),s=whole%60;return`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
function formatTimePrecise(seconds:number){if(!Number.isFinite(seconds)||seconds<0)return"00:00.000";const m=Math.floor(seconds/60),s=Math.floor(seconds%60),ms=Math.floor((seconds-Math.floor(seconds))*1000);return`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(ms).padStart(3,"0")}`}
function readVideoDuration(file:File){return new Promise<number>(resolve=>{const url=URL.createObjectURL(file),video=document.createElement("video");const done=(v:number)=>{URL.revokeObjectURL(url);resolve(Number.isFinite(v)?v:0)};video.preload="metadata";video.onloadedmetadata=()=>done(video.duration);video.onerror=()=>done(0);video.src=url})}
