import { apiGet, apiPost } from './authApi';
import type { InstrumentCatalogEntry, InstrumentMatchResult, InstrumentParameterEntry } from './bridgeApi';
import type { AuditionMetrics } from './auditionAnalysis';

export type SoundDesignerStatus = {
  configured:boolean; provider:string; model:string; learnedModel:boolean; bridgeOwnsAi:false;
  auditionEvaluation:string; directAudioModel:false; snapshotsRequired:true;
  maxCandidates:number; maxParameters:number; maxChangesPerIteration:number; maxHistory:number;
};

export type SoundDesignerMidiPart = {
  trackName:string; startBar:number; lengthBars:number;
  notes:Array<{pitch:number;startBars:number;lengthBars:number;velocity:number}>;
};

export type SoundDesignerContext = {
  desired:string; role?:string; keyLabel?:string; bpm?:number; arrangement?:string;
  vocalLowHz?:number|null; vocalHighHz?:number|null; notes?:string; midiPart?:SoundDesignerMidiPart|null;
};

export type SoundDesignerAuditionNote = { note:number; velocity?:number; startSeconds?:number; durationSeconds?:number; channel?:number };

export type SoundDesignerPlan = {
  instrumentId:string; reason:string; targetTraits:string[]; avoidTraits:string[];
  audition:{durationSeconds:number;notes:SoundDesignerAuditionNote[]};
};

export type SoundDesignerChange = {
  parameterId:number; parameterName:string; fromValue:number; targetValue:number; reason:string;
};

export type SoundDesignerStep = {
  evaluation:string; score:number; confidence:'low'|'medium'|'high'; done:boolean;
  changes:SoundDesignerChange[];
  nextAudition:{durationSeconds:number;notes:SoundDesignerAuditionNote[]};
  nextFocus:string;
  evaluationKind:'model-guided-from-dsp-metrics'|'model-guided-without-audition-metrics';
};

export type SoundDesignerIteration = {
  iteration:number; score:number; evaluation:string; changes:SoundDesignerChange[];
  audition:AuditionMetrics|null; snapshotId?:string|null; createdAt:number;
};

export function getSoundDesignerStatus(){ return apiGet<SoundDesignerStatus>('/api/sound-designer/status'); }

export function planSoundDesign(context:SoundDesignerContext,candidates:InstrumentMatchResult[]){
  return apiPost<{plan:SoundDesignerPlan;provider:string;model:string}>('/api/sound-designer/plan',{context,candidates});
}

export function proposeSoundDesignStep(args:{
  context:SoundDesignerContext; instrument:InstrumentCatalogEntry; parameters:InstrumentParameterEntry[];
  audition:AuditionMetrics|null; history:SoundDesignerIteration[]; snapshotConfirmed:boolean;
}){
  return apiPost<{step:SoundDesignerStep;provider:string;model:string}>('/api/sound-designer/step',args);
}
