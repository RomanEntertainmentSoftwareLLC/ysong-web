import { apiGet, apiPost } from './authApi';
import type { MidiNote, MidiScaleId } from './midi';

export type ComposerRole = 'melody'|'chords'|'bassline'|'arpeggio'|'countermelody'|'drums'|'strings'|'piano'|'atmosphere'|'harmony';
export type ComposerAction = 'generate'|'regenerate'|'variation'|'simpler'|'more_melodic'|'darker'|'more_aggressive'|'continue_8_bars'|'harmony'|'bass_from_this';

export type ComposerControls = {
  bpm:number; keyRoot:number; keyLabel:string; scaleId:MidiScaleId; sigNum:number; sigDen:number;
  totalBars:number; bars:number; startBar:number; complexity:number; humanization:number; mood:string; style:string; role:ComposerRole;
};
export type ComposerArrangementSection={name:string;startBar:number;endBar:number};
export type ComposerArrangementRole={role:ComposerRole;label:string;purpose:string;entryBar:number;endBar:number;priority:number};
export type ComposerArrangement={id:string;title:string;summary:string;totalBars:number;sections:ComposerArrangementSection[];roles:ComposerArrangementRole[]};
export type ComposerChord={atBars:number;symbol:string;durationBars:number};
export type ComposerProposal={
  id:string; role:ComposerRole; label:string; action:ComposerAction; startBar:number; lengthBars:number;
  keyRoot:number; keyLabel:string; scaleId:MidiScaleId; bpm:number; sigNum:number; sigDen:number;
  complexity:number; humanization:number; notes:Omit<MidiNote,'id'>[]; chords:ComposerChord[]; explanation:string; generationNotes:string;
};
export type ComposerProjectContext={
  projectName:string; playheadBar:number; tracks:Array<{name:string;type:string;clipCount:number}>;
  source?:{trackId?:string;trackName:string;startBar:number;lengthBars:number;notes:Omit<MidiNote,'id'>[]}|null;
};
export type ComposerStatus={configured:boolean;provider:string;model:string;structured:boolean;learnedModel:boolean};

export const COMPOSER_ROLES:Array<{id:ComposerRole;label:string}>=[
  {id:'melody',label:'Melody'},{id:'chords',label:'Chords'},{id:'bassline',label:'Bassline'},{id:'arpeggio',label:'Arpeggio'},
  {id:'countermelody',label:'Countermelody'},{id:'drums',label:'Drum pattern'},{id:'strings',label:'Strings'},{id:'piano',label:'Piano'},
  {id:'atmosphere',label:'Atmosphere'},{id:'harmony',label:'Harmony'},
];

export function getComposerStatus(){return apiGet<ComposerStatus>('/api/composer/status');}
export function proposeComposerArrangement(controls:ComposerControls,project:ComposerProjectContext){
  return apiPost<{arrangement:ComposerArrangement;provider:string;model:string}>('/api/composer/arrangement',{controls,project});
}
export function generateComposerIdea(args:{controls:ComposerControls;arrangement:ComposerArrangement;action:ComposerAction;sourceProposal?:ComposerProposal|null;project:ComposerProjectContext}){
  return apiPost<{proposal:ComposerProposal;provider:string;model:string}>('/api/composer/generate',args);
}
