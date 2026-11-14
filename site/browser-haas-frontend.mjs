// Experimental browser port of the Apache-2.0 Haas CPU frontend.
// Source: kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX
// revision e46a4b107ffba60336eb3de9745da6f628cfae35, haas_cpu/core/features.py.
const f32=Math.fround;
const plans=new Map();
function fftPlan(n){
 if(plans.has(n))return plans.get(n);
 const reverse=new Uint32Array(n),bits=Math.log2(n);
 if(!Number.isInteger(bits))throw Error('FFT length must be a power of two');
 for(let i=0;i<n;i++){let x=i,y=0;for(let k=0;k<bits;k++){y=(y<<1)|(x&1);x>>>=1;}reverse[i]=y;}
 const plan={reverse,cos:Float64Array.from({length:n/2},(_,i)=>Math.cos(2*Math.PI*i/n)),sin:Float64Array.from({length:n/2},(_,i)=>Math.sin(2*Math.PI*i/n))};
 plans.set(n,plan);return plan;
}
function fft(re,im,plan){
 const n=re.length;
 for(let i=0;i<n;i++){const j=plan.reverse[i];if(j>i){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let size=2;size<=n;size*=2){const half=size/2,step=n/size;
  for(let start=0;start<n;start+=size)for(let j=0;j<half;j++){
   const k=j*step,a=start+j,b=a+half,c=plan.cos[k],s=-plan.sin[k];
   const tr=re[b]*c-im[b]*s,ti=re[b]*s+im[b]*c,ar=re[a],ai=im[a];
   re[a]=ar+tr;im[a]=ai+ti;re[b]=ar-tr;im[b]=ai-ti;
  }
 }
}

/** 16 kHz mono PCM -> the model's fixed, deterministic log-mel input. */
export function logMel(audio,config){
 if(config.sample_rate!==16000||config.n_fft!==512||config.win_length!==400||config.hop_length!==160||config.pad_to!==16||config.normalize!=='per_feature'||config.log_zero_guard_type!=='add'||config.mag_power!==2||config.exact_pad!==false||config.frame_splicing!==1||config.pad_value!==0)throw Error('Unsupported Haas frontend settings');
 if(!(audio instanceof Float32Array))audio=Float32Array.from(audio);
 const n=audio.length,fftSize=config.n_fft,hop=config.hop_length,valid=Math.floor(n/hop),frameCount=Math.floor(n/hop)+1;
 if(valid<2)throw Error('Audio must contain at least 20 ms');
 if(frameCount>8000)throw Error('Haas encoder input exceeds 8000 frames; split the audio');
 const bins=fftSize/2+1,melCount=config.mel_filter.length,padded=Math.ceil(frameCount/config.pad_to)*config.pad_to;
 if(config.window.length!==config.win_length||config.mel_filter.some(row=>row.length!==bins))throw Error('Invalid Haas frontend coefficients');
 const emphasized=new Float32Array(n),preemph=f32(config.preemph);
 for(let i=0;i<n;i++){if(!Number.isFinite(audio[i]))throw Error('PCM contains a nonfinite sample');emphasized[i]=i?f32(audio[i]-f32(preemph*audio[i-1])):audio[i];}
 const window=new Float64Array(fftSize),windowStart=(fftSize-config.win_length)/2;
 for(let i=0;i<config.window.length;i++)window[windowStart+i]=f32(config.window[i]);
 const filters=config.mel_filter.map(row=>row.flatMap((weight,bin)=>weight?[{bin,weight:f32(weight)}]:[]));
 const data=new Float32Array(melCount*padded),re=new Float64Array(fftSize),im=new Float64Array(fftSize),power=new Float32Array(bins),plan=fftPlan(fftSize),guard=f32(config.log_zero_guard_value);
 for(let frame=0;frame<frameCount;frame++){
  const offset=frame*hop-fftSize/2;im.fill(0);
  for(let j=0;j<fftSize;j++){const index=offset+j;re[j]=(index<0||index>=n?0:emphasized[index])*window[j];}
  fft(re,im,plan);
  for(let j=0;j<bins;j++)power[j]=f32(re[j]*re[j]+im[j]*im[j]);
  for(let m=0;m<melCount;m++){let sum=0;for(const {bin,weight} of filters[m])sum+=weight*power[bin];data[m*padded+frame]=f32(Math.log(f32(f32(sum)+guard)));}
 }
 const epsilon=f32(1e-5);
 for(let m=0;m<melCount;m++){
  const offset=m*padded;let total=0;for(let t=0;t<valid;t++)total+=data[offset+t];
  const mean=f32(total/valid);let variance=0;
  for(let t=0;t<valid;t++){const difference=f32(data[offset+t]-mean);variance+=f32(difference*difference);}
  const std=f32(Math.sqrt(f32(variance/(valid-1)))),denominator=f32(std+epsilon);
  for(let t=0;t<valid;t++)data[offset+t]=f32(f32(data[offset+t]-mean)/denominator);
  data.fill(0,offset+valid,offset+padded);
 }
 return {data,dims:[1,melCount,padded],length:new BigInt64Array([BigInt(valid)]),validFrames:valid};
}

/** Quiet-point chunking used by the official CPU example for longer audio. */
export function splitAtQuietPoints(audio,{sampleRate=16000,chunkSeconds=28,searchSeconds=2,windowSeconds=.1}={}){
 const step=Math.floor(chunkSeconds*sampleRate),search=Math.floor(searchSeconds*sampleRate),window=Math.floor(windowSeconds*sampleRate),bounds=[];let start=0;
 while(audio.length-start>step){const target=start+step,low=Math.max(start+Math.floor(step/2),target-search),high=Math.min(audio.length-window,target+search);let cut=target;
  if(high>low){let energy=0;for(let i=low;i<low+window;i++)energy+=audio[i]*audio[i];let best=energy,bestIndex=low;
   for(let i=low+1;i<=high;i++){energy+=audio[i+window-1]**2-audio[i-1]**2;if(energy<best){best=energy;bestIndex=i;}}cut=bestIndex+Math.floor(window/2);
  }
  bounds.push([start,cut]);start=cut;
 }
 if(start<audio.length)bounds.push([start,audio.length]);return bounds;
}
