export type AuditionMetrics = {
  durationSeconds:number;
  sampleRate:number;
  peakDbfs:number;
  rmsDbfs:number;
  crestDb:number;
  spectralCentroidHz:number;
  spectralFlatness:number;
  lowEnergyRatio:number;
  midEnergyRatio:number;
  highEnergyRatio:number;
  stereoCorrelation:number;
  stereoWidth:number;
  attackMs:number;
  tailRmsDbfs:number;
  zeroCrossingRate:number;
  vocalBandEnergyRatio:number|null;
};

type DecodedFloatWave={sampleRate:number;left:Float32Array;right:Float32Array};
const EPS=1e-12;
const db=(value:number)=>20*Math.log10(Math.max(EPS,value));
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

function fourcc(view:DataView,offset:number){ return String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2),view.getUint8(offset+3)); }

export function decodeBridgeFloatWave(buffer:ArrayBuffer):DecodedFloatWave{
  const view=new DataView(buffer);
  if(view.byteLength<44 || fourcc(view,0)!=='RIFF' || fourcc(view,8)!=='WAVE') throw new Error('Audition is not a valid RIFF/WAVE file.');
  let offset=12; let format=0; let channels=0; let sampleRate=0; let bits=0; let dataOffset=-1; let dataBytes=0;
  while(offset+8<=view.byteLength){
    const id=fourcc(view,offset); const size=view.getUint32(offset+4,true); const body=offset+8;
    if(id==='fmt ' && size>=16){ format=view.getUint16(body,true); channels=view.getUint16(body+2,true); sampleRate=view.getUint32(body+4,true); bits=view.getUint16(body+14,true); }
    if(id==='data'){ dataOffset=body; dataBytes=Math.min(size,view.byteLength-body); break; }
    offset=body+size+(size%2);
  }
  if(dataOffset<0 || format!==3 || bits!==32 || channels<1 || channels>2 || sampleRate<=0) throw new Error('YSong Sound Designer currently expects Bridge IEEE-float mono/stereo WAV auditions.');
  const frameBytes=channels*4; const frames=Math.floor(dataBytes/frameBytes);
  const left=new Float32Array(frames); const right=new Float32Array(frames);
  for(let i=0;i<frames;i++){
    const base=dataOffset+i*frameBytes; const l=view.getFloat32(base,true); const r=channels>1?view.getFloat32(base+4,true):l;
    left[i]=Number.isFinite(l)?l:0; right[i]=Number.isFinite(r)?r:0;
  }
  return {sampleRate,left,right};
}

function fftMagnitudes(samples:Float32Array,size=2048){
  let n=1; while(n<size)n<<=1; n=Math.min(n,4096);
  const re=new Float64Array(n); const im=new Float64Array(n);
  const count=Math.min(n,samples.length);
  for(let i=0;i<count;i++){ const w=count>1?0.5-0.5*Math.cos((2*Math.PI*i)/(count-1)):1; re[i]=samples[i]*w; }
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1; for(;j&bit;bit>>=1)j^=bit; j^=bit;
    if(i<j){ const tr=re[i]; re[i]=re[j]; re[j]=tr; }
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len; const wlenR=Math.cos(ang),wlenI=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let wr=1,wi=0;
      for(let j=0;j<len/2;j++){
        const uR=re[i+j],uI=im[i+j]; const k=i+j+len/2; const vR=re[k]*wr-im[k]*wi; const vI=re[k]*wi+im[k]*wr;
        re[i+j]=uR+vR; im[i+j]=uI+vI; re[k]=uR-vR; im[k]=uI-vI;
        const nextWr=wr*wlenR-wi*wlenI; wi=wr*wlenI+wi*wlenR; wr=nextWr;
      }
    }
  }
  const mags=new Float64Array(n/2);
  for(let i=0;i<mags.length;i++)mags[i]=Math.hypot(re[i],im[i]);
  return mags;
}

function spectralMetrics(mono:Float32Array,sampleRate:number,vocalLowHz?:number|null,vocalHighHz?:number|null){
  const windowSize=Math.min(2048,mono.length); if(windowSize<64)return {centroid:0,flatness:0,low:0,mid:0,high:0,vocal:null as number|null};
  const starts=[0.08,0.32,0.58].map((ratio)=>Math.max(0,Math.min(mono.length-windowSize,Math.floor((mono.length-windowSize)*ratio))));
  let totalPower=0,weighted=0,low=0,mid=0,high=0,vocal=0,logSum=0,binCount=0;
  for(const start of starts){
    const mags=fftMagnitudes(mono.subarray(start,start+windowSize),windowSize); const hzPerBin=sampleRate/(mags.length*2);
    for(let i=1;i<mags.length;i++){
      const power=mags[i]*mags[i]+EPS; const hz=i*hzPerBin;
      totalPower+=power; weighted+=power*hz; logSum+=Math.log(power); binCount++;
      if(hz<250)low+=power; else if(hz<4000)mid+=power; else high+=power;
      if(vocalLowHz && vocalHighHz && hz>=vocalLowHz && hz<=vocalHighHz)vocal+=power;
    }
  }
  const arithmetic=totalPower/Math.max(1,binCount); const geometric=Math.exp(logSum/Math.max(1,binCount));
  return {centroid:totalPower>0?weighted/totalPower:0,flatness:arithmetic>0?clamp(geometric/arithmetic,0,1):0,low:totalPower>0?low/totalPower:0,mid:totalPower>0?mid/totalPower:0,high:totalPower>0?high/totalPower:0,vocal:vocalLowHz&&vocalHighHz&&totalPower>0?vocal/totalPower:null};
}

export function analyzeAuditionWave(buffer:ArrayBuffer,options:{vocalLowHz?:number|null;vocalHighHz?:number|null}={}):AuditionMetrics{
  const {sampleRate,left,right}=decodeBridgeFloatWave(buffer); const n=Math.min(left.length,right.length);
  let sum=0,peak=0,l2=0,r2=0,lr=0,mid2=0,side2=0,zc=0; const mono=new Float32Array(n);
  let prev=0;
  for(let i=0;i<n;i++){
    const l=left[i],r=right[i],m=(l+r)*0.5,s=(l-r)*0.5; mono[i]=m;
    sum+=m*m; peak=Math.max(peak,Math.abs(l),Math.abs(r)); l2+=l*l; r2+=r*r; lr+=l*r; mid2+=m*m; side2+=s*s;
    if(i>0 && ((m>=0)!==(prev>=0)))zc++; prev=m;
  }
  const rms=Math.sqrt(sum/Math.max(1,n)); const crest=peak/Math.max(EPS,rms);
  const correlation=(l2>EPS&&r2>EPS)?clamp(lr/Math.sqrt(l2*r2),-1,1):1; const width=Math.sqrt(side2/Math.max(EPS,mid2));
  const firstSearch=Math.min(n,Math.max(1,Math.floor(sampleRate*1.2))); let firstActive=0; const threshold=Math.max(peak*0.08,0.0005);
  while(firstActive<firstSearch && Math.abs(mono[firstActive])<threshold)firstActive++;
  const attackTarget=peak*0.9; let attackIndex=firstActive;
  while(attackIndex<firstSearch && Math.abs(mono[attackIndex])<attackTarget)attackIndex++;
  const attackMs=clamp(((attackIndex-firstActive)/sampleRate)*1000,0,5000);
  const tailFrames=Math.min(n,Math.max(1,Math.floor(sampleRate*0.25))); let tailSum=0;
  for(let i=n-tailFrames;i<n;i++)tailSum+=mono[Math.max(0,i)]**2;
  const tailRms=Math.sqrt(tailSum/Math.max(1,tailFrames));
  const spec=spectralMetrics(mono,sampleRate,options.vocalLowHz,options.vocalHighHz);
  return {
    durationSeconds:n/sampleRate,sampleRate,peakDbfs:db(peak),rmsDbfs:db(rms),crestDb:db(crest),
    spectralCentroidHz:spec.centroid,spectralFlatness:spec.flatness,lowEnergyRatio:spec.low,midEnergyRatio:spec.mid,highEnergyRatio:spec.high,
    stereoCorrelation:correlation,stereoWidth:width,attackMs,tailRmsDbfs:db(tailRms),zeroCrossingRate:n>1?zc/(n-1):0,vocalBandEnergyRatio:spec.vocal,
  };
}
