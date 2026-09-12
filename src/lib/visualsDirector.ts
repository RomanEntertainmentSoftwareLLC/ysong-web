import { localAiChat } from "./localAiApi";
import { buildVisualModulationTargets } from "./visualsModulation";
import {
  PERFORMANCE_BEHAVIORS,
  normalizeVisualScene,
  type VisualAiDirectorScope,
  type VisualAiDirectorStyle,
  type VisualAnimationLayer,
  type VisualAudioSource,
  type VisualCameraKeyframe,
  type VisualSceneState,
} from "./visualsScene";

export type VisualDirectorSongContext = {
  title: string;
  artist: string;
  genre: string;
  durationSeconds: number;
  bpm: number;
  sigNum: number;
  sigDen: number;
};

export type VisualDirectorOperation =
  | { id: string; enabled: boolean; kind: "marker"; time: number; label: string; note?: string }
  | { id: string; enabled: boolean; kind: "cameraCut"; time: number; cameraId: string; note?: string }
  | { id: string; enabled: boolean; kind: "cameraKey"; time: number; cameraId: string; patch: Partial<VisualCameraKeyframe>; note?: string }
  | { id: string; enabled: boolean; kind: "performanceCue"; time: number; cueId: string; strength: number; note?: string }
  | { id: string; enabled: boolean; kind: "animationClip"; time: number; animationId: string; duration: number; speed: number; weight: number; layer: VisualAnimationLayer; note?: string }
  | { id: string; enabled: boolean; kind: "audioBinding"; source: VisualAudioSource; target: string; amount: number; attack: number; release: number; threshold: number; note?: string }
  | { id: string; enabled: boolean; kind: "scenePatch"; target: "weather" | "postFx" | "stage" | "wind" | "particles" | "clouds" | "spectrum"; values: Record<string, number | boolean | string>; note?: string };

export type VisualDirectorPlan = {
  id: string;
  title: string;
  summary: string;
  source: "ai" | "fallback";
  seed: number;
  durationSeconds: number;
  operations: VisualDirectorOperation[];
};

export type VisualDirectorRequest = {
  scene: VisualSceneState;
  song: VisualDirectorSongContext;
  prompt: string;
  style: VisualAiDirectorStyle;
  scope: VisualAiDirectorScope;
  intensity: number;
  seed: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
function id(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }
function hashText(input: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let x = (seed >>> 0) || 0x9e3779b9;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
function timeAt(duration: number, ratio: number) { return clamp(duration * ratio, 0, Math.max(0, duration)); }
function scopeAllows(scope: VisualAiDirectorScope, group: Exclude<VisualAiDirectorScope, "full">) { return scope === "full" || scope === group; }

function fallbackPlan(request: VisualDirectorRequest): VisualDirectorPlan {
  const { scene, song, style, scope } = request;
  const duration = Math.max(8, song.durationSeconds || scene.timeline.durationSeconds || 180);
  const intensity = clamp(request.intensity, .1, 1.5);
  const seed = (request.seed || 7) ^ hashText(`${song.title}|${song.artist}|${style}|${request.prompt}`);
  const random = rng(seed);
  const operations: VisualDirectorOperation[] = [];
  const beatSeconds=(60/Math.max(1,song.bpm||120))*(4/Math.max(1,song.sigDen||4));
  const barSeconds=beatSeconds*Math.max(1,song.sigNum||4);
  const snapMusical=(time:number)=>barSeconds>0?clamp(Math.round(time/barSeconds)*barSeconds,0,duration):clamp(time,0,duration);
  const authoredMarkers=scene.timeline.markers.filter(marker=>!marker.directorPlanId&&marker.time>0&&marker.time<duration).sort((a,b)=>a.time-b.time);
  const heuristic=[0,.13,.29,.48,.66,.83,.94].map(r=>snapMusical(timeAt(duration,r)));
  const markerDriven=authoredMarkers.length>=3?[0,...authoredMarkers.slice(0,5).map(marker=>snapMusical(marker.time)),snapMusical(timeAt(duration,.94))]:heuristic;
  const sections=[...new Set(markerDriven)].sort((a,b)=>a-b);

  if (scope === "full" && authoredMarkers.length<3) {
    ["Intro", "Build", "Lift", "Center", "Drive", "Finale", "Outro"].slice(0,sections.length).forEach((label, i) => operations.push({ id:id("dir-marker"), enabled:true, kind:"marker", time:sections[i], label:`Director · ${label}` }));
  }

  if (scopeAllows(scope, "camera") && scene.cameras.length) {
    const cameras = scene.cameras.filter(c => c.enabled);
    const usable = cameras.length ? cameras : scene.cameras;
    sections.slice(0, -1).forEach((time, index) => {
      const camera = usable[index % usable.length];
      if (index > 0 && usable.length > 1) operations.push({ id:id("dir-cut"), enabled:true, kind:"cameraCut", time, cameraId:camera.id, note:`${style} shot ${index + 1}` });
      const pulse = Math.sin(index * 1.7 + random()) * intensity;
      operations.push({ id:id("dir-camkey"), enabled:true, kind:"cameraKey", time, cameraId:camera.id, patch:{
        positionX: camera.positionX + pulse * .18,
        positionY: camera.positionY + (index % 2 ? .18 : -.05) * intensity,
        positionZ: camera.positionZ - (index === 3 || index === 5 ? .8 : 0) * intensity,
        targetX: camera.targetX, targetY: camera.targetY, targetZ: camera.targetZ,
        rotationX: camera.rotationX, rotationY: camera.rotationY, rotationZ: camera.rotationZ,
        fov: clamp(camera.fov + (index % 3 - 1) * 6 * intensity, 18, 110),
        focusDistance: Math.max(.2, camera.focusDistance - (index === 3 ? .8 : 0) * intensity),
        aperture: camera.aperture,
        dofAmount: clamp(camera.dofAmount + (style === "cinematic" || style === "ethereal" ? .15 * intensity : 0), 0, 1),
        dofBalance: camera.dofBalance,
        focusRange: camera.focusRange,
        maxBlur: camera.maxBlur,
        bokehSize: camera.bokehSize,
        exposure: clamp(camera.exposure + (index === 5 ? .08 * intensity : 0), .05, 8),
        shakeAmount: clamp(camera.shakeAmount + (style === "aggressive" && index >= 3 ? .1 * intensity : 0), 0, 10),
        shakeFrequency: camera.shakeFrequency,
        shakeRotation: clamp(camera.shakeRotation + (style === "aggressive" && index >= 3 ? .35 * intensity : 0), 0, 45),
        easing: style === "aggressive" ? "easeOut" : "easeInOut",
      }, note:`Camera choreography at ${time.toFixed(1)}s` });
    });
  }

  if (scopeAllows(scope, "performance") && scene.layers.some(l => l.type === "object" && l.visible)) {
    const palette: Record<VisualAiDirectorStyle, string[]> = {
      balanced:["watch-audience","open-arms","reach-camera","energy-gather","energy-release","proud-stance"],
      cinematic:["watch-audience","look-up","open-arms","reach-camera","rise","return-stare"],
      aggressive:["rage-build","rage-release","pound-screen","double-pound","storm-caller","energy-release"],
      ethereal:["look-up","angelic-open","high-ascension","open-arms","dual-lightning","rise"],
      minimal:["still","breathe","slow-sway","watch-audience","look-left","look-right"],
    };
    const cueIds = palette[style];
    sections.slice(1, -1).forEach((time, index) => operations.push({ id:id("dir-perf"), enabled:true, kind:"performanceCue", time, cueId:cueIds[index % cueIds.length], strength:clamp(.65 + intensity * .35 + random() * .15, .1, 2), note:`${style} performance beat` }));
    if (scene.animations.length) {
      const candidate = scene.animations.find(a => /idle|breathe|walk/i.test(a.name)) || scene.animations[0];
      operations.push({ id:id("dir-anim"), enabled:true, kind:"animationClip", time:0, animationId:candidate.id, duration:Math.min(duration, Math.max(candidate.duration, 8)), speed:1, weight:clamp(.65 + intensity * .2, .1, 1), layer:"base", note:`Base motion from ${candidate.name}` });
    }
  }

  if (scopeAllows(scope, "atmosphere")) {
    if (style === "aggressive") {
      operations.push({id:id("dir-patch"),enabled:true,kind:"scenePatch",target:"weather",values:{preset:"storm",intensity:clamp(.7*intensity,0,1.5),rain:clamp(.55*intensity,0,1),fog:clamp(.42*intensity,0,1),lightning:clamp(.7*intensity,0,1),lightningRate:Math.max(5,11/intensity)},note:"Storm-driven atmosphere"});
      operations.push({id:id("dir-patch"),enabled:true,kind:"scenePatch",target:"wind",values:{enabled:true,strength:clamp(2.4*intensity,0,8),gustiness:clamp(.6*intensity,0,1),turbulence:clamp(.5*intensity,0,2)},note:"Aggressive world wind"});
    } else if (style === "ethereal") {
      operations.push({id:id("dir-patch"),enabled:true,kind:"scenePatch",target:"weather",values:{preset:"magic",intensity:clamp(.7*intensity,0,1.5),magic:clamp(.72*intensity,0,1),fog:clamp(.38*intensity,0,1),lightning:clamp(.18*intensity,0,1)},note:"Ethereal magic atmosphere"});
      operations.push({id:id("dir-patch"),enabled:true,kind:"scenePatch",target:"clouds",values:{coverage:clamp(.45+.18*intensity,0,1),density:clamp(.5+.15*intensity,0,1),brightness:clamp(1.15+.2*intensity,.2,3),lightAbsorption:clamp(.28+.1*intensity,0,1)},note:"Luminous cloud field"});
    } else if (style === "minimal") {
      operations.push({id:id("dir-patch"),enabled:true,kind:"scenePatch",target:"weather",values:{preset:"clear",rain:0,snow:0,ash:0,dust:0,sand:0,magic:0,lightning:0,fog:clamp(.08*intensity,0,.2)},note:"Minimal atmosphere"});
    } else {
      operations.push({id:id("dir-patch"),enabled:true,kind:"scenePatch",target:"clouds",values:{coverage:clamp(.22+.15*intensity,0,1),density:clamp(.28+.18*intensity,0,1),brightness:1,lightAbsorption:clamp(.16+.1*intensity,0,1)},note:"Cinematic cloud depth"});
      operations.push({id:id("dir-patch"),enabled:true,kind:"scenePatch",target:"weather",values:{preset:"clear",fog:clamp(.16*intensity,0,.45),heatHaze:style==="cinematic"?clamp(.05*intensity,0,.15):0},note:"Controlled atmosphere"});
    }
  }

  if (scopeAllows(scope, "post")) {
    const values: Record<string, number | boolean | string> = style === "aggressive"
      ? {colorGradeEnabled:true,contrast:clamp(1.08+.18*intensity,.25,2),saturation:clamp(1+.08*intensity,0,2.5),chromaticAberration:clamp(.06*intensity,0,.35),halation:clamp(.18*intensity,0,1),filmGrain:clamp(.08*intensity,0,.35),vignette:clamp(.18*intensity,0,.5)}
      : style === "ethereal"
        ? {colorGradeEnabled:true,contrast:clamp(.98+.05*intensity,.25,2),saturation:clamp(1.02+.06*intensity,0,2.5),temperature:clamp(-.08*intensity,-1,1),halation:clamp(.35*intensity,0,1.2),filmGrain:clamp(.035*intensity,0,.2),vignette:clamp(.12*intensity,0,.4),lightShaftsIntensity:clamp(.65*intensity,0,2)}
        : style === "minimal"
          ? {colorGradeEnabled:true,contrast:1.02,saturation:1,chromaticAberration:0,halation:0,filmGrain:clamp(.02*intensity,0,.08),vignette:clamp(.05*intensity,0,.12)}
          : {colorGradeEnabled:true,contrast:clamp(1.03+.07*intensity,.25,2),saturation:clamp(1+.03*intensity,0,2.5),halation:clamp(.14*intensity,0,.6),filmGrain:clamp(.045*intensity,0,.18),vignette:clamp(.12*intensity,0,.35)};
    operations.push({id:id("dir-patch"),enabled:true,kind:"scenePatch",target:"postFx",values,note:`${style} finishing pass`});
    operations.push({id:id("dir-patch"),enabled:true,kind:"scenePatch",target:"stage",values:{bloomStrength:clamp(scene.stage.bloomStrength + (style==="aggressive"?.55:style==="ethereal"?.4:.18)*intensity,0,5)},note:"Bloom shaping"});
  }

  if (scopeAllows(scope, "reactivity")) {
    const candidates = [
      {source:"energy" as VisualAudioSource,target:"stage.bloomStrength",amount:.55*intensity,attack:.08,release:.3,threshold:.05,note:"Energy drives bloom"},
      {source:"kick" as VisualAudioSource,target:`camera:${scene.activeCameraId}:shakeAmount`,amount:.13*intensity,attack:.015,release:.14,threshold:.16,note:"Kick adds camera impact"},
      {source:"bass" as VisualAudioSource,target:"particles.turbulence",amount:.85*intensity,attack:.05,release:.3,threshold:.08,note:"Bass drives particle turbulence"},
      {source:"highs" as VisualAudioSource,target:"postFx.halation",amount:.22*intensity,attack:.04,release:.22,threshold:.1,note:"Highs lift halation"},
    ];
    for (const c of candidates) operations.push({id:id("dir-react"),enabled:true,kind:"audioBinding",...c});
  }

  return { id:`director-${crypto.randomUUID()}`, title:`${style[0].toUpperCase()+style.slice(1)} Visual Direction`, summary:`Deterministic ${style} plan for ${song.title || "the active song"}. ${operations.length} editable operations across ${scope}.`, source:"fallback", seed, durationSeconds:duration, operations };
}

function parseJsonObject(text: string) {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI response did not contain a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function sanitizeAiPlan(raw: Record<string, unknown>, request: VisualDirectorRequest): VisualDirectorPlan {
  const scene = request.scene; const duration = Math.max(1, request.song.durationSeconds || scene.timeline.durationSeconds || 180);
  const cameraIds = new Set(scene.cameras.map(c=>c.id));
  const cueIds = new Set(PERFORMANCE_BEHAVIORS.map(c=>c.id));
  const animationIds = new Set(scene.animations.map(a=>a.id));
  const targetIds = new Set(buildVisualModulationTargets(scene).map(t=>t.id));
  const sources = new Set<VisualAudioSource>(["bass","mids","highs","energy","kick","rms","peak","beat","bar"]);
  const out: VisualDirectorOperation[] = [];
  const list = Array.isArray(raw.operations) ? raw.operations : [];
  for (const entry of list.slice(0, 80)) {
    if (!entry || typeof entry !== "object") continue;
    const op = entry as Record<string, unknown>; const kind = String(op.kind || "");
    const note = typeof op.note === "string" ? op.note.slice(0,240) : undefined;
    const time = clamp(Number(op.time)||0,0,duration);
    if (kind === "marker" && request.scope === "full") out.push({id:id("dir-marker"),enabled:true,kind,time,label:String(op.label||"Director Marker").slice(0,100),note});
    else if (kind === "cameraCut" && scopeAllows(request.scope,"camera") && cameraIds.has(String(op.cameraId))) out.push({id:id("dir-cut"),enabled:true,kind,time,cameraId:String(op.cameraId),note});
    else if (kind === "cameraKey" && scopeAllows(request.scope,"camera") && cameraIds.has(String(op.cameraId))) {
      const camera=scene.cameras.find(c=>c.id===String(op.cameraId))!; const patchRaw=(op.patch&&typeof op.patch==="object"?op.patch:{}) as Record<string,unknown>;
      const patch:Partial<VisualCameraKeyframe>={positionX:Number(patchRaw.positionX??camera.positionX),positionY:Number(patchRaw.positionY??camera.positionY),positionZ:Number(patchRaw.positionZ??camera.positionZ),targetX:Number(patchRaw.targetX??camera.targetX),targetY:Number(patchRaw.targetY??camera.targetY),targetZ:Number(patchRaw.targetZ??camera.targetZ),rotationX:Number(patchRaw.rotationX??camera.rotationX),rotationY:Number(patchRaw.rotationY??camera.rotationY),rotationZ:Number(patchRaw.rotationZ??camera.rotationZ),fov:clamp(Number(patchRaw.fov??camera.fov),10,140),focusDistance:clamp(Number(patchRaw.focusDistance??camera.focusDistance),.1,200),aperture:clamp(Number(patchRaw.aperture??camera.aperture),.1,64),dofAmount:clamp(Number(patchRaw.dofAmount??camera.dofAmount),0,1),dofBalance:clamp(Number(patchRaw.dofBalance??camera.dofBalance),-1,1),focusRange:clamp(Number(patchRaw.focusRange??camera.focusRange),.02,100),maxBlur:clamp(Number(patchRaw.maxBlur??camera.maxBlur),0,40),bokehSize:clamp(Number(patchRaw.bokehSize??camera.bokehSize),.1,4),exposure:clamp(Number(patchRaw.exposure??camera.exposure),.05,8),shakeAmount:clamp(Number(patchRaw.shakeAmount??camera.shakeAmount),0,10),shakeFrequency:clamp(Number(patchRaw.shakeFrequency??camera.shakeFrequency),.05,30),shakeRotation:clamp(Number(patchRaw.shakeRotation??camera.shakeRotation),0,45),easing:["linear","easeIn","easeOut","easeInOut","hold"].includes(String(patchRaw.easing))?patchRaw.easing as VisualCameraKeyframe["easing"]:"easeInOut"};
      out.push({id:id("dir-camkey"),enabled:true,kind,time,cameraId:camera.id,patch,note});
    } else if (kind === "performanceCue" && scopeAllows(request.scope,"performance") && cueIds.has(String(op.cueId))) out.push({id:id("dir-perf"),enabled:true,kind,time,cueId:String(op.cueId),strength:clamp(Number(op.strength)||1,.1,2),note});
    else if (kind === "animationClip" && scopeAllows(request.scope,"performance") && animationIds.has(String(op.animationId))) out.push({id:id("dir-anim"),enabled:true,kind,time,animationId:String(op.animationId),duration:clamp(Number(op.duration)||4,.05,duration),speed:clamp(Number(op.speed)||1,.05,4),weight:clamp(Number(op.weight)||1,0,1),layer:["base","upperBody","lowerBody","arms","head"].includes(String(op.layer))?op.layer as VisualAnimationLayer:"base",note});
    else if (kind === "audioBinding" && scopeAllows(request.scope,"reactivity") && sources.has(String(op.source) as VisualAudioSource) && targetIds.has(String(op.target))) out.push({id:id("dir-react"),enabled:true,kind,source:String(op.source) as VisualAudioSource,target:String(op.target),amount:clamp(Number(op.amount)||1,-100,100),attack:clamp(Number(op.attack)||.08,.001,10),release:clamp(Number(op.release)||.24,.001,10),threshold:clamp(Number(op.threshold)||0,0,.99),note});
    else if (kind === "scenePatch" && ["weather","postFx","stage","wind","particles","clouds","spectrum"].includes(String(op.target)) && op.values && typeof op.values === "object") {
      const target=String(op.target) as Extract<VisualDirectorOperation,{kind:"scenePatch"}>["target"];
      const allowed=scopeAllows(request.scope,"atmosphere")&&["weather","wind","particles","clouds","spectrum"].includes(target) || scopeAllows(request.scope,"post")&&["postFx","stage"].includes(target);
      if(allowed) out.push({id:id("dir-patch"),enabled:true,kind,target,values:op.values as Record<string,number|boolean|string>,note});
    }
  }
  if (!out.length) throw new Error("AI plan contained no valid YSong operations.");
  return {id:`director-${crypto.randomUUID()}`,title:String(raw.title||"AI Visual Direction").slice(0,120),summary:String(raw.summary||`AI-authored plan with ${out.length} operations.`).slice(0,1000),source:"ai",seed:request.seed,durationSeconds:Math.max(1,request.song.durationSeconds||request.scene.timeline.durationSeconds||1),operations:out};
}

export async function createVisualDirectorPlan(request: VisualDirectorRequest): Promise<VisualDirectorPlan> {
  const fallback = fallbackPlan(request);
  const scene = request.scene;
  const modulationTargets = buildVisualModulationTargets(scene).slice(0,140).map(t=>t.id);
  const brief = {
    song: request.song,
    style: request.style,
    scope: request.scope,
    intensity: request.intensity,
    userDirection: request.prompt,
    cameras: scene.cameras.map(c=>({id:c.id,name:c.name,position:[c.positionX,c.positionY,c.positionZ],fov:c.fov})),
    performanceBehaviors: PERFORMANCE_BEHAVIORS.map(c=>c.id),
    animations: scene.animations.map(a=>({id:a.id,name:a.name,duration:a.duration,tags:a.tags})),
    modulationTargets,
    existing: { cameraCuts:scene.cameraCuts.length, cameraKeys:scene.cameras.reduce((n,c)=>n+c.keyframes.length,0), performanceCues:scene.performance.timelineCues.length, animationClips:scene.animationCues.length, audioMappings:scene.audioModulation.bindings.length, manualMarkers:scene.timeline.markers.filter(marker=>!marker.directorPlanId).slice(0,24).map(marker=>({time:marker.time,label:marker.label})) },
  };
  const system = `You are YSong Visual Director. You NEVER render pixels or invent unsupported engine features. You direct the deterministic YSong scene/timeline engine by returning JSON operations only. Manual editing always remains available. Use only IDs supplied in the brief. Treat supplied manualMarkers as authoritative section hints. Place timed events on musically sensible beats/bars from the supplied BPM and time signature. Keep cuts and cues intentional and avoid frantic over-editing unless style is aggressive.\nAllowed JSON shape: {"title":"...","summary":"...","operations":[...]}\nAllowed operations:\n{"kind":"marker","time":number,"label":"...","note":"..."}\n{"kind":"cameraCut","time":number,"cameraId":"...","note":"..."}\n{"kind":"cameraKey","time":number,"cameraId":"...","patch":{"positionX":n,"positionY":n,"positionZ":n,"targetX":n,"targetY":n,"targetZ":n,"rotationX":n,"rotationY":n,"rotationZ":n,"fov":n,"focusDistance":n,"aperture":n,"dofAmount":n,"dofBalance":n,"focusRange":n,"maxBlur":n,"bokehSize":n,"exposure":n,"shakeAmount":n,"shakeFrequency":n,"shakeRotation":n,"easing":"linear|easeIn|easeOut|easeInOut|hold"},"note":"..."}\n{"kind":"performanceCue","time":number,"cueId":"...","strength":number,"note":"..."}\n{"kind":"animationClip","time":number,"animationId":"...","duration":number,"speed":number,"weight":number,"layer":"base|upperBody|lowerBody|arms|head","note":"..."}\n{"kind":"audioBinding","source":"bass|mids|highs|energy|kick|rms|peak|beat|bar","target":"supplied target id","amount":number,"attack":number,"release":number,"threshold":number,"note":"..."}\n{"kind":"scenePatch","target":"weather|postFx|stage|wind|particles|clouds|spectrum","values":{},"note":"..."}\nReturn JSON only.`;
  try {
    const reply = await localAiChat([{role:"system",content:system},{role:"user",content:JSON.stringify(brief)}]);
    return sanitizeAiPlan(parseJsonObject(reply), request);
  } catch {
    return fallback;
  }
}

function nearTime<T extends {time:number}>(items:T[], time:number, tolerance=.18){ return items.some(item=>Math.abs(item.time-time)<=tolerance); }

function safePatch<T extends object>(base:T, values:Record<string,number|boolean|string>, allowed:Set<string>):T {
  const next:Record<string,unknown>={...(base as Record<string,unknown>)};
  for(const [key,value] of Object.entries(values)) if(allowed.has(key) && (typeof value==="number"||typeof value==="boolean"||typeof value==="string")) next[key]=value;
  return next as T;
}

export function applyVisualDirectorPlan(sceneInput: VisualSceneState, plan: VisualDirectorPlan): VisualSceneState {
  const scene=structuredClone(sceneInput); const enabled=plan.operations.filter(op=>op.enabled); const preserve=scene.director.preserveManual;
  if(scene.director.replacePreviousDirectorPlan){
    scene.timeline.markers=scene.timeline.markers.filter(x=>!x.directorPlanId);
    scene.cameraCuts=scene.cameraCuts.filter(x=>!x.directorPlanId);
    scene.performance.timelineCues=scene.performance.timelineCues.filter(x=>!x.directorPlanId);
    scene.animationCues=scene.animationCues.filter(x=>!x.directorPlanId);
    scene.audioModulation.bindings=scene.audioModulation.bindings.filter(x=>!x.directorPlanId);
    scene.cameras=scene.cameras.map(c=>({...c,keyframes:c.keyframes.filter(k=>!k.directorPlanId)}));
  }
  const duration=Math.max(1,scene.timeline.durationSeconds,plan.durationSeconds||0); scene.timeline.durationSeconds=Math.max(scene.timeline.durationSeconds,duration);
  for(const op of enabled){
    if(op.kind==="marker"){
      if(preserve&&nearTime(scene.timeline.markers,op.time,.12))continue;
      scene.timeline.markers.push({id:op.id,directorPlanId:plan.id,time:clamp(op.time,0,duration),label:op.label});
    }else if(op.kind==="cameraCut"){
      if(!scene.cameras.some(c=>c.id===op.cameraId))continue;
      if(preserve&&nearTime(scene.cameraCuts,op.time,.12))continue;
      scene.cameraCuts.push({id:op.id,directorPlanId:plan.id,time:clamp(op.time,0,duration),cameraId:op.cameraId});
    }else if(op.kind==="cameraKey"){
      const camera=scene.cameras.find(c=>c.id===op.cameraId); if(!camera)continue;
      if(preserve&&nearTime(camera.keyframes,op.time,.12))continue;
      camera.keyframes.push({id:op.id,directorPlanId:plan.id,time:clamp(op.time,0,duration),positionX:Number(op.patch.positionX??camera.positionX),positionY:Number(op.patch.positionY??camera.positionY),positionZ:Number(op.patch.positionZ??camera.positionZ),targetX:Number(op.patch.targetX??camera.targetX),targetY:Number(op.patch.targetY??camera.targetY),targetZ:Number(op.patch.targetZ??camera.targetZ),rotationX:Number(op.patch.rotationX??camera.rotationX),rotationY:Number(op.patch.rotationY??camera.rotationY),rotationZ:Number(op.patch.rotationZ??camera.rotationZ),fov:Number(op.patch.fov??camera.fov),focusDistance:Number(op.patch.focusDistance??camera.focusDistance),aperture:Number(op.patch.aperture??camera.aperture),dofAmount:Number(op.patch.dofAmount??camera.dofAmount),dofBalance:Number(op.patch.dofBalance??camera.dofBalance),focusRange:Number(op.patch.focusRange??camera.focusRange),maxBlur:Number(op.patch.maxBlur??camera.maxBlur),bokehSize:Number(op.patch.bokehSize??camera.bokehSize),exposure:Number(op.patch.exposure??camera.exposure),shakeAmount:Number(op.patch.shakeAmount??camera.shakeAmount),shakeFrequency:Number(op.patch.shakeFrequency??camera.shakeFrequency),shakeRotation:Number(op.patch.shakeRotation??camera.shakeRotation),easing:op.patch.easing||"easeInOut"});
      camera.keyframes.sort((a,b)=>a.time-b.time);
    }else if(op.kind==="performanceCue"){
      if(preserve&&nearTime(scene.performance.timelineCues,op.time,.12))continue;
      scene.performance.timelineCues.push({id:op.id,directorPlanId:plan.id,time:clamp(op.time,0,duration),cueId:op.cueId,strength:clamp(op.strength,.1,2)});
    }else if(op.kind==="animationClip"){
      if(!scene.animations.some(a=>a.id===op.animationId))continue;
      if(preserve&&nearTime(scene.animationCues,op.time,.12))continue;
      scene.animationCues.push({id:op.id,directorPlanId:plan.id,time:clamp(op.time,0,duration),duration:clamp(op.duration,.05,duration),trimIn:0,animationId:op.animationId,speed:clamp(op.speed,.05,4),loop:false,blend:.2,weight:clamp(op.weight,0,1),blendIn:.15,blendOut:.2,layer:op.layer,blendMode:"override",enabled:true});
    }else if(op.kind==="audioBinding"){
      if(preserve&&scene.audioModulation.bindings.some(b=>b.target===op.target&&b.source===op.source&&!b.directorPlanId))continue;
      scene.audioModulation.bindings.push({id:op.id,directorPlanId:plan.id,enabled:true,name:`Director · ${op.note||op.target}`,source:op.source,target:op.target,amount:clamp(op.amount,-100,100),attack:clamp(op.attack,.001,10),release:clamp(op.release,.001,10),threshold:clamp(op.threshold,0,.99),invert:false,curve:"smoothstep"});
    }else if(op.kind==="scenePatch"){
      if(op.target==="weather")scene.weather=safePatch(scene.weather,op.values,new Set(["preset","intensity","rain","snow","ash","dust","sand","magic","fog","fogColor","heatHaze","heatHazeSpeed","lightning","lightningRate","lightningColor","precipitationSize","fallSpeed","area","height"]));
      else if(op.target==="postFx")scene.postFx=safePatch(scene.postFx,op.values,new Set(["toneMapping","exposure","colorGradeEnabled","saturation","contrast","brightness","temperature","tint","lift","gamma","gain","lutIntensity","ambientOcclusionIntensity","ambientOcclusionRadius","lightShaftsIntensity","lightShaftsSource","lightShaftsDecay","lightShaftsDensity","lightShaftsWeight","chromaticAberration","lensDistortion","lensZoom","halation","filmGrain","vignette","vignetteSoftness"]));
      else if(op.target==="stage")scene.stage=safePatch(scene.stage,op.values,new Set(["fogEnabled","fogColor","fogNear","fogFar","ambientIntensity","sunIntensity","moonEnabled","moonIntensity","keyIntensity","rimIntensity","fillIntensity","exposure","bloomStrength","bloomRadius","bloomThreshold","lensFlareEnabled","lensFlareIntensity"]));
      else if(op.target==="wind")scene.wind=safePatch(scene.wind,op.values,new Set(["enabled","directionX","directionZ","strength","gustiness","turbulence","affectsClouds","affectsParticles","affectsWeather","affectsPhysics","physicsForce"]));
      else if(op.target==="particles")scene.particles=safePatch(scene.particles,op.values,new Set(["count","size","amount","depth","spread","speed","gravity","turbulence","orbit","positionX","positionY","positionZ","rainbowSpeed","alphaTest"]));
      else if(op.target==="clouds")scene.clouds=safePatch(scene.clouds,op.values,new Set(["coverage","density","altitude","thickness","scale","softness","windX","windZ","speed","brightness","lightAbsorption","color","quality"]));
      else if(op.target==="spectrum")scene.spectrum=safePatch(scene.spectrum,op.values,new Set(["height","thickness","smoothing","glow","positionX","positionY","scale","rotation"]));
    }
  }
  scene.timeline.markers.sort((a,b)=>a.time-b.time); scene.cameraCuts.sort((a,b)=>a.time-b.time); scene.performance.timelineCues.sort((a,b)=>a.time-b.time); scene.animationCues.sort((a,b)=>a.time-b.time);
  scene.director.lastPlanId=plan.id; scene.director.lastPlanSummary=plan.summary; scene.director.lastPlanSource=plan.source; scene.director.lastAppliedAt=Date.now(); scene.updatedAt=Date.now();
  return normalizeVisualScene(scene);
}

export function visualDirectorOperationLabel(op: VisualDirectorOperation) {
  if(op.kind==="marker")return `Marker · ${op.label}`;
  if(op.kind==="cameraCut")return `Camera Cut · ${op.cameraId}`;
  if(op.kind==="cameraKey")return `Camera Key · ${op.cameraId}`;
  if(op.kind==="performanceCue")return `Performance · ${op.cueId}`;
  if(op.kind==="animationClip")return `Animation · ${op.animationId}`;
  if(op.kind==="audioBinding")return `Audio · ${op.source} → ${op.target}`;
  return `${op.target} patch`;
}
