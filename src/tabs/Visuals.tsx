import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { requestWorldTransport, useWorldPlayer } from "../components/WorldPlayer";
import { getPlaybackOwner, subscribePlaybackOwner, type PlaybackOwner } from "../lib/playbackOwner";
import { extrapolatedTransportPosition, publishLocalVisualAudio, publishLocalVisualTransport, subscribeLocalVisualTransport } from "../lib/visualsRealtime";
import { bridgeApi, type VisualAudioFrame, type VisualScenePreset, type VisualTransportState } from "../lib/bridgeApi";
import { sendDawSessionCommand, subscribeDawSessionSnapshot, type DawSessionSnapshot } from "../lib/dawSessionBus";
import {
	DEFAULT_VISUAL_SCENE,
	HUMANOID_SLOTS,
	PERFORMANCE_BEHAVIORS,
	SPECTRUM_PRESETS,
	createBlankVisualScene,
	makeVisualMaterial,
	makeVisualPrimitive,
	makeVisualShape2D,
	makeVisualSecondary,
	normalizeVisualScene,
	weatherPresetPatch,
	type VisualAudioSource,
	type VisualCameraKeyframe,
	type VisualCameraSegmentEasing,
	type VisualCameraCut,
	type VisualProgramCamera,
	type VisualLayer,
	type VisualLayerType,
	type VisualProjectMode,
	type VisualPostFxModuleType,
	type VisualPrimitiveType,
	type VisualPrimitiveObject,
	type VisualMaterialAsset,
	type VisualShape2D,
	type VisualShape2DType,
	type VisualSecondaryKind,
	type VisualSecondaryDynamic,
	type VisualSkeletalAnimation,
	type VisualSkeletalKeyframe,
	type VisualAnimationCue,
	type VisualAnimationLayer,
	type VisualIKConstraint,
	type VisualHumanoidSlot,
	type VisualParticleEmitter,
	type VisualPerformanceDirectorMode,
	type VisualWeatherPreset,
	type VisualSceneState,
	type VisualAiDirectorStyle,
	type VisualAiDirectorScope,
	type VisualSpectrumMode,
} from "../lib/visualsScene";
import { buildVisualCameraShots, sampleVisualProgramCamera } from "../lib/visualsCamera";
import { visualAnimationCueDuration, visualAnimationSpans } from "../lib/visualsPerformance";
import {
	applyVisualDirectorPlan,
	createVisualDirectorPlan,
	visualDirectorOperationLabel,
	type VisualDirectorPlan,
	type VisualDirectorSongContext,
} from "../lib/visualsDirector";
import {
	buildVisualModulationTargets,
	makeVisualAudioBinding,
	visualModulationSourceValues,
} from "../lib/visualsModulation";
import {
	YSONG_VISUALS_CHANNEL,
	openVisualOutput,
	type VisualModelInfo,
	type VisualImportedAnimationClip,
	type VisualOutputMessage,
	type VisualPerformanceState,
	type VisualOutputStats,
} from "../lib/visualsBus";

const AUDIO_SOURCES: VisualAudioSource[] = ["bass", "mids", "highs", "energy", "kick", "rms", "peak"];
const MODULATION_AUDIO_SOURCES: VisualAudioSource[] = [...AUDIO_SOURCES, "beat", "bar"];
const PARTICLE_EMITTERS: VisualParticleEmitter[] = ["box", "sphere", "ring", "fountain", "tunnel"];
const ZERO_AUDIO: VisualAudioFrame = { sequence:0,timestampUnixMs:0,source:"idle",rms:0,peak:0,bass:0,mids:0,highs:0,energy:0,kick:0,spectrum:Array.from({length:64},()=>0) };
type OutputState = "offline" | "online" | "error";
type SingletonLayerType = Exclude<VisualLayerType, "media" | "primitive" | "shape2d" | "secondary">;
type EditorCameraSnapshot = { position:{x:number;y:number;z:number}; rotation:{x:number;y:number;z:number}; fov:number };

export default function VisualsPane() {
	const world = useWorldPlayer();
	const [scene,setScene]=useState<VisualSceneState>(()=>structuredClone(DEFAULT_VISUAL_SCENE));
	const [selectedId,setSelectedId]=useState("object");
	const [audio,setAudio]=useState<VisualAudioFrame>(ZERO_AUDIO);
	const [audioConnected,setAudioConnected]=useState(false);
	const [session,setSession]=useState<DawSessionSnapshot|null>(null);
	const [transport,setTransport]=useState<VisualTransportState>({source:"idle",playing:false,positionSeconds:0,durationSeconds:0,updatedAt:0});
	const [playbackOwner,setPlaybackOwner]=useState<PlaybackOwner>(()=>getPlaybackOwner());
	const [worldClock,setWorldClock]=useState({trackId:"",positionSeconds:0,durationSeconds:0,playing:false});
	const [stats,setStats]=useState<VisualOutputStats|null>(null);
	const [outputState,setOutputState]=useState<OutputState>("offline");
	const [outputError,setOutputError]=useState("");
	const [importing,setImporting]=useState("");
	const [notice,setNotice]=useState("");
	const [presets,setPresets]=useState<VisualScenePreset<VisualSceneState>[]>([]);
	const [presetName,setPresetName]=useState("");
	const [modelInfo,setModelInfo]=useState<VisualModelInfo|null>(null);
	const [livePerformance,setLivePerformance]=useState<VisualPerformanceState|null>(null);
	const [showAudioMeters,setShowAudioMeters]=useState(false);
	const [previewProgramCamera,setPreviewProgramCamera]=useState(false);
	const [editorCamera,setEditorCamera]=useState<EditorCameraSnapshot>({position:{x:0,y:.35,z:7.4},rotation:{x:0,y:0,z:0},fov:52});
	const [editorFreeRoamActive,setEditorFreeRoamActive]=useState(false);
	const [directorPlan,setDirectorPlan]=useState<VisualDirectorPlan|null>(null);
	const [directorBusy,setDirectorBusy]=useState(false);
	const [directorError,setDirectorError]=useState("");
	const directorUndoRef=useRef<VisualSceneState|null>(null);
	const imageInputRef=useRef<HTMLInputElement|null>(null);
	const videoInputRef=useRef<HTMLInputElement|null>(null);
	const modelInputRef=useRef<HTMLInputElement|null>(null);
	const materialInputRef=useRef<HTMLInputElement|null>(null);
	const sceneReadyRef=useRef(false);

	const refreshLibrary=()=>void bridgeApi.getVisualLibrary<VisualSceneState>().then(r=>setPresets(r.presets||[])).catch(()=>{});
	useEffect(()=>{
		let cancelled=false;
		void bridgeApi.getVisualScene<VisualSceneState>().then(payload=>{
			if(cancelled)return;
			const next=normalizeVisualScene(payload.scene);setScene(next);sceneReadyRef.current=true;
			if(!next.layers.some(l=>l.id===selectedId)&&!next.cameras.some(c=>c.id===selectedId)&&selectedId!=="editor-camera")setSelectedId(next.layers[0]?.id||"");
			if(!payload.scene||(payload.scene as VisualSceneState).version!==21)void bridgeApi.setVisualScene(next).catch(()=>{});
		}).catch(()=>{sceneReadyRef.current=true;void bridgeApi.setVisualScene(DEFAULT_VISUAL_SCENE).catch(()=>{})});
		refreshLibrary();
		return()=>{cancelled=true};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	},[]);
	useEffect(()=>{if(!sceneReadyRef.current)return;const t=window.setTimeout(()=>void bridgeApi.setVisualScene({...scene,updatedAt:Date.now()}).catch(()=>{}),90);return()=>clearTimeout(t)},[scene]);
	useEffect(()=>bridgeApi.subscribeVisualAudio((frame)=>{setAudio(frame);publishLocalVisualAudio(frame)},setAudioConnected),[]);
	useEffect(()=>bridgeApi.subscribeVisualTransport((next)=>{setTransport(prev=>(next.updatedAt||0)>=(prev.updatedAt||0)?next:prev);publishLocalVisualTransport(next)}),[]);
	useEffect(()=>subscribeLocalVisualTransport((next)=>setTransport(prev=>(next.updatedAt||0)>=(prev.updatedAt||0)?next:prev)),[]);
	useEffect(()=>subscribeDawSessionSnapshot(setSession),[]);
	useEffect(()=>subscribePlaybackOwner(setPlaybackOwner),[]);
	useEffect(()=>{
		const onMessage=(event:MessageEvent)=>{
			if(event.origin!==window.location.origin||!event.data||typeof event.data!=="object")return;
			if(event.data.type==="ysong-visual-select"&&typeof event.data.id==="string")setSelectedId(event.data.id);
			if(event.data.type==="ysong-editor-camera"&&event.data.position&&event.data.rotation)setEditorCamera(event.data as EditorCameraSnapshot & {type:string});
			if(event.data.type==="ysong-editor-free-roam")setEditorFreeRoamActive(event.data.active===true);
		};
		window.addEventListener("message",onMessage);return()=>window.removeEventListener("message",onMessage);
	},[]);
	useEffect(()=>{
		let raf=0,lastSample=0;
		const tick=(now:number)=>{
			raf=requestAnimationFrame(tick);
			if(playbackOwner!=="world"||now-lastSample<33)return;
			lastSample=now;
			const element=world.audioRef.current;
			const track=world.current;
			if(!element||!track){setWorldClock(prev=>prev.trackId?{trackId:"",positionSeconds:0,durationSeconds:0,playing:false}:prev);return}
			const next={trackId:track.id,positionSeconds:Number.isFinite(element.currentTime)?element.currentTime:0,durationSeconds:Number.isFinite(element.duration)&&element.duration>0?element.duration:(track.durationSeconds||0),playing:!element.paused&&!element.ended};
			setWorldClock(prev=>prev.trackId===next.trackId&&Math.abs(prev.positionSeconds-next.positionSeconds)<.008&&Math.abs(prev.durationSeconds-next.durationSeconds)<.01&&prev.playing===next.playing?prev:next);
		};
		raf=requestAnimationFrame(tick);
		return()=>cancelAnimationFrame(raf);
	},[playbackOwner,world.audioRef,world.current,world.playing]);
	useEffect(()=>{
		const channel=new BroadcastChannel(YSONG_VISUALS_CHANNEL);let lastSeen=0;
		channel.onmessage=(event:MessageEvent<VisualOutputMessage>)=>{const m=event.data;if(!m||typeof m!=="object")return;lastSeen=Date.now();if(m.type==="visual-output-stats"){setStats(m);setOutputError("");setOutputState("online")}else if(m.type==="visual-output-error"){setOutputError(m.message);setOutputState("error")}else if(m.type==="visual-model-info")setModelInfo(m);else if(m.type==="visual-performance-state")setLivePerformance(m)};
		const heartbeat=window.setInterval(()=>{if(lastSeen&&Date.now()-lastSeen>2500){lastSeen=0;setOutputState("offline");setStats(null)}},500);
		return()=>{clearInterval(heartbeat);channel.close()};
	},[]);

	const selected=scene.layers.find(l=>l.id===selectedId)||null;
	const selectedCamera=scene.cameras.find(camera=>camera.id===selectedId)||null;
	const selectedMaterial=selectedId.startsWith("material:")?scene.materials.find(material=>`material:${material.id}`===selectedId)||null:null;
	const selectedPrimitive=selected?.type==="primitive"?scene.primitives.find(primitive=>primitive.id===selected.entityId)||null:null;
	const selectedShape=selected?.type==="shape2d"?scene.shapes2d.find(shape=>shape.id===selected.entityId)||null:null;
	const selectedSecondary=selected?.type==="secondary"?scene.secondaryDynamics.find(item=>item.id===selected.entityId)||null:null;
	const activeCamera=scene.cameras.find(camera=>camera.id===scene.activeCameraId)||scene.cameras[0]||null;
	const dawSeconds=session?barsToSeconds(session.playheadBar-1,session):0;
	const dawDuration=session?barsToSeconds(session.endBar-1,session):0;
	const worldIsCurrent=playbackOwner==="world";
	const worldClockMatches=!!world.current&&worldClock.trackId===world.current.id;
	const worldFallbackPosition=extrapolatedTransportPosition(transport);
	const positionSeconds=worldIsCurrent?(worldClockMatches?worldClock.positionSeconds:worldFallbackPosition):dawSeconds;
	const durationSeconds=worldIsCurrent?Math.max(1,worldClockMatches&&worldClock.durationSeconds>0?worldClock.durationSeconds:(world.current?.durationSeconds||transport.durationSeconds||scene.timeline.durationSeconds||1)):Math.max(1,dawDuration>0?dawDuration:(scene.timeline.durationSeconds||1));
	const playing=worldIsCurrent?(worldClockMatches?worldClock.playing:transport.playing):!!session?.playing;

	const directorSongContext:VisualDirectorSongContext={
		title:worldIsCurrent?(world.current?.title||transport.title||"YSong World"):(session?.projectName||"Untitled DAW Song"),
		artist:worldIsCurrent?(world.current?.artistName||transport.artist||""):"",
		genre:worldIsCurrent?(world.current?.genre||""):"",
		durationSeconds,
		bpm:Math.max(1,Number(worldIsCurrent?(transport.bpm||120):(session?.bpm||transport.bpm||120))||120),
		sigNum:Math.max(1,Math.round(Number(worldIsCurrent?(transport.sigNum||4):(session?.sigNum||transport.sigNum||4))||4)),
		sigDen:Math.max(1,Math.round(Number(worldIsCurrent?(transport.sigDen||4):(session?.sigDen||transport.sigDen||4))||4)),
	};
	const draftDirectorPlan=async()=>{
		setDirectorBusy(true);setDirectorError("");
		try{const plan=await createVisualDirectorPlan({scene,song:directorSongContext,prompt:scene.director.prompt,style:scene.director.style,scope:scene.director.scope,intensity:scene.director.intensity,seed:scene.director.seed});setDirectorPlan(plan);setSelectedId("ai-director-settings");if(plan.source==="fallback")setNotice("AI service unavailable or invalid response; drafted a deterministic local Director plan instead.");}
		catch(error){setDirectorError(error instanceof Error?error.message:"Could not draft AI Director plan.");}
		finally{setDirectorBusy(false)}
	};
	const applyDirectorDraft=()=>{if(!directorPlan)return;directorUndoRef.current=structuredClone(scene);const next=applyVisualDirectorPlan(scene,directorPlan);setScene(next);setDirectorPlan(null);setNotice(`Applied ${directorPlan.operations.filter(op=>op.enabled).length} Director operation${directorPlan.operations.filter(op=>op.enabled).length===1?"":"s"}. Every result remains editable in the normal scene/timeline tools.`)};
	const undoDirectorApply=()=>{const snapshot=directorUndoRef.current;if(!snapshot)return;setScene(structuredClone(snapshot));directorUndoRef.current=null;setNotice("Undid the last AI Director apply.")};

	const patchLayer=(id:string,patch:Partial<VisualLayer>)=>setScene(prev=>({...prev,layers:prev.layers.map(l=>l.id===id?{...l,...patch}:l)}));
	const patchTimeline=(id:string,patch:Partial<NonNullable<VisualLayer["timeline"]>>)=>setScene(prev=>({...prev,layers:prev.layers.map(l=>l.id===id?{...l,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...l.timeline,...patch}}:l)}));
	const ensureSingleton=(type:SingletonLayerType)=>{
		const existing=scene.layers.find(l=>l.type===type);if(existing){setSelectedId(existing.id);return}
		const spec:{[K in SingletonLayerType]:{id:string;name:string}}={stage:{id:"stage",name:"Stage Lighting & Fog"},sky:{id:"sky",name:"Sky Environment"},particles:{id:"particles",name:"3D Particles"},spectrum:{id:"spectrum",name:"Spectrum"},object:{id:"object",name:"3D Performer"},nowPlaying:{id:"now-playing",name:"Now Playing"},clouds:{id:"clouds",name:"Volumetric Clouds"},weather:{id:"weather",name:"Weather & Atmosphere"}};
		const v=spec[type];const layer:VisualLayer={id:`${v.id}-${crypto.randomUUID().slice(0,6)}`,type,name:v.name,visible:true,opacity:1,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}};
		setScene(prev=>({...prev,layers:[...prev.layers,layer]}));setSelectedId(layer.id);
	};
	const addPrimitive=(primitive:VisualPrimitiveType)=>{const object=makeVisualPrimitive(primitive);const layer:VisualLayer={id:`layer-${object.id}`,type:"primitive",name:object.name,visible:true,locked:false,opacity:1,entityId:object.id,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}};setScene(prev=>({...prev,project:{...prev.project,mode:prev.project.mode==="2d"?"hybrid":prev.project.mode},primitives:[...prev.primitives,object],layers:[...prev.layers,layer]}));setSelectedId(layer.id)};
	const addShape=(shape:VisualShape2DType)=>{const object=makeVisualShape2D(shape);const layer:VisualLayer={id:`layer-${object.id}`,type:"shape2d",name:object.name,visible:true,locked:false,opacity:1,entityId:object.id,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}};setScene(prev=>({...prev,project:{...prev.project,mode:prev.project.mode==="3d"?"hybrid":prev.project.mode},shapes2d:[...prev.shapes2d,object],layers:[...prev.layers,layer]}));setSelectedId(layer.id)};
	const addSecondary=(kind:VisualSecondaryKind)=>{const object=makeVisualSecondary(kind);const layer:VisualLayer={id:`layer-${object.id}`,type:"secondary",name:object.name,visible:true,locked:false,opacity:1,entityId:object.id,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}};setScene(prev=>({...prev,project:{...prev.project,mode:prev.project.mode==="2d"?"hybrid":prev.project.mode},secondaryDynamics:[...prev.secondaryDynamics,object],layers:[...prev.layers,layer]}));setSelectedId(layer.id)};
	const addMaterial=()=>{const material=makeVisualMaterial(`Material ${scene.materials.length+1}`);setScene(prev=>({...prev,materials:[...prev.materials,material]}));setSelectedId(`material:${material.id}`)};
	const newProject=(mode:VisualProjectMode)=>{if((scene.layers.length||scene.primitives.length||scene.assets.length)&&!confirm(`Create a blank ${mode.toUpperCase()} visual project? This wipes the current working visual. Save it first if you want to keep it.`))return;const name=window.prompt("Visual project name",mode==="2d"?"Untitled 2D Visualizer":mode==="3d"?"Untitled 3D Scene":"Untitled Hybrid Visual")?.trim()||"Untitled Visual";const next=createBlankVisualScene(mode,name);setScene(next);setSelectedId(next.cameras[0]?.id||"");setModelInfo(null);setNotice(`Created blank ${mode.toUpperCase()} project “${name}”.`)};
	const removeSelected=()=>{if(selectedMaterial){if(selectedMaterial.id==="material-default")return;setScene(prev=>({...prev,materials:prev.materials.filter(m=>m.id!==selectedMaterial.id),primitives:prev.primitives.map(p=>p.materialId===selectedMaterial.id?{...p,materialId:"material-default"}:p),secondaryDynamics:prev.secondaryDynamics.map(item=>item.materialId===selectedMaterial.id?{...item,materialId:""}:item),object:prev.object.materialId===selectedMaterial.id?{...prev.object,materialId:""}:prev.object}));setSelectedId("");return}if(selectedCamera){removeCamera(selectedCamera.id);return}if(!selected)return;setScene(prev=>{const layers=prev.layers.filter(l=>l.id!==selected.id);const primitives=selected.type==="primitive"&&selected.entityId?prev.primitives.filter(p=>p.id!==selected.entityId):prev.primitives;const shapes2d=selected.type==="shape2d"&&selected.entityId?prev.shapes2d.filter(p=>p.id!==selected.entityId):prev.shapes2d;const secondaryDynamics=selected.type==="secondary"&&selected.entityId?prev.secondaryDynamics.filter(item=>item.id!==selected.entityId):prev.secondaryDynamics;queueMicrotask(()=>setSelectedId(layers[0]?.id||""));return{...prev,layers,primitives,shapes2d,secondaryDynamics}})};
	const moveSelected=(dir:-1|1)=>{if(!selected)return;setScene(prev=>{const a=[...prev.layers],i=a.findIndex(l=>l.id===selected.id),j=i+dir;if(i<0||j<0||j>=a.length)return prev;[a[i],a[j]]=[a[j],a[i]];return{...prev,layers:a}})};
	const addCamera=(fromEditor=false)=>{
		const base=activeCamera||DEFAULT_VISUAL_SCENE.cameras[0];
		const id=`program-camera-${crypto.randomUUID().slice(0,8)}`;
		const forward={x:-Math.sin(editorCamera.rotation.y)*Math.cos(editorCamera.rotation.x),y:Math.sin(editorCamera.rotation.x),z:-Math.cos(editorCamera.rotation.y)*Math.cos(editorCamera.rotation.x)};
		const camera:VisualProgramCamera={...structuredClone(base),id,name:`Program Camera ${scene.cameras.length+1}`,keyframes:[],positionX:fromEditor?editorCamera.position.x:base.positionX,positionY:fromEditor?editorCamera.position.y:base.positionY,positionZ:fromEditor?editorCamera.position.z:base.positionZ,targetX:fromEditor?editorCamera.position.x+forward.x*5:base.targetX,targetY:fromEditor?editorCamera.position.y+forward.y*5:base.targetY,targetZ:fromEditor?editorCamera.position.z+forward.z*5:base.targetZ,rotationX:fromEditor?editorCamera.rotation.x:base.rotationX,rotationY:fromEditor?editorCamera.rotation.y:base.rotationY,rotationZ:fromEditor?editorCamera.rotation.z:base.rotationZ,fov:fromEditor?editorCamera.fov:base.fov};
		setScene(prev=>({...prev,cameras:[...prev.cameras,camera]}));setSelectedId(id);
	};
	const removeCamera=(id:string)=>setScene(prev=>{if(prev.cameras.length<=1)return prev;const cameras=prev.cameras.filter(c=>c.id!==id);const activeCameraId=prev.activeCameraId===id?(cameras[0]?.id||""):prev.activeCameraId;const cameraCuts=prev.cameraCuts.filter(c=>c.cameraId!==id);queueMicrotask(()=>setSelectedId(activeCameraId));return{...prev,cameras,activeCameraId,cameraCuts}});
	const patchCamera=(id:string,patch:Partial<VisualProgramCamera>)=>setScene(prev=>({...prev,cameras:prev.cameras.map(camera=>camera.id===id?{...camera,...patch}:camera)}));
	const cutToCamera=(id:string,time=positionSeconds)=>setScene(prev=>{const cut:VisualCameraCut={id:`cut-${crypto.randomUUID()}`,time:Math.max(0,time),cameraId:id};return{...prev,activeCameraId:prev.activeCameraId||id,cameraCuts:[...prev.cameraCuts.filter(existing=>Math.abs(existing.time-cut.time)>.02),cut].sort((a,b)=>a.time-b.time)}});

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
			const ext=file.name.split(".").pop()?.toLowerCase();
			const modelFormat=(ext==="fbx"||ext==="obj"||ext==="gltf"?ext:"glb") as VisualSceneState["object"]["modelFormat"];
			let selectedObjectId="";
			setScene(prev=>{
				const existing=prev.layers.find(l=>l.type==="object");
				selectedObjectId=existing?.id||`object-${crypto.randomUUID().slice(0,6)}`;
				const layers=existing?prev.layers.map(l=>l.id===existing.id?{...l,visible:true,name:file.name}:l):[...prev.layers,{id:selectedObjectId,type:"object" as const,name:file.name,visible:true,opacity:1,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}}];
				return{...prev,project:{...prev.project,mode:prev.project.mode==="2d"?"hybrid":prev.project.mode},object:{...prev.object,model:"asset",modelUrl:uploaded.url,modelFileName:file.name,modelFormat,animation:"",positionY:0,baseScale:1},layers};
			});
			queueMicrotask(()=>selectedObjectId&&setSelectedId(selectedObjectId));
			setModelInfo(null);setNotice(`${file.name} loaded. YSong will discover meshes${modelFormat==="obj"?"":" / bones / animations"}.`);
		}catch(e){setNotice(e instanceof Error?e.message:"Could not import 3D model.")}finally{setImporting("")}
	};
	const importMaterial=async(file:File)=>{
		setImporting(`Importing ${file.name}…`);setNotice("");
		try{
			const text=await file.text(); const name=file.name.replace(/\.[^.]+$/,"")||"Imported Material"; let material=makeVisualMaterial(name); let parsed=false;
			if(file.name.toLowerCase().endsWith(".json")||file.name.toLowerCase().endsWith(".ymat")){
				try{const raw=JSON.parse(text) as Partial<VisualMaterialAsset>;material={...material,...raw,id:`material-${crypto.randomUUID()}`,name:raw.name||name};parsed=true}catch{/* fall through */}
			}else if(/%YAML|Material:|m_Shader:/i.test(text)){
				const number=(key:string)=>{const m=text.match(new RegExp(`${key}\\s*:\\s*([-+.0-9eE]+)`));return m?Number(m[1]):undefined};
				const color=text.match(/_Color:\s*\{r:\s*([\d.]+),\s*g:\s*([\d.]+),\s*b:\s*([\d.]+),\s*a:\s*([\d.]+)/);
				if(color){const c=[1,2,3].map(i=>Math.max(0,Math.min(255,Math.round(Number(color[i])*255))).toString(16).padStart(2,"0")).join("");material.baseColor=`#${c}`;material.opacity=Number(color[4]);material.transparent=material.opacity<.999;}
				const metallic=number("_Metallic");if(Number.isFinite(metallic))material.metalness=Math.max(0,Math.min(1,metallic!));const gloss=number("_Glossiness");if(Number.isFinite(gloss))material.roughness=1-Math.max(0,Math.min(1,gloss!));const bump=number("_BumpScale");if(Number.isFinite(bump))material.bumpScale=bump!;parsed=true;
			}
			setScene(prev=>({...prev,materials:[...prev.materials,material]}));setSelectedId(`material:${material.id}`);setNotice(parsed?`${file.name} imported. Texture references can be assigned in the Material Inspector.`:`${file.name} was not a readable YSong/Unity text material. A YSong material shell was created; proprietary/binary .mat files need Bridge conversion or manual texture assignment.`);
		}catch(e){setNotice(e instanceof Error?e.message:"Could not import material.")}finally{setImporting("")}
	};
	const saveScene=async()=>{const name=presetName.trim()||window.prompt("Scene name",`Scene ${presets.length+1}`)?.trim();if(!name)return;try{const r=await bridgeApi.saveVisualPreset(name,{...scene,updatedAt:Date.now()});setPresetName("");setPresets(prev=>[r.preset,...prev.filter(p=>p.id!==r.preset.id)]);setNotice(`Saved visual scene “${name}”. It can now be assigned to YSong World playlist songs.`)}catch(e){setNotice(e instanceof Error?e.message:"Could not save scene.")}};
	const loadScene=(preset:VisualScenePreset<VisualSceneState>)=>{const next=normalizeVisualScene(preset.scene);setScene(next);setSelectedId(next.layers[0]?.id||"");setNotice(`Loaded “${preset.name}”.`)};
	const deleteScene=async(preset:VisualScenePreset<VisualSceneState>)=>{if(!confirm(`Delete visual scene “${preset.name}”?`))return;await bridgeApi.deleteVisualPreset(preset.id);refreshLibrary()};

	const seek=(seconds:number)=>{
		const next=Math.max(0,Math.min(durationSeconds,seconds));
		if(worldIsCurrent)requestWorldTransport({type:"seek",seconds:next});
		else sendDawSessionCommand({type:"transport-seek-seconds",value:next});
		setTransport(prev=>({...prev,positionSeconds:next,updatedAt:Date.now()}));
	};
	const togglePlayback=()=>{if(worldIsCurrent)requestWorldTransport({type:playing?"pause":"play"});else sendDawSessionCommand({type:"transport-toggle"})};
	const stopPlayback=()=>{if(worldIsCurrent)requestWorldTransport({type:"stop"});else sendDawSessionCommand({type:"transport-stop"})};
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
		const offset=Math.max(.5,tl.duration||.5);
		if(selected.type==="primitive"&&selected.entityId){
			const source=scene.primitives.find(item=>item.id===selected.entityId);
			if(!source)return;
			const entityId=`primitive-${crypto.randomUUID()}`;
			const object:VisualPrimitiveObject={...structuredClone(source),id:entityId,name:`${source.name} copy`,locked:false,positionX:source.positionX+.5};
			const copy:VisualLayer={...selected,id:`layer-${entityId}`,entityId,name:object.name,locked:false,timeline:{...tl,start:tl.start+offset}};
			setScene(prev=>({...prev,primitives:[...prev.primitives,object],layers:[...prev.layers,copy]}));setSelectedId(copy.id);return;
		}
		if(selected.type==="shape2d"&&selected.entityId){
			const source=scene.shapes2d.find(item=>item.id===selected.entityId);
			if(!source)return;
			const entityId=`shape2d-${crypto.randomUUID()}`;
			const object:VisualShape2D={...structuredClone(source),id:entityId,name:`${source.name} copy`,positionX:Math.min(1.5,source.positionX+.03),positionY:Math.min(1.5,source.positionY+.03)};
			const copy:VisualLayer={...selected,id:`layer-${entityId}`,entityId,name:object.name,locked:false,timeline:{...tl,start:tl.start+offset}};
			setScene(prev=>({...prev,shapes2d:[...prev.shapes2d,object],layers:[...prev.layers,copy]}));setSelectedId(copy.id);return;
		}
		if(selected.type==="secondary"&&selected.entityId){
			const source=scene.secondaryDynamics.find(item=>item.id===selected.entityId);
			if(!source)return;
			const entityId=`secondary-${crypto.randomUUID()}`;
			const object:VisualSecondaryDynamic={...structuredClone(source),id:entityId,name:`${source.name} copy`,offsetX:source.offsetX+.25};
			const copy:VisualLayer={...selected,id:`layer-${entityId}`,entityId,name:object.name,locked:false,timeline:{...tl,start:tl.start+offset}};
			setScene(prev=>({...prev,secondaryDynamics:[...prev.secondaryDynamics,object],layers:[...prev.layers,copy]}));setSelectedId(copy.id);return;
		}
		if(selected.type!=="media"){setNotice("Duplicate currently creates independent copies for media, 3D primitives, 2D shapes, and secondary-physics objects. Scene-wide systems remain singletons.");return}
		const copy:VisualLayer={...selected,id:`media-${crypto.randomUUID()}`,name:`${selected.name} copy`,locked:false,timeline:{...tl,start:tl.start+offset}};
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
		<input ref={modelInputRef} type="file" accept="model/gltf-binary,model/gltf+json,.glb,.gltf,.fbx,.obj" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void importModel(f);e.currentTarget.value=""}}/>
		<input ref={materialInputRef} type="file" accept=".ymat,.mat,.json,text/plain,application/json" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void importMaterial(f);e.currentTarget.value=""}}/>
		<header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0e1118] px-4">
			<div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-400">YSong Visual Broadcast Engine</div><div className="truncate text-sm font-semibold">Visual DAW <span className="ml-2 text-[10px] font-normal text-neutral-500">Phase 15 Cumulative</span> <span className="ml-2 rounded bg-violet-500/10 px-1.5 py-.5 text-[9px] font-normal uppercase tracking-wider text-violet-300">{scene.project.mode}</span></div></div>
			<div className="ml-auto flex items-center gap-2"><StatusPill label={audioConnected?`AUDIO ${audio.source.toUpperCase()}`:"AUDIO OFFLINE"} active={audioConnected}/><StatusPill label={outputState==="online"&&stats?`${stats.fps.toFixed(1)} FPS`:outputState.toUpperCase()} active={outputState==="online"} error={outputState==="error"}/><button onClick={()=>setPreviewProgramCamera(v=>!v)} className={`rounded-md border px-3 py-1.5 text-xs ${previewProgramCamera?"border-cyan-400/40 bg-cyan-500/15 text-cyan-100":"border-white/10 bg-white/5 text-neutral-400 hover:bg-white/10"}`} title="Switch the embedded preview between the editor free-roam camera and the final Program/OBS camera">{previewProgramCamera?"Program Camera":"Editor Camera"}</button><button onClick={()=>setShowAudioMeters(v=>!v)} className={`rounded-md border px-3 py-1.5 text-xs ${showAudioMeters?"border-violet-400/40 bg-violet-500/15 text-violet-100":"border-white/10 bg-white/5 text-neutral-400 hover:bg-white/10"}`} title="Audio analysis meters are hidden by default">{showAudioMeters?"Hide Meters":"Show Meters"}</button><button onClick={()=>void copyObsSource()} className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">Copy OBS Source</button><button onClick={()=>openVisualOutput()} className="rounded-md border border-violet-400/40 bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-100">Open Program Output</button></div>
		</header>
		<div className="grid min-h-0 flex-1 grid-cols-[252px_minmax(0,1fr)_330px] grid-rows-[minmax(0,1fr)_250px]">
			<aside className="min-h-0 overflow-auto border-r border-white/10 bg-[#0b0e14]">
				<PanelHeading title="Project" action={<span className="text-[9px] uppercase text-neutral-600">{scene.project.mode}</span>}/>
				<div className="space-y-2 border-b border-white/10 p-3"><div className="truncate text-xs font-semibold text-neutral-200">{scene.project.name}</div><div className="grid grid-cols-3 gap-1"><button onClick={()=>newProject("2d")} className="inspector-btn">New 2D</button><button onClick={()=>newProject("3d")} className="inspector-btn">New 3D</button><button onClick={()=>newProject("hybrid")} className="inspector-btn">New Hybrid</button></div><div className="grid grid-cols-3 gap-1"><button onClick={()=>setSelectedId("renderer-settings")} className="inspector-btn">Renderer</button><button onClick={()=>setSelectedId("postfx-settings")} className="inspector-btn">Post FX</button><button onClick={()=>setSelectedId("physics-settings")} className="inspector-btn">Physics</button><button onClick={()=>setSelectedId("wind-settings")} className="inspector-btn">Wind</button><button onClick={()=>setSelectedId("audio-modulation-settings")} className="inspector-btn">Audio</button><button onClick={()=>setSelectedId("ai-director-settings")} className="inspector-btn">AI Director</button></div></div>
				<PanelHeading title="Visual Library"/>
				<div className="p-3"><div className="flex gap-1"><input value={presetName} onChange={e=>setPresetName(e.target.value)} placeholder="Scene name" className="min-w-0 flex-1 rounded border border-white/10 bg-[#121620] px-2 py-1.5 text-xs"/><button onClick={()=>void saveScene()} className="rounded border border-violet-400/30 bg-violet-500/10 px-2 text-[10px]">SAVE</button></div><div className="mt-2 max-h-28 space-y-1 overflow-auto">{presets.map(p=><div key={p.id} className="flex items-center gap-1 rounded bg-white/[.03] px-1"><button onClick={()=>loadScene(p)} className="min-w-0 flex-1 truncate px-1 py-1.5 text-left text-[10px] hover:text-violet-300">{p.name}</button><button onClick={()=>void deleteScene(p)} className="px-1 text-[10px] text-neutral-600 hover:text-red-300">×</button></div>)}{!presets.length?<div className="text-[10px] text-neutral-600">Save scenes here, then assign them to playlist songs in YSong World.</div>:null}</div></div>
				<PanelHeading title="Media Bin" action={<span className="text-[9px] text-neutral-600">{scene.assets.length} assets</span>}/>
				<div className="max-h-36 space-y-1 overflow-auto px-2 py-2">{scene.assets.map(asset=><div key={asset.id} className="flex items-center gap-1 rounded border border-white/5 bg-white/[.025] px-1.5 py-1"><span className="w-4 text-center text-[10px] text-neutral-500">{asset.kind==="video"?"▶":"▧"}</span><button onClick={()=>addAssetToTimeline(asset,positionSeconds)} className="min-w-0 flex-1 truncate text-left text-[10px] hover:text-violet-300" title="Add a new clip at the playhead">{asset.name}</button>{asset.duration>0?<span className="text-[8px] text-neutral-600">{formatTime(asset.duration)}</span>:null}<button onClick={()=>removeAsset(asset.id)} className="px-1 text-[10px] text-neutral-700 hover:text-red-300" title="Remove from media bin">×</button></div>)}{scene.assets.length===0?<div className="px-1 text-[10px] text-neutral-600">Import an image or video. It stays here so you can reuse it on the timeline without uploading it again.</div>:null}</div>
				<PanelHeading title="Materials" action={<div className="flex gap-1"><button onClick={addMaterial} className="text-[9px] text-neutral-500 hover:text-violet-300">+ NEW</button><button onClick={()=>materialInputRef.current?.click()} className="text-[9px] text-neutral-500 hover:text-violet-300">IMPORT</button></div>}/>
				<div className="grid max-h-44 grid-cols-3 gap-2 overflow-auto border-b border-white/10 p-2">{scene.materials.map(material=><button key={material.id} onClick={()=>setSelectedId(`material:${material.id}`)} className={`group rounded border p-1.5 text-center ${selectedId===`material:${material.id}`?"border-violet-300/50 bg-violet-500/10":"border-white/10 bg-white/[.025] hover:border-white/20"}`} title={`${material.name} · click to edit`}><MaterialSphere material={material}/><div className="mt-1 truncate text-[8px] text-neutral-400">{material.name}</div></button>)}</div>
				<PanelHeading title="Scene" action={<div className="flex gap-2"><button onClick={()=>moveSelected(-1)} disabled={!selected} className="text-[10px] text-neutral-500 disabled:opacity-20">↑</button><button onClick={()=>moveSelected(1)} disabled={!selected} className="text-[10px] text-neutral-500 disabled:opacity-20">↓</button><button onClick={removeSelected} disabled={selectedId==="editor-camera"||!!selectedCamera&&scene.cameras.length<=1} className="text-[10px] text-neutral-500 hover:text-red-300 disabled:opacity-20">REMOVE</button></div>}/>
				<div className="space-y-1 px-2 pb-3">
					{[["renderer-settings","▤","Renderer",`${scene.renderer.antialiasMode.toUpperCase()} · ${Math.round(scene.renderer.renderScale*100)}%`],["postfx-settings","◈","Post FX","Studio stack"],["physics-settings","◌","Physics",scene.physics.mode.toUpperCase()],["wind-settings","➤","World Wind",scene.wind.enabled?`${scene.wind.strength.toFixed(1)} FORCE`:"OFF"],["audio-modulation-settings","♫","Audio Modulation",`${scene.audioModulation.bindings.length} MAP${scene.audioModulation.bindings.length===1?"":"S"}`],["ai-director-settings","✦","AI Director",scene.director.lastPlanSource?`${scene.director.lastPlanSource.toUpperCase()} · ${scene.director.style.toUpperCase()}`:"READY"]] .map(([id,icon,name,meta])=><button key={id} onClick={()=>setSelectedId(id)} className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs ${selectedId===id?"border-violet-400/40 bg-violet-500/15":"border-transparent hover:bg-white/5"}`}><span className="w-4 text-center text-[11px] text-violet-300">{icon}</span><span className="min-w-0 flex-1 truncate">{name}</span><span className="text-[8px] uppercase text-neutral-600">{meta}</span></button>)}
					<button onClick={()=>setSelectedId("editor-camera")} className={`flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left text-xs ${selectedId==="editor-camera"?"border-amber-400/40 bg-amber-500/10":"border-transparent hover:bg-white/5"}`}><span className="mt-.5 w-4 text-center text-[11px] text-amber-300">⌖</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate">Editor Camera</span><span className="text-[8px] uppercase tracking-wider text-neutral-600">EDITOR ONLY</span></span><span className="mt-1 block truncate font-mono text-[8px] text-neutral-600">P {editorCamera.position.x.toFixed(1)} {editorCamera.position.y.toFixed(1)} {editorCamera.position.z.toFixed(1)} · R {(editorCamera.rotation.x*180/Math.PI).toFixed(0)} {(editorCamera.rotation.y*180/Math.PI).toFixed(0)} {(editorCamera.rotation.z*180/Math.PI).toFixed(0)}°</span></span></button>
					<div className="mt-2 flex items-center justify-between px-1 text-[9px] font-bold uppercase tracking-[.16em] text-neutral-600"><span>Cameras</span><div className="flex gap-1"><button onClick={()=>addCamera(false)} className="rounded border border-white/10 px-1.5 py-.5 hover:text-cyan-200" title="Add program camera">+ CAM</button><button onClick={()=>addCamera(true)} className="rounded border border-white/10 px-1.5 py-.5 hover:text-cyan-200" title="Create a program camera from the editor view">FROM VIEW</button></div></div>
					{scene.cameras.map(camera=><button key={camera.id} onClick={()=>setSelectedId(camera.id)} className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs ${selectedId===camera.id?"border-cyan-400/40 bg-cyan-500/12":"border-transparent hover:bg-white/5"}`}><span className="w-4 text-center text-[11px] text-cyan-300">▣</span><span className="min-w-0 flex-1 truncate">{camera.name}</span>{scene.activeCameraId===camera.id?<span className="text-[8px] font-bold text-emerald-400">MASTER</span>:null}<span onClick={e=>{e.stopPropagation();patchCamera(camera.id,{enabled:!camera.enabled})}} className={camera.enabled?"text-emerald-400":"text-neutral-600"} title="Program camera enabled">{camera.enabled?"●":"○"}</span></button>)}
					<div className="my-2 border-t border-white/10"/>
					{scene.layers.map(layer=><button key={layer.id} onClick={()=>setSelectedId(layer.id)} className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs ${selectedId===layer.id?"border-violet-400/40 bg-violet-500/15":"border-transparent hover:bg-white/5"}`}><span className="w-4 text-center text-[11px] text-neutral-500">{layerIcon(layer)}</span><span className="min-w-0 flex-1 truncate">{layer.name}</span><span onClick={e=>{e.stopPropagation();patchLayer(layer.id,{locked:!layer.locked})}} className={layer.locked?"text-amber-300":"text-neutral-700"} title={layer.locked?"Unlock":"Lock"}>{layer.locked?"▣":"▢"}</span><span onClick={e=>{e.stopPropagation();patchLayer(layer.id,{visible:!layer.visible})}} className={layer.visible?"text-emerald-400":"text-neutral-600"}>{layer.visible?"●":"○"}</span></button>)}
				</div>
				<div className="border-t border-white/10 p-3"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-neutral-500">Add / Create</div><div className="grid grid-cols-2 gap-1.5"><AddButton label="Image" onClick={()=>imageInputRef.current?.click()}/><AddButton label="Video" onClick={()=>videoInputRef.current?.click()}/><AddButton label="Spectrum" onClick={()=>ensureSingleton("spectrum")}/><AddButton label="Now Playing" onClick={()=>ensureSingleton("nowPlaying")}/>{scene.project.mode!=="2d"?<><AddButton label="3D Model" onClick={()=>modelInputRef.current?.click()}/><AddButton label="Stage" onClick={()=>ensureSingleton("stage")}/><AddButton label="Sky" onClick={()=>ensureSingleton("sky")}/><AddButton label="Clouds" onClick={()=>ensureSingleton("clouds")}/><AddButton label="Weather" onClick={()=>ensureSingleton("weather")}/><AddButton label="3D Particles" onClick={()=>ensureSingleton("particles")}/></>:null}{scene.project.mode!=="3d"?<><AddButton label="2D Rectangle" onClick={()=>addShape("rectangle")}/><AddButton label="2D Ellipse" onClick={()=>addShape("ellipse")}/><AddButton label="2D Line" onClick={()=>addShape("line")}/></>:null}</div>{scene.project.mode!=="2d"?<><div className="mb-2 mt-4 text-[9px] font-bold uppercase tracking-[.15em] text-neutral-600">3D Primitives</div><div className="grid grid-cols-3 gap-1">{(["box","sphere","icosphere","cylinder","cone","capsule","plane","torus","pyramid"] as VisualPrimitiveType[]).map(type=><button key={type} onClick={()=>addPrimitive(type)} className="inspector-btn capitalize">{type}</button>)}</div><div className="mb-2 mt-4 text-[9px] font-bold uppercase tracking-[.15em] text-neutral-600">Secondary Physics</div><div className="grid grid-cols-2 gap-1">{(["hair","cloth","cape","rope","chain","tentacle","wings","springBone"] as VisualSecondaryKind[]).map(type=><button key={type} onClick={()=>addSecondary(type)} className="inspector-btn capitalize">{type==="springBone"?"Spring Bone":type}</button>)}</div></>:null}{importing?<div className="mt-3 text-[10px] text-violet-300">{importing}</div>:null}</div>
			</aside>

			<main className="relative min-h-0 overflow-hidden bg-[#050609] p-4"><div className="absolute left-6 top-5 z-10 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-neutral-400"><span>Live Viewport</span><span className="rounded bg-black/50 px-1.5 py-.5 text-neutral-500">960 × 540 PREVIEW</span><span className="rounded bg-black/50 px-1.5 py-.5 text-neutral-600">{previewProgramCamera?"PROGRAM/OBS CAMERA PREVIEW · SELECT CAMERAS IN SCENE":editorFreeRoamActive?"FREE ROAM ACTIVE · ESC/CLICK EXIT · WASD + MOUSE · Q/E VERTICAL":"CLICK EMPTY VIEWPORT FOR FREE ROAM · WASD + MOUSE · WHEEL DOLLY · MMB PAN"}</span></div><div className="grid h-full place-items-center"><div className="relative aspect-video w-full max-w-[min(100%,1200px)] overflow-hidden rounded-lg border border-white/10 bg-black"><iframe title="YSong Visuals live viewport" src={`/visual-output?embedded=1${previewProgramCamera?"&program=1":""}`} className="absolute inset-0 h-full w-full border-0"/></div></div>{showAudioMeters?<div className="absolute bottom-5 left-6 right-6 flex items-end gap-2"><AudioMeter label="BASS" value={audio.bass}/><AudioMeter label="MIDS" value={audio.mids}/><AudioMeter label="HIGHS" value={audio.highs}/><AudioMeter label="ENERGY" value={audio.energy}/><AudioMeter label="KICK" value={audio.kick}/></div>:null}</main>

			<aside className="min-h-0 overflow-auto border-l border-white/10 bg-[#0b0e14]"><PanelHeading title="Stability Diagnostics"/><div className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-white/10 p-3 text-[9px]"><span className="text-neutral-600">Playback owner</span><span className="text-right font-semibold text-violet-300">{playbackOwner.toUpperCase()}</span><span className="text-neutral-600">Bridge transport</span><span className="truncate text-right">{transport.source.toUpperCase()} {transport.playing?"PLAYING":"STOPPED"}</span><span className="text-neutral-600">Master timeline</span><span className="truncate text-right">{worldIsCurrent?"WORLD":"DAW"} {formatTimePrecise(positionSeconds)} / {formatTime(durationSeconds)}</span><span className="text-neutral-600">Audio analyzer</span><span className="text-right">{audioConnected?audio.source.toUpperCase():"OFFLINE"}</span><span className="text-neutral-600">Program output</span><span className="text-right">{outputState}{stats?` ${stats.fps.toFixed(1)}fps`:""}</span><span className="text-neutral-600">Renderer quality</span><span className="text-right">{stats?`${stats.qualityTier.toUpperCase()} · ${Math.round(stats.renderScale*100)}%`:"—"}</span><span className="text-neutral-600">Internal render</span><span className="text-right">{stats?`${stats.internalWidth}×${stats.internalHeight}`:"—"}</span><span className="text-neutral-600">Visible layers</span><span className="text-right">{scene.layers.filter(l=>l.visible).length}/{scene.layers.length}</span><span className="text-neutral-600">Grid</span><span className="text-right">{scene.layers.some(l=>l.type==="stage"&&l.visible)&&scene.grid.visible?"VISIBLE":"HIDDEN"}</span><span className="text-neutral-600">Particles</span><span className="text-right">{scene.layers.some(l=>l.type==="particles"&&l.visible)?"VISIBLE":"HIDDEN"}</span><span className="text-neutral-600">Weather</span><span className="text-right">{scene.layers.some(l=>l.type==="weather"&&l.visible)?scene.weather.preset.toUpperCase():"HIDDEN"}</span><span className="text-neutral-600">World wind</span><span className="text-right">{scene.wind.enabled?`${scene.wind.strength.toFixed(1)} · ${scene.wind.affectsPhysics?"PHYS":"VIS"}`:"OFF"}</span><span className="text-neutral-600">Performer</span><span className="text-right">{scene.layers.some(l=>l.type==="object"&&l.visible)?"VISIBLE":"HIDDEN"}</span><span className="text-neutral-600">Animation clips</span><span className="text-right">{scene.animationCues.length} · {scene.animations.length} LIB</span><span className="text-neutral-600">IK constraints</span><span className="text-right">{scene.ikConstraints.filter(c=>c.enabled).length}/{scene.ikConstraints.length} ACTIVE</span><span className="text-neutral-600">Secondary physics</span><span className="text-right">{scene.secondaryDynamics.filter(item=>item.enabled).length}/{scene.secondaryDynamics.length} ACTIVE</span><span className="text-neutral-600">AI Director</span><span className="text-right">{scene.director.lastPlanSource?`${scene.director.lastPlanSource.toUpperCase()} · ${scene.director.style.toUpperCase()}`:"READY"}</span></div>{worldIsCurrent?<><PanelHeading title="Broadcast Monitor"/><div className="border-b border-white/10 p-3 text-[10px]"><div className="rounded-lg border border-violet-400/20 bg-violet-500/5 p-2"><div className="flex items-center justify-between gap-2"><span className="font-bold uppercase tracking-[.16em] text-violet-300">{transport.broadcastProgramName||transport.playlistName||"YSong World"}</span><span className="rounded bg-white/5 px-1.5 py-.5 text-[9px] uppercase tracking-wider text-neutral-400">{transport.broadcastKind||"ad-hoc"}</span></div><div className="mt-1 flex items-center justify-between gap-2 text-neutral-600"><span>{transport.broadcastKind==="radio"?"YSong Radio":transport.playlistName||"World playback"}</span><span>{transport.transitionMode||"regular"}</span></div><div className="mt-2 truncate text-xs font-semibold text-neutral-100">{transport.title||world.current?.title||"No track"}</div><div className="truncate text-neutral-500">Scene: {transport.visualSceneName||"Current / fallback"}</div>{transport.broadcastBranding?.enabled?<div className="mt-1 truncate text-[9px] text-cyan-300/70">Branding: {transport.broadcastBranding.showStationBug?transport.broadcastBranding.stationLabel||"Program bug":"bug off"} · Now Playing {transport.broadcastBranding.showNowPlaying?"on":"off"} · Up Next {transport.broadcastBranding.showNextUp?"on":"off"}</div>:null}{transport.nextTitle?<div className="mt-2 rounded border border-white/5 bg-black/20 px-2 py-1.5"><span className="text-neutral-600">UP NEXT</span><div className="truncate text-neutral-300">{transport.nextTitle}</div></div>:null}<div className="mt-2 grid grid-cols-2 gap-2"><div><div className="flex justify-between text-neutral-600"><span>Audio</span><span>{Math.round((transport.audioTransitionProgress||0)*100)}%</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-cyan-400" style={{width:`${Math.max(0,Math.min(1,transport.audioTransitionProgress||0))*100}%`}}/></div></div><div><div className="flex justify-between text-neutral-600"><span>{transport.visualTransition||"cut"}</span><span>{transport.visualTransitionSeconds?.toFixed(1)||"0.0"}s</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-violet-400" style={{width:`${Math.max(0,Math.min(1,transport.transitionProgress||0))*100}%`}}/></div></div></div></div></div></>:null}<PanelHeading title="Inspector"/>{selectedId==="renderer-settings"?<RendererInspector scene={scene} setScene={setScene} stats={stats}/>:selectedId==="postfx-settings"?<PostFxInspector scene={scene} setScene={setScene} onNotice={setNotice}/>:selectedId==="physics-settings"?<PhysicsInspector scene={scene} setScene={setScene}/>:selectedId==="wind-settings"?<WindInspector scene={scene} setScene={setScene}/>:selectedId==="audio-modulation-settings"?<AudioModulationInspector scene={scene} setScene={setScene} audio={audio} transport={transport} position={positionSeconds}/>:selectedId==="ai-director-settings"?<AiDirectorInspector scene={scene} setScene={setScene} song={directorSongContext} plan={directorPlan} setPlan={setDirectorPlan} busy={directorBusy} error={directorError} onDraft={draftDirectorPlan} onApply={applyDirectorDraft} onUndo={undoDirectorApply} canUndo={!!directorUndoRef.current}/>:selectedMaterial?<MaterialInspector material={selectedMaterial} scene={scene} setScene={setScene} onNotice={setNotice}/>:selectedCamera?<CameraInspector camera={selectedCamera} scene={scene} setScene={setScene} position={positionSeconds} duration={durationSeconds} editorCamera={editorCamera} seek={seek} onRemove={()=>removeCamera(selectedCamera.id)} onCut={()=>cutToCamera(selectedCamera.id)}/>:selectedId==="editor-camera"?<EditorCameraInspector snapshot={editorCamera} onCreateCamera={()=>addCamera(true)}/>:selected?<div className="space-y-5 p-3"><div><div className="text-sm font-semibold">{selected.name}</div><div className="mt-.5 text-[10px] uppercase tracking-[.16em] text-neutral-500">{selected.type==="media"?selected.mediaKind:selected.type}</div></div><InspectorSection title="Layer"><Toggle label="Visible" checked={selected.visible} onChange={v=>patchLayer(selected.id,{visible:v})}/><Toggle label="Locked" checked={selected.locked===true} onChange={v=>patchLayer(selected.id,{locked:v})}/><RangeRow label="Opacity" value={selected.opacity} min={0} max={1} step={.01} onChange={v=>patchLayer(selected.id,{opacity:v})}/>{selected.type==="media"?<SelectRow label="Blend" value={selected.blendMode||"normal"} options={["normal","screen","add","multiply"]} onChange={v=>patchLayer(selected.id,{blendMode:v as VisualLayer["blendMode"]})}/>:null}</InspectorSection>{selected.type==="media"?<MediaInspector layer={selected} patch={p=>patchLayer(selected.id,p)} patchTimeline={p=>patchTimeline(selected.id,p)} split={splitSelected} duplicate={duplicateSelected}/>:<LayerTimelineInspector layer={selected} patchTimeline={p=>patchTimeline(selected.id,p)} duration={durationSeconds}/>} {selected.type==="stage"?<StageInspector scene={scene} setScene={setScene}/>:null}{selected.type==="sky"?<SkyInspector scene={scene} setScene={setScene}/>:null}{selected.type==="clouds"?<CloudsInspector scene={scene} setScene={setScene}/>:null}{selected.type==="weather"?<WeatherInspector scene={scene} setScene={setScene}/>:null}{selected.type==="object"?<ObjectInspector scene={scene} setScene={setScene} info={modelInfo} live={livePerformance} position={positionSeconds} onImport={()=>modelInputRef.current?.click()} onNotice={setNotice}/>:null}{selected.type==="primitive"&&selectedPrimitive?<PrimitiveInspector primitive={selectedPrimitive} scene={scene} setScene={setScene}/>:null}{selected.type==="shape2d"&&selectedShape?<Shape2DInspector shape={selectedShape} scene={scene} setScene={setScene}/>:null}{selected.type==="secondary"&&selectedSecondary?<SecondaryDynamicsInspector item={selectedSecondary} scene={scene} setScene={setScene} info={modelInfo}/>:null}{selected.type==="particles"?<ParticlesInspector scene={scene} setScene={setScene}/>:null}{selected.type==="spectrum"?<SpectrumInspector scene={scene} setScene={setScene}/>:null}{selected.type==="nowPlaying"?<NowPlayingInspector scene={scene} setScene={setScene} session={session}/>:null}</div>:<div className="p-4 text-xs text-neutral-600">Select a scene object.</div>}{notice||outputError?<div className="m-3 rounded border border-amber-400/20 bg-amber-500/5 p-2 text-[10px] leading-relaxed text-amber-100">{outputError||notice}</div>:null}</aside>

			<section className="col-span-3 min-h-0 border-t border-white/10 bg-[#0a0d13]"><VisualTimeline scene={scene} setScene={setScene} selectedId={selectedId} setSelectedId={setSelectedId} position={positionSeconds} duration={durationSeconds} playing={playing} source={worldIsCurrent?"YSong World":"DAW"} title={worldIsCurrent?(world.current?.title||transport.title||"YSong World"):(session?.projectName||"No active song")} seek={seek} toggle={togglePlayback} stop={stopPlayback} previous={worldIsCurrent?()=>requestWorldTransport({type:"previous"}):undefined} next={worldIsCurrent?()=>requestWorldTransport({type:"next"}):undefined} session={worldIsCurrent?null:session}/></section>
		</div>
	</div>;
}

type TimelineTool = "select" | "pencil" | "razor" | "erase" | "hand";

function VisualTimeline({scene,setScene,selectedId,setSelectedId,position,duration,playing,source,title,seek,toggle,stop,previous,next,session}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;selectedId:string;setSelectedId:(id:string)=>void;position:number;duration:number;playing:boolean;source:string;title:string;seek:(s:number)=>void;toggle:()=>void;stop:()=>void;previous?:()=>void;next?:()=>void;session:DawSessionSnapshot|null}){
	const scrollRef=useRef<HTMLDivElement|null>(null);
	const labelScrollRef=useRef<HTMLDivElement|null>(null);
	const scrubbingRef=useRef(false);
	const [tool,setTool]=useState<TimelineTool>("select");
	const [selectedCueId,setSelectedCueId]=useState("");
	const [selectedCameraKeyframeId,setSelectedCameraKeyframeId]=useState("");
	const [selectedCameraCutId,setSelectedCameraCutId]=useState("");
	const [selectedAnimationCueId,setSelectedAnimationCueId]=useState("");
	const [selectedIkKeyId,setSelectedIkKeyId]=useState("");
	const pxPerSecond=10*Math.max(.5,scene.timeline.zoom);
	const trackWidth=Math.max(1100,duration*pxPerSecond);
	const playX=Math.max(0,Math.min(trackWidth,position*pxPerSecond));
	const beatSeconds=session?(60/Math.max(1,session.bpm))*(4/Math.max(1,session.sigDen)):0;
	const barSeconds=session?beatSeconds*Math.max(1,session.sigNum):0;
	const snapInterval=scene.timeline.snapMode==="beat"&&beatSeconds>0?beatSeconds:scene.timeline.snapMode==="bar"&&barSeconds>0?barSeconds:scene.timeline.snapSeconds;
	const snapTime=(value:number,ignoreId="")=>{
		let v=Math.max(0,value);
		if(snapInterval>0)v=Math.round(v/snapInterval)*snapInterval;
		const magnets=[position,...scene.timeline.markers.map(m=>m.time),...scene.performance.timelineCues.filter(c=>c.id!==ignoreId).map(c=>c.time),...scene.cameras.flatMap(c=>c.keyframes.filter(k=>k.id!==ignoreId).map(k=>k.time)),...scene.cameraCuts.filter(c=>c.id!==ignoreId).map(c=>c.time),...scene.animationCues.filter(c=>c.id!==ignoreId).flatMap(c=>{const animation=scene.animations.find(a=>a.id===c.animationId);const span=visualAnimationCueDuration(c,animation);return[c.time,c.time+span]}),...scene.ikConstraints.flatMap(c=>c.weightKeys.filter(k=>k.id!==ignoreId).map(k=>k.time)),...scene.layers.flatMap(l=>{const tl=l.timeline;if(!tl||tl.duration<=0)return[];return[tl.start,tl.start+tl.duration]})];
		for(const point of magnets)if(Math.abs(v-point)<=Math.max(.04,6/pxPerSecond)){v=point;break}
		return Math.max(0,Math.min(duration,v));
	};
	const rulerStep=pxPerSecond>=30?5:pxPerSecond>=12?10:20;
	const rulerTicks=Array.from({length:Math.ceil(duration/rulerStep)+2},(_,i)=>i*rulerStep);
	const musicalLines=session&&beatSeconds>0?Array.from({length:Math.min(3000,Math.ceil(duration/beatSeconds)+1)},(_,i)=>i*beatSeconds):[];

	const timeFromClientX=(clientX:number,element:HTMLElement)=>{
		const rect=element.getBoundingClientRect();
		const x=clientX-rect.left+(scrollRef.current?.scrollLeft||0);
		return Math.max(0,Math.min(duration,x/pxPerSecond));
	};
	const addQuickMarker=(time:number)=>setScene(prev=>({...prev,timeline:{...prev.timeline,markers:[...prev.timeline.markers,{id:`marker-${crypto.randomUUID()}`,time,label:`Cue ${prev.timeline.markers.length+1}`}]}}));
	const rulerPointerDown=(e:React.PointerEvent<HTMLDivElement>)=>{
		if(e.button!==0)return;
		e.preventDefault();
		if(tool==="pencil"){addQuickMarker(snapTime(timeFromClientX(e.clientX,e.currentTarget)));return}
		if(tool==="hand"){startHandPan(e);return}
		scrubbingRef.current=true;
		e.currentTarget.setPointerCapture(e.pointerId);
		seek(snapTime(timeFromClientX(e.clientX,e.currentTarget)));
	};
	const rulerPointerMove=(e:React.PointerEvent<HTMLDivElement>)=>{if(scrubbingRef.current)seek(snapTime(timeFromClientX(e.clientX,e.currentTarget)))};
	const rulerPointerUp=(e:React.PointerEvent<HTMLDivElement>)=>{scrubbingRef.current=false;try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{/* already released */}};

	const setTimelineZoom=(nextZoom:number,clientX?:number)=>{
		const next=Math.max(.5,Math.min(8,Math.round(nextZoom*4)/4));
		if(Math.abs(next-scene.timeline.zoom)<.001)return;
		const scroller=scrollRef.current;
		let nextScroll:number|null=null;
		if(scroller){
			const rect=scroller.getBoundingClientRect();
			const anchor=clientX==null?Math.max(0,Math.min(rect.width,playX-scroller.scrollLeft)):Math.max(0,Math.min(rect.width,clientX-rect.left));
			const anchorTime=(scroller.scrollLeft+anchor)/pxPerSecond;
			const nextPx=10*next;
			nextScroll=Math.max(0,anchorTime*nextPx-anchor);
		}
		setScene(prev=>({...prev,timeline:{...prev.timeline,zoom:next}}));
		if(scroller&&nextScroll!=null)requestAnimationFrame(()=>{scroller.scrollLeft=nextScroll!});
	};
	const onTimelineWheel=(e:React.WheelEvent<HTMLDivElement>)=>{
		if(!e.shiftKey)return;
		e.preventDefault();
		const factor=e.deltaY>0?.85:1.15;
		setTimelineZoom(scene.timeline.zoom*factor,e.clientX);
	};
	const syncRightScroll=(e:React.UIEvent<HTMLDivElement>)=>{if(scrollRef.current&&Math.abs(scrollRef.current.scrollTop-e.currentTarget.scrollTop)>1)scrollRef.current.scrollTop=e.currentTarget.scrollTop};
	const syncLabelScroll=(e:React.UIEvent<HTMLDivElement>)=>{if(labelScrollRef.current&&Math.abs(labelScrollRef.current.scrollTop-e.currentTarget.scrollTop)>1)labelScrollRef.current.scrollTop=e.currentTarget.scrollTop};
	const startHandPan=(e:React.PointerEvent<HTMLElement>)=>{
		if(e.button!==0||!scrollRef.current)return;
		e.preventDefault();e.stopPropagation();
		const scroller=scrollRef.current;
		const startX=e.clientX,startY=e.clientY,startLeft=scroller.scrollLeft,startTop=scroller.scrollTop;
		const move=(ev:PointerEvent)=>{scroller.scrollLeft=startLeft-(ev.clientX-startX);scroller.scrollTop=startTop-(ev.clientY-startY);if(labelScrollRef.current)labelScrollRef.current.scrollTop=scroller.scrollTop};
		const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
		window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
	};

	const addTimelineMarker=()=>{
		const label=window.prompt("Marker name",`Marker ${scene.timeline.markers.length+1}`)?.trim();if(!label)return;
		setScene(prev=>({...prev,timeline:{...prev.timeline,markers:[...prev.timeline.markers,{id:`marker-${crypto.randomUUID()}`,time:position,label}]}}));
	};
	const removeMarker=(id:string)=>setScene(prev=>({...prev,timeline:{...prev.timeline,markers:prev.timeline.markers.filter(m=>m.id!==id)}}));
	const removePerformanceCue=(id:string)=>{setScene(prev=>({...prev,performance:{...prev.performance,timelineCues:prev.performance.timelineCues.filter(c=>c.id!==id)}}));setSelectedCueId(prev=>prev===id?"":prev)};
	const beginPerformanceCueDrag=(e:React.PointerEvent<HTMLButtonElement>,cueId:string,cueTime:number)=>{
		if(e.button!==0)return;
		e.preventDefault();e.stopPropagation();
		if(tool==="erase"){removePerformanceCue(cueId);return}
		if(tool!=="select"){setSelectedCueId(cueId);return}
		setSelectedCueId(cueId);
		const startX=e.clientX;
		const move=(ev:PointerEvent)=>{
			const next=snapTime(cueTime+(ev.clientX-startX)/pxPerSecond,cueId);
			setScene(prev=>({...prev,performance:{...prev.performance,timelineCues:prev.performance.timelineCues.map(c=>c.id===cueId?{...c,time:next,directorPlanId:undefined}:c).sort((a,b)=>a.time-b.time)}}));
		};
		const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
		window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
	};

	const motionCamera=scene.cameras.find(c=>c.id===selectedId)||scene.cameras.find(c=>c.id===scene.activeCameraId)||scene.cameras[0]||null;
	const cameraShots=buildVisualCameraShots(scene,duration);
	const removeCameraKeyframe=(cameraId:string,id:string)=>{setScene(prev=>({...prev,cameras:prev.cameras.map(c=>c.id===cameraId?{...c,keyframes:c.keyframes.filter(k=>k.id!==id)}:c)}));setSelectedCameraKeyframeId(prev=>prev===id?"":prev)};
	const beginCameraKeyframeDrag=(e:React.PointerEvent<HTMLButtonElement>,cameraId:string,keyframeId:string,keyframeTime:number)=>{
		if(e.button!==0)return;
		e.preventDefault();e.stopPropagation();
		if(tool==="erase"){removeCameraKeyframe(cameraId,keyframeId);return}
		setSelectedId(cameraId);setSelectedCameraKeyframeId(keyframeId);
		if(tool!=="select")return;
		const startX=e.clientX;
		const move=(ev:PointerEvent)=>{const next=snapTime(keyframeTime+(ev.clientX-startX)/pxPerSecond,keyframeId);setScene(prev=>({...prev,cameras:prev.cameras.map(c=>c.id===cameraId?{...c,keyframes:c.keyframes.map(k=>k.id===keyframeId?{...k,time:next,directorPlanId:undefined}:k).sort((a,b)=>a.time-b.time)}:c)}))};
		const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
		window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
	};
	const removeCameraCut=(id:string)=>{setScene(prev=>({...prev,cameraCuts:prev.cameraCuts.filter(c=>c.id!==id)}));setSelectedCameraCutId(prev=>prev===id?"":prev)};
	const beginCameraCutDrag=(e:React.PointerEvent<HTMLButtonElement>,cut:VisualCameraCut)=>{
		if(e.button!==0)return;
		e.preventDefault();e.stopPropagation();
		if(tool==="erase"){removeCameraCut(cut.id);return}
		setSelectedCameraCutId(cut.id);setSelectedId(cut.cameraId);
		if(tool!=="select")return;
		const startX=e.clientX;
		const move=(ev:PointerEvent)=>{const next=snapTime(cut.time+(ev.clientX-startX)/pxPerSecond,cut.id);setScene(prev=>({...prev,cameraCuts:prev.cameraCuts.map(c=>c.id===cut.id?{...c,time:next,directorPlanId:undefined}:c).sort((a,b)=>a.time-b.time)}))};
		const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
		window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
	};
	const removeAnimationCue=(id:string)=>{setScene(prev=>({...prev,animationCues:prev.animationCues.filter(c=>c.id!==id)}));setSelectedAnimationCueId(prev=>prev===id?"":prev)};
	const splitAnimationCueAt=(cue:VisualAnimationCue,splitTime:number)=>{
		const animation=scene.animations.find(a=>a.id===cue.animationId);const span=Math.max(.05,visualAnimationCueDuration(cue,animation));const local=splitTime-cue.time;if(local<=.05||local>=span-.05)return;
		const left:VisualAnimationCue={...cue,directorPlanId:undefined,duration:local,blendOut:Math.min(cue.blendOut,local)};
		const right:VisualAnimationCue={...cue,id:`animation-cue-${crypto.randomUUID()}`,directorPlanId:undefined,time:splitTime,duration:span-local,trimIn:Math.max(0,(cue.trimIn||0)+local*Math.max(.01,cue.speed||1)),blendIn:Math.min(cue.blendIn,span-local)};
		setScene(prev=>({...prev,animationCues:prev.animationCues.flatMap(c=>c.id===cue.id?[left,right]:[c]).sort((a,b)=>a.time-b.time)}));setSelectedAnimationCueId(right.id);
	};
	const beginAnimationClipDrag=(e:React.PointerEvent<HTMLElement>,cue:VisualAnimationCue,mode:"move"|"left"|"right")=>{
		if(e.button!==0)return;e.preventDefault();e.stopPropagation();if(tool==="erase"){removeAnimationCue(cue.id);return}setSelectedAnimationCueId(cue.id);setSelectedId(scene.layers.find(l=>l.type==="object")?.id||selectedId);
		if(tool==="razor"&&mode==="move"&&scrollRef.current){const rect=scrollRef.current.getBoundingClientRect();const split=snapTime((e.clientX-rect.left+scrollRef.current.scrollLeft)/pxPerSecond,cue.id);splitAnimationCueAt(cue,split);return}
		if(tool!=="select")return;
		const animation=scene.animations.find(a=>a.id===cue.animationId);
		const originalDuration=Math.max(.05,visualAnimationCueDuration(cue,animation));
		const originalStart=cue.time, originalEnd=cue.time+originalDuration, originalTrim=Math.max(0,cue.trimIn||0), speed=Math.max(.01,cue.speed||1);
		const startX=e.clientX;
		const move=(ev:PointerEvent)=>{
			const delta=(ev.clientX-startX)/pxPerSecond;
			setScene(prev=>({...prev,animationCues:prev.animationCues.map(c=>{if(c.id!==cue.id)return c;
				if(mode==="move"){const next=snapTime(originalStart+delta,cue.id);return{...c,directorPlanId:undefined,time:Math.max(0,Math.min(duration-originalDuration,next)),duration:originalDuration}}
				if(mode==="right"){const nextEnd=Math.max(originalStart+.05,snapTime(originalEnd+delta,cue.id));return{...c,directorPlanId:undefined,duration:Math.max(.05,Math.min(duration-originalStart,nextEnd-originalStart))}}
				const nextStart=Math.max(0,Math.min(originalEnd-.05,snapTime(originalStart+delta,cue.id)));const consumed=nextStart-originalStart;return{...c,directorPlanId:undefined,time:nextStart,duration:Math.max(.05,originalDuration-consumed),trimIn:Math.max(0,originalTrim+consumed*speed)};
			}).sort((a,b)=>a.time-b.time)}));
		};
		const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
	};
	const removeIkKey=(constraintId:string,keyId:string)=>{setScene(prev=>({...prev,ikConstraints:prev.ikConstraints.map(c=>c.id===constraintId?{...c,weightKeys:c.weightKeys.filter(k=>k.id!==keyId)}:c)}));setSelectedIkKeyId(prev=>prev===keyId?"":prev)};
	const beginIkKeyDrag=(e:React.PointerEvent<HTMLButtonElement>,constraintId:string,keyId:string,keyTime:number)=>{
		if(e.button!==0)return;e.preventDefault();e.stopPropagation();if(tool==="erase"){removeIkKey(constraintId,keyId);return}setSelectedIkKeyId(keyId);setSelectedId(scene.layers.find(l=>l.type==="object")?.id||"");if(tool!=="select")return;const startX=e.clientX;
		const move=(ev:PointerEvent)=>{const next=snapTime(keyTime+(ev.clientX-startX)/pxPerSecond,keyId);setScene(prev=>({...prev,ikConstraints:prev.ikConstraints.map(c=>c.id===constraintId?{...c,weightKeys:c.weightKeys.map(k=>k.id===keyId?{...k,time:next}:k).sort((a,b)=>a.time-b.time)}:c)}))};
		const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
	};
	const animationSpans=visualAnimationSpans(scene.animations,scene.animationCues,duration);
	const performerTrackIndex=scene.layers.findIndex(l=>l.type==="object");
	// System lanes are contextual. An empty project gets only the master audio row;
	// camera/animation/IK lanes appear only after the user actually authors that data.
	const showCameraShotsTrack=scene.cameraCuts.length>0;
	const showCameraMotionTrack=!!motionCamera?.keyframes.length;
	const showAnimationTrack=scene.animationCues.length>0;
	const showIkTrack=scene.ikConstraints.length>0;
	let nextSystemRow=1;
	const cameraShotsRow=showCameraShotsTrack?nextSystemRow++:-1;
	const cameraMotionRow=showCameraMotionTrack?nextSystemRow++:-1;
	const animationRow=showAnimationTrack?nextSystemRow++:-1;
	const ikRow=showIkTrack?nextSystemRow++:-1;
	const layerStartRow=nextSystemRow;
	const rowTop=(row:number)=>36+row*35;
	const keyTop=(row:number)=>rowTop(row)+7;
	const cutsTop=keyTop(cameraShotsRow);
	const cameraTop=keyTop(cameraMotionRow);
	const ikTop=keyTop(ikRow);
	const cueTop=36+(Math.max(0,performerTrackIndex)+layerStartRow)*35+7;
	const patchLayer=(id:string,patch:Partial<VisualLayer>)=>setScene(prev=>({...prev,layers:prev.layers.map(l=>l.id===id?{...l,...patch}:l)}));
	const patchTimeline=(id:string,patch:Partial<NonNullable<VisualLayer["timeline"]>>)=>setScene(prev=>({...prev,layers:prev.layers.map(l=>l.id===id?{...l,timeline:{start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...l.timeline,...patch}}:l)}));
	const removeLayer=(id:string)=>setScene(prev=>{
		const layer=prev.layers.find(item=>item.id===id);
		if(!layer||layer.locked)return prev;
		const primitives=layer.type==="primitive"&&layer.entityId?prev.primitives.filter(item=>item.id!==layer.entityId):prev.primitives;
		const shapes2d=layer.type==="shape2d"&&layer.entityId?prev.shapes2d.filter(item=>item.id!==layer.entityId):prev.shapes2d;
		queueMicrotask(()=>{if(selectedId===id)setSelectedId("")});
		return{...prev,layers:prev.layers.filter(item=>item.id!==id),primitives,shapes2d};
	});
	const splitLayerAt=(id:string,time:number)=>{
		setScene(prev=>{
			const layer=prev.layers.find(l=>l.id===id);
			if(!layer||layer.type!=="media"||layer.locked)return prev;
			const tl={start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...layer.timeline};
			const d=tl.duration>0?tl.duration:duration;
			const local=time-tl.start;
			if(local<=.05||local>=d-.05)return prev;
			const speed=Math.max(.01,layer.speed||1);
			const splitSource=tl.trimIn+local*speed;
			const left:VisualLayer={...layer,timeline:{...tl,duration:local,trimOut:splitSource,fadeOut:Math.min(tl.fadeOut,local)}};
			const right:VisualLayer={...layer,id:`media-${crypto.randomUUID()}`,name:`${layer.name} B`,timeline:{...tl,start:tl.start+local,duration:d-local,trimIn:splitSource,fadeIn:Math.min(tl.fadeIn,d-local)}};
			queueMicrotask(()=>setSelectedId(right.id));
			return{...prev,layers:prev.layers.flatMap(l=>l.id===id?[left,right]:[l])};
		});
	};
	const toolButton=(value:TimelineTool,label:string,titleText:string)=><button onClick={()=>setTool(value)} className={`timeline-tool min-w-7 ${tool===value?"active":""}`} title={titleText}>{label}</button>;

	return <div className="grid h-full grid-cols-[270px_minmax(0,1fr)] grid-rows-[56px_minmax(0,1fr)] text-xs">
		<div className="flex items-center gap-1 border-r border-white/10 px-3">
			<button onClick={previous} disabled={!previous} className="transport-btn" title="Previous">|◀</button>
			<button onClick={toggle} className="transport-btn" title={playing?"Pause":"Play"}>{playing?"Ⅱ":"▶"}</button>
			<button onClick={stop} className="transport-btn" title="Stop">■</button>
			<button onClick={next} disabled={!next} className="transport-btn" title="Next">▶|</button>
			<div className="ml-2 min-w-0"><div className="truncate font-semibold">{title}</div><div className="text-[9px] uppercase tracking-wider text-neutral-500">{source}{session?` · ${session.bpm} BPM · ${session.sigNum}/${session.sigDen}`:""}</div></div>
		</div>
		<div className="flex items-center gap-1 overflow-x-auto px-3">
			<div className="mr-2 flex items-center gap-1 border-r border-white/10 pr-2">
				{toolButton("select","↖","Select / move / trim clips")}
				{toolButton("pencil","✎","Pencil: click the ruler to drop a cue marker")}
				{toolButton("razor","✂","Razor: click a media clip to split it")}
				{toolButton("erase","⌫","Eraser: click a clip to delete it")}
				{toolButton("hand","✋","Hand: drag the timeline to pan")}
				<button onClick={()=>setTimelineZoom(scene.timeline.zoom*1.25)} className="timeline-tool min-w-7" title="Zoom in">⌕+</button>
				<button onClick={()=>setTimelineZoom(scene.timeline.zoom*.8)} className="timeline-tool min-w-7" title="Zoom out">⌕−</button>
			</div>
			<span className="font-mono text-[11px] whitespace-nowrap">{formatTimePrecise(position)} / {formatTime(duration)}</span>
			<button onClick={addTimelineMarker} className="timeline-tool" title="Add marker at playhead (M)">+ Marker</button>
			<label className="ml-auto flex items-center gap-1 text-[10px] text-neutral-500 whitespace-nowrap">Snap<select value={scene.timeline.snapMode} onChange={e=>setScene(p=>({...p,timeline:{...p.timeline,snapMode:e.target.value as VisualSceneState["timeline"]["snapMode"]}}))} className="rounded border border-white/10 bg-[#121620] px-1 py-1"><option value="seconds">Time</option><option value="beat" disabled={!session}>Beat</option><option value="bar" disabled={!session}>Bar</option></select></label>
			{scene.timeline.snapMode==="seconds"?<select value={scene.timeline.snapSeconds} onChange={e=>setScene(p=>({...p,timeline:{...p.timeline,snapSeconds:Number(e.target.value)}}))} className="rounded border border-white/10 bg-[#121620] px-1 py-1 text-[10px] text-neutral-400"><option value={0}>Off</option><option value={.05}>0.05s</option><option value={.1}>0.1s</option><option value={.25}>0.25s</option><option value={.5}>0.5s</option><option value={1}>1s</option></select>:null}
			<span className="ml-1 whitespace-nowrap text-[8px] uppercase tracking-wider text-neutral-700">Wheel scroll · Shift+Wheel zoom</span>
		</div>

		<div ref={labelScrollRef} className="min-h-0 overflow-y-auto border-r border-t border-white/10 bg-[#090c12]" onScroll={syncRightScroll} onWheel={onTimelineWheel}>
			<div className="flex h-8 items-center gap-2 border-b border-white/10 px-3 text-[9px] font-bold uppercase tracking-wider text-neutral-600"><span className="w-5">V</span><span className="w-5">L</span><span>Timeline tracks</span></div>
			<div className="flex h-[34px] items-center gap-2 border-b border-cyan-400/10 bg-cyan-500/[.035] px-3 text-[10px] text-cyan-200"><span>♫</span><span className="min-w-0 flex-1 truncate">{title}</span><span className="text-[8px] uppercase tracking-wider text-cyan-400/60">{source}</span></div>
			{showCameraShotsTrack?<div className="flex h-[34px] items-center gap-2 border-b border-white/5 bg-cyan-500/[.025] px-3 text-[10px] text-cyan-300"><span>✂</span><span className="min-w-0 flex-1 truncate">Program Camera Shots</span><span className="text-[8px] uppercase tracking-wider text-cyan-400/50">{scene.cameraCuts.length} CUTS</span></div>:null}
			{showCameraMotionTrack?<div className="flex h-[34px] items-center gap-2 border-b border-white/5 bg-cyan-500/[.02] px-3 text-[10px] text-cyan-300"><span>◉</span><span className="min-w-0 flex-1 truncate">Camera Motion · {motionCamera?.name||"Camera"}</span><span className="text-[8px] uppercase tracking-wider text-cyan-400/50">{motionCamera?.keyframes.length||0} KEYS</span></div>:null}
			{showAnimationTrack?<div className="flex h-[34px] items-center gap-2 border-b border-white/5 bg-fuchsia-500/[.02] px-3 text-[10px] text-fuchsia-300"><span>♟</span><span className="min-w-0 flex-1 truncate">Skeletal Animation Clips</span><span className="text-[8px] uppercase tracking-wider text-fuchsia-400/50">{scene.animationCues.length} CLIPS</span></div>:null}
			{showIkTrack?<div className="flex h-[34px] items-center gap-2 border-b border-white/5 bg-violet-500/[.018] px-3 text-[10px] text-violet-300"><span>◎</span><span className="min-w-0 flex-1 truncate">IK / Constraints</span><span className="text-[8px] uppercase tracking-wider text-violet-400/50">{scene.ikConstraints.reduce((sum,c)=>sum+c.weightKeys.length,0)} KEYS</span></div>:null}
			{scene.layers.map(l=><div key={l.id} className={`flex h-[34px] items-center gap-1 border-b border-white/5 px-2 ${selectedId===l.id?"bg-violet-500/10 text-violet-100":"text-neutral-400"}`}>
				<button onClick={()=>patchLayer(l.id,{visible:!l.visible})} className={`w-5 text-[10px] ${l.visible?"text-emerald-400":"text-neutral-700"}`} title="Visibility">{l.visible?"●":"○"}</button>
				<button onClick={()=>patchLayer(l.id,{locked:!l.locked})} className={`w-5 text-[10px] ${l.locked?"text-amber-300":"text-neutral-700"}`} title="Lock track">{l.locked?"▣":"▢"}</button>
				<button onClick={()=>setSelectedId(l.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[10px]"><span>{layerIcon(l)}</span><span className="truncate">{l.name}</span></button>
			</div>)}
		</div>

		<div ref={scrollRef} tabIndex={0} className={`relative min-h-0 overflow-auto border-t border-white/10 outline-none ${tool==="hand"?"cursor-grab":""}`} onScroll={syncLabelScroll} onWheel={onTimelineWheel} onPointerDown={e=>{if(tool==="hand"&&!((e.target as HTMLElement).closest("[data-ruler]")))startHandPan(e)}}>
			<div className="relative" style={{width:trackWidth,minHeight:Math.max(110,(scene.layers.length+layerStartRow)*35+34)}}>
				<div data-ruler className={`sticky top-0 z-20 h-8 border-b border-white/10 bg-[#0a0d13]/95 ${tool==="pencil"?"cursor-crosshair":tool==="hand"?"cursor-grab":"cursor-ew-resize"}`} onPointerDown={rulerPointerDown} onPointerMove={rulerPointerMove} onPointerUp={rulerPointerUp} onPointerCancel={rulerPointerUp}>
					{rulerTicks.map(t=><div key={t} className="pointer-events-none absolute top-0 h-full border-l border-white/10 pl-1 pt-1 text-[8px] text-neutral-600" style={{left:t*pxPerSecond}}>{formatTime(t)}</div>)}
				</div>
				{musicalLines.map((t,i)=><div key={`beat-${i}`} className={`pointer-events-none absolute top-8 bottom-0 border-l ${session&&i%Math.max(1,session.sigNum)===0?"border-violet-400/12":"border-white/[.035]"}`} style={{left:t*pxPerSecond}}/>)}
				<div className="absolute h-7 rounded border border-cyan-300/20 bg-cyan-500/10 text-cyan-100" style={{top:rowTop(0),left:0,width:Math.max(10,duration*pxPerSecond)}}><div className="flex h-full items-center gap-2 px-2 text-[9px]"><span>♫</span><span className="truncate">{title}</span><span className="ml-auto text-[8px] uppercase tracking-wider text-cyan-300/50">MASTER {source}</span></div></div>
				{showCameraShotsTrack?<div className="absolute h-7 rounded border border-cyan-300/10 bg-cyan-500/[.045] text-cyan-200" style={{top:rowTop(cameraShotsRow),left:0,width:Math.max(10,duration*pxPerSecond)}}><div className="flex h-full items-center gap-2 px-2 text-[9px]"><span>✂</span><span>Program Camera Shots</span><span className="ml-auto text-[8px] uppercase tracking-wider text-cyan-300/40">{scene.cameraCuts.length} CUTS</span></div></div>:null}
				{showCameraMotionTrack?<div className="absolute h-7 rounded border border-cyan-300/10 bg-cyan-500/[.035] text-cyan-200" style={{top:rowTop(cameraMotionRow),left:0,width:Math.max(10,duration*pxPerSecond)}}><div className="flex h-full items-center gap-2 px-2 text-[9px]"><span>◉</span><span className="truncate">Camera Motion · {motionCamera?.name||"Camera"}</span><span className="ml-auto text-[8px] uppercase tracking-wider text-cyan-300/40">{motionCamera?.keyframes.length||0} KEYFRAMES</span></div></div>:null}
				{showAnimationTrack?<div className="absolute h-7 rounded border border-fuchsia-300/10 bg-fuchsia-500/[.035] text-fuchsia-200" style={{top:rowTop(animationRow),left:0,width:Math.max(10,duration*pxPerSecond)}}><div className="flex h-full items-center gap-2 px-2 text-[9px]"><span>♟</span><span>Skeletal Animation Clips</span><span className="ml-auto text-[8px] uppercase tracking-wider text-fuchsia-300/40">{scene.animationCues.length} CLIPS</span></div></div>:null}
				{showIkTrack?<div className="absolute h-7 rounded border border-violet-300/10 bg-violet-500/[.03] text-violet-200" style={{top:rowTop(ikRow),left:0,width:Math.max(10,duration*pxPerSecond)}}><div className="flex h-full items-center gap-2 px-2 text-[9px]"><span>◎</span><span>IK / Constraints</span><span className="ml-auto text-[8px] uppercase tracking-wider text-violet-300/40">{scene.ikConstraints.reduce((sum,c)=>sum+c.weightKeys.length,0)} KEYS</span></div></div>:null}
				{scene.timeline.markers.map(marker=><div key={marker.id} data-marker className="absolute top-0 bottom-0 z-25 w-px bg-amber-400/70" style={{left:marker.time*pxPerSecond}}><button onDoubleClick={()=>removeMarker(marker.id)} onClick={e=>{e.stopPropagation();seek(marker.time)}} className="absolute left-1 top-1 max-w-28 truncate rounded bg-amber-400/15 px-1.5 py-.5 text-[8px] text-amber-200" title={`${marker.label} · ${formatTimePrecise(marker.time)} · double-click to delete`}>{marker.directorPlanId?"✦ ":""}{marker.label}</button></div>)}
				{showCameraShotsTrack?cameraShots.map((shot,index)=>{const shotCamera=scene.cameras.find(c=>c.id===shot.cameraId);const active=selectedId===shot.cameraId;return <button key={shot.id} onClick={e=>{e.stopPropagation();if(shotCamera)setSelectedId(shotCamera.id)}} className={`absolute z-30 h-[26px] overflow-hidden border px-2 text-left text-[8px] transition ${active?"border-cyan-200/60 bg-cyan-400/20 text-cyan-100":"border-cyan-400/10 bg-cyan-500/[.055] text-cyan-300/65 hover:bg-cyan-500/10"}`} style={{top:rowTop(cameraShotsRow)+1,left:shot.start*pxPerSecond,width:Math.max(8,(shot.end-shot.start)*pxPerSecond)}} title={`${shotCamera?.name||"Camera"} · ${formatTimePrecise(shot.start)} → ${formatTimePrecise(shot.end)}`}><span className="truncate">{index+1}. {shotCamera?.name||"Missing Camera"}</span></button>}):null}
				{scene.cameraCuts.map(cut=>{const camera=scene.cameras.find(c=>c.id===cut.cameraId);const selectedCut=selectedCameraCutId===cut.id;return <div key={`${cut.id}-${cut.time}`} className="pointer-events-none absolute z-40" style={{left:cut.time*pxPerSecond,top:cutsTop}}><button onPointerDown={e=>beginCameraCutDrag(e,cut)} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();removeCameraCut(cut.id)}} className={`pointer-events-auto -ml-2 h-4 w-4 rotate-45 border ${selectedCut?"border-cyan-50 bg-cyan-200 shadow-[0_0_8px_rgba(103,232,249,.9)]":"border-cyan-100/80 bg-cyan-500/75"} ${tool==="erase"?"cursor-pointer hover:border-red-100 hover:bg-red-500":"cursor-ew-resize"}`} title={`${cut.directorPlanId?"AI Director · ":""}${camera?.name||"Camera"} CUT · ${formatTimePrecise(cut.time)} · drag to retime · eraser or double-click to delete`}><span className="sr-only">{camera?.name||"Camera"} cut</span></button></div>})}
				{motionCamera?.keyframes.map(keyframe=>{const selectedCamera=selectedCameraKeyframeId===keyframe.id;return <div key={`${motionCamera.id}-${keyframe.id}-${keyframe.time}`} className="pointer-events-none absolute z-40" style={{left:keyframe.time*pxPerSecond,top:cameraTop}}><button onPointerDown={e=>beginCameraKeyframeDrag(e,motionCamera.id,keyframe.id,keyframe.time)} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();removeCameraKeyframe(motionCamera.id,keyframe.id)}} className={`pointer-events-auto -ml-2 h-4 w-4 rotate-45 border ${selectedCamera?"border-cyan-50 bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,.9)]":"border-cyan-100/80 bg-cyan-500/70"} ${tool==="erase"?"cursor-pointer hover:border-red-100 hover:bg-red-500":"cursor-ew-resize"}`} title={`${keyframe.directorPlanId?"AI Director · ":""}${motionCamera.name} motion · ${formatTimePrecise(keyframe.time)} · drag to retime · eraser or double-click to delete`}><span className="sr-only">{motionCamera.name} keyframe</span></button></div>})}
				{animationSpans.map(span=>{const cue=scene.animationCues.find(c=>c.id===span.cue.id);if(!cue)return null;const animation=scene.animations.find(a=>a.id===cue.animationId);const selectedCue=selectedAnimationCueId===cue.id;const width=Math.max(12,(span.end-span.start)*pxPerSecond);return <div key={`${cue.id}-${cue.time}-${cue.duration}`} className={`absolute z-40 h-[26px] overflow-hidden rounded border ${selectedCue?"border-fuchsia-100 bg-fuchsia-400/25 shadow-[0_0_10px_rgba(244,114,182,.3)]":"border-fuchsia-400/25 bg-fuchsia-500/10 hover:bg-fuchsia-500/15"}`} style={{left:span.start*pxPerSecond,top:rowTop(animationRow)+1,width}} title={`${animation?.name||"Animation"} · ${formatTimePrecise(span.start)} → ${formatTimePrecise(span.end)} · ${cue.layer} · ${cue.blendMode}`} onPointerDown={e=>beginAnimationClipDrag(e,cue,"move")} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();removeAnimationCue(cue.id)}}>
					<button aria-label="Trim animation clip start" className={`absolute left-0 top-0 z-10 h-full w-2 border-r border-fuchsia-200/25 ${tool==="erase"?"cursor-pointer hover:bg-red-500/50":"cursor-ew-resize hover:bg-fuchsia-300/25"}`} onPointerDown={e=>beginAnimationClipDrag(e,cue,"left")}/><div className="pointer-events-none flex h-full min-w-0 items-center gap-1 px-2 text-[8px] text-fuchsia-100">{cue.directorPlanId?<span className="shrink-0 text-cyan-300">✦</span>:null}<span className="truncate">{animation?.name||"Missing Animation"}</span><span className="ml-auto shrink-0 uppercase text-fuchsia-300/55">{cue.layer}</span></div><button aria-label="Trim animation clip end" className={`absolute right-0 top-0 z-10 h-full w-2 border-l border-fuchsia-200/25 ${tool==="erase"?"cursor-pointer hover:bg-red-500/50":"cursor-ew-resize hover:bg-fuchsia-300/25"}`} onPointerDown={e=>beginAnimationClipDrag(e,cue,"right")}/></div>})}
				{scene.ikConstraints.flatMap(constraint=>constraint.weightKeys.map(key=>({constraint,key}))).map(({constraint,key})=>{const selectedKey=selectedIkKeyId===key.id;return <div key={`${constraint.id}-${key.id}-${key.time}`} className="pointer-events-none absolute z-40" style={{left:key.time*pxPerSecond,top:ikTop}}><button onPointerDown={e=>beginIkKeyDrag(e,constraint.id,key.id,key.time)} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();removeIkKey(constraint.id,key.id)}} className={`pointer-events-auto -ml-2 h-4 w-4 rotate-45 border ${selectedKey?"border-violet-50 bg-violet-200 shadow-[0_0_8px_rgba(196,181,253,.9)]":"border-violet-100/80 bg-violet-500/70"} ${tool==="erase"?"cursor-pointer hover:border-red-100 hover:bg-red-500":"cursor-ew-resize"}`} title={`${constraint.name} · IK weight ${key.weight.toFixed(2)} · ${formatTimePrecise(key.time)} · drag to retime`}><span className="sr-only">{constraint.name} IK key</span></button></div>})}
				{scene.performance.timelineCues.map(cue=>{const meta=PERFORMANCE_BEHAVIORS.find(x=>x.id===cue.cueId);const selectedCue=selectedCueId===cue.id;return <div key={`${cue.id}-${cue.time}`} data-performance-cue className="pointer-events-none absolute z-40" style={{left:cue.time*pxPerSecond,top:cueTop}}><button onPointerDown={e=>beginPerformanceCueDrag(e,cue.id,cue.time)} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();removePerformanceCue(cue.id)}} className={`pointer-events-auto -ml-2 h-4 w-4 rotate-45 border ${selectedCue?"border-fuchsia-100 bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,.9)]":"border-violet-200/80 bg-violet-500/65"} ${tool==="erase"?"cursor-pointer hover:border-red-100 hover:bg-red-500":"cursor-ew-resize"}`} title={`${cue.directorPlanId?"AI Director · ":""}${meta?.label||cue.cueId} · ${formatTimePrecise(cue.time)} · drag to retime · eraser or double-click to delete`}><span className="sr-only">{meta?.label||cue.cueId}</span></button></div>})}
				{scene.layers.map((l,i)=><TimelineClip key={l.id} layer={l} row={i+layerStartRow} duration={duration} pxPerSecond={pxPerSecond} selected={l.id===selectedId} tool={tool} select={()=>setSelectedId(l.id)} patch={patch=>patchTimeline(l.id,patch)} remove={()=>removeLayer(l.id)} splitAt={time=>splitLayerAt(l.id,time)} snapTime={snapTime}/>)}
				<div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-fuchsia-400" style={{left:playX}}><div className="-ml-1 h-2 w-2 rotate-45 bg-fuchsia-400"/></div>
			</div>
		</div>
		<style>{`.transport-btn{height:28px;min-width:30px;border:1px solid rgb(255 255 255 / .1);border-radius:6px;background:rgb(255 255 255 / .04);color:#ddd}.transport-btn:disabled{opacity:.25}.timeline-tool{border:1px solid rgb(255 255 255 / .1);border-radius:6px;background:rgb(255 255 255 / .04);padding:4px 7px;font-size:9px;color:#aaa}.timeline-tool:hover,.timeline-tool.active{border-color:rgb(167 139 250 / .45);background:rgb(139 92 246 / .14);color:#eee}`}</style>
	</div>
}

function TimelineClip({layer,row,duration,pxPerSecond,selected,tool,select,patch,remove,splitAt,snapTime}:{layer:VisualLayer;row:number;duration:number;pxPerSecond:number;selected:boolean;tool:TimelineTool;select:()=>void;patch:(p:Partial<NonNullable<VisualLayer["timeline"]>>)=>void;remove:()=>void;splitAt:(time:number)=>void;snapTime:(v:number)=>number}){
	const tl={start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...layer.timeline};
	const activeDuration=tl.duration>0?tl.duration:Math.max(.05,duration-tl.start);
	const left=tl.start*pxPerSecond;
	const width=Math.max(10,activeDuration*pxPerSecond);
	const beginDrag=(e:React.PointerEvent,mode:"move"|"left"|"right")=>{
		e.preventDefault();e.stopPropagation();select();if(layer.locked)return;
		const startX=e.clientX,initial={...tl};
		const initialDuration=initial.duration>0?initial.duration:Math.max(.05,duration-initial.start);
		const initialEnd=Math.min(duration,initial.start+initialDuration);
		const speed=Math.max(.01,layer.speed||1);
		const move=(ev:PointerEvent)=>{
			const delta=(ev.clientX-startX)/pxPerSecond;
			if(mode==="move"){
				const maxStart=initial.duration>0?Math.max(0,duration-initialDuration):Math.max(0,duration-.05);
				patch({start:Math.min(maxStart,snapTime(initial.start+delta))});
				return;
			}
			if(mode==="left"){
				const proposed=snapTime(initial.start+delta);
				const sourceLimitedStart=layer.type==="media"&&layer.mediaKind==="video"&&layer.loop===false?Math.max(0,initial.start-initial.trimIn/speed):0;
				const nextStart=Math.min(initialEnd-.05,Math.max(sourceLimitedStart,proposed));
				const nextDuration=Math.max(.05,initialEnd-nextStart);
				if(layer.type!=="media"){
					patch({start:nextStart,duration:nextDuration});
					return;
				}
				const consumed=(nextStart-initial.start)*speed;
				const nextTrimIn=Math.max(0,initial.trimIn+consumed);
				const sourceOut=initial.trimOut>0?initial.trimOut:layer.sourceDuration||0;
				if(sourceOut>0&&nextTrimIn>=sourceOut-.01)return;
				patch({start:nextStart,duration:nextDuration,trimIn:nextTrimIn});
				return;
			}
			const rawEnd=snapTime(initial.start+initialDuration+delta);
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
	const beginFade=(e:React.PointerEvent,side:"in"|"out")=>{
		e.preventDefault();e.stopPropagation();select();if(layer.locked)return;
		const startX=e.clientX,initial={...tl};
		const move=(ev:PointerEvent)=>{
			const delta=(ev.clientX-startX)/pxPerSecond;
			if(side==="in")patch({fadeIn:Math.max(0,Math.min(activeDuration,initial.fadeIn+delta))});
			else patch({fadeOut:Math.max(0,Math.min(activeDuration,initial.fadeOut-delta))});
		};
		const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
		window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
	};
	const handleBodyPointerDown=(e:React.PointerEvent<HTMLDivElement>)=>{
		if(tool==="hand")return;
		if(tool==="erase"){e.preventDefault();e.stopPropagation();if(!layer.locked)remove();return}
		if(tool==="razor"){
			e.preventDefault();e.stopPropagation();select();if(layer.type!=="media"||layer.locked)return;
			const rect=e.currentTarget.getBoundingClientRect();
			const time=tl.start+Math.max(0,Math.min(activeDuration,(e.clientX-rect.left)/pxPerSecond));
			splitAt(snapTime(time));return;
		}
		if(tool==="pencil"){e.preventDefault();e.stopPropagation();select();return}
		beginDrag(e,"move");
	};
	const fadeInWidth=Math.min(width,tl.fadeIn*pxPerSecond);
	const fadeOutWidth=Math.min(width,tl.fadeOut*pxPerSecond);
	const clipClass=layer.type==="media"?(layer.mediaKind==="video"?"bg-cyan-500/22":"bg-blue-500/20"):layer.type==="object"?"bg-violet-500/22":layer.type==="particles"?"bg-fuchsia-500/18":layer.type==="spectrum"?"bg-emerald-500/16":layer.type==="stage"?"bg-amber-500/12":layer.type==="clouds"?"bg-sky-500/12":"bg-white/[.07]";
	const cursor=layer.locked?"cursor-not-allowed":tool==="razor"?"cursor-crosshair":tool==="erase"?"cursor-pointer":tool==="hand"?"cursor-grab":tool==="pencil"?"cursor-cell":"cursor-move";
	return <div data-clip onPointerDown={handleBodyPointerDown} onClick={e=>{e.stopPropagation();select()}} className={`absolute h-7 overflow-hidden rounded border ${clipClass} ${cursor} ${selected?"border-violet-300 text-white":"border-white/10 text-neutral-300"} ${layer.locked?"opacity-65":""} ${tool==="erase"&&!layer.locked?"hover:border-red-300 hover:bg-red-500/15":""}`} style={{top:36+row*35,left,width}} title={`${layer.name} · ${formatTimePrecise(tl.start)} → ${formatTimePrecise(tl.start+activeDuration)}${tl.duration<=0?" · continuous":""}`}>
		{fadeInWidth>1?<div className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/65 to-transparent" style={{width:fadeInWidth}}/>:null}
		{fadeOutWidth>1?<div className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/65 to-transparent" style={{width:fadeOutWidth}}/>:null}
		<div className="pointer-events-none flex h-full items-center gap-1 px-3 text-[9px]"><span>{layerIcon(layer)}</span><span className="truncate">{layer.name}</span>{layer.locked?<span className="ml-auto text-amber-300">▣</span>:null}</div>
		{tool==="select"&&!layer.locked?<><div onPointerDown={e=>beginDrag(e,"left")} className="absolute inset-y-0 left-0 z-20 w-3 cursor-ew-resize border-r border-white/20 bg-white/[.04] hover:border-cyan-200 hover:bg-cyan-300/25" title={layer.type==="media"?"Trim start":"Resize active range start"}/><div onPointerDown={e=>beginDrag(e,"right")} className="absolute inset-y-0 right-0 z-20 w-3 cursor-ew-resize border-l border-white/20 bg-white/[.04] hover:border-cyan-200 hover:bg-cyan-300/25" title={layer.type==="media"?"Trim end":"Resize active range end"}/>{layer.type==="media"?<><div onPointerDown={e=>beginFade(e,"in")} className="absolute left-3 top-0 z-30 h-2.5 w-2.5 cursor-ew-resize rounded-bl bg-violet-300/80" title="Drag fade in"/><div onPointerDown={e=>beginFade(e,"out")} className="absolute right-3 top-0 z-30 h-2.5 w-2.5 cursor-ew-resize rounded-br bg-violet-300/80" title="Drag fade out"/></>:null}</>:null}
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
function LayerTimelineInspector({layer,patchTimeline,duration}:{layer:VisualLayer;patchTimeline:(p:Partial<NonNullable<VisualLayer["timeline"]>>)=>void;duration:number}){
	const tl={start:0,duration:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0,...layer.timeline};
	const activeDuration=tl.duration>0?tl.duration:Math.max(0,duration-tl.start);
	return <InspectorSection title="Visual DAW Range"><NumberRow label="Timeline Start" value={tl.start} min={0} max={duration} step={.05} onChange={v=>patchTimeline({start:v})} suffix="s"/><NumberRow label="Duration" value={tl.duration} min={0} max={duration} step={.05} onChange={v=>patchTimeline({duration:v})} suffix="s"/><div className="text-[9px] text-neutral-600">Active span: {formatTimePrecise(tl.start)} → {formatTimePrecise(Math.min(duration,tl.start+activeDuration))}</div><div className="rounded border border-white/5 bg-white/[.025] p-2 text-[9px] leading-relaxed text-neutral-500">Duration 0 means continuous from the start point to the end of the song. In Select mode, every visual clip exposes left/right ↔ handles. Drag either edge to create or resize an explicit active range.</div></InspectorSection>
}

function EditorCameraInspector({snapshot,onCreateCamera}:{snapshot:EditorCameraSnapshot;onCreateCamera:()=>void}){
	const deg=(r:number)=>r*180/Math.PI;
	return <div className="space-y-5 p-3"><div><div className="text-sm font-semibold">Editor Camera</div><div className="mt-.5 text-[10px] uppercase tracking-[.16em] text-amber-400/70">Free roam · never rendered to OBS</div></div><InspectorSection title="Live Transform"><ReadoutGrid rows={[["Position X",snapshot.position.x],["Position Y",snapshot.position.y],["Position Z",snapshot.position.z],["Rotation X",deg(snapshot.rotation.x),"°"],["Rotation Y",deg(snapshot.rotation.y),"°"],["Rotation Z",deg(snapshot.rotation.z),"°"],["FOV",snapshot.fov,"°"]]}/><button onClick={onCreateCamera} className="inspector-btn w-full border-cyan-400/30 bg-cyan-500/10">Create Program Camera From This View</button><div className="text-[9px] leading-relaxed text-neutral-600">Click empty space / the sky to enter free roam. Hovering a pickable 3D object changes the cursor; click it to select that object instead.</div></InspectorSection></div>
}

function CameraInspector({camera,scene,setScene,position,duration,editorCamera,seek,onRemove,onCut}:{camera:VisualProgramCamera;scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;position:number;duration:number;editorCamera:EditorCameraSnapshot;seek:(seconds:number)=>void;onRemove:()=>void;onCut:()=>void}){
	const patch=(p:Partial<VisualProgramCamera>)=>setScene(v=>({...v,cameras:v.cameras.map(c=>c.id===camera.id?{...c,...p}:c)}));
	const patchKeyframe=(id:string,p:Partial<VisualCameraKeyframe>)=>setScene(v=>({...v,cameras:v.cameras.map(c=>c.id===camera.id?{...c,keyframes:c.keyframes.map(k=>k.id===id?{...k,...p,directorPlanId:undefined}:k).sort((a,b)=>a.time-b.time)}:c)}));
	const makeKeyframe=(sample=sampleVisualProgramCamera(camera,position),time=position,easing:VisualCameraSegmentEasing="inherit"):VisualCameraKeyframe=>({
		id:`camera-key-${crypto.randomUUID()}`,time:Math.max(0,Math.min(duration,time)),
		positionX:sample.positionX,positionY:sample.positionY,positionZ:sample.positionZ,
		rotationX:sample.rotationX,rotationY:sample.rotationY,rotationZ:sample.rotationZ,
		targetX:sample.targetX,targetY:sample.targetY,targetZ:sample.targetZ,targetOffsetX:sample.targetOffsetX,targetOffsetY:sample.targetOffsetY,targetOffsetZ:sample.targetOffsetZ,fov:sample.fov,
		focusDistance:sample.focusDistance,aperture:sample.aperture,dofAmount:sample.dofAmount,dofBalance:sample.dofBalance,focusRange:sample.focusRange,maxBlur:sample.maxBlur,bokehSize:sample.bokehSize,
		exposure:sample.exposure,shakeAmount:sample.shakeAmount,shakeFrequency:sample.shakeFrequency,shakeRotation:sample.shakeRotation,easing,
	});
	const insertKeyframe=(keyframe:VisualCameraKeyframe)=>setScene(v=>({...v,cameras:v.cameras.map(c=>c.id===camera.id?{...c,keyframes:[...c.keyframes.filter(k=>Math.abs(k.time-keyframe.time)>.01),keyframe].sort((a,b)=>a.time-b.time)}:c)}));
	const addKeyframe=()=>insertKeyframe(makeKeyframe());
	const keyEditorView=()=>{
		const f={x:-Math.sin(editorCamera.rotation.y)*Math.cos(editorCamera.rotation.x),y:Math.sin(editorCamera.rotation.x),z:-Math.cos(editorCamera.rotation.y)*Math.cos(editorCamera.rotation.x)};
		const sample=sampleVisualProgramCamera(camera,position);
		insertKeyframe(makeKeyframe({...sample,positionX:editorCamera.position.x,positionY:editorCamera.position.y,positionZ:editorCamera.position.z,rotationX:editorCamera.rotation.x,rotationY:editorCamera.rotation.y,rotationZ:editorCamera.rotation.z,targetX:editorCamera.position.x+f.x*5,targetY:editorCamera.position.y+f.y*5,targetZ:editorCamera.position.z+f.z*5,fov:editorCamera.fov}));
	};
	const alignToEditor=()=>{const f={x:-Math.sin(editorCamera.rotation.y)*Math.cos(editorCamera.rotation.x),y:Math.sin(editorCamera.rotation.x),z:-Math.cos(editorCamera.rotation.y)*Math.cos(editorCamera.rotation.x)};patch({positionX:editorCamera.position.x,positionY:editorCamera.position.y,positionZ:editorCamera.position.z,rotationX:editorCamera.rotation.x,rotationY:editorCamera.rotation.y,rotationZ:editorCamera.rotation.z,targetX:editorCamera.position.x+f.x*5,targetY:editorCamera.position.y+f.y*5,targetZ:editorCamera.position.z+f.z*5,fov:editorCamera.fov})};
	const targetPoint=()=>{
		if(camera.targetMode==="performer")return{x:scene.object.positionX+camera.targetOffsetX,y:scene.object.positionY+camera.targetOffsetY,z:scene.object.positionZ+camera.targetOffsetZ};
		if(camera.targetMode==="primitive"){const primitive=scene.primitives.find(p=>p.id===camera.targetEntityId);if(primitive)return{x:primitive.positionX+camera.targetOffsetX,y:primitive.positionY+camera.targetOffsetY,z:primitive.positionZ+camera.targetOffsetZ};}
		return{x:camera.targetX,y:camera.targetY,z:camera.targetZ};
	};
	const askDuration=(label:string,fallback:number)=>{const remaining=Math.max(0,duration-position);if(remaining<.25){window.alert("Move the playhead earlier in the song to create a camera path.");return null;}const raw=window.prompt(`${label} duration in seconds`,String(Math.min(fallback,remaining)));if(raw===null)return null;const value=Number(raw);const requested=Number.isFinite(value)?value:fallback;return Math.max(.25,Math.min(120,remaining,requested));};
	const generateOrbit=()=>{
		const pathDuration=askDuration("Orbit",8);if(pathDuration==null)return;
		const center=targetPoint();const sample=sampleVisualProgramCamera(camera,position);const dx=sample.positionX-center.x,dz=sample.positionZ-center.z;const radius=Math.max(.5,Math.hypot(dx,dz)||6);const startAngle=Math.atan2(dz,dx);const keys:VisualCameraKeyframe[]=[];
		for(let i=0;i<=8;i++){const a=startAngle+(Math.PI*2*i/8);keys.push(makeKeyframe({...sample,positionX:center.x+Math.cos(a)*radius,positionY:sample.positionY,positionZ:center.z+Math.sin(a)*radius,targetX:center.x,targetY:center.y,targetZ:center.z},position+pathDuration*i/8,"linear"));}
		patch({pathInterpolation:"catmullRom",pathClosed:true,loop:true,showPath:true,keyframes:[...camera.keyframes.filter(k=>k.time<position-.01||k.time>position+pathDuration+.01),...keys].sort((a,b)=>a.time-b.time)});
	};
	const generateDolly=()=>{
		const pathDuration=askDuration("Dolly",4);if(pathDuration==null)return;const center=targetPoint();const sample=sampleVisualProgramCamera(camera,position);const end={...sample,positionX:center.x+(sample.positionX-center.x)*.38,positionY:center.y+(sample.positionY-center.y)*.38,positionZ:center.z+(sample.positionZ-center.z)*.38,targetX:center.x,targetY:center.y,targetZ:center.z};
		patch({pathInterpolation:"smooth",pathClosed:false,loop:false,showPath:true,keyframes:[...camera.keyframes.filter(k=>k.time<position-.01||k.time>position+pathDuration+.01),makeKeyframe(sample,position,"easeInOut"),makeKeyframe(end,position+pathDuration,"inherit")].sort((a,b)=>a.time-b.time)});
	};
	const generateCrane=()=>{
		const pathDuration=askDuration("Crane",4);if(pathDuration==null)return;const sample=sampleVisualProgramCamera(camera,position);const end={...sample,positionY:sample.positionY+4};
		patch({pathInterpolation:"smooth",pathClosed:false,loop:false,showPath:true,keyframes:[...camera.keyframes.filter(k=>k.time<position-.01||k.time>position+pathDuration+.01),makeKeyframe(sample,position,"easeInOut"),makeKeyframe(end,position+pathDuration,"inherit")].sort((a,b)=>a.time-b.time)});
	};
	const cameraCuts=scene.cameraCuts.filter(cut=>cut.cameraId===camera.id).sort((a,b)=>a.time-b.time);
	const primitiveLabels=Object.fromEntries(scene.primitives.map(p=>[p.id,p.name]));
	return <div className="space-y-5 p-3">
		<div><div className="text-sm font-semibold">{camera.name}</div><div className="mt-.5 text-[10px] uppercase tracking-[.16em] text-cyan-400/70">Program / OBS choreography camera</div></div>
		<div className="overflow-hidden rounded border border-cyan-400/20 bg-black">
			<div className="flex items-center justify-between border-b border-white/10 px-2 py-1 text-[8px] uppercase tracking-[.15em] text-neutral-500"><span>Selected Camera Monitor</span><span>16:9 LIVE</span></div>
			<div className="relative aspect-video">
				<iframe title={`${camera.name} monitor`} src={`/visual-output?embedded=1&program=1&cameraId=${encodeURIComponent(camera.id)}`} className="absolute inset-0 h-full w-full border-0"/>
				{camera.showThirds?<div className="pointer-events-none absolute inset-0"><i className="absolute bottom-0 top-0 left-1/3 border-l border-white/25"/><i className="absolute bottom-0 top-0 left-2/3 border-l border-white/25"/><i className="absolute left-0 right-0 top-1/3 border-t border-white/25"/><i className="absolute left-0 right-0 top-2/3 border-t border-white/25"/></div>:null}
				{camera.showCenter?<div className="pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2"><i className="absolute left-1/2 top-0 h-full border-l border-white/35"/><i className="absolute left-0 top-1/2 w-full border-t border-white/35"/></div>:null}
				{camera.showSafeAreas?<div className="pointer-events-none absolute inset-[5%] border border-amber-200/30"><div className="absolute inset-[5%] border border-amber-100/20"/></div>:null}
			</div>
		</div>
		<InspectorSection title="Camera Object">
			<TextRow label="Name" value={camera.name} onChange={v=>patch({name:v})}/><Toggle label="Enabled" checked={camera.enabled} onChange={v=>patch({enabled:v})}/>
			<button onClick={()=>setScene(v=>({...v,activeCameraId:camera.id}))} className={`inspector-btn w-full ${scene.activeCameraId===camera.id?"active":""}`}>{scene.activeCameraId===camera.id?"MASTER PROGRAM CAMERA":"Set As Master Camera"}</button>
			<div className="grid grid-cols-2 gap-2"><button onClick={onCut} className="inspector-btn">Cut Here @ {formatTimePrecise(position)}</button><button onClick={alignToEditor} className="inspector-btn">Align Base To Editor</button></div>
		</InspectorSection>
		<InspectorSection title="Transform / Aim">
			<NumberRow label="Position X" value={camera.positionX} min={-1000} step={.05} onChange={v=>patch({positionX:v})}/><NumberRow label="Position Y" value={camera.positionY} min={-1000} step={.05} onChange={v=>patch({positionY:v})}/><NumberRow label="Position Z" value={camera.positionZ} min={-1000} step={.05} onChange={v=>patch({positionZ:v})}/>
			<SelectRow label="Aim Mode" value={camera.aimMode} options={["target","rotation"]} labels={{target:"Look At Target",rotation:"XYZ Rotation"}} onChange={v=>patch({aimMode:v as VisualProgramCamera["aimMode"]})}/>
			{camera.aimMode==="target"?<><SelectRow label="Target Source" value={camera.targetMode} options={["point","performer","primitive"]} labels={{point:"World Point",performer:"3D Performer",primitive:"3D Primitive / Physics Object"}} onChange={v=>patch({targetMode:v as VisualProgramCamera["targetMode"]})}/>{camera.targetMode==="primitive"?<SelectRow label="Tracked Primitive" value={camera.targetEntityId} options={["",...scene.primitives.map(p=>p.id)]} labels={{"":"Select primitive",...primitiveLabels}} onChange={v=>patch({targetEntityId:v})}/>:null}{camera.targetMode==="point"?<><NumberRow label="Target X" value={camera.targetX} min={-1000} step={.05} onChange={v=>patch({targetX:v})}/><NumberRow label="Target Y" value={camera.targetY} min={-1000} step={.05} onChange={v=>patch({targetY:v})}/><NumberRow label="Target Z" value={camera.targetZ} min={-1000} step={.05} onChange={v=>patch({targetZ:v})}/></>:<><NumberRow label="Target Offset X" value={camera.targetOffsetX} min={-100} step={.05} onChange={v=>patch({targetOffsetX:v})}/><NumberRow label="Target Offset Y" value={camera.targetOffsetY} min={-100} step={.05} onChange={v=>patch({targetOffsetY:v})}/><NumberRow label="Target Offset Z" value={camera.targetOffsetZ} min={-100} step={.05} onChange={v=>patch({targetOffsetZ:v})}/></>}</>:<><NumberRow label="Rotation X" value={camera.rotationX*180/Math.PI} min={-360} max={360} step={.1} onChange={v=>patch({rotationX:v*Math.PI/180})} suffix="°"/><NumberRow label="Rotation Y" value={camera.rotationY*180/Math.PI} min={-360} max={360} step={.1} onChange={v=>patch({rotationY:v*Math.PI/180})} suffix="°"/><NumberRow label="Rotation Z" value={camera.rotationZ*180/Math.PI} min={-360} max={360} step={.1} onChange={v=>patch({rotationZ:v*Math.PI/180})} suffix="°"/></>}
		</InspectorSection>
		<InspectorSection title="Lens / Exposure">
			<RangeRow label="FOV" value={camera.fov} min={10} max={140} step={1} onChange={v=>patch({fov:v})} suffix="°"/><RangeRow label="Camera Exposure" value={camera.exposure} min={.1} max={4} step={.01} onChange={v=>patch({exposure:v})}/><NumberRow label="Near Clip" value={camera.near} min={.01} max={100} step={.01} onChange={v=>patch({near:v})}/><NumberRow label="Far Clip" value={camera.far} min={1} max={5000} step={1} onChange={v=>patch({far:v})}/><div className="text-[9px] leading-relaxed text-neutral-600">Camera Exposure multiplies the scene + global post exposure and is stored in motion keyframes, so exposure ramps can follow a shot.</div>
		</InspectorSection>
		<InspectorSection title="Focus / Depth of Field">
			<RangeRow label="Focus Bias" value={camera.dofBalance} min={-1} max={1} step={.01} onChange={v=>patch({dofBalance:v,dofAmount:Math.abs(v)})}/><div className="-mt-1 flex justify-between text-[8px] text-neutral-600"><span>Near blur / far focus</span><span>0 = OFF</span><span>Near focus / far blur</span></div><RangeRow label="Focus Distance" value={camera.focusDistance} min={.1} max={100} step={.1} onChange={v=>patch({focusDistance:v})}/><RangeRow label="Focus Range" value={camera.focusRange} min={.05} max={40} step={.05} onChange={v=>patch({focusRange:v})}/><RangeRow label="Aperture / F-stop" value={camera.aperture} min={.7} max={22} step={.1} onChange={v=>patch({aperture:v})}/><RangeRow label="Maximum Blur" value={camera.maxBlur} min={0} max={24} step={.25} onChange={v=>patch({maxBlur:v})} suffix="px"/>
		</InspectorSection>
		<InspectorSection title="Bokeh / Lens Response">
			<RangeRow label="Bokeh Size" value={camera.bokehSize} min={.25} max={4} step={.05} onChange={v=>patch({bokehSize:v})}/><RangeRow label="Iris Blades" value={camera.bokehBlades} min={3} max={12} step={1} onChange={v=>patch({bokehBlades:Math.round(v)})}/><RangeRow label="Blade Rotation" value={camera.bokehRotation} min={-180} max={180} step={1} onChange={v=>patch({bokehRotation:v})} suffix="°"/><RangeRow label="Highlight Threshold" value={camera.bokehThreshold} min={0} max={3} step={.05} onChange={v=>patch({bokehThreshold:v})}/><RangeRow label="Highlight Gain" value={camera.bokehGain} min={0} max={4} step={.05} onChange={v=>patch({bokehGain:v})}/><RangeRow label="Anamorphic" value={camera.bokehAnamorphic} min={.25} max={3} step={.05} onChange={v=>patch({bokehAnamorphic:v})}/><RangeRow label="Lens Flare Response" value={camera.lensFlare} min={0} max={2} step={.05} onChange={v=>patch({lensFlare:v})}/>
		</InspectorSection>
		<InspectorSection title="Handheld / Camera Shake">
			<RangeRow label="Position Shake" value={camera.shakeAmount} min={0} max={2} step={.005} onChange={v=>patch({shakeAmount:v})}/><RangeRow label="Shake Frequency" value={camera.shakeFrequency} min={.1} max={12} step={.05} onChange={v=>patch({shakeFrequency:v})} suffix=" Hz"/><RangeRow label="Rotational Shake" value={camera.shakeRotation} min={0} max={10} step={.05} onChange={v=>patch({shakeRotation:v})} suffix="°"/><NumberRow label="Deterministic Seed" value={camera.shakeSeed} min={-999999} step={1} onChange={v=>patch({shakeSeed:v})}/><div className="text-[9px] leading-relaxed text-neutral-600">Authored shake is deterministic from Visual DAW time. Scrubbing back to the same frame gives the same shake instead of changing the broadcast on every pass.</div>
		</InspectorSection>
		<InspectorSection title="Framing Guides">
			<Toggle label="Rule of Thirds" checked={camera.showThirds} onChange={v=>patch({showThirds:v})}/><Toggle label="Center Crosshair" checked={camera.showCenter} onChange={v=>patch({showCenter:v})}/><Toggle label="Action / Title Safe" checked={camera.showSafeAreas} onChange={v=>patch({showSafeAreas:v})}/><div className="text-[9px] leading-relaxed text-neutral-600">Guides appear only in the selected-camera editor monitor. They never render into Program Output / OBS.</div>
		</InspectorSection>
		<InspectorSection title="Editor Camera Helpers">
			<Toggle label="Show Camera Model" checked={camera.showModel} onChange={v=>patch({showModel:v})}/><Toggle label="Fade Model When Near" checked={camera.fadeModelWhenNear} onChange={v=>patch({fadeModelWhenNear:v})}/><Toggle label="Show Field of View" checked={camera.showFov} onChange={v=>patch({showFov:v})}/><Toggle label="Show Forward Axis" checked={camera.showForward} onChange={v=>patch({showForward:v})}/><Toggle label="Show Target Line" checked={camera.showTarget} onChange={v=>patch({showTarget:v})}/><Toggle label="Show Motion Path" checked={camera.showPath} onChange={v=>patch({showPath:v})}/><RangeRow label="Helper Length" value={camera.helperLength} min={1} max={50} step={.5} onChange={v=>patch({helperLength:v})}/><div className="text-[9px] leading-relaxed text-neutral-600">Camera body, FOV and motion-path helpers are editor-only. Program Output and OBS never see them.</div>
		</InspectorSection>
		<InspectorSection title="Camera Motion Path">
			<SelectRow label="Interpolation" value={camera.pathInterpolation} options={["linear","smooth","catmullRom"]} labels={{linear:"Linear",smooth:"Smooth Ease",catmullRom:"Catmull-Rom Spline"}} onChange={v=>patch({pathInterpolation:v as VisualProgramCamera["pathInterpolation"]})}/><Toggle label="Closed Spline Tangents" checked={camera.pathClosed} onChange={v=>patch({pathClosed:v})}/><Toggle label="Loop Timeline Path" checked={camera.loop} onChange={v=>patch({loop:v})}/>
			<div className="grid grid-cols-2 gap-2"><button onClick={addKeyframe} className="inspector-btn">◆ Key Current @ {formatTimePrecise(position)}</button><button onClick={keyEditorView} className="inspector-btn">◆ Key Editor View</button></div>
			<div className="grid grid-cols-3 gap-1"><button onClick={generateOrbit} className="inspector-btn">Orbit 360°</button><button onClick={generateDolly} className="inspector-btn">Dolly In</button><button onClick={generateCrane} className="inspector-btn">Crane Up</button></div>
			{camera.keyframes.length?<div className="max-h-[28rem] space-y-1 overflow-auto">{camera.keyframes.map(key=><div key={key.id} className="rounded border border-white/5 bg-white/[.025] p-1.5"><div className="flex items-center gap-1"><button onClick={()=>seek(key.time)} className="min-w-0 flex-1 truncate text-left font-mono text-[8px] text-cyan-300">{key.directorPlanId?"✦ ":""}◆ {formatTimePrecise(key.time)}</button><button onClick={()=>patchKeyframe(key.id,{time:Math.max(0,Math.min(duration,position))})} className="text-[8px] text-neutral-500 hover:text-cyan-200" title="Move this key to the current playhead">⇥ PLAYHEAD</button><button onClick={()=>patch({keyframes:camera.keyframes.filter(k=>k.id!==key.id)})} className="text-neutral-600 hover:text-red-300">×</button></div><div className="mt-1 grid grid-cols-[1fr_90px] items-center gap-1"><span className="truncate text-[8px] text-neutral-600">P {key.positionX.toFixed(1)}, {key.positionY.toFixed(1)}, {key.positionZ.toFixed(1)} · FOV {key.fov.toFixed(0)}°</span><select value={key.easing||"inherit"} onChange={e=>patchKeyframe(key.id,{easing:e.target.value as VisualCameraSegmentEasing})} className="rounded border border-white/10 bg-[#0b0e14] px-1 py-1 text-[8px] text-neutral-400"><option value="inherit">Inherit</option><option value="linear">Linear</option><option value="easeIn">Ease In</option><option value="easeOut">Ease Out</option><option value="easeInOut">Ease In/Out</option><option value="hold">Hold</option></select></div><details className="mt-1 rounded border border-white/5 bg-black/15 p-1.5"><summary className="cursor-pointer text-[8px] uppercase tracking-wider text-neutral-500 hover:text-cyan-200">Edit keyed camera values</summary><div className="mt-2 space-y-1.5"><NumberRow label="Time" value={key.time} min={0} max={duration} step={.01} onChange={v=>patchKeyframe(key.id,{time:v})} suffix="s"/><NumberRow label="Position X" value={key.positionX} min={-1000} step={.05} onChange={v=>patchKeyframe(key.id,{positionX:v})}/><NumberRow label="Position Y" value={key.positionY} min={-1000} step={.05} onChange={v=>patchKeyframe(key.id,{positionY:v})}/><NumberRow label="Position Z" value={key.positionZ} min={-1000} step={.05} onChange={v=>patchKeyframe(key.id,{positionZ:v})}/>{camera.aimMode==="rotation"?<><NumberRow label="Rotation X" value={(key.rotationX??camera.rotationX)*180/Math.PI} min={-360} max={360} step={.1} onChange={v=>patchKeyframe(key.id,{rotationX:v*Math.PI/180})} suffix="°"/><NumberRow label="Rotation Y" value={(key.rotationY??camera.rotationY)*180/Math.PI} min={-360} max={360} step={.1} onChange={v=>patchKeyframe(key.id,{rotationY:v*Math.PI/180})} suffix="°"/><NumberRow label="Rotation Z" value={(key.rotationZ??camera.rotationZ)*180/Math.PI} min={-360} max={360} step={.1} onChange={v=>patchKeyframe(key.id,{rotationZ:v*Math.PI/180})} suffix="°"/></>:camera.targetMode==="point"?<><NumberRow label="Target X" value={key.targetX} min={-1000} step={.05} onChange={v=>patchKeyframe(key.id,{targetX:v})}/><NumberRow label="Target Y" value={key.targetY} min={-1000} step={.05} onChange={v=>patchKeyframe(key.id,{targetY:v})}/><NumberRow label="Target Z" value={key.targetZ} min={-1000} step={.05} onChange={v=>patchKeyframe(key.id,{targetZ:v})}/></>:<><NumberRow label="Target Offset X" value={key.targetOffsetX??camera.targetOffsetX} min={-100} step={.05} onChange={v=>patchKeyframe(key.id,{targetOffsetX:v})}/><NumberRow label="Target Offset Y" value={key.targetOffsetY??camera.targetOffsetY} min={-100} step={.05} onChange={v=>patchKeyframe(key.id,{targetOffsetY:v})}/><NumberRow label="Target Offset Z" value={key.targetOffsetZ??camera.targetOffsetZ} min={-100} step={.05} onChange={v=>patchKeyframe(key.id,{targetOffsetZ:v})}/></>}<RangeRow label="FOV" value={key.fov} min={10} max={140} step={1} onChange={v=>patchKeyframe(key.id,{fov:v})} suffix="°"/><RangeRow label="Focus Distance" value={key.focusDistance??camera.focusDistance} min={.1} max={100} step={.1} onChange={v=>patchKeyframe(key.id,{focusDistance:v})}/><RangeRow label="Focus Bias" value={key.dofBalance??camera.dofBalance} min={-1} max={1} step={.01} onChange={v=>patchKeyframe(key.id,{dofBalance:v,dofAmount:Math.abs(v)})}/><RangeRow label="Maximum Blur" value={key.maxBlur??camera.maxBlur} min={0} max={24} step={.25} onChange={v=>patchKeyframe(key.id,{maxBlur:v})}/><RangeRow label="Bokeh Size" value={key.bokehSize??camera.bokehSize} min={.25} max={4} step={.05} onChange={v=>patchKeyframe(key.id,{bokehSize:v})}/><RangeRow label="Exposure" value={key.exposure??camera.exposure} min={.1} max={4} step={.01} onChange={v=>patchKeyframe(key.id,{exposure:v})}/><RangeRow label="Position Shake" value={key.shakeAmount??camera.shakeAmount} min={0} max={2} step={.005} onChange={v=>patchKeyframe(key.id,{shakeAmount:v})}/><RangeRow label="Shake Frequency" value={key.shakeFrequency??camera.shakeFrequency} min={.1} max={12} step={.05} onChange={v=>patchKeyframe(key.id,{shakeFrequency:v})} suffix=" Hz"/><RangeRow label="Rotational Shake" value={key.shakeRotation??camera.shakeRotation} min={0} max={10} step={.05} onChange={v=>patchKeyframe(key.id,{shakeRotation:v})} suffix="°"/></div></details></div>)}</div>:<div className="text-[9px] text-neutral-600">No camera motion keyframes yet. Capture the current camera or the Editor view, or generate a starter path.</div>}
			<button onClick={()=>patch({keyframes:[]})} disabled={!camera.keyframes.length} className="inspector-btn w-full text-red-300 disabled:opacity-30">Clear Motion Keyframes</button>
		</InspectorSection>
		<InspectorSection title="Camera Cuts / Multicam">
			<div className="text-[9px] text-neutral-600">{cameraCuts.length} cut{cameraCuts.length===1?"":"s"} to this camera. The Program Camera Shots lane in the Visual DAW shows the actual shot spans between cuts.</div>{cameraCuts.length?<div className="max-h-24 space-y-1 overflow-auto">{cameraCuts.map(cut=><div key={cut.id} className="flex items-center justify-between rounded bg-white/[.03] px-2 py-1 text-[9px]"><button onClick={()=>seek(cut.time)} className="font-mono text-cyan-300">{formatTimePrecise(cut.time)}</button><button onClick={()=>setScene(v=>({...v,cameraCuts:v.cameraCuts.filter(x=>x.id!==cut.id)}))} className="text-neutral-600 hover:text-red-300">×</button></div>)}</div>:null}<button onClick={onCut} className="inspector-btn w-full">Add Cut To {camera.name}</button>
		</InspectorSection>
		<button onClick={onRemove} disabled={scene.cameras.length<=1} className="inspector-btn w-full text-red-300 disabled:opacity-30">Remove Camera Object</button>
	</div>
}
function WindInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){
	const patch=(p:Partial<VisualSceneState["wind"]>)=>setScene(v=>({...v,wind:{...v.wind,...p}}));
	return <div className="space-y-5 p-3"><InspectorSection title="Shared World Wind"><Toggle label="Enabled" checked={scene.wind.enabled} onChange={v=>patch({enabled:v})}/><div className="grid grid-cols-2 gap-2"><NumberRow label="Direction X" value={scene.wind.directionX} min={-10} max={10} step={.05} onChange={v=>patch({directionX:v})}/><NumberRow label="Direction Z" value={scene.wind.directionZ} min={-10} max={10} step={.05} onChange={v=>patch({directionZ:v})}/></div><RangeRow label="Strength" value={scene.wind.strength} min={0} max={8} step={.05} onChange={v=>patch({strength:v})}/><RangeRow label="Gustiness" value={scene.wind.gustiness} min={0} max={1} step={.01} onChange={v=>patch({gustiness:v})}/><RangeRow label="Turbulence" value={scene.wind.turbulence} min={0} max={2} step={.02} onChange={v=>patch({turbulence:v})}/><div className="text-[9px] leading-relaxed text-neutral-600">One deterministic wind field drives clouds, weather, particles and optionally dynamic rigid bodies. Local cloud wind remains an additive artistic offset.</div></InspectorSection><InspectorSection title="Affected Systems"><Toggle label="Clouds" checked={scene.wind.affectsClouds} onChange={v=>patch({affectsClouds:v})}/><Toggle label="3D Particles" checked={scene.wind.affectsParticles} onChange={v=>patch({affectsParticles:v})}/><Toggle label="Weather" checked={scene.wind.affectsWeather} onChange={v=>patch({affectsWeather:v})}/><Toggle label="Dynamic Physics" checked={scene.wind.affectsPhysics} onChange={v=>patch({affectsPhysics:v})}/><RangeRow label="Physics Force" value={scene.wind.physicsForce} min={0} max={20} step={.1} onChange={v=>patch({physicsForce:v})}/></InspectorSection></div>
}

function WeatherInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){
	const patch=(p:Partial<VisualSceneState["weather"]>)=>setScene(v=>({...v,weather:{...v.weather,...p}}));
	const choose=(preset:VisualWeatherPreset)=>setScene(v=>({...v,weather:{...v.weather,...weatherPresetPatch(preset)}}));
	return <><InspectorSection title="Weather Preset"><SelectRow label="Preset" value={scene.weather.preset} options={["clear","rain","snow","storm","ash","dust","sandstorm","magic"]} labels={{clear:"Clear / Manual",rain:"Rain",snow:"Snow",storm:"Thunderstorm",ash:"Ash Fall",dust:"Dust",sandstorm:"Sandstorm",magic:"Magic Storm"}} onChange={v=>choose(v as VisualWeatherPreset)}/><RangeRow label="Master Intensity" value={scene.weather.intensity} min={0} max={2} step={.02} onChange={v=>patch({intensity:v})}/><div className="text-[9px] leading-relaxed text-neutral-600">Presets are starting points. After choosing one, every component below remains independently editable and can be mixed.</div></InspectorSection><InspectorSection title="Precipitation / Air"><RangeRow label="Rain" value={scene.weather.rain} min={0} max={1} step={.01} onChange={v=>patch({preset:"clear",rain:v})}/><RangeRow label="Snow" value={scene.weather.snow} min={0} max={1} step={.01} onChange={v=>patch({preset:"clear",snow:v})}/><RangeRow label="Ash" value={scene.weather.ash} min={0} max={1} step={.01} onChange={v=>patch({preset:"clear",ash:v})}/><RangeRow label="Dust" value={scene.weather.dust} min={0} max={1} step={.01} onChange={v=>patch({preset:"clear",dust:v})}/><RangeRow label="Sand" value={scene.weather.sand} min={0} max={1} step={.01} onChange={v=>patch({preset:"clear",sand:v})}/><RangeRow label="Magic" value={scene.weather.magic} min={0} max={1} step={.01} onChange={v=>patch({preset:"clear",magic:v})}/><RangeRow label="Particle Size" value={scene.weather.precipitationSize} min={.2} max={3} step={.05} onChange={v=>patch({precipitationSize:v})}/><RangeRow label="Fall Speed" value={scene.weather.fallSpeed} min={.05} max={4} step={.05} onChange={v=>patch({fallSpeed:v})}/><NumberRow label="Area" value={scene.weather.area} min={4} max={100} step={1} onChange={v=>patch({area:v})}/><NumberRow label="Height" value={scene.weather.height} min={4} max={80} step={1} onChange={v=>patch({height:v})}/></InspectorSection><InspectorSection title="Atmosphere"><RangeRow label="Weather Fog" value={scene.weather.fog} min={0} max={1} step={.01} onChange={v=>patch({fog:v})}/><ColorRow label="Fog Color" value={scene.weather.fogColor} onChange={v=>patch({fogColor:v})}/><RangeRow label="Heat Haze" value={scene.weather.heatHaze} min={0} max={1} step={.01} onChange={v=>patch({heatHaze:v})}/><RangeRow label="Haze Motion" value={scene.weather.heatHazeSpeed} min={0} max={3} step={.05} onChange={v=>patch({heatHazeSpeed:v})}/></InspectorSection><InspectorSection title="Lightning"><RangeRow label="Lightning" value={scene.weather.lightning} min={0} max={1} step={.01} onChange={v=>patch({lightning:v})}/><RangeRow label="Strikes / Minute" value={scene.weather.lightningRate} min={0} max={60} step={1} onChange={v=>patch({lightningRate:v})}/><ColorRow label="Lightning Color" value={scene.weather.lightningColor} onChange={v=>patch({lightningColor:v})}/><div className="text-[9px] leading-relaxed text-neutral-600">Storm flashes are deterministic from timeline time so broadcast playback does not randomly change on every render.</div></InspectorSection></>
}

function CloudsInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){const patch=(p:Partial<VisualSceneState["clouds"]>)=>setScene(v=>({...v,clouds:{...v.clouds,...p}}));return <><InspectorSection title="Volumetric Clouds"><SelectRow label="Quality" value={scene.clouds.quality} options={["performance","high","ultra"]} onChange={v=>patch({quality:v as VisualSceneState["clouds"]["quality"]})}/><RangeRow label="Coverage" value={scene.clouds.coverage} min={.05} max={1} step={.01} onChange={v=>patch({coverage:v})}/><RangeRow label="Density" value={scene.clouds.density} min={.02} max={1} step={.01} onChange={v=>patch({density:v})}/><RangeRow label="Altitude" value={scene.clouds.altitude} min={-5} max={30} step={.1} onChange={v=>patch({altitude:v})}/><RangeRow label="Thickness" value={scene.clouds.thickness} min={.5} max={20} step={.1} onChange={v=>patch({thickness:v})}/><RangeRow label="Scale" value={scene.clouds.scale} min={.2} max={4} step={.05} onChange={v=>patch({scale:v})}/><RangeRow label="Softness" value={scene.clouds.softness} min={0} max={1} step={.02} onChange={v=>patch({softness:v})}/><ColorRow label="Cloud Color" value={scene.clouds.color} onChange={v=>patch({color:v})}/><RangeRow label="Brightness" value={scene.clouds.brightness} min={.2} max={3} step={.05} onChange={v=>patch({brightness:v})}/><RangeRow label="Light Absorption" value={scene.clouds.lightAbsorption} min={0} max={1} step={.01} onChange={v=>patch({lightAbsorption:v})}/></InspectorSection><InspectorSection title="Wind"><RangeRow label="Wind X" value={scene.clouds.windX} min={-3} max={3} step={.05} onChange={v=>patch({windX:v})}/><RangeRow label="Wind Z" value={scene.clouds.windZ} min={-3} max={3} step={.05} onChange={v=>patch({windZ:v})}/><RangeRow label="Speed" value={scene.clouds.speed} min={0} max={2} step={.02} onChange={v=>patch({speed:v})}/></InspectorSection></>}

function ReadoutGrid({rows}:{rows:Array<[string,number,string?]>}){return <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-white/10 bg-black/20 p-2 text-[9px]">{rows.map(([label,value,suffix])=><div key={label} className="contents"><span className="text-neutral-600">{label}</span><span className="text-right font-mono text-neutral-300">{value.toFixed(2)}{suffix||""}</span></div>)}</div>}

function SkyInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){
	const patch=(p:Partial<VisualSceneState["sky"]>)=>setScene(v=>({...v,sky:{...v.sky,...p}}));
	const upload=async(file:File,field:keyof Pick<VisualSceneState["sky"],"sphereUrl"|"boxRightUrl"|"boxLeftUrl"|"boxTopUrl"|"boxBottomUrl"|"boxFrontUrl"|"boxBackUrl">)=>{
		const result=await bridgeApi.uploadVisualMedia(file);
		if(field==="sphereUrl")patch({sphereUrl:result.url,sphereFileName:file.name});
		else patch({[field]:result.url} as Partial<VisualSceneState["sky"]>);
	};
	return <><InspectorSection title="Sky Environment">
		<SelectRow label="Mode" value={scene.sky.mode} options={["sphere","box"]} labels={{sphere:"Sky Sphere",box:"Skybox (6 faces)"}} onChange={v=>patch({mode:v as VisualSceneState["sky"]["mode"]})}/>
		<RangeRow label="Rotation" value={scene.sky.rotationY} min={-3.14} max={3.14} step={.01} onChange={v=>patch({rotationY:v})}/>
		<RangeRow label="Brightness" value={scene.sky.brightness} min={.1} max={3} step={.05} onChange={v=>patch({brightness:v})}/>
		<div className="rounded border border-white/10 bg-white/[.025] p-2 text-[9px] leading-relaxed text-neutral-500">Sky environments stay centered on the camera and ignore scene fog, lights and shadows. They are the only environment layer intended to replace the background image/video.</div>
	</InspectorSection>
	{scene.sky.mode==="sphere"?<InspectorSection title="Sky Sphere">
		<SkyTextureUpload label="Sphere Texture" url={scene.sky.sphereUrl} onFile={f=>upload(f,"sphereUrl")}/>
		<div className="text-[9px] text-neutral-600">{scene.sky.sphereFileName||"Use one equirectangular / spherical panorama texture."}</div>
		<RangeRow label="Approx Polygons" value={scene.sky.spherePolygons} min={256} max={65536} step={256} onChange={v=>patch({spherePolygons:Math.round(v)})}/>
	</InspectorSection>:<InspectorSection title="Skybox Faces">
		<div className="grid grid-cols-2 gap-2">
			<SkyTextureUpload label="Right +X" url={scene.sky.boxRightUrl} onFile={f=>upload(f,"boxRightUrl")}/><SkyTextureUpload label="Left -X" url={scene.sky.boxLeftUrl} onFile={f=>upload(f,"boxLeftUrl")}/>
			<SkyTextureUpload label="Top +Y" url={scene.sky.boxTopUrl} onFile={f=>upload(f,"boxTopUrl")}/><SkyTextureUpload label="Bottom -Y" url={scene.sky.boxBottomUrl} onFile={f=>upload(f,"boxBottomUrl")}/>
			<SkyTextureUpload label="Front +Z" url={scene.sky.boxFrontUrl} onFile={f=>upload(f,"boxFrontUrl")}/><SkyTextureUpload label="Back -Z" url={scene.sky.boxBackUrl} onFile={f=>upload(f,"boxBackUrl")}/>
		</div>
	</InspectorSection>}
	</>
}
function SkyTextureUpload({label,url,onFile}:{label:string;url:string;onFile:(file:File)=>void|Promise<void>}){return <label className="block cursor-pointer rounded border border-white/10 bg-white/[.035] px-2 py-2 text-[9px] text-neutral-400 hover:border-violet-400/30 hover:bg-violet-500/10"><div className="flex items-center justify-between gap-2"><span>{label}</span><span className={url?"text-emerald-400":"text-neutral-700"}>{url?"SET":"ADD"}</span></div><input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden" onChange={e=>{const file=e.currentTarget.files?.[0];if(file)void onFile(file);e.currentTarget.value=""}}/></label>}

function StageInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){
	const patch=(p:Partial<VisualSceneState["stage"]>)=>setScene(v=>({...v,stage:{...v.stage,...p}}));
	return <><InspectorSection title="Atmosphere"><Toggle label="Fog" checked={scene.stage.fogEnabled} onChange={v=>patch({fogEnabled:v})}/><ColorRow label="Fog Color" value={scene.stage.fogColor} onChange={v=>patch({fogColor:v})}/><RangeRow label="Fog Near" value={scene.stage.fogNear} min={1} max={30} step={.25} onChange={v=>patch({fogNear:v})}/><RangeRow label="Fog Far" value={scene.stage.fogFar} min={4} max={60} step={.5} onChange={v=>patch({fogFar:v})}/><SelectRow label="Fog React" value={scene.stage.fogSource} options={AUDIO_SOURCES} onChange={v=>patch({fogSource:v as VisualAudioSource})}/><RangeRow label="Fog Amount" value={scene.stage.fogAmount} min={0} max={2} step={.05} onChange={v=>patch({fogAmount:v})}/></InspectorSection><InspectorSection title="Lighting"><RangeRow label="Ambient" value={scene.stage.ambientIntensity} min={0} max={4} step={.05} onChange={v=>patch({ambientIntensity:v})}/><ColorRow label="Ambient Sky" value={scene.stage.ambientSkyColor} onChange={v=>patch({ambientSkyColor:v})}/><ColorRow label="Ambient Ground" value={scene.stage.ambientGroundColor} onChange={v=>patch({ambientGroundColor:v})}/><ColorRow label="Sun Color" value={scene.stage.sunColor} onChange={v=>patch({sunColor:v})}/><RangeRow label="Sun Intensity" value={scene.stage.sunIntensity} min={0} max={6} step={.05} onChange={v=>patch({sunIntensity:v})}/><RangeRow label="Sun Direction X" value={scene.stage.sunX} min={-12} max={12} step={.1} onChange={v=>patch({sunX:v})}/><RangeRow label="Sun Direction Y" value={scene.stage.sunY} min={-8} max={14} step={.1} onChange={v=>patch({sunY:v})}/><RangeRow label="Sun Direction Z" value={scene.stage.sunZ} min={-12} max={14} step={.1} onChange={v=>patch({sunZ:v})}/><SelectRow label="Sun React" value={scene.stage.sunSource} options={AUDIO_SOURCES} onChange={v=>patch({sunSource:v as VisualAudioSource})}/><RangeRow label="Sun Amount" value={scene.stage.sunAmount} min={0} max={5} step={.05} onChange={v=>patch({sunAmount:v})}/><Toggle label="Moon Directional Light" checked={scene.stage.moonEnabled} onChange={v=>patch({moonEnabled:v})}/>{scene.stage.moonEnabled?<><ColorRow label="Moon Color" value={scene.stage.moonColor} onChange={v=>patch({moonColor:v})}/><RangeRow label="Moon Intensity" value={scene.stage.moonIntensity} min={0} max={6} step={.05} onChange={v=>patch({moonIntensity:v})}/><RangeRow label="Moon Direction X" value={scene.stage.moonX} min={-12} max={12} step={.1} onChange={v=>patch({moonX:v})}/><RangeRow label="Moon Direction Y" value={scene.stage.moonY} min={-8} max={14} step={.1} onChange={v=>patch({moonY:v})}/><RangeRow label="Moon Direction Z" value={scene.stage.moonZ} min={-12} max={14} step={.1} onChange={v=>patch({moonZ:v})}/><SelectRow label="Moon React" value={scene.stage.moonSource} options={AUDIO_SOURCES} onChange={v=>patch({moonSource:v as VisualAudioSource})}/><RangeRow label="Moon Amount" value={scene.stage.moonAmount} min={0} max={5} step={.05} onChange={v=>patch({moonAmount:v})}/></>:null}<ColorRow label="Key Color" value={scene.stage.keyColor} onChange={v=>patch({keyColor:v})}/><RangeRow label="Key Intensity" value={scene.stage.keyIntensity} min={0} max={10} step={.1} onChange={v=>patch({keyIntensity:v})}/><RangeRow label="Key X" value={scene.stage.keyX} min={-12} max={12} step={.1} onChange={v=>patch({keyX:v})}/><RangeRow label="Key Y" value={scene.stage.keyY} min={-6} max={14} step={.1} onChange={v=>patch({keyY:v})}/><RangeRow label="Key Z" value={scene.stage.keyZ} min={-12} max={14} step={.1} onChange={v=>patch({keyZ:v})}/><RangeRow label="Key Cone" value={scene.stage.keyAngle} min={5} max={88} step={1} onChange={v=>patch({keyAngle:v})}/><RangeRow label="Key Penumbra" value={scene.stage.keyPenumbra} min={0} max={1} step={.02} onChange={v=>patch({keyPenumbra:v})}/><RangeRow label="Key Range" value={scene.stage.keyDistance} min={0} max={80} step={1} onChange={v=>patch({keyDistance:v})}/><SelectRow label="Key React" value={scene.stage.keySource} options={AUDIO_SOURCES} onChange={v=>patch({keySource:v as VisualAudioSource})}/><RangeRow label="Key Amount" value={scene.stage.keyAmount} min={0} max={5} step={.05} onChange={v=>patch({keyAmount:v})}/><ColorRow label="Rim Color" value={scene.stage.rimColor} onChange={v=>patch({rimColor:v})}/><RangeRow label="Rim Intensity" value={scene.stage.rimIntensity} min={0} max={12} step={.1} onChange={v=>patch({rimIntensity:v})}/><RangeRow label="Rim X" value={scene.stage.rimX} min={-12} max={12} step={.1} onChange={v=>patch({rimX:v})}/><RangeRow label="Rim Y" value={scene.stage.rimY} min={-8} max={12} step={.1} onChange={v=>patch({rimY:v})}/><RangeRow label="Rim Z" value={scene.stage.rimZ} min={-12} max={14} step={.1} onChange={v=>patch({rimZ:v})}/><SelectRow label="Rim React" value={scene.stage.rimSource} options={AUDIO_SOURCES} onChange={v=>patch({rimSource:v as VisualAudioSource})}/><RangeRow label="Rim Amount" value={scene.stage.rimAmount} min={0} max={5} step={.05} onChange={v=>patch({rimAmount:v})}/><ColorRow label="Fill Color" value={scene.stage.fillColor} onChange={v=>patch({fillColor:v})}/><RangeRow label="Fill Intensity" value={scene.stage.fillIntensity} min={0} max={10} step={.1} onChange={v=>patch({fillIntensity:v})}/><RangeRow label="Fill X" value={scene.stage.fillX} min={-12} max={12} step={.1} onChange={v=>patch({fillX:v})}/><RangeRow label="Fill Y" value={scene.stage.fillY} min={-8} max={12} step={.1} onChange={v=>patch({fillY:v})}/><RangeRow label="Fill Z" value={scene.stage.fillZ} min={-12} max={14} step={.1} onChange={v=>patch({fillZ:v})}/><SelectRow label="Fill React" value={scene.stage.fillSource} options={AUDIO_SOURCES} onChange={v=>patch({fillSource:v as VisualAudioSource})}/><RangeRow label="Fill Amount" value={scene.stage.fillAmount} min={0} max={5} step={.05} onChange={v=>patch({fillAmount:v})}/></InspectorSection><InspectorSection title="Floor + Post"><Toggle label="Floor" checked={scene.stage.floorVisible} onChange={v=>patch({floorVisible:v})}/><ColorRow label="Floor Color" value={scene.stage.floorColor} onChange={v=>patch({floorColor:v})}/><RangeRow label="Floor Opacity" value={scene.stage.floorOpacity} min={0} max={1} step={.01} onChange={v=>patch({floorOpacity:v})}/><RangeRow label="Floor Size" value={scene.stage.floorSize} min={10} max={80} step={1} onChange={v=>patch({floorSize:v})}/><Toggle label="Program Shadows" checked={scene.stage.shadows} onChange={v=>patch({shadows:v})}/><Toggle label="Sun Shadows" checked={scene.stage.sunShadows} onChange={v=>patch({sunShadows:v})}/><Toggle label="Moon Shadows" checked={scene.stage.moonShadows} onChange={v=>patch({moonShadows:v})}/><Toggle label="Key Shadows" checked={scene.stage.keyShadows} onChange={v=>patch({keyShadows:v})}/><SelectRow label="Shadow Map" value={String(scene.stage.shadowMapSize)} options={["512","1024","2048","4096"]} labels={{"512":"512 Performance","1024":"1024 Balanced","2048":"2048 High","4096":"4096 Ultra"}} onChange={v=>patch({shadowMapSize:Number(v)})}/><RangeRow label="Shadow Bias" value={scene.stage.shadowBias} min={-.01} max={.01} step={.00005} onChange={v=>patch({shadowBias:v})}/><RangeRow label="Exposure" value={scene.stage.exposure} min={.2} max={3} step={.05} onChange={v=>patch({exposure:v})}/><Toggle label="Lens Flare" checked={scene.stage.lensFlareEnabled} onChange={v=>patch({lensFlareEnabled:v})}/><RangeRow label="Lens Flare Intensity" value={scene.stage.lensFlareIntensity} min={0} max={3} step={.05} onChange={v=>patch({lensFlareIntensity:v})}/><RangeRow label="Bloom" value={scene.stage.bloomStrength} min={0} max={3} step={.05} onChange={v=>patch({bloomStrength:v})}/><RangeRow label="Bloom Radius" value={scene.stage.bloomRadius} min={0} max={1} step={.02} onChange={v=>patch({bloomRadius:v})}/><RangeRow label="Bloom Threshold" value={scene.stage.bloomThreshold} min={0} max={1} step={.02} onChange={v=>patch({bloomThreshold:v})}/></InspectorSection></>}
function ObjectInspector({scene,setScene,info,live,position,onImport,onNotice}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;info:VisualModelInfo|null;live:VisualPerformanceState|null;position:number;onImport:()=>void;onNotice:(message:string)=>void}){
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
			<div className="grid grid-cols-3 gap-1"><button onClick={()=>patch({model:"mannequin",modelUrl:""})} className={`inspector-btn ${scene.object.model==="mannequin"?"active":""}`}>Rig Dummy</button><button onClick={()=>patch({model:"crystal",modelUrl:""})} className={`inspector-btn ${scene.object.model==="crystal"?"active":""}`}>Crystal</button><button onClick={onImport} className={`inspector-btn ${scene.object.model==="glb"||scene.object.model==="asset"?"active":""}`}>Import Model</button></div>
			<button onClick={()=>patch({model:"glb",modelUrl:"/visuals/YSong-Test-Rig.glb",modelFileName:"YSong-Test-Rig.glb",animation:"Wave",positionY:0,baseScale:1})} className="inspector-btn w-full">Load bundled rig test (Wave / Reach / Bow)</button>
			{scene.object.model==="glb"||scene.object.model==="asset"?<div className="rounded border border-cyan-400/15 bg-cyan-500/5 p-2 text-[10px] text-cyan-100/75"><div className="font-semibold">{scene.object.modelFileName||"3D model"}</div><div className="mt-1 uppercase text-neutral-500">{scene.object.modelFormat}</div>{info&&info.fileName===scene.object.modelFileName?<div className="mt-1">{info.meshes} meshes • {info.bones.length} bones • {info.animations.length} clips</div>:<div className="mt-1">Waiting for model discovery…</div>}</div>:null}
			{info?.animations.length&&(scene.object.model==="glb"||scene.object.model==="asset")?<SelectRow label="Imported Animation" value={scene.object.animation} options={["",...info.animations]} labels={{"":"None"}} onChange={v=>patch({animation:v})}/>:null}
			{info?.morphTargets?.length?<div className="max-h-32 space-y-1 overflow-auto rounded border border-white/5 bg-white/[.02] p-2"><div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-neutral-600">Morph Targets</div>{info.morphTargets.map(name=><RangeRow key={name} label={name} value={scene.object.morphTargets[name]??0} min={0} max={1} step={.01} onChange={v=>patch({morphTargets:{...scene.object.morphTargets,[name]:v}})}/>)}</div>:null}
			<RangeRow label="Animation Speed" value={scene.object.animationSpeed} min={.1} max={3} step={.05} onChange={v=>patch({animationSpeed:v})}/>
		</InspectorSection>
		<InspectorSection title="Performance Director">
			<div className="rounded border border-violet-400/20 bg-violet-500/5 p-2 text-[10px] text-violet-100/80"><div className="flex items-center justify-between gap-2"><span className="font-bold">{PERFORMANCE_BEHAVIORS.length} performance behaviors loaded</span><span className="uppercase text-violet-300">Phase 9</span></div><div className="mt-1 text-neutral-400">Manual cues work without music. Auto Director chooses non-repeating reactions from musical events.</div></div>
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
		<InspectorSection title="Transform"><RangeRow label="Position X" value={scene.object.positionX} min={-10} max={10} step={.05} onChange={v=>patch({positionX:v})}/><RangeRow label="Position Y" value={scene.object.positionY} min={-8} max={8} step={.05} onChange={v=>patch({positionY:v})}/><RangeRow label="Position Z" value={scene.object.positionZ} min={-16} max={10} step={.05} onChange={v=>patch({positionZ:v})}/><RangeRow label="Scale" value={scene.object.baseScale} min={.1} max={12} step={.02} onChange={v=>patch({baseScale:v})}/><RangeRow label="Rotate X" value={scene.object.rotationX} min={-3.14} max={3.14} step={.02} onChange={v=>patch({rotationX:v})}/><RangeRow label="Rotate Y" value={scene.object.rotationY} min={-3.14} max={3.14} step={.02} onChange={v=>patch({rotationY:v})}/><RangeRow label="Rotate Z" value={scene.object.rotationZ} min={-3.14} max={3.14} step={.02} onChange={v=>patch({rotationZ:v})}/></InspectorSection>
		<InspectorSection title="Materials"><SelectRow label="YSong Material" value={scene.object.materialId||""} options={["",...scene.materials.map(m=>m.id)]} labels={{"":"Use Imported Materials",...Object.fromEntries(scene.materials.map(m=>[m.id,m.name]))}} onChange={v=>patch({materialId:v})}/><Toggle label="Legacy Tint Override" checked={scene.object.materialOverride} onChange={v=>patch({materialOverride:v})}/>{scene.object.materialOverride?<><ColorRow label="Tint" value={scene.object.materialTint} onChange={v=>patch({materialTint:v})}/><RangeRow label="Metallic" value={scene.object.materialMetalness} min={0} max={1} step={.01} onChange={v=>patch({materialMetalness:v})}/><RangeRow label="Roughness" value={scene.object.materialRoughness} min={0} max={1} step={.01} onChange={v=>patch({materialRoughness:v})}/></>:null}</InspectorSection><SkeletalAnimationInspector scene={scene} setScene={setScene} info={info} position={position} onNotice={onNotice}/><IKPerformanceInspector scene={scene} setScene={setScene} position={position}/>
		<InspectorSection title="Continuous Audio React"><div className="rounded border border-violet-400/15 bg-violet-500/5 p-2 text-[10px] text-violet-100/70">Continuous motion is separate from the performance behaviors above. Keep it subtle and let cues provide the dramatic movement.</div><RangeRow label="Idle Motion" value={scene.object.idleAmount} min={0} max={1} step={.01} onChange={v=>patch({idleAmount:v})}/><RangeRow label="Manual Test Signal" value={scene.object.testSignal} min={0} max={1} step={.01} onChange={v=>patch({testSignal:v})}/><RangeRow label="Sensitivity" value={scene.object.sensitivity} min={.25} max={6} step={.05} onChange={v=>patch({sensitivity:v})}/><RangeRow label="Dead Zone" value={scene.object.deadZone} min={0} max={.5} step={.01} onChange={v=>patch({deadZone:v})}/><RangeRow label="Attack" value={scene.object.attack} min={.02} max={1} step={.02} onChange={v=>patch({attack:v})}/><RangeRow label="Release" value={scene.object.release} min={.02} max={1} step={.02} onChange={v=>patch({release:v})}/><SelectRow label="Body Source" value={scene.object.bodySource} options={AUDIO_SOURCES} onChange={v=>patch({bodySource:v as VisualAudioSource})}/><RangeRow label="Body Motion" value={scene.object.bodyAmount} min={0} max={3} step={.05} onChange={v=>patch({bodyAmount:v})}/><SelectRow label="Arms Source" value={scene.object.armSource} options={AUDIO_SOURCES} onChange={v=>patch({armSource:v as VisualAudioSource})}/><RangeRow label="Arm Motion" value={scene.object.armAmount} min={0} max={3} step={.05} onChange={v=>patch({armAmount:v})}/><RangeRow label="Spring/Recoil" value={scene.object.springAmount} min={0} max={2} step={.05} onChange={v=>patch({springAmount:v})}/><SelectRow label="Glow Source" value={scene.object.glowSource} options={AUDIO_SOURCES} onChange={v=>patch({glowSource:v as VisualAudioSource})}/><ColorRow label="Emissive Color" value={scene.object.emissiveColor} onChange={v=>patch({emissiveColor:v})}/><RangeRow label="Glow" value={scene.object.glowAmount} min={0} max={4} step={.05} onChange={v=>patch({glowAmount:v})}/></InspectorSection>
		<InspectorSection title="3D Grid Stage"><Toggle label="Visible" checked={scene.grid.visible} onChange={v=>patchGrid({visible:v})}/><RangeRow label="Grid Size" value={scene.grid.size} min={6} max={30} step={1} onChange={v=>patchGrid({size:Math.round(v)})}/><RangeRow label="Grid Opacity" value={scene.grid.intensity} min={0} max={1} step={.01} onChange={v=>patchGrid({intensity:v})}/></InspectorSection>
	</>
}
function ParticlesInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){
	const patch=(p:Partial<VisualSceneState["particles"]>)=>setScene(v=>({...v,particles:{...v.particles,...p}}));
	const upload=async(file:File)=>{const result=await bridgeApi.uploadVisualMedia(file);patch({textureUrl:result.url,textureFileName:file.name,renderMode:"billboard"})};
	return <><InspectorSection title="World-Space 3D Particles"><SelectRow label="Emitter" value={scene.particles.emitter} options={PARTICLE_EMITTERS} onChange={v=>patch({emitter:v as VisualParticleEmitter})}/><RangeRow label="Count" value={scene.particles.count} min={100} max={8000} step={100} onChange={v=>patch({count:Math.round(v)})}/><RangeRow label="Size" value={scene.particles.size} min={1} max={30} step={.2} onChange={v=>patch({size:v})}/><RangeRow label="Depth" value={scene.particles.depth} min={2} max={30} step={.25} onChange={v=>patch({depth:v})}/><RangeRow label="Spread" value={scene.particles.spread} min={1} max={20} step={.25} onChange={v=>patch({spread:v})}/><RangeRow label="Velocity" value={scene.particles.speed} min={0} max={4} step={.05} onChange={v=>patch({speed:v})}/><RangeRow label="Gravity" value={scene.particles.gravity} min={-3} max={3} step={.05} onChange={v=>patch({gravity:v})}/><RangeRow label="Turbulence" value={scene.particles.turbulence} min={0} max={4} step={.05} onChange={v=>patch({turbulence:v})}/><RangeRow label="Orbit" value={scene.particles.orbit} min={-3} max={3} step={.05} onChange={v=>patch({orbit:v})}/><SelectRow label="Audio Source" value={scene.particles.source} options={AUDIO_SOURCES} onChange={v=>patch({source:v as VisualAudioSource})}/><RangeRow label="Audio Amount" value={scene.particles.amount} min={0} max={5} step={.05} onChange={v=>patch({amount:v})}/></InspectorSection><InspectorSection title="Particle Appearance"><SelectRow label="Render Mode" value={scene.particles.renderMode} options={["point","billboard"]} labels={{point:"Point / Spark",billboard:"Billboard Texture"}} onChange={v=>patch({renderMode:v as VisualSceneState["particles"]["renderMode"]})}/>{scene.particles.renderMode==="billboard"?<><SkyTextureUpload label="Transparent Billboard Texture" url={scene.particles.textureUrl} onFile={upload}/><div className="text-[9px] text-neutral-600">{scene.particles.textureFileName||"PNG/WebP alpha is preserved. Points always face the active camera."}</div><RangeRow label="Alpha Cutoff" value={scene.particles.alphaTest} min={0} max={.8} step={.01} onChange={v=>patch({alphaTest:v})}/></>:null}<SelectRow label="Blend" value={scene.particles.blendMode} options={["additive","normal"]} onChange={v=>patch({blendMode:v as VisualSceneState["particles"]["blendMode"]})}/><SelectRow label="Color Mode" value={scene.particles.colorMode} options={["single","bi","tri","gradient","rainbow"]} labels={{single:"Single Color",bi:"Bi-Color",tri:"Tri-Color",gradient:"3-Stop Gradient",rainbow:"Rainbow"}} onChange={v=>patch({colorMode:v as VisualSceneState["particles"]["colorMode"]})}/>{scene.particles.colorMode!=="rainbow"?<ColorRow label="Color A" value={scene.particles.colorA} onChange={v=>patch({colorA:v})}/>:null}{["bi","tri","gradient"].includes(scene.particles.colorMode)?<ColorRow label="Color B" value={scene.particles.colorB} onChange={v=>patch({colorB:v})}/>:null}{["tri","gradient"].includes(scene.particles.colorMode)?<ColorRow label="Color C" value={scene.particles.colorC} onChange={v=>patch({colorC:v})}/>:null}{scene.particles.colorMode==="rainbow"?<RangeRow label="Hue Motion" value={scene.particles.rainbowSpeed} min={0} max={2} step={.01} onChange={v=>patch({rainbowSpeed:v})}/>:null}</InspectorSection></>
}

function SpectrumInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){const patch=(p:Partial<VisualSceneState["spectrum"]>)=>setScene(v=>({...v,spectrum:{...v.spectrum,...p}}));const apply=(id:string)=>{const preset=SPECTRUM_PRESETS.find(x=>x.id===id);if(preset)patch({...DEFAULT_VISUAL_SCENE.spectrum,preset:id,mode:preset.mode,...preset.patch})};return <><InspectorSection title="Spectrum Presets"><div className="grid grid-cols-3 gap-1">{SPECTRUM_PRESETS.map(p=><button key={p.id} onClick={()=>apply(p.id)} className={`rounded border px-1 py-2 text-[9px] ${scene.spectrum.preset===p.id?"border-violet-300/50 bg-violet-500/20":"border-white/10 bg-white/[.03] hover:bg-white/[.06]"}`}>{p.label}</button>)}</div></InspectorSection><InspectorSection title="Spectrum Controls"><SelectRow label="Mode" value={scene.spectrum.mode} options={SPECTRUM_PRESETS.map(x=>x.mode)} onChange={v=>patch({mode:v as VisualSpectrumMode,preset:"custom"})}/><RangeRow label="Position X" value={scene.spectrum.positionX} min={0} max={1} step={.01} onChange={v=>patch({positionX:v,preset:"custom"})}/><RangeRow label="Position Y" value={scene.spectrum.positionY} min={0} max={1} step={.01} onChange={v=>patch({positionY:v,preset:"custom"})}/><RangeRow label="Scale" value={scene.spectrum.scale} min={.1} max={2} step={.02} onChange={v=>patch({scale:v,preset:"custom"})}/><RangeRow label="Rotation" value={scene.spectrum.rotation} min={-3.14} max={3.14} step={.02} onChange={v=>patch({rotation:v,preset:"custom"})}/><RangeRow label="Height" value={scene.spectrum.height} min={.03} max={.8} step={.01} onChange={v=>patch({height:v,preset:"custom"})}/><RangeRow label="Thickness" value={scene.spectrum.thickness} min={.05} max={1} step={.02} onChange={v=>patch({thickness:v,preset:"custom"})}/><RangeRow label="Smoothing" value={scene.spectrum.smoothing} min={0} max={.98} step={.01} onChange={v=>patch({smoothing:v,preset:"custom"})}/><RangeRow label="Glow" value={scene.spectrum.glow} min={0} max={3} step={.05} onChange={v=>patch({glow:v,preset:"custom"})}/></InspectorSection></>}
function NowPlayingInspector({scene,setScene,session}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;session:DawSessionSnapshot|null}){const patch=(p:Partial<VisualSceneState["nowPlaying"]>)=>setScene(v=>({...v,nowPlaying:{...v.nowPlaying,...p}}));return <InspectorSection title="Broadcast Metadata"><TextRow label="Title" value={scene.nowPlaying.title} onChange={v=>patch({title:v})}/><TextRow label="Artist" value={scene.nowPlaying.artist} onChange={v=>patch({artist:v})}/><TextRow label="Album" value={scene.nowPlaying.album} onChange={v=>patch({album:v})}/><RangeRow label="Position X" value={scene.nowPlaying.positionX} min={0} max={1} step={.01} onChange={v=>patch({positionX:v})}/><RangeRow label="Position Y" value={scene.nowPlaying.positionY} min={0} max={1} step={.01} onChange={v=>patch({positionY:v})}/><RangeRow label="Width" value={scene.nowPlaying.width} min={.15} max={.9} step={.01} onChange={v=>patch({width:v})}/><RangeRow label="Font Scale" value={scene.nowPlaying.fontScale} min={.5} max={3} step={.05} onChange={v=>patch({fontScale:v})}/><SelectRow label="Align" value={scene.nowPlaying.align} options={["left","center","right"]} onChange={v=>patch({align:v as VisualSceneState["nowPlaying"]["align"]})}/>{session?<button onClick={()=>patch({title:session.projectName})} className="inspector-btn w-full">Use DAW project name</button>:null}</InspectorSection>}

type MaterialTextureKey = "baseColorMap"|"normalMap"|"bumpMap"|"roughnessMap"|"metalnessMap"|"aoMap"|"emissiveMap"|"alphaMap"|"displacementMap"|"envMap";

function MaterialSphere({material}:{material:VisualMaterialAsset}){
	const gloss=Math.max(0,Math.min(1,1-material.roughness));
	return <div className="mx-auto grid h-12 w-12 place-items-center"><div className="h-10 w-10 rounded-full border border-white/15 shadow-[inset_-8px_-9px_14px_rgba(0,0,0,.7),inset_7px_7px_10px_rgba(255,255,255,.14),0_5px_12px_rgba(0,0,0,.4)]" style={{background:`radial-gradient(circle at 31% 27%, rgba(255,255,255,${.2+.55*gloss}) 0 4%, ${material.baseColor} 26%, ${material.baseColor} 54%, #050509 120%)`,opacity:material.opacity}}/></div>
}

function AiDirectorInspector({scene,setScene,song,plan,setPlan,busy,error,onDraft,onApply,onUndo,canUndo}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;song:VisualDirectorSongContext;plan:VisualDirectorPlan|null;setPlan:React.Dispatch<React.SetStateAction<VisualDirectorPlan|null>>;busy:boolean;error:string;onDraft:()=>Promise<void>;onApply:()=>void;onUndo:()=>void;canUndo:boolean}){
	const patch=(values:Partial<VisualSceneState["director"]>)=>setScene(prev=>({...prev,director:{...prev.director,...values}}));
	const toggleOperation=(id:string,enabled:boolean)=>setPlan(prev=>prev?{...prev,operations:prev.operations.map(op=>op.id===id?{...op,enabled}:op)}:prev);
	const setAll=(enabled:boolean)=>setPlan(prev=>prev?{...prev,operations:prev.operations.map(op=>({...op,enabled}))}:prev);
	const enabledCount=plan?.operations.filter(op=>op.enabled).length||0;
	const styleLabels:Record<string,string>={balanced:"Balanced",cinematic:"Cinematic",aggressive:"Aggressive",ethereal:"Ethereal",minimal:"Minimal"};
	const scopeLabels:Record<string,string>={full:"Full Production",camera:"Camera",performance:"Performance",atmosphere:"Atmosphere",post:"Post FX",reactivity:"Music Reactivity"};
	return <div className="space-y-5 p-3">
		<div><div className="text-sm font-semibold">AI Visual Director</div><div className="mt-.5 text-[10px] uppercase tracking-[.16em] text-cyan-300/80">Phase 15 · deterministic direction, editable results</div></div>
		<div className="rounded-lg border border-cyan-400/15 bg-cyan-500/5 p-2 text-[9px] leading-relaxed text-neutral-400"><b className="text-cyan-200">No hidden runtime authority.</b> The Director drafts the same cameras, cues, animation clips, atmosphere, Post FX and audio mappings you can create manually. Nothing changes until you apply the draft, and every result remains editable afterward.</div>
		<InspectorSection title="Song Brief">
			<div className="rounded border border-white/5 bg-black/20 p-2 text-[9px]"><div className="truncate font-semibold text-neutral-200">{song.title}</div>{song.artist?<div className="truncate text-neutral-500">{song.artist}</div>:null}<div className="mt-1 text-neutral-600">{formatTime(song.durationSeconds)} · {Math.round(song.bpm)} BPM · {song.sigNum}/{song.sigDen}{song.genre?` · ${song.genre}`:""}</div></div>
			<SelectRow label="Style" value={scene.director.style} options={["balanced","cinematic","aggressive","ethereal","minimal"]} labels={styleLabels} onChange={v=>patch({style:v as VisualAiDirectorStyle})}/>
			<SelectRow label="Scope" value={scene.director.scope} options={["full","camera","performance","atmosphere","post","reactivity"]} labels={scopeLabels} onChange={v=>patch({scope:v as VisualAiDirectorScope})}/>
			<RangeRow label="Intensity" value={scene.director.intensity} min={0} max={1} step={.01} onChange={v=>patch({intensity:v})}/>
			<NumberRow label="Seed" value={scene.director.seed} min={0} max={2147483647} step={1} onChange={v=>patch({seed:Math.round(v)})}/>
			<label className="block text-[10px] text-neutral-400"><span>Direction / Notes</span><textarea value={scene.director.prompt} onChange={e=>patch({prompt:e.target.value})} rows={4} placeholder="Example: start restrained, build dread through verse 2, huge moonlit chorus, cut hard on the final kick…" className="mt-1 w-full resize-y rounded border border-white/10 bg-[#121620] px-2 py-1.5 text-xs leading-relaxed text-neutral-100 outline-none focus:border-cyan-400/40"/></label>
			<Toggle label="Preserve manual timeline events" checked={scene.director.preserveManual} onChange={v=>patch({preserveManual:v})}/>
			<Toggle label="Replace previous Director timeline plan" checked={scene.director.replacePreviousDirectorPlan} onChange={v=>patch({replacePreviousDirectorPlan:v})}/>
			<div className="text-[8px] leading-relaxed text-neutral-600">Preserve Manual avoids collisions with your existing authored timeline events. Replacing a previous plan removes Director-tagged timeline/cue/mapping objects before applying the new draft. Static scene values remain ordinary editable scene values and are protected by Undo Last Apply.</div>
			<button onClick={()=>void onDraft()} disabled={busy} className="inspector-btn w-full disabled:opacity-40">{busy?"Directing…":"✦ Draft Director Plan"}</button>
			{error?<div className="rounded border border-red-400/20 bg-red-500/5 p-2 text-[9px] text-red-200">{error}</div>:null}
		</InspectorSection>
		<InspectorSection title="Draft Plan">
			{!plan?<div className="rounded border border-white/5 bg-white/[.02] p-3 text-center text-[9px] text-neutral-600">No draft yet. Drafting is non-destructive; review individual operations before applying anything.</div>:<>
				<div className="rounded-lg border border-white/10 bg-white/[.025] p-2"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="truncate text-[10px] font-bold text-neutral-200">{plan.title}</div><div className="mt-.5 text-[8px] uppercase tracking-[.14em] text-neutral-600">Seed {plan.seed} · {plan.operations.length} operations</div></div><span className={`rounded border px-1.5 py-.5 text-[8px] font-bold tracking-wider ${plan.source==="ai"?"border-cyan-400/25 bg-cyan-500/10 text-cyan-200":"border-amber-400/25 bg-amber-500/10 text-amber-200"}`}>{plan.source==="ai"?"AI PLAN":"DETERMINISTIC FALLBACK"}</span></div><div className="mt-2 text-[9px] leading-relaxed text-neutral-500">{plan.summary}</div></div>
				<div className="flex gap-1"><button onClick={()=>setAll(true)} className="inspector-btn flex-1">Enable All</button><button onClick={()=>setAll(false)} className="inspector-btn flex-1">Disable All</button></div>
				<div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">{plan.operations.map(op=>{const timeLabel="time" in op?formatTimePrecise(op.time):op.kind==="audioBinding"?op.source.toUpperCase():"STATIC";return <label key={op.id} className={`block cursor-pointer rounded border p-2 ${op.enabled?"border-cyan-400/20 bg-cyan-500/[.04]":"border-white/5 bg-black/10 opacity-55"}`}><div className="flex items-start gap-2"><input type="checkbox" checked={op.enabled} onChange={e=>toggleOperation(op.id,e.target.checked)} className="mt-.5 accent-cyan-400"/><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-semibold text-neutral-300">{visualDirectorOperationLabel(op)}</span><span className="shrink-0 font-mono text-[8px] text-cyan-300/70">{timeLabel}</span></div>{op.note?<div className="mt-1 text-[8px] leading-relaxed text-neutral-600">{op.note}</div>:null}</div></div></label>})}</div>
				<div className="grid grid-cols-2 gap-1"><button onClick={onApply} disabled={!enabledCount} className="inspector-btn disabled:opacity-35">Apply {enabledCount}</button><button onClick={()=>setPlan(null)} className="inspector-btn">Clear Draft</button></div>
			</>}
			<button onClick={onUndo} disabled={!canUndo} className="inspector-btn w-full disabled:opacity-30">↶ Undo Last Director Apply</button>
			{scene.director.lastPlanSource?<div className="rounded border border-white/5 bg-black/20 p-2 text-[8px] leading-relaxed text-neutral-600"><div>Last applied: <span className="text-neutral-400">{scene.director.lastPlanSource.toUpperCase()} · {scene.director.lastPlanSummary||"Director plan"}</span></div><div className="mt-1">Generated objects are normal YSong data. Move the diamonds, edit the camera, delete the cues, change the weather, or ignore the AI entirely.</div></div>:null}
		</InspectorSection>
	</div>
}

function AudioModulationInspector({scene,setScene,audio,transport,position}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;audio:VisualAudioFrame;transport:VisualTransportState;position:number}){
	const targets=buildVisualModulationTargets(scene);
	const targetLabels=Object.fromEntries(targets.map(option=>[option.id,`${option.group} · ${option.label.replace(/^.*? · /,"")}`]));
	const sourceLabels:Record<string,string>={bass:"Bass",mids:"Mids",highs:"Highs",energy:"Energy",kick:"Kick / Transient",rms:"Overall RMS",peak:"Peak",beat:"Beat",bar:"Bar / Downbeat"};
	const sources=visualModulationSourceValues(audio,transport,position);
	const patchRoot=(patch:Partial<VisualSceneState["audioModulation"]>)=>setScene(prev=>({...prev,audioModulation:{...prev.audioModulation,...patch}}));
	const patchBinding=(id:string,patch:Partial<VisualSceneState["audioModulation"]["bindings"][number]>)=>setScene(prev=>({...prev,audioModulation:{...prev.audioModulation,bindings:prev.audioModulation.bindings.map(binding=>binding.id===id?{...binding,...patch,directorPlanId:undefined}:binding)}}));
	const removeBinding=(id:string)=>setScene(prev=>({...prev,audioModulation:{...prev.audioModulation,bindings:prev.audioModulation.bindings.filter(binding=>binding.id!==id)}}));
	const addBinding=()=>setScene(prev=>({...prev,audioModulation:{...prev.audioModulation,bindings:[...prev.audioModulation.bindings,makeVisualAudioBinding(targets.some(option=>option.id==="stage.bloomStrength")?"stage.bloomStrength":targets[0]?.id)]}}));
	const pulseTest=()=>{patchRoot({testSignal:1});window.setTimeout(()=>setScene(prev=>({...prev,audioModulation:{...prev.audioModulation,testSignal:0}})),550)};
	return <div className="space-y-5 p-3"><div><div className="text-sm font-semibold">Music-Reactive Everything</div><div className="mt-.5 text-[10px] uppercase tracking-[.16em] text-fuchsia-400/80">Phase 5 generic modulation matrix</div></div><InspectorSection title="Master"><Toggle label="Enable Audio Modulation" checked={scene.audioModulation.enabled} onChange={v=>patchRoot({enabled:v})}/><RangeRow label="Master Amount" value={scene.audioModulation.masterAmount} min={0} max={4} step={.01} onChange={v=>patchRoot({masterAmount:v})}/><RangeRow label="Test Signal" value={scene.audioModulation.testSignal} min={0} max={1} step={.01} onChange={v=>patchRoot({testSignal:v})}/><button onClick={pulseTest} className="inspector-btn w-full">Pulse Test Signal</button><div className="grid grid-cols-3 gap-1">{MODULATION_AUDIO_SOURCES.map(source=><div key={source} className="rounded border border-white/5 bg-black/20 px-1.5 py-1"><div className="truncate text-[7px] uppercase tracking-wide text-neutral-600">{sourceLabels[source]||source}</div><div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-violet-400" style={{width:`${Math.max(0,Math.min(1,sources[source]||0))*100}%`}}/></div></div>)}</div><div className="rounded border border-fuchsia-400/15 bg-fuchsia-500/5 p-2 text-[9px] leading-relaxed text-neutral-500">Any mapping adds a smoothed audio-driven offset to the authored value. Negative Amount values move the parameter the opposite direction. Beat/Bar use DAW tempo when available; World falls back to detected Kick for Beat and does not invent a Bar pulse.</div></InspectorSection><InspectorSection title="Mappings"><button onClick={addBinding} disabled={!targets.length} className="inspector-btn w-full">+ Add Audio Mapping</button>{scene.audioModulation.bindings.length===0?<div className="rounded border border-white/5 bg-white/[.02] p-3 text-center text-[9px] text-neutral-600">No generic mappings yet. Existing dedicated particle/light/performer reactions still work; Phase 5 mappings are additive.</div>:null}{scene.audioModulation.bindings.map((binding,index)=>{const meta=targets.find(option=>option.id===binding.target)??targets[0];return <div key={binding.id} className="space-y-2 rounded-lg border border-white/10 bg-white/[.025] p-2"><div className="flex items-center justify-between gap-2"><span className="text-[9px] font-bold uppercase tracking-[.12em] text-violet-300">{binding.directorPlanId?"✦ ":""}{binding.name||`Mapping ${index+1}`}</span><button onClick={()=>removeBinding(binding.id)} className="text-[9px] text-neutral-600 hover:text-red-300">REMOVE</button></div><Toggle label="Enabled" checked={binding.enabled} onChange={v=>patchBinding(binding.id,{enabled:v})}/><TextRow label="Name" value={binding.name} onChange={v=>patchBinding(binding.id,{name:v})}/><SelectRow label="Audio Source" value={binding.source} options={MODULATION_AUDIO_SOURCES} labels={sourceLabels} onChange={v=>patchBinding(binding.id,{source:v as VisualAudioSource})}/><div className="flex items-center justify-between text-[9px] text-neutral-600"><span>Live Source</span><span className="font-mono text-violet-300">{(sources[binding.source]||0).toFixed(3)}</span></div><SelectRow label="Target" value={binding.target} options={targets.map(option=>option.id)} labels={targetLabels} onChange={v=>patchBinding(binding.id,{target:v})}/>{meta?<RangeRow label="Amount" value={binding.amount} min={meta.amountMin} max={meta.amountMax} step={meta.amountStep} onChange={v=>patchBinding(binding.id,{amount:v})}/>:<NumberRow label="Amount" value={binding.amount} min={-100} max={100} step={.05} onChange={v=>patchBinding(binding.id,{amount:v})}/>}<RangeRow label="Attack" value={binding.attack} min={.001} max={2} step={.01} onChange={v=>patchBinding(binding.id,{attack:v})} suffix="s"/><RangeRow label="Release" value={binding.release} min={.001} max={4} step={.01} onChange={v=>patchBinding(binding.id,{release:v})} suffix="s"/><RangeRow label="Threshold" value={binding.threshold} min={0} max={.95} step={.01} onChange={v=>patchBinding(binding.id,{threshold:v})}/><SelectRow label="Response Curve" value={binding.curve} options={["linear","smoothstep","easeIn","easeOut"]} labels={{linear:"Linear",smoothstep:"Smooth",easeIn:"Ease In",easeOut:"Ease Out"}} onChange={v=>patchBinding(binding.id,{curve:v as VisualSceneState["audioModulation"]["bindings"][number]["curve"]})}/><Toggle label="Invert Source" checked={binding.invert} onChange={v=>patchBinding(binding.id,{invert:v})}/></div>})}</InspectorSection></div>
}

function RendererInspector({scene,setScene,stats}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;stats:VisualOutputStats|null}){
	const patch=(p:Partial<VisualSceneState["renderer"]>)=>setScene(v=>({...v,renderer:{...v.renderer,...p}}));
	const qualityOptions=["auto","performance","high","ultra","custom"];
	const qualityLabels={auto:"Auto / Hardware",performance:"Performance",high:"High",ultra:"Ultra",custom:"Custom"};
	const customActive=scene.renderer.editorQuality==="custom"||scene.renderer.programQuality==="custom";
	const megapixels=stats?(stats.internalWidth*stats.internalHeight/1_000_000):0;
	return <div className="space-y-5 p-3">
		<div><div className="text-sm font-semibold">Renderer Quality</div><div className="mt-.5 text-[10px] uppercase tracking-[.16em] text-violet-400/70">Phase 11 capability-aware quality tiers</div></div>
		<InspectorSection title="Quality Tiers">
			<SelectRow label="Editor Preview" value={scene.renderer.editorQuality} options={qualityOptions} labels={qualityLabels} onChange={v=>patch({editorQuality:v as VisualSceneState["renderer"]["editorQuality"]})}/>
			<SelectRow label="Program / OBS" value={scene.renderer.programQuality} options={qualityOptions} labels={qualityLabels} onChange={v=>patch({programQuality:v as VisualSceneState["renderer"]["programQuality"]})}/>
			<Toggle label="Editor Viewport AA" checked={scene.renderer.editorAntialias} onChange={v=>patch({editorAntialias:v})}/>
			<Toggle label="Program / OBS AA" checked={scene.renderer.programAntialias} onChange={v=>patch({programAntialias:v})}/>
			<div className="rounded border border-white/5 bg-white/[.025] p-2 text-[9px] leading-relaxed text-neutral-500">Performance, High, and Ultra are non-destructive runtime budgets. They scale render resolution, AA, shadow-map ceiling, cloud/particle budgets, AO samples, texture anisotropy, sky tessellation, and secondary-physics solver effort without rewriting the authored scene.</div>
		</InspectorSection>
		{customActive?<InspectorSection title="Custom Quality">
			<SelectRow label="Anti-Aliasing" value={scene.renderer.antialiasMode} options={["off","fxaa","smaa","msaa2","msaa4","msaa8"]} labels={{off:"Off",fxaa:"FXAA",smaa:"SMAA",msaa2:"MSAA 2x",msaa4:"MSAA 4x",msaa8:"MSAA 8x"}} onChange={v=>patch({antialiasMode:v as VisualSceneState["renderer"]["antialiasMode"]})}/>
			<RangeRow label="Render Scale" value={scene.renderer.renderScale*100} min={50} max={200} step={5} onChange={v=>patch({renderScale:v/100})} suffix="%"/>
			<RangeRow label="Post-AA Sharpen" value={scene.renderer.sharpen} min={0} max={1} step={.01} onChange={v=>patch({sharpen:v})}/>
			<div className="text-[9px] leading-relaxed text-neutral-600">Unsupported MSAA levels fall back automatically. Custom keeps the authored shadow-map and secondary-solver controls while still respecting actual GPU limits.</div>
		</InspectorSection>:<InspectorSection title="Finish"><RangeRow label="Post-AA Sharpen" value={scene.renderer.sharpen} min={0} max={1} step={.01} onChange={v=>patch({sharpen:v})}/></InspectorSection>}
		<InspectorSection title="Adaptive Resolution">
			<Toggle label="Dynamic Resolution" checked={scene.renderer.adaptiveResolution} onChange={v=>patch({adaptiveResolution:v})}/>
			{scene.renderer.adaptiveResolution?<><RangeRow label="Target FPS" value={scene.renderer.adaptiveTargetFps} min={24} max={120} step={1} onChange={v=>patch({adaptiveTargetFps:Math.round(v)})}/><RangeRow label="Minimum Scale" value={scene.renderer.adaptiveMinScale*100} min={40} max={100} step={5} onChange={v=>patch({adaptiveMinScale:Math.min(v/100,scene.renderer.adaptiveMaxScale)})} suffix="%"/><RangeRow label="Maximum Scale" value={scene.renderer.adaptiveMaxScale*100} min={40} max={100} step={5} onChange={v=>patch({adaptiveMaxScale:Math.max(v/100,scene.renderer.adaptiveMinScale)})} suffix="%"/></>:null}
			<div className="text-[9px] leading-relaxed text-neutral-600">Adaptive Resolution only changes the internal 3D render size. It does not alter song timing, choreography, physics state, camera paths, or project resolution. It backs off after sustained misses and recovers conservatively after sustained headroom.</div>
		</InspectorSection>
		<InspectorSection title="Live Hardware / Render Budget">
			{stats?<div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px]">
				<span className="text-neutral-600">GPU</span><span className="truncate text-right" title={stats.renderer}>{stats.renderer}</span>
				<span className="text-neutral-600">GPU class</span><span className="text-right uppercase">{stats.gpuClass}</span>
				<span className="text-neutral-600">Recommended</span><span className="text-right font-semibold text-violet-300">{stats.recommendedTier.toUpperCase()}</span>
				<span className="text-neutral-600">Active quality</span><span className="text-right">{stats.qualityLabel}</span>
				<span className="text-neutral-600">Internal render</span><span className="text-right">{stats.internalWidth}×{stats.internalHeight} · {megapixels.toFixed(2)} MP</span>
				<span className="text-neutral-600">Effective scale</span><span className="text-right">{Math.round(stats.renderScale*100)}%</span>
				<span className="text-neutral-600">Adaptive multiplier</span><span className="text-right">{Math.round(stats.adaptiveScale*100)}%</span>
				<span className="text-neutral-600">AA</span><span className="text-right uppercase">{stats.antialiasMode}</span>
				<span className="text-neutral-600">MSAA capability</span><span className="text-right">{stats.maxSamples}x</span>
				<span className="text-neutral-600">Max texture</span><span className="text-right">{stats.maxTextureSize}px</span>
				<span className="text-neutral-600">Anisotropy</span><span className="text-right">{stats.maxAnisotropy}x</span>
				<span className="text-neutral-600">Draw calls</span><span className="text-right">{stats.drawCalls.toLocaleString()}</span>
				<span className="text-neutral-600">Triangles</span><span className="text-right">{stats.triangles.toLocaleString()}</span>
				<span className="text-neutral-600">GPU resources</span><span className="text-right">{stats.geometries} geo · {stats.textures} tex</span>
			</div>:<div className="text-[9px] text-neutral-600">Start the embedded Visual Output to read the browser/GPU capability report.</div>}
			<div className="rounded border border-cyan-400/10 bg-cyan-500/[.035] p-2 text-[9px] leading-relaxed text-neutral-500">{stats?.rtxClassHint?"RTX-class hardware detected by renderer name. YSong can budget Ultra aggressively, but the current WebGL2 path does not pretend to expose native ray tracing, DLSS, or frame generation. Those remain future renderer backends.":"YSong's current renderer is WebGL2 and never requires RTX hardware. Ray tracing, DLSS-style upscaling, and frame generation remain explicit future backends rather than fake checkboxes."}</div>
		</InspectorSection>
	</div>
}

function PostFxInspector({scene,setScene,onNotice}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;onNotice:(message:string)=>void}){
	const patch=(p:Partial<VisualSceneState["postFx"]>)=>setScene(v=>({...v,postFx:{...v.postFx,...p}}));
	const [newType,setNewType]=useState<VisualPostFxModuleType>("bloom");
	const labels:Record<VisualPostFxModuleType,string>={ambientOcclusion:"Ambient Occlusion",depthOfField:"Depth of Field",bloom:"Bloom",lightShafts:"Light Shafts",colorGrade:"Color Grade",lut:"3D LUT",lens:"Lens / Distortion",film:"Film / Finish"};
	const types=Object.keys(labels) as VisualPostFxModuleType[];
	const mutateStack=(fn:(stack:VisualSceneState["postFx"]["stack"])=>VisualSceneState["postFx"]["stack"])=>setScene(v=>({...v,postFx:{...v.postFx,stack:fn(v.postFx.stack)}}));
	const add=()=>mutateStack(stack=>[...stack,{id:`post-${crypto.randomUUID()}`,type:newType,name:labels[newType],enabled:true}]);
	const move=(index:number,delta:number)=>mutateStack(stack=>{const next=[...stack];const to=index+delta;if(to<0||to>=next.length)return next;[next[index],next[to]]=[next[to],next[index]];return next});
	const duplicate=(index:number)=>mutateStack(stack=>{const source=stack[index];if(!source)return stack;const next=[...stack];next.splice(index+1,0,{...source,id:`post-${crypto.randomUUID()}`,name:`${source.name} Copy`});return next});
	const remove=(id:string)=>mutateStack(stack=>stack.filter(module=>module.id!==id));
	const toggle=(id:string,enabled:boolean)=>mutateStack(stack=>stack.map(module=>module.id===id?{...module,enabled}:module));
	const lutInputRef=useRef<HTMLInputElement|null>(null);
	const uploadLut=async(file:File)=>{try{const result=await bridgeApi.uploadVisualMedia(file);patch({lutUrl:result.url,lutFileName:file.name});onNotice(`${file.name} loaded as the active 3D LUT.`);}catch(error){onNotice(error instanceof Error?error.message:"LUT upload failed.")}};
	return <div className="space-y-5 p-3"><div><div className="text-sm font-semibold">Lighting + Post FX</div><div className="mt-.5 text-[10px] uppercase tracking-[.16em] text-violet-400/70">Phase 7 modular realtime finishing stack</div></div>
		<InspectorSection title="Ordered Post FX Stack">
			<div className="grid grid-cols-[1fr_auto] gap-1"><SelectRow label="Add Module" value={newType} options={types} labels={labels} onChange={v=>setNewType(v as VisualPostFxModuleType)}/><button onClick={add} className="inspector-btn">+ Add</button></div>
			<div className="space-y-1.5">{scene.postFx.stack.map((module,index)=><div key={module.id} className="flex items-center gap-1 rounded border border-white/10 bg-white/[.025] p-1.5"><input type="checkbox" checked={module.enabled} onChange={e=>toggle(module.id,e.target.checked)} className="accent-violet-400"/><span className="min-w-0 flex-1 truncate text-[9px] text-neutral-300">{index+1}. {module.name}</span><button onClick={()=>move(index,-1)} disabled={index===0} className="inspector-btn px-2 disabled:opacity-25">↑</button><button onClick={()=>move(index,1)} disabled={index===scene.postFx.stack.length-1} className="inspector-btn px-2 disabled:opacity-25">↓</button><button onClick={()=>duplicate(index)} className="inspector-btn px-2">⧉</button><button onClick={()=>remove(module.id)} className="inspector-btn px-2 text-red-300">×</button></div>)}</div>
			<div className="text-[9px] leading-relaxed text-neutral-600">The order above is the actual EffectComposer order. Duplicate modules really run twice. Delete a module to remove it from the render path, then add it back whenever you want.</div>
		</InspectorSection>
		<InspectorSection title="Tone Mapping + Exposure"><SelectRow label="Tone Mapping" value={scene.postFx.toneMapping} options={["none","linear","reinhard","cineon","aces","agx","neutral"]} labels={{none:"None",linear:"Linear",reinhard:"Reinhard",cineon:"Cineon / Filmic",aces:"ACES Filmic",agx:"AgX",neutral:"Neutral"}} onChange={v=>patch({toneMapping:v as VisualSceneState["postFx"]["toneMapping"]})}/><RangeRow label="Post Exposure" value={scene.postFx.exposure} min={.1} max={4} step={.01} onChange={v=>patch({exposure:v})}/><div className="text-[9px] leading-relaxed text-neutral-600">Stage Exposure controls scene lighting exposure. Post Exposure is an additional finishing multiplier, so cameras/lights stay physically understandable while the final grade can still be pushed.</div></InspectorSection>
		<InspectorSection title="Ambient Occlusion"><RangeRow label="AO Intensity" value={scene.postFx.ambientOcclusionIntensity} min={0} max={3} step={.02} onChange={v=>patch({ambientOcclusionIntensity:v})}/><RangeRow label="AO Radius" value={scene.postFx.ambientOcclusionRadius} min={.1} max={16} step={.1} onChange={v=>patch({ambientOcclusionRadius:v})}/><div className="text-[9px] text-neutral-600">Uses GTAO. Keep it subtle for skin and large clean sets; push it harder for stone ruins, machinery and architectural detail.</div></InspectorSection>
		<InspectorSection title="Bloom + Light Shafts"><RangeRow label="Bloom Strength" value={scene.stage.bloomStrength} min={0} max={5} step={.02} onChange={v=>setScene(prev=>({...prev,stage:{...prev.stage,bloomStrength:v}}))}/><RangeRow label="Bloom Radius" value={scene.stage.bloomRadius} min={0} max={1} step={.01} onChange={v=>setScene(prev=>({...prev,stage:{...prev.stage,bloomRadius:v}}))}/><RangeRow label="Bloom Threshold" value={scene.stage.bloomThreshold} min={0} max={1} step={.01} onChange={v=>setScene(prev=>({...prev,stage:{...prev.stage,bloomThreshold:v}}))}/><RangeRow label="God Rays / Shafts" value={scene.postFx.lightShaftsIntensity} min={0} max={3} step={.02} onChange={v=>patch({lightShaftsIntensity:v})}/><SelectRow label="Shaft Source" value={scene.postFx.lightShaftsSource} options={["sun","moon"]} labels={{sun:"Sun",moon:"Moon"}} onChange={v=>patch({lightShaftsSource:v as "sun"|"moon"})}/><RangeRow label="Shaft Decay" value={scene.postFx.lightShaftsDecay} min={.7} max={.995} step={.001} onChange={v=>patch({lightShaftsDecay:v})}/><RangeRow label="Shaft Density" value={scene.postFx.lightShaftsDensity} min={.1} max={1.4} step={.01} onChange={v=>patch({lightShaftsDensity:v})}/><RangeRow label="Shaft Weight" value={scene.postFx.lightShaftsWeight} min={.01} max={.8} step={.01} onChange={v=>patch({lightShaftsWeight:v})}/></InspectorSection>
		<InspectorSection title="Color Grade"><Toggle label="Enable Color Grade" checked={scene.postFx.colorGradeEnabled} onChange={v=>patch({colorGradeEnabled:v})}/><RangeRow label="Brightness" value={scene.postFx.brightness} min={.25} max={2} step={.01} onChange={v=>patch({brightness:v})}/><RangeRow label="Contrast" value={scene.postFx.contrast} min={.25} max={2} step={.01} onChange={v=>patch({contrast:v})}/><RangeRow label="Saturation" value={scene.postFx.saturation} min={0} max={2.5} step={.01} onChange={v=>patch({saturation:v})}/><RangeRow label="Temperature" value={scene.postFx.temperature} min={-1} max={1} step={.01} onChange={v=>patch({temperature:v})}/><RangeRow label="Tint" value={scene.postFx.tint} min={-1} max={1} step={.01} onChange={v=>patch({tint:v})}/><RangeRow label="Lift" value={scene.postFx.lift} min={-.5} max={.5} step={.005} onChange={v=>patch({lift:v})}/><RangeRow label="Gamma" value={scene.postFx.gamma} min={.25} max={3} step={.01} onChange={v=>patch({gamma:v})}/><RangeRow label="Gain" value={scene.postFx.gain} min={0} max={3} step={.01} onChange={v=>patch({gain:v})}/></InspectorSection>
		<InspectorSection title="3D LUT"><input ref={lutInputRef} type="file" accept=".cube,.3dl" className="hidden" onChange={e=>{const file=e.target.files?.[0];if(file)void uploadLut(file);e.currentTarget.value=""}}/><div className="flex items-center gap-2"><button onClick={()=>lutInputRef.current?.click()} className="inspector-btn flex-1">Load .CUBE / .3DL</button><button onClick={()=>patch({lutUrl:"",lutFileName:""})} disabled={!scene.postFx.lutUrl} className="inspector-btn disabled:opacity-30">Clear</button></div><div className="truncate rounded border border-white/5 bg-black/20 px-2 py-1.5 text-[9px] text-neutral-500">{scene.postFx.lutFileName||"No LUT loaded"}</div><RangeRow label="LUT Intensity" value={scene.postFx.lutIntensity} min={0} max={1} step={.01} onChange={v=>patch({lutIntensity:v})}/><div className="text-[9px] leading-relaxed text-neutral-600">Standard 3D color lookup tables are applied as a true reorderable stack module. The LUT file remains an asset reference; it is not baked destructively into the scene.</div></InspectorSection>
		<InspectorSection title="Lens"><RangeRow label="Chromatic Aberration" value={scene.postFx.chromaticAberration} min={0} max={1} step={.005} onChange={v=>patch({chromaticAberration:v})}/><RangeRow label="Barrel / Pincushion" value={scene.postFx.lensDistortion} min={-1} max={1} step={.005} onChange={v=>patch({lensDistortion:v})}/><RangeRow label="Lens Zoom" value={scene.postFx.lensZoom} min={.65} max={1.5} step={.005} onChange={v=>patch({lensZoom:v})}/><RangeRow label="Post-AA Sharpen" value={scene.renderer.sharpen} min={0} max={1} step={.01} onChange={v=>setScene(prev=>({...prev,renderer:{...prev.renderer,sharpen:v}}))}/></InspectorSection>
		<InspectorSection title="Film Finish"><RangeRow label="Halation" value={scene.postFx.halation} min={0} max={2} step={.01} onChange={v=>patch({halation:v})}/><RangeRow label="Film Grain" value={scene.postFx.filmGrain} min={0} max={1} step={.01} onChange={v=>patch({filmGrain:v})}/><RangeRow label="Vignette" value={scene.postFx.vignette} min={0} max={1} step={.01} onChange={v=>patch({vignette:v})}/><RangeRow label="Vignette Softness" value={scene.postFx.vignetteSoftness} min={.05} max={.9} step={.01} onChange={v=>patch({vignetteSoftness:v})}/></InspectorSection>
		<div className="rounded border border-violet-400/15 bg-violet-500/5 p-2 text-[9px] leading-relaxed text-neutral-500">Scene/world effects such as weather fog and clouds stay in the world engine. Camera optics stay on each Program Camera. This stack is final-image processing and can be reordered independently.</div>
	</div>
}

function PhysicsInspector({scene,setScene}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){
	const patch=(p:Partial<VisualSceneState["physics"]>)=>setScene(v=>({...v,physics:{...v.physics,...p}}));
	return <div className="space-y-5 p-3"><div><div className="text-sm font-semibold">Physics World</div><div className="mt-.5 text-[10px] uppercase tracking-[.16em] text-violet-400/70">Rapier rigid bodies + YSong secondary dynamics</div></div>
		<InspectorSection title="World Simulation"><Toggle label="Physics Enabled" checked={scene.physics.enabled} onChange={v=>patch({enabled:v})}/><SelectRow label="Mode" value={scene.physics.mode} options={["edit","simulate"]} labels={{edit:"Edit / Paused",simulate:"Simulate / Live"}} onChange={v=>patch({mode:v as VisualSceneState["physics"]["mode"]})}/><RangeRow label="Gravity Y" value={scene.physics.gravityY} min={-30} max={30} step={.1} onChange={v=>patch({gravityY:v})}/><Toggle label="Ground Collider" checked={scene.physics.groundEnabled} onChange={v=>patch({groundEnabled:v})}/><NumberRow label="Ground Y" value={scene.physics.groundY} min={-1000} max={1000} step={.05} onChange={v=>patch({groundY:v})}/><button onClick={()=>patch({resetSequence:scene.physics.resetSequence+1})} className="inspector-btn w-full">Reset ALL Simulation</button><div className="text-[9px] leading-relaxed text-neutral-600">Dynamic primitives use Rapier. Hair, cloth, capes, ropes, chains, tentacles, wings, and spring bones use the secondary position-based solver and share the same simulation mode/reset.</div></InspectorSection>
		<InspectorSection title="Secondary Dynamics Solver"><Toggle label="Secondary Dynamics" checked={scene.physics.secondaryEnabled} onChange={v=>patch({secondaryEnabled:v})}/><RangeRow label="Substeps" value={scene.physics.secondarySubsteps} min={1} max={8} step={1} onChange={v=>patch({secondarySubsteps:Math.round(v)})}/><RangeRow label="Constraint Iterations" value={scene.physics.secondaryIterations} min={1} max={16} step={1} onChange={v=>patch({secondaryIterations:Math.round(v)})}/><Toggle label="Reset on Timeline Seek" checked={scene.physics.resetSecondaryOnSeek} onChange={v=>patch({resetSecondaryOnSeek:v})}/><Toggle label="Debug Points / Constraints" checked={scene.physics.secondaryDebug} onChange={v=>patch({secondaryDebug:v})}/><div className="rounded border border-white/5 bg-black/20 p-2 text-[9px] text-neutral-500">{scene.secondaryDynamics.length} secondary object{scene.secondaryDynamics.length===1?"":"s"}. More substeps/iterations improve stiff cloth, chains, and collision stability but cost CPU/GPU frame time.</div></InspectorSection>
	</div>
}

function SecondaryDynamicsInspector({item,scene,setScene,info}:{item:VisualSecondaryDynamic;scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;info:VisualModelInfo|null}){
	const patch=(p:Partial<VisualSecondaryDynamic>)=>setScene(v=>({...v,secondaryDynamics:v.secondaryDynamics.map(x=>x.id===item.id?{...x,...p}:x)}));
	const rename=(name:string)=>{patch({name});setScene(v=>({...v,layers:v.layers.map(layer=>layer.entityId===item.id?{...layer,name}:layer)}))};
	const primitiveLabels=Object.fromEntries(scene.primitives.map(p=>[p.id,p.name]));
	const materialLabels=Object.fromEntries(scene.materials.map(m=>[m.id,m.name]));
	const rigBones=(info?.bones||[]).filter(Boolean).map(name=>`bone:${name}` as VisualSecondaryDynamic["anchorBone"]);
	const boneOptions=[...HUMANOID_SLOTS,...rigBones];
	const boneLabels:Record<string,string>={...Object.fromEntries(HUMANOID_SLOTS.map(slot=>[slot,`Humanoid · ${humanize(slot)}`])),...Object.fromEntries(rigBones.map(value=>[value,`Rig · ${String(value).slice(5)}`]))};
	const sheet=item.kind==="cloth"||item.kind==="cape"||item.kind==="wings";
	return <><InspectorSection title="Secondary Dynamics"><TextRow label="Name" value={item.name} onChange={rename}/><Toggle label="Enabled" checked={item.enabled} onChange={v=>patch({enabled:v})}/><SelectRow label="Type" value={item.kind} options={["hair","cloth","cape","rope","chain","tentacle","wings","springBone"]} labels={{hair:"Hair",cloth:"Cloth",cape:"Cape",rope:"Rope",chain:"Chain",tentacle:"Tentacle",wings:"Wings",springBone:"Spring Bone"}} onChange={v=>{const next=makeVisualSecondary(v as VisualSecondaryKind,item.name);patch({...next,id:item.id,name:item.name})}}/></InspectorSection>
		<InspectorSection title="Anchor"><SelectRow label="Anchor To" value={item.anchorMode} options={["performerBone","primitive","point"]} labels={{performerBone:"Performer Bone",primitive:"Physics / Primitive Object",point:"World Point"}} onChange={v=>patch({anchorMode:v as VisualSecondaryDynamic["anchorMode"]})}/>{item.anchorMode==="performerBone"?<SelectRow label="Anchor Bone" value={String(item.anchorBone)} options={boneOptions} labels={boneLabels} onChange={v=>patch({anchorBone:v as VisualSecondaryDynamic["anchorBone"]})}/>:null}{item.anchorMode==="primitive"?<SelectRow label="Anchor Object" value={item.anchorEntityId} options={["",...scene.primitives.map(p=>p.id)]} labels={{"":"None",...primitiveLabels}} onChange={v=>patch({anchorEntityId:v})}/>:null}{item.anchorMode==="point"?<><NumberRow label="World X" value={item.anchorX} min={-1000} step={.05} onChange={v=>patch({anchorX:v})}/><NumberRow label="World Y" value={item.anchorY} min={-1000} step={.05} onChange={v=>patch({anchorY:v})}/><NumberRow label="World Z" value={item.anchorZ} min={-1000} step={.05} onChange={v=>patch({anchorZ:v})}/></>:null}<NumberRow label="Offset X" value={item.offsetX} min={-100} step={.02} onChange={v=>patch({offsetX:v})}/><NumberRow label="Offset Y" value={item.offsetY} min={-100} step={.02} onChange={v=>patch({offsetY:v})}/><NumberRow label="Offset Z" value={item.offsetZ} min={-100} step={.02} onChange={v=>patch({offsetZ:v})}/><NumberRow label="Rest Direction X" value={item.restDirectionX} min={-1} max={1} step={.02} onChange={v=>patch({restDirectionX:v})}/><NumberRow label="Rest Direction Y" value={item.restDirectionY} min={-1} max={1} step={.02} onChange={v=>patch({restDirectionY:v})}/><NumberRow label="Rest Direction Z" value={item.restDirectionZ} min={-1} max={1} step={.02} onChange={v=>patch({restDirectionZ:v})}/></InspectorSection>
		{item.kind==="springBone"?<InspectorSection title="Spring Bone"><SelectRow label="Driven Bone" value={String(item.targetBone)} options={boneOptions} labels={boneLabels} onChange={v=>patch({targetBone:v as VisualSecondaryDynamic["targetBone"]})}/><RangeRow label="Tip Length" value={item.length} min={.05} max={5} step={.01} onChange={v=>patch({length:v})}/><RangeRow label="Rotation Influence" value={item.boneInfluence} min={0} max={1} step={.01} onChange={v=>patch({boneInfluence:v})}/></InspectorSection>:<InspectorSection title={sheet?"Soft Body Mesh":"Strand / Chain"}><RangeRow label={sheet?"Rows":"Segments"} value={item.segments} min={1} max={64} step={1} onChange={v=>patch({segments:Math.round(v)})}/>{sheet?<RangeRow label="Columns" value={item.columns} min={2} max={32} step={1} onChange={v=>patch({columns:Math.round(v)})}/>:null}<RangeRow label="Length" value={item.length} min={.05} max={30} step={.05} onChange={v=>patch({length:v})}/>{sheet?<RangeRow label="Width" value={item.width} min={.05} max={30} step={.05} onChange={v=>patch({width:v})}/>:null}<RangeRow label="Thickness / Radius" value={item.radius} min={.005} max={1} step={.005} onChange={v=>patch({radius:v})}/>{item.kind==="wings"?<Toggle label="Mirror Left + Right" checked={item.mirror} onChange={v=>patch({mirror:v})}/>:null}</InspectorSection>}
		<InspectorSection title="Forces"><RangeRow label="Stiffness" value={item.stiffness} min={0} max={1} step={.01} onChange={v=>patch({stiffness:v})}/><RangeRow label="Bend Stiffness" value={item.bendStiffness} min={0} max={1} step={.01} onChange={v=>patch({bendStiffness:v})}/><RangeRow label="Damping" value={item.damping} min={.5} max={.999} step={.001} onChange={v=>patch({damping:v})}/><RangeRow label="Gravity Scale" value={item.gravityScale} min={-3} max={3} step={.02} onChange={v=>patch({gravityScale:v})}/><RangeRow label="World Wind" value={item.windInfluence} min={0} max={5} step={.02} onChange={v=>patch({windInfluence:v})}/><RangeRow label="Air Drag" value={item.drag} min={0} max={2} step={.01} onChange={v=>patch({drag:v})}/></InspectorSection>
		<InspectorSection title="Collision"><RangeRow label="Particle Radius" value={item.collisionRadius} min={.001} max={1} step={.005} onChange={v=>patch({collisionRadius:v})}/><Toggle label="Ground" checked={item.collideGround} onChange={v=>patch({collideGround:v})}/><Toggle label="3D Primitives / Rigid Bodies" checked={item.collidePrimitives} onChange={v=>patch({collidePrimitives:v})}/><Toggle label="Performer Body" checked={item.collidePerformer} onChange={v=>patch({collidePerformer:v})}/><Toggle label="Self Collision" checked={item.selfCollision} onChange={v=>patch({selfCollision:v})}/></InspectorSection>
		<InspectorSection title="Music Impulse"><SelectRow label="Source" value={item.audioSource} options={MODULATION_AUDIO_SOURCES} onChange={v=>patch({audioSource:v as VisualAudioSource})}/><RangeRow label="Impulse" value={item.audioImpulse} min={-10} max={10} step={.05} onChange={v=>patch({audioImpulse:v})}/><NumberRow label="Direction X" value={item.audioDirectionX} min={-10} max={10} step={.05} onChange={v=>patch({audioDirectionX:v})}/><NumberRow label="Direction Y" value={item.audioDirectionY} min={-10} max={10} step={.05} onChange={v=>patch({audioDirectionY:v})}/><NumberRow label="Direction Z" value={item.audioDirectionZ} min={-10} max={10} step={.05} onChange={v=>patch({audioDirectionZ:v})}/><div className="text-[9px] text-neutral-600">Kick a cape, pulse a tentacle, whip a rope, or make wings react to a drop without replacing the physical simulation.</div></InspectorSection>
		<InspectorSection title="Appearance"><SelectRow label="Material" value={item.materialId} options={["",...scene.materials.map(m=>m.id)]} labels={{"":"Fallback Color",...materialLabels}} onChange={v=>patch({materialId:v})}/><ColorRow label="Fallback Color" value={item.color} onChange={v=>patch({color:v})}/></InspectorSection>
	</>
}

function MaterialInspector({material,scene,setScene,onNotice}:{material:VisualMaterialAsset;scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;onNotice:(message:string)=>void}){
	const patch=(p:Partial<VisualMaterialAsset>)=>setScene(v=>({...v,materials:v.materials.map(m=>m.id===material.id?{...m,...p}:m)}));
	const upload=async(key:MaterialTextureKey,file:File)=>{try{const result=await bridgeApi.uploadVisualMedia(file);patch({[key]:{url:result.url,fileName:file.name}} as Partial<VisualMaterialAsset>);onNotice(`${file.name} assigned to ${key}.`)}catch(e){onNotice(e instanceof Error?e.message:"Texture upload failed.")}};
	return <div className="space-y-5 p-3"><div className="flex items-center gap-3"><MaterialSphere material={material}/><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{material.name}</div><div className="text-[9px] uppercase tracking-wider text-neutral-600">Reusable YSong PBR material</div></div></div><InspectorSection title="Material"><TextRow label="Name" value={material.name} onChange={v=>patch({name:v})}/><ColorRow label="Base Color" value={material.baseColor} onChange={v=>patch({baseColor:v})}/><RangeRow label="Metallic" value={material.metalness} min={0} max={1} step={.01} onChange={v=>patch({metalness:v})}/><RangeRow label="Roughness" value={material.roughness} min={0} max={1} step={.01} onChange={v=>patch({roughness:v})}/><ColorRow label="Emissive" value={material.emissiveColor} onChange={v=>patch({emissiveColor:v})}/><RangeRow label="Emission" value={material.emissiveIntensity} min={0} max={20} step={.05} onChange={v=>patch({emissiveIntensity:v})}/><RangeRow label="Opacity" value={material.opacity} min={0} max={1} step={.01} onChange={v=>patch({opacity:v,transparent:v<.999||material.transparent})}/><Toggle label="Transparent" checked={material.transparent} onChange={v=>patch({transparent:v})}/><Toggle label="Double Sided" checked={material.doubleSided} onChange={v=>patch({doubleSided:v})}/></InspectorSection><InspectorSection title="Surface"><RangeRow label="Normal Strength" value={material.normalScale} min={0} max={4} step={.05} onChange={v=>patch({normalScale:v})}/><RangeRow label="Bump Strength" value={material.bumpScale} min={-2} max={2} step={.02} onChange={v=>patch({bumpScale:v})}/><RangeRow label="Displacement" value={material.displacementScale} min={-2} max={2} step={.02} onChange={v=>patch({displacementScale:v})}/><RangeRow label="Environment Reflection" value={material.envMapIntensity} min={0} max={5} step={.05} onChange={v=>patch({envMapIntensity:v})}/><RangeRow label="Clearcoat" value={material.clearcoat} min={0} max={1} step={.01} onChange={v=>patch({clearcoat:v})}/><RangeRow label="Clearcoat Roughness" value={material.clearcoatRoughness} min={0} max={1} step={.01} onChange={v=>patch({clearcoatRoughness:v})}/><RangeRow label="Transmission" value={material.transmission} min={0} max={1} step={.01} onChange={v=>patch({transmission:v})}/><RangeRow label="IOR" value={material.ior} min={1} max={2.5} step={.01} onChange={v=>patch({ior:v})}/></InspectorSection><InspectorSection title="Texture Maps">{([['baseColorMap','Base / Albedo'],['normalMap','Normal'],['bumpMap','Bump'],['roughnessMap','Roughness'],['metalnessMap','Metallic'],['aoMap','Ambient Occlusion'],['emissiveMap','Emissive'],['alphaMap','Opacity / Alpha'],['displacementMap','Height / Displacement'],['envMap','Environment / HDRI']] as [MaterialTextureKey,string][]).map(([key,label])=><TextureSlotRow key={key} label={label} fileName={material[key].fileName} onFile={file=>void upload(key,file)}/>)}</InspectorSection><InspectorSection title="Assignment"><SelectRow label="Performer Override" value={scene.object.materialId===material.id?material.id:""} options={["",material.id]} labels={{"":"Not assigned",[material.id]:"Assigned to Performer"}} onChange={v=>setScene(prev=>({...prev,object:{...prev.object,materialId:v}}))}/><div className="text-[9px] text-neutral-600">Assign this material to any primitive from that object's inspector. Imported binary/proprietary .mat files may need Bridge conversion, but YSong/JSON and readable Unity material properties are imported directly.</div></InspectorSection></div>
}

function TextureSlotRow({label,fileName,onFile}:{label:string;fileName:string;onFile:(file:File)=>void}){
	const input=useRef<HTMLInputElement|null>(null);return <div className="flex items-center gap-2"><input ref={input} type="file" accept="image/*,.hdr,.exr" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f);e.currentTarget.value=""}}/><span className="min-w-0 flex-1 truncate text-[9px] text-neutral-500">{label}: <span className="text-neutral-300">{fileName||"None"}</span></span><button onClick={()=>input.current?.click()} className="inspector-btn shrink-0">Choose</button></div>
}

function PrimitiveInspector({primitive,scene,setScene}:{primitive:VisualPrimitiveObject;scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){
	const patch=(p:Partial<VisualPrimitiveObject>)=>setScene(v=>({...v,primitives:v.primitives.map(x=>x.id===primitive.id?{...x,...p}:x)}));
	const patchPhysics=(p:Partial<VisualPrimitiveObject["physics"]>)=>patch({physics:{...primitive.physics,...p}});
	const materialLabels=Object.fromEntries(scene.materials.map(m=>[m.id,m.name]));
	return <><InspectorSection title="Primitive"><TextRow label="Name" value={primitive.name} onChange={v=>{patch({name:v});setScene(p=>({...p,layers:p.layers.map(l=>l.entityId===primitive.id?{...l,name:v}:l)}))}}/><SelectRow label="Type" value={primitive.primitive} options={["box","sphere","icosphere","cylinder","cone","capsule","plane","torus","pyramid"]} onChange={v=>patch({primitive:v as VisualPrimitiveType})}/><SelectRow label="Material" value={primitive.materialId} options={scene.materials.map(m=>m.id)} labels={materialLabels} onChange={v=>patch({materialId:v})}/></InspectorSection><InspectorSection title="Transform"><NumberRow label="Position X" value={primitive.positionX} min={-1000} step={.05} onChange={v=>patch({positionX:v})}/><NumberRow label="Position Y" value={primitive.positionY} min={-1000} step={.05} onChange={v=>patch({positionY:v})}/><NumberRow label="Position Z" value={primitive.positionZ} min={-1000} step={.05} onChange={v=>patch({positionZ:v})}/><NumberRow label="Rotation X" value={primitive.rotationX*180/Math.PI} min={-360} max={360} step={.5} onChange={v=>patch({rotationX:v*Math.PI/180})} suffix="°"/><NumberRow label="Rotation Y" value={primitive.rotationY*180/Math.PI} min={-360} max={360} step={.5} onChange={v=>patch({rotationY:v*Math.PI/180})} suffix="°"/><NumberRow label="Rotation Z" value={primitive.rotationZ*180/Math.PI} min={-360} max={360} step={.5} onChange={v=>patch({rotationZ:v*Math.PI/180})} suffix="°"/><NumberRow label="Scale X" value={primitive.scaleX} min={.01} max={100} step={.05} onChange={v=>patch({scaleX:v})}/><NumberRow label="Scale Y" value={primitive.scaleY} min={.01} max={100} step={.05} onChange={v=>patch({scaleY:v})}/><NumberRow label="Scale Z" value={primitive.scaleZ} min={.01} max={100} step={.05} onChange={v=>patch({scaleZ:v})}/></InspectorSection><InspectorSection title="Geometry"><NumberRow label="Size X" value={primitive.sizeX} min={.01} max={1000} step={.05} onChange={v=>patch({sizeX:v})}/><NumberRow label="Size Y" value={primitive.sizeY} min={.01} max={1000} step={.05} onChange={v=>patch({sizeY:v})}/><NumberRow label="Size Z" value={primitive.sizeZ} min={.01} max={1000} step={.05} onChange={v=>patch({sizeZ:v})}/><NumberRow label="Radius" value={primitive.radius} min={.01} max={500} step={.05} onChange={v=>patch({radius:v})}/><NumberRow label="Height" value={primitive.height} min={.01} max={1000} step={.05} onChange={v=>patch({height:v})}/><RangeRow label="Segments" value={primitive.segments} min={3} max={128} step={1} onChange={v=>patch({segments:Math.round(v)})}/><NumberRow label="Tube Radius" value={primitive.tubeRadius} min={.01} max={100} step={.02} onChange={v=>patch({tubeRadius:v})}/></InspectorSection><InspectorSection title="Rigid Body"><SelectRow label="Body" value={primitive.physics.bodyType} options={["static","dynamic","kinematic"]} onChange={v=>patchPhysics({bodyType:v as VisualPrimitiveObject["physics"]["bodyType"]})}/><SelectRow label="Collider" value={primitive.physics.collider} options={["auto","box","sphere","capsule","cylinder","convexHull"]} onChange={v=>patchPhysics({collider:v as VisualPrimitiveObject["physics"]["collider"]})}/><RangeRow label="Mass" value={primitive.physics.mass} min={.01} max={500} step={.1} onChange={v=>patchPhysics({mass:v})}/><RangeRow label="Friction" value={primitive.physics.friction} min={0} max={2} step={.01} onChange={v=>patchPhysics({friction:v})}/><RangeRow label="Bounce / Restitution" value={primitive.physics.restitution} min={0} max={1} step={.01} onChange={v=>patchPhysics({restitution:v})}/><RangeRow label="Linear Damping" value={primitive.physics.linearDamping} min={0} max={5} step={.01} onChange={v=>patchPhysics({linearDamping:v})}/><RangeRow label="Angular Damping" value={primitive.physics.angularDamping} min={0} max={5} step={.01} onChange={v=>patchPhysics({angularDamping:v})}/><RangeRow label="Gravity Scale" value={primitive.physics.gravityScale} min={-2} max={3} step={.05} onChange={v=>patchPhysics({gravityScale:v})}/></InspectorSection></>
}

function Shape2DInspector({shape,setScene}:{shape:VisualSceneState["shapes2d"][number];scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>}){
	const patch=(p:Partial<VisualSceneState["shapes2d"][number]>)=>setScene(v=>({...v,shapes2d:v.shapes2d.map(x=>x.id===shape.id?{...x,...p}:x)}));
	return <><InspectorSection title="2D Shape"><TextRow label="Name" value={shape.name} onChange={v=>{patch({name:v});setScene(p=>({...p,layers:p.layers.map(l=>l.entityId===shape.id?{...l,name:v}:l)}))}}/><SelectRow label="Type" value={shape.shape} options={["rectangle","ellipse","line"]} onChange={v=>patch({shape:v as VisualShape2DType})}/><ColorRow label="Fill" value={shape.color} onChange={v=>patch({color:v})}/><ColorRow label="Border" value={shape.borderColor} onChange={v=>patch({borderColor:v})}/><RangeRow label="Border Width" value={shape.borderWidth} min={0} max={20} step={.25} onChange={v=>patch({borderWidth:v})}/><RangeRow label="Corner Radius" value={shape.borderRadius} min={0} max={.5} step={.01} onChange={v=>patch({borderRadius:v})}/></InspectorSection><InspectorSection title="2D Transform"><RangeRow label="Position X" value={shape.positionX} min={0} max={1} step={.005} onChange={v=>patch({positionX:v})}/><RangeRow label="Position Y" value={shape.positionY} min={0} max={1} step={.005} onChange={v=>patch({positionY:v})}/><RangeRow label="Width" value={shape.width} min={.005} max={2} step={.005} onChange={v=>patch({width:v})}/><RangeRow label="Height" value={shape.height} min={.005} max={2} step={.005} onChange={v=>patch({height:v})}/><RangeRow label="Rotation" value={shape.rotation} min={-180} max={180} step={1} onChange={v=>patch({rotation:v})} suffix="°"/></InspectorSection></>
}

function importedTrackNodeName(trackName:string){
	try{const parsed=THREE.PropertyBinding.parseTrackName(trackName);if(parsed.nodeName)return parsed.nodeName;}catch{/* fall through for exporter-specific names */}
	const boneMatch=trackName.match(/\.bones\[([^\]]+)\]/i);if(boneMatch?.[1])return boneMatch[1];
	const withoutProperty=trackName.replace(/\.(position|quaternion|scale)$/i,"");const slash=withoutProperty.lastIndexOf("/");return (slash>=0?withoutProperty.slice(slash+1):withoutProperty).replace(/^.*\|/,"").trim();
}

function importedClipToYSongAnimation(clip:VisualImportedAnimationClip):VisualSkeletalAnimation{
	const keyframes:VisualSkeletalKeyframe[]=[];
	for(const track of clip.tracks){
		if(track.property==="other")continue;
		const boneName=importedTrackNodeName(track.name);if(!boneName)continue;
		const slot=HUMANOID_SLOTS.find(candidate=>guessBoneForSlot(candidate,[boneName])===boneName);
		const target:VisualSkeletalKeyframe["target"]=slot||(`bone:${boneName}` as VisualSkeletalKeyframe["target"]);
		const count=Math.min(track.times.length,Math.floor(track.values.length/Math.max(1,track.valueSize)));
		for(let i=0;i<count;i++){
			const offset=i*track.valueSize;let x=0,y=0,z=0;
			if(track.property==="quaternion"&&track.valueSize>=4){
				const q=new THREE.Quaternion(track.values[offset]||0,track.values[offset+1]||0,track.values[offset+2]||0,track.values[offset+3]??1).normalize();
				const euler=new THREE.Euler().setFromQuaternion(q,"XYZ");x=THREE.MathUtils.radToDeg(euler.x);y=THREE.MathUtils.radToDeg(euler.y);z=THREE.MathUtils.radToDeg(euler.z);
			}else{x=track.values[offset]??0;y=track.values[offset+1]??0;z=track.values[offset+2]??0;}
			keyframes.push({id:`bone-key-${crypto.randomUUID()}`,time:Math.max(0,track.times[i]||0),target,property:track.property==="quaternion"?"rotation":track.property,x,y,z,easing:"smooth"});
		}
	}
	return{id:`animation-${crypto.randomUUID()}`,name:clip.name||"Imported Animation",duration:Math.max(.05,clip.duration||.05),loop:false,source:"imported",sourceClip:clip.name||"",tags:["imported"],keyframes:keyframes.sort((a,b)=>a.time-b.time)};
}

function SkeletalAnimationInspector({scene,setScene,info,position,onNotice}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;info:VisualModelInfo|null;position:number;onNotice:(message:string)=>void}){
	const [animationId,setAnimationId]=useState(scene.animations[0]?.id||"");
	const [target,setTarget]=useState<VisualSkeletalKeyframe["target"]>("root");
	const [property,setProperty]=useState<VisualSkeletalKeyframe["property"]>("rotation");
	const [keyTime,setKeyTime]=useState(0);const [x,setX]=useState(0);const [y,setY]=useState(0);const [z,setZ]=useState(0);
	const [importClipName,setImportClipName]=useState(info?.animationClips?.[0]?.name||"");
	const animation=scene.animations.find(a=>a.id===animationId)||scene.animations[0]||null;
	useEffect(()=>{if(animation&&!animationId)setAnimationId(animation.id)},[animation,animationId]);
	useEffect(()=>{const clips=info?.animationClips||[];if(clips.length&&!clips.some(c=>c.name===importClipName))setImportClipName(clips[0].name)},[info,importClipName]);
	const patchAnimation=(p:Partial<VisualSkeletalAnimation>)=>{if(!animation)return;setScene(v=>({...v,animations:v.animations.map(a=>a.id===animation.id?{...a,...p}:a)}))};
	const create=()=>{const name=window.prompt("Animation name",`Animation ${scene.animations.length+1}`)?.trim();if(!name)return;const next:VisualSkeletalAnimation={id:`animation-${crypto.randomUUID()}`,name,duration:2,loop:false,source:"authored",sourceClip:"",tags:[],keyframes:[]};setScene(v=>({...v,animations:[...v.animations,next]}));setAnimationId(next.id)};
	const duplicate=()=>{if(!animation)return;const next:VisualSkeletalAnimation={...structuredClone(animation),id:`animation-${crypto.randomUUID()}`,name:`${animation.name} Copy`,source:"authored",sourceClip:"",keyframes:animation.keyframes.map(key=>({...key,id:`bone-key-${crypto.randomUUID()}`}))};setScene(v=>({...v,animations:[...v.animations,next]}));setAnimationId(next.id);onNotice(`${animation.name} duplicated into an editable YSong animation.`)};
	const removeAnimation=()=>{if(!animation)return;const id=animation.id;setScene(v=>({...v,animations:v.animations.filter(a=>a.id!==id),animationCues:v.animationCues.filter(c=>c.animationId!==id)}));setAnimationId(scene.animations.find(a=>a.id!==id)?.id||"")};
	const addKey=()=>{if(!animation)return;const key:VisualSkeletalKeyframe={id:`bone-key-${crypto.randomUUID()}`,time:Math.max(0,Math.min(animation.duration,keyTime)),target,property,x,y,z,easing:"smooth"};patchAnimation({keyframes:[...animation.keyframes,key].sort((a,b)=>a.time-b.time)});onNotice(`Added ${property} key to ${animation.name} @ ${key.time.toFixed(2)}s.`)};
	const patchKey=(id:string,p:Partial<VisualSkeletalKeyframe>)=>{if(!animation)return;patchAnimation({keyframes:animation.keyframes.map(key=>key.id===id?{...key,...p}:key).sort((a,b)=>a.time-b.time)})};
	const schedule=()=>{if(!animation)return;const cue:VisualAnimationCue={id:`animation-cue-${crypto.randomUUID()}`,time:Math.max(0,position),duration:Math.max(.05,animation.duration),trimIn:0,animationId:animation.id,speed:1,loop:animation.loop,blend:1,weight:1,blendIn:.12,blendOut:.18,layer:"base",blendMode:"override",enabled:true};setScene(v=>({...v,animationCues:[...v.animationCues,cue].sort((a,b)=>a.time-b.time)}));onNotice(`${animation.name} added as an editable DAW clip at ${formatTimePrecise(position)}.`)};
	const patchCue=(id:string,p:Partial<VisualAnimationCue>)=>setScene(v=>({...v,animationCues:v.animationCues.map(c=>c.id===id?{...c,...p}:c).sort((a,b)=>a.time-b.time)}));
	const removeCue=(id:string)=>setScene(v=>({...v,animationCues:v.animationCues.filter(c=>c.id!==id)}));
	const importEditableClip=()=>{const clip=(info?.animationClips||[]).find(item=>item.name===importClipName);if(!clip)return;const next=importedClipToYSongAnimation(clip);setScene(v=>({...v,animations:[...v.animations,next]}));setAnimationId(next.id);onNotice(`${clip.name} converted into ${next.keyframes.length} editable YSong skeletal keys.`)};
	const mapBone=(slot:VisualHumanoidSlot,bone:string)=>setScene(v=>({...v,object:{...v.object,humanoidMap:{...v.object.humanoidMap,[slot]:bone||undefined}}}));
	const autoMap=()=>{if(!info?.bones.length)return;const next:Partial<Record<VisualHumanoidSlot,string>>={};for(const slot of HUMANOID_SLOTS){const bone=guessBoneForSlot(slot,info.bones);if(bone)next[slot]=bone}setScene(v=>({...v,object:{...v.object,humanoidMap:next}}));onNotice(`Auto-mapped ${Object.keys(next).length} humanoid bones. Review the mapping before retargeting.`)};
	const targets=[...HUMANOID_SLOTS,...(info?.bones||[]).map(name=>`bone:${name}` as const)];
	const visibleKeys=animation?.keyframes.filter(key=>key.target===target&&key.property===property)||[];
	const animationLabels=Object.fromEntries(scene.animations.map(a=>[a.id,`${a.name}${a.source==="imported"?" · imported":""}`]));
	return <>
		<InspectorSection title="YSong Humanoid Mapping">
			{info?.bones.length?<><button onClick={autoMap} className="inspector-btn w-full">Auto-map Imported Skeleton</button><div className="max-h-44 space-y-1 overflow-auto">{HUMANOID_SLOTS.map(slot=><SelectRow key={slot} label={humanize(slot)} value={scene.object.humanoidMap[slot]||""} options={["",...(info?.bones||[])]} labels={{"":"Auto / Unmapped"}} onChange={v=>mapBone(slot,v)}/>)}</div></>:<div className="text-[9px] text-neutral-600">Import a rigged GLB/FBX to discover its bones. OBJ is static geometry and has no skeleton.</div>}
		</InspectorSection>
		{info?.animationClips?.length?<InspectorSection title="Imported Animation → Editable Library">
			<SelectRow label="Source Clip" value={importClipName} options={info.animationClips.map(clip=>clip.name)} onChange={setImportClipName}/>
			<button onClick={importEditableClip} className="inspector-btn w-full border-cyan-400/30 bg-cyan-500/10">Convert to Editable YSong Animation</button>
			<div className="text-[9px] leading-relaxed text-neutral-600">Phase 9 reads the source clip tracks, converts quaternion/position/scale tracks into editable skeletal keys, and maps recognizable bones to YSong humanoid slots. Unsupported custom tracks stay in the original imported clip.</div>
		</InspectorSection>:null}
		<InspectorSection title="Animation Library">
			<div className="grid grid-cols-[1fr_auto_auto] gap-1"><SelectRow label="Animation" value={animation?.id||""} options={scene.animations.map(a=>a.id)} labels={animationLabels} onChange={setAnimationId}/><button onClick={create} className="inspector-btn">+ New</button><button onClick={duplicate} disabled={!animation} className="inspector-btn disabled:opacity-30">⧉</button></div>
			{animation?<><TextRow label="Name" value={animation.name} onChange={v=>patchAnimation({name:v})}/><NumberRow label="Duration" value={animation.duration} min={.05} max={600} step={.05} onChange={v=>patchAnimation({duration:v})} suffix="s"/><Toggle label="Default Loop" checked={animation.loop} onChange={v=>patchAnimation({loop:v})}/><TextRow label="Tags" value={animation.tags.join(", ")} onChange={v=>patchAnimation({tags:v.split(",").map(tag=>tag.trim()).filter(Boolean).slice(0,32)})}/><div className="flex items-center justify-between text-[8px] uppercase tracking-wider text-neutral-600"><span>{animation.source==="imported"?`Converted from ${animation.sourceClip||"imported clip"}`:"YSong authored"}</span><span>{animation.keyframes.length} keys</span></div><button onClick={removeAnimation} className="inspector-btn w-full text-red-300">Delete Animation + Timeline Uses</button></>:<div className="text-[9px] text-neutral-600">Create an animation or convert one from the imported rig.</div>}
		</InspectorSection>
		{animation?<InspectorSection title="Skeletal Keyframe Editor">
			<SelectRow label="Bone / Humanoid Target" value={target} options={targets} labels={Object.fromEntries(targets.map(t=>[t,t.startsWith("bone:")?`Bone · ${t.slice(5)}`:humanize(t)]))} onChange={v=>setTarget(v as VisualSkeletalKeyframe["target"])}/>
			<SelectRow label="Property" value={property} options={["rotation","position","scale"]} onChange={v=>setProperty(v as VisualSkeletalKeyframe["property"])}/>
			<div className="rounded border border-white/5 bg-white/[.025] p-2"><NumberRow label="Key Time" value={keyTime} min={0} max={animation.duration} step={.01} onChange={setKeyTime} suffix="s"/><div className="mt-2 grid grid-cols-3 gap-1"><MiniNumber label="X" value={x} onChange={setX}/><MiniNumber label="Y" value={y} onChange={setY}/><MiniNumber label="Z" value={z} onChange={setZ}/></div><div className="mt-1 text-[8px] text-neutral-600">Rotation is degrees. Authored Position is a bind-pose local offset; Scale uses 1.0 as unchanged. Converted imported clips preserve their sampled local transform values.</div><button onClick={addKey} className="inspector-btn mt-2 w-full">◆ Add Bone Keyframe</button></div>
			<div className="text-[8px] uppercase tracking-wider text-neutral-600">Showing {visibleKeys.length} keys for {humanize(target)} · {property}</div>
			{visibleKeys.length?<div className="max-h-64 space-y-1 overflow-auto">{visibleKeys.map(key=><details key={key.id} className="rounded border border-white/5 bg-white/[.025] p-1.5"><summary className="cursor-pointer text-[8px] text-neutral-400"><span className="font-mono text-fuchsia-300">◆ {key.time.toFixed(3)}s</span> · {key.x.toFixed(1)}, {key.y.toFixed(1)}, {key.z.toFixed(1)}</summary><div className="mt-2 space-y-1.5"><NumberRow label="Time" value={key.time} min={0} max={animation.duration} step={.001} onChange={v=>patchKey(key.id,{time:v})} suffix="s"/><div className="grid grid-cols-3 gap-1"><MiniNumber label="X" value={key.x} onChange={v=>patchKey(key.id,{x:v})}/><MiniNumber label="Y" value={key.y} onChange={v=>patchKey(key.id,{y:v})}/><MiniNumber label="Z" value={key.z} onChange={v=>patchKey(key.id,{z:v})}/></div><SelectRow label="Interpolation" value={key.easing} options={["smooth","linear"]} onChange={v=>patchKey(key.id,{easing:v as VisualSkeletalKeyframe["easing"]})}/><button onClick={()=>patchAnimation({keyframes:animation.keyframes.filter(k=>k.id!==key.id)})} className="inspector-btn w-full text-red-300">Delete Key</button></div></details>)}</div>:<div className="text-[9px] text-neutral-600">No keys on this bone/property track yet.</div>}
		</InspectorSection>:null}
		{animation?<InspectorSection title="Visual DAW Performance Clips">
			<button onClick={schedule} className="inspector-btn w-full border-fuchsia-400/30 bg-fuchsia-500/10">Add {animation.name} Clip @ {formatTimePrecise(position)}</button>
			<div className="text-[9px] leading-relaxed text-neutral-600">Animation performances are real timeline clips now: move/resize them in the DAW, layer them, loop/trim them, and use independent blend-in/out and weight.</div>
			{scene.animationCues.filter(c=>c.animationId===animation.id).map(cue=><details key={cue.id} className="rounded border border-fuchsia-400/10 bg-fuchsia-500/[.035] p-1.5"><summary className="cursor-pointer text-[8px] text-fuchsia-200">{formatTimePrecise(cue.time)} → {formatTimePrecise(cue.time+visualAnimationCueDuration(cue,animation))} · {cue.layer}</summary><div className="mt-2 space-y-1.5"><Toggle label="Enabled" checked={cue.enabled} onChange={v=>patchCue(cue.id,{enabled:v})}/><NumberRow label="Start" value={cue.time} min={0} step={.01} onChange={v=>patchCue(cue.id,{time:v})} suffix="s"/><NumberRow label="Duration" value={visualAnimationCueDuration(cue,animation)} min={.05} max={600} step={.05} onChange={v=>patchCue(cue.id,{duration:v})} suffix="s"/><NumberRow label="Source In" value={cue.trimIn} min={0} max={animation.duration} step={.01} onChange={v=>patchCue(cue.id,{trimIn:v})} suffix="s"/><RangeRow label="Speed" value={cue.speed} min={.05} max={4} step={.05} onChange={v=>patchCue(cue.id,{speed:v})}/><RangeRow label="Weight" value={cue.weight} min={0} max={1} step={.01} onChange={v=>patchCue(cue.id,{weight:v,blend:v})}/><NumberRow label="Blend In" value={cue.blendIn} min={0} max={30} step={.05} onChange={v=>patchCue(cue.id,{blendIn:v})} suffix="s"/><NumberRow label="Blend Out" value={cue.blendOut} min={0} max={30} step={.05} onChange={v=>patchCue(cue.id,{blendOut:v})} suffix="s"/><SelectRow label="Body Layer / Mask" value={cue.layer} options={["base","upperBody","lowerBody","arms","head"]} labels={{base:"Full Body / Base",upperBody:"Upper Body",lowerBody:"Lower Body",arms:"Arms + Hands",head:"Head + Neck"}} onChange={v=>patchCue(cue.id,{layer:v as VisualAnimationLayer})}/><SelectRow label="Blend Mode" value={cue.blendMode} options={["override","additive"]} labels={{override:"Override / Pose",additive:"Additive Offset"}} onChange={v=>patchCue(cue.id,{blendMode:v as VisualAnimationCue["blendMode"]})}/><Toggle label="Loop Source" checked={cue.loop} onChange={v=>patchCue(cue.id,{loop:v})}/><button onClick={()=>removeCue(cue.id)} className="inspector-btn w-full text-red-300">Delete Performance Clip</button></div></details>)}
		</InspectorSection>:null}
	</>
}

function IKPerformanceInspector({scene,setScene,position}:{scene:VisualSceneState;setScene:React.Dispatch<React.SetStateAction<VisualSceneState>>;position:number}){
	const add=(effector:VisualIKConstraint["effector"],targetMode:VisualIKConstraint["targetMode"]="point")=>{const name=effector==="head"?"Head Look":effector==="leftHand"?"Left Hand Reach":"Right Hand Reach";const constraint:VisualIKConstraint={id:`ik-${crypto.randomUUID()}`,name,enabled:true,effector,targetMode,targetEntityId:"",targetX:0,targetY:1.4,targetZ:2,offsetX:0,offsetY:0,offsetZ:0,weight:1,iterations:4,maxAngleDegrees:55,weightKeys:[]};setScene(v=>({...v,ikConstraints:[...v.ikConstraints,constraint]}))};
	const patch=(id:string,p:Partial<VisualIKConstraint>)=>setScene(v=>({...v,ikConstraints:v.ikConstraints.map(c=>c.id===id?{...c,...p}:c)}));
	const remove=(id:string)=>setScene(v=>({...v,ikConstraints:v.ikConstraints.filter(c=>c.id!==id)}));
	const addWeightKey=(constraint:VisualIKConstraint)=>{const key={id:`ik-key-${crypto.randomUUID()}`,time:Math.max(0,position),weight:constraint.weight,easing:"smooth" as const};patch(constraint.id,{weightKeys:[...constraint.weightKeys.filter(k=>Math.abs(k.time-position)>.01),key].sort((a,b)=>a.time-b.time)})};
	const patchWeightKey=(constraint:VisualIKConstraint,keyId:string,p:Partial<VisualIKConstraint["weightKeys"][number]>)=>patch(constraint.id,{weightKeys:constraint.weightKeys.map(k=>k.id===keyId?{...k,...p}:k).sort((a,b)=>a.time-b.time)});
	const reachCamera=()=>{const start=Math.max(0,position),peak=start+.28,hold=start+1.15,end=start+1.55;const make=(effector:"leftHand"|"rightHand",side:number):VisualIKConstraint=>({id:`ik-${crypto.randomUUID()}`,name:`${effector==="leftHand"?"Left":"Right"} Hand → Camera`,enabled:true,effector,targetMode:"camera",targetEntityId:"",targetX:0,targetY:0,targetZ:0,offsetX:side*.28,offsetY:-.08,offsetZ:.25,weight:0,iterations:5,maxAngleDegrees:55,weightKeys:[{id:`ik-key-${crypto.randomUUID()}`,time:start,weight:0,easing:"smooth"},{id:`ik-key-${crypto.randomUUID()}`,time:peak,weight:1,easing:"smooth"},{id:`ik-key-${crypto.randomUUID()}`,time:hold,weight:1,easing:"linear"},{id:`ik-key-${crypto.randomUUID()}`,time:end,weight:0,easing:"smooth"}]});setScene(v=>({...v,ikConstraints:[...v.ikConstraints,make("leftHand",-1),make("rightHand",1)]}))};
	const primitiveLabels={"":"Select primitive",...Object.fromEntries(scene.primitives.map(p=>[p.id,p.name]))};
	return <InspectorSection title="IK / Performance Constraints">
		<div className="rounded border border-violet-400/15 bg-violet-500/5 p-2 text-[9px] leading-relaxed text-neutral-500">IK is applied after authored animation, so a walking/gesturing performer can still reach toward the Program Camera or a moving Rapier object. IK weight can be keyed on the Visual DAW timeline.</div>
		<div className="grid grid-cols-3 gap-1"><button onClick={()=>add("head","camera")} className="inspector-btn">+ Head Look</button><button onClick={()=>add("leftHand")} className="inspector-btn">+ Left Hand</button><button onClick={()=>add("rightHand")} className="inspector-btn">+ Right Hand</button></div>
		<button onClick={reachCamera} className="inspector-btn w-full border-violet-300/30 bg-violet-500/10">Create Two-Hand Reach Camera Choreography @ Playhead</button>
		{scene.ikConstraints.length===0?<div className="text-[9px] text-neutral-600">No IK constraints yet.</div>:null}
		<div className="space-y-1.5">{scene.ikConstraints.map(constraint=><details key={constraint.id} className="rounded border border-white/5 bg-white/[.025] p-1.5"><summary className="cursor-pointer text-[9px] text-violet-200">{constraint.enabled?"●":"○"} {constraint.name} · {constraint.effector}</summary><div className="mt-2 space-y-1.5"><Toggle label="Enabled" checked={constraint.enabled} onChange={v=>patch(constraint.id,{enabled:v})}/><TextRow label="Name" value={constraint.name} onChange={v=>patch(constraint.id,{name:v})}/><SelectRow label="Effector" value={constraint.effector} options={["head","leftHand","rightHand"]} labels={{head:"Head / Look At",leftHand:"Left Hand",rightHand:"Right Hand"}} onChange={v=>patch(constraint.id,{effector:v as VisualIKConstraint["effector"]})}/><SelectRow label="Target" value={constraint.targetMode} options={["camera","primitive","point"]} labels={{camera:"Active Program Camera / Viewer",primitive:"3D Primitive / Physics Object",point:"World Point"}} onChange={v=>patch(constraint.id,{targetMode:v as VisualIKConstraint["targetMode"]})}/>{constraint.targetMode==="primitive"?<SelectRow label="Tracked Object" value={constraint.targetEntityId} options={["",...scene.primitives.map(p=>p.id)]} labels={primitiveLabels} onChange={v=>patch(constraint.id,{targetEntityId:v})}/>:null}{constraint.targetMode==="point"?<><NumberRow label="Target X" value={constraint.targetX} min={-1000} step={.05} onChange={v=>patch(constraint.id,{targetX:v})}/><NumberRow label="Target Y" value={constraint.targetY} min={-1000} step={.05} onChange={v=>patch(constraint.id,{targetY:v})}/><NumberRow label="Target Z" value={constraint.targetZ} min={-1000} step={.05} onChange={v=>patch(constraint.id,{targetZ:v})}/></>:null}<NumberRow label="Offset X" value={constraint.offsetX} min={-100} step={.05} onChange={v=>patch(constraint.id,{offsetX:v})}/><NumberRow label="Offset Y" value={constraint.offsetY} min={-100} step={.05} onChange={v=>patch(constraint.id,{offsetY:v})}/><NumberRow label="Offset Z" value={constraint.offsetZ} min={-100} step={.05} onChange={v=>patch(constraint.id,{offsetZ:v})}/><RangeRow label="Weight" value={constraint.weight} min={0} max={1} step={.01} onChange={v=>patch(constraint.id,{weight:v})}/>{constraint.effector!=="head"?<><RangeRow label="Solver Iterations" value={constraint.iterations} min={1} max={12} step={1} onChange={v=>patch(constraint.id,{iterations:Math.round(v)})}/><RangeRow label="Max Joint Step" value={constraint.maxAngleDegrees} min={5} max={120} step={1} onChange={v=>patch(constraint.id,{maxAngleDegrees:v})} suffix="°"/></>:null}<button onClick={()=>addWeightKey(constraint)} className="inspector-btn w-full">◆ Key IK Weight @ {formatTimePrecise(position)}</button>{constraint.weightKeys.map(key=><div key={key.id} className="rounded border border-white/5 bg-black/15 p-1.5"><div className="flex items-center gap-2 text-[8px]"><span className="font-mono text-violet-300">◆ {formatTimePrecise(key.time)}</span><span className="ml-auto">{key.weight.toFixed(2)}</span><button onClick={()=>patch(constraint.id,{weightKeys:constraint.weightKeys.filter(k=>k.id!==key.id)})} className="text-red-300">×</button></div><div className="mt-1 space-y-1"><NumberRow label="Time" value={key.time} min={0} step={.01} onChange={v=>patchWeightKey(constraint,key.id,{time:v})}/><RangeRow label="Weight" value={key.weight} min={0} max={1} step={.01} onChange={v=>patchWeightKey(constraint,key.id,{weight:v})}/><SelectRow label="Interpolation" value={key.easing} options={["smooth","linear"]} onChange={v=>patchWeightKey(constraint,key.id,{easing:v as "smooth"|"linear"})}/></div></div>)}<button onClick={()=>remove(constraint.id)} className="inspector-btn w-full text-red-300">Delete Constraint</button></div></details>)}</div>
	</InspectorSection>
}

function MiniNumber({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}){return <label className="text-[8px] text-neutral-500"><span>{label}</span><input type="number" value={value} step={.05} onChange={e=>onChange(Number(e.target.value)||0)} className="mt-1 w-full rounded border border-white/10 bg-[#121620] px-1 py-1 text-right text-[9px] text-neutral-200"/></label>}
function humanize(value:string){return value.replace(/^bone:/,"Bone · ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,m=>m.toUpperCase())}
function guessBoneForSlot(slot:VisualHumanoidSlot,bones:string[]){const rules:Record<VisualHumanoidSlot,RegExp[]>={root:[/^root$/i,/armature/i],hips:[/hips/i,/pelvis/i],spine:[/^spine$/i,/spine0?1/i],chest:[/chest/i,/upper.?spine/i,/spine0?2/i],neck:[/neck/i],head:[/head/i],leftShoulder:[/left.*shoulder/i,/shoulder.*l/i,/clavicle.*l/i],leftUpperArm:[/left.*upper.*arm/i,/upper.*arm.*l/i,/left.*arm/i],leftForeArm:[/left.*fore.*arm/i,/fore.*arm.*l/i,/left.*lower.*arm/i],leftHand:[/left.*hand/i,/hand.*l/i],rightShoulder:[/right.*shoulder/i,/shoulder.*r/i,/clavicle.*r/i],rightUpperArm:[/right.*upper.*arm/i,/upper.*arm.*r/i,/right.*arm/i],rightForeArm:[/right.*fore.*arm/i,/fore.*arm.*r/i,/right.*lower.*arm/i],rightHand:[/right.*hand/i,/hand.*r/i],leftUpperLeg:[/left.*upper.*leg/i,/left.*thigh/i,/thigh.*l/i],leftLowerLeg:[/left.*lower.*leg/i,/left.*calf/i,/calf.*l/i],leftFoot:[/left.*foot/i,/foot.*l/i],rightUpperLeg:[/right.*upper.*leg/i,/right.*thigh/i,/thigh.*r/i],rightLowerLeg:[/right.*lower.*leg/i,/right.*calf/i,/calf.*r/i],rightFoot:[/right.*foot/i,/foot.*r/i]};for(const rule of rules[slot]){const found=bones.find(name=>rule.test(name));if(found)return found}return ""}

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
function layerIcon(layer:VisualLayer){if(layer.type==="media")return layer.mediaKind==="video"?"▶":layer.mediaKind==="model"?"♙":"▧";if(layer.type==="particles")return"✦";if(layer.type==="spectrum")return"▥";if(layer.type==="object")return"♙";if(layer.type==="stage")return"☀";if(layer.type==="sky")return"◉";if(layer.type==="clouds")return"☁";if(layer.type==="weather")return"☂";if(layer.type==="secondary")return"≈";return"T"}
function barsToSeconds(bars:number,s:DawSessionSnapshot){const beatSeconds=(60/Math.max(1,s.bpm))*(4/Math.max(1,s.sigDen));return Math.max(0,bars)*beatSeconds*Math.max(1,s.sigNum)}
function formatTime(seconds:number){if(!Number.isFinite(seconds)||seconds<=0)return"00:00";const whole=Math.max(0,Math.floor(seconds)),m=Math.floor(whole/60),s=whole%60;return`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
function formatTimePrecise(seconds:number){if(!Number.isFinite(seconds)||seconds<0)return"00:00.000";const m=Math.floor(seconds/60),s=Math.floor(seconds%60),ms=Math.floor((seconds-Math.floor(seconds))*1000);return`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(ms).padStart(3,"0")}`}
function readVideoDuration(file:File){return new Promise<number>(resolve=>{const url=URL.createObjectURL(file),video=document.createElement("video");const done=(v:number)=>{URL.revokeObjectURL(url);resolve(Number.isFinite(v)?v:0)};video.preload="metadata";video.onloadedmetadata=()=>done(video.duration);video.onerror=()=>done(0);video.src=url})}
