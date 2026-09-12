import { apiGet, apiPost } from './authApi';
import type { MidiNote, MidiScaleId } from './midi';

export type StemRole='drums'|'bass'|'piano'|'strings'|'lead'|'vocals'|'guitar'|'choir'|'atmosphere'|'percussion'|'fx';
export type StemMode='midi'|'audio';
export const STEM_ROLES:Array<{id:StemRole;label:string;preferred:StemMode}>=[
  {id:'drums',label:'Drums',preferred:'midi'},{id:'bass',label:'Bass',preferred:'midi'},{id:'piano',label:'Piano',preferred:'midi'},{id:'strings',label:'Strings',preferred:'midi'},{id:'lead',label:'Lead',preferred:'midi'},
  {id:'vocals',label:'Vocals',preferred:'audio'},{id:'guitar',label:'Guitar',preferred:'audio'},{id:'choir',label:'Choir',preferred:'audio'},{id:'atmosphere',label:'Atmosphere',preferred:'audio'},{id:'percussion',label:'Percussion',preferred:'audio'},{id:'fx',label:'FX / Texture',preferred:'audio'},
];
export type StemSection={name:string;startBar:number;endBar:number};
export type StemChord={atBar:number;symbol:string;durationBars:number};
export type StemUniverse={songId:string;generationFamily:string;generationSeed:string;bpm:number;keyRoot:number;keyLabel:string;scaleId:MidiScaleId;sigNum:number;sigDen:number;totalBars:number;sampleRate:number;sectionMap:StemSection[];chordMap:StemChord[];locked:boolean;exactDurationSec:number;universeHash:string};
export type StemDependency={nodeId:string;role:StemRole;mode:StemMode;version:number;universeHash:string;label:string;notes?:Omit<MidiNote,'id'>[];assetId?:string;audioUrl?:string;summary?:string};
export type MidiStemProposal={id:string;role:StemRole;mode:'midi';label:string;startBar:number;lengthBars:number;exactDurationSec:number;universeHash:string;generationFamily:string;generationSeed:string;version:number;dependsOn:Array<{nodeId:string;version:number;role:StemRole}>;notes:Omit<MidiNote,'id'>[];chords:StemChord[];explanation:string};
export type AudioStemProposal={id:string;role:StemRole;mode:'audio';label:string;startBar:number;lengthBars:number;exactDurationSec:number;sampleRate:number;channels:number;objectKey:string;assetId:string;sizeBytes:number;universeHash:string;generationFamily:string;generationSeed:string;version:number;dependsOn:Array<{nodeId:string;version:number;role:StemRole}>;provider:string};
export type StemProposal=MidiStemProposal|AudioStemProposal;
export type StemNode={nodeId:string;role:StemRole;mode:StemMode;version:number;label:string;universeHash:string;generationFamily:string;generationSeed:string;dependsOn:Array<{nodeId:string;version:number;role:StemRole}>;clipId?:string;trackId?:string;assetId?:string;status:'active'|'superseded'|'stale';createdAt:string;summary?:string};
export type ProgressiveStemState={universe:StemUniverse|null;nodes:StemNode[];activeByRole:Partial<Record<StemRole,string>>};
export type AudioStemManifest=Record<string,unknown>;
export type StemComposerStatus={structuredMidiConfigured:boolean;audioProviderConfigured:boolean;provider:string;model:string;audioProviderName:string;targetOnly:boolean;progressiveConditioning:boolean;absoluteTimeline:boolean;preferredModes:Record<StemRole,StemMode>;audioOutputNormalization:string;learnedAudioModel:boolean};

export function getStemComposerStatus(){return apiGet<StemComposerStatus>('/api/stem-composer/status');}
export function lockStemUniverse(args:Omit<StemUniverse,'locked'|'exactDurationSec'|'universeHash'>){return apiPost<{universe:StemUniverse}>('/api/stem-composer/universe/lock',args as Record<string, unknown>);}
export function generateMidiStem(args:{universe:StemUniverse;targetRole:StemRole;mode:'midi';desired:string;negative:string[];dependencies:StemDependency[];version:number;generationSeed:string}){return apiPost<{proposal:MidiStemProposal;provider:string;model:string}>('/api/stem-composer/midi/generate',args);}
export function prepareAudioStemManifest(args:{universe:StemUniverse;targetRole:StemRole;mode:'audio';desired:string;negative:string[];dependencies:StemDependency[];version:number;generationSeed:string}){return apiPost<{manifest:AudioStemManifest}>('/api/stem-composer/audio/manifest',args);}
export function generateAudioStem(args:{universe:StemUniverse;targetRole:StemRole;mode:'audio';desired:string;negative:string[];dependencies:StemDependency[];version:number;generationSeed:string}){return apiPost<{proposal:AudioStemProposal;manifest:AudioStemManifest}>('/api/stem-composer/audio/generate',args);}
export function getSignedAssetUrl(objectKey:string){return apiGet<{url:string}>(`/api/uploads/signed-url?objectKey=${encodeURIComponent(objectKey)}&mode=play`);}

export function staleDependents(nodes:StemNode[],changedNodeId:string,newVersion:number){const stale=new Set<string>();for(const n of nodes){if(n.dependsOn.some(d=>d.nodeId===changedNodeId&&d.version!==newVersion))stale.add(n.nodeId);}let changed=true;while(changed){changed=false;for(const n of nodes){if(stale.has(n.nodeId))continue;if(n.dependsOn.some(d=>stale.has(d.nodeId))){stale.add(n.nodeId);changed=true;}}}return stale;}
