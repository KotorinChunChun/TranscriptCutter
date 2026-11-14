// Copyright 2026 The HuggingFace Inc. team. All rights reserved.
// Apache-2.0; adapted to JavaScript from Transformers' Nemotron3DiarizationSpeakerCache
// and Nemotron3DiarizationForAudioFrameClassification.forward, revision
// 3a134bc37f7c22c801b618e289b0255425f22647, modeling_nemotron3_diarization.py.
// FFT/feature calculations are a new JS implementation of the published 16 kHz
// frontend contract. ONNX weights are separately licensed under OpenMDW-1.1.
// This module does not use the unlicensed third-party experimental diar.js.

const C={rate:16000,hop:160,fft:512,window:400,mels:128,sub:8,width:512,speakers:8,
  chunk:340,right:40,cache:264,fifo:40,update:300,silenceSlots:1,scoreFloor:.25,
  latestBoost:.05,minPositiveRate:.5,strongRate:.75,weakRate:1.5};
const sigmoid=x=>1/(1+Math.exp(-x));
const finiteArray=value=>value&&ArrayBuffer.isView(value)&&value.every(Number.isFinite);

// Iterative radix-2 FFT; zero-padding and Hann window follow the model processor.
function fftPlan(){
  const reverse=Uint16Array.from({length:C.fft},(_,i)=>{let x=i,r=0;for(let b=0;b<9;b++){r=(r<<1)|(x&1);x>>>=1;}return r;});
  return {reverse,cos:Float64Array.from({length:256},(_,i)=>Math.cos(2*Math.PI*i/512)),sin:Float64Array.from({length:256},(_,i)=>Math.sin(2*Math.PI*i/512))};
}
const FFT=fftPlan();
function transform(real,imag){
  for(let i=0;i<512;i++){const j=FFT.reverse[i];if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]];}}
  for(let length=2;length<=512;length*=2){const half=length/2,stride=512/length;
    for(let offset=0;offset<512;offset+=length)for(let j=0;j<half;j++){
      const a=offset+j,b=a+half,k=j*stride,tr=real[b]*FFT.cos[k]+imag[b]*FFT.sin[k],ti=imag[b]*FFT.cos[k]-real[b]*FFT.sin[k];
      real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;
    }
  }
}
export function createNemotronFeatureExtractor(filters){
  if(!finiteArray(filters)||filters.length!==128*257)throw Error('Nemotronのメル係数が不正です。');
  const weights=[];
  for(let m=0;m<128;m++){const row=[];for(let k=0;k<257;k++)if(filters[m*257+k])row.push([k,filters[m*257+k]]);weights.push(row);}
  const window=new Float64Array(512);for(let i=0;i<400;i++)window[i+56]=.5-.5*Math.cos(2*Math.PI*i/399);
  const real=new Float64Array(512),imag=new Float64Array(512),power=new Float64Array(257);
  return (audio,first,last)=>{
    const features=new Float32Array((last-first)*128);
    for(let f=first;f<last;f++){
      const origin=f*160-256;
      for(let j=0;j<512;j++){const index=origin+j;let sample=0;if(index===0)sample=audio[0];else if(index>0&&index<audio.length)sample=Math.fround(audio[index]-.97*audio[index-1]);real[j]=sample*window[j];imag[j]=0;}
      transform(real,imag);for(let k=0;k<257;k++)power[k]=real[k]**2+imag[k]**2;
      for(let m=0;m<128;m++){let value=0;for(const [k,w] of weights[m])value+=power[k]*w;features[(f-first)*128+m]=Math.log(value+2**-24);}
    }
    return features;
  };
}

/** Batch-one translation of the official Arrival-Order Speaker Cache policy. */
export class NemotronSpeakerCache {
  constructor(silence){this.silence=silence;this.embeds=[];this.probs=[];this.fifo=[];this.compressed=false;}
  getEmbeds(){return [...this.embeds,...this.fifo];}
  update(input,pooled,chunkFrames){
    const cached=this.embeds.length,fifoLength=this.fifo.length,chunkStart=cached+fifoLength;
    let queue=[...this.fifo,...input.slice(chunkStart,chunkStart+chunkFrames)];
    const popped=queue.length>C.fifo?Math.min(Math.max(C.update,queue.length-C.fifo),queue.length):0;
    if(popped){
      const fifoProbs=pooled.slice(cached,cached+queue.length);
      const stored=this.compressed?this.probs:pooled.slice(0,cached);
      let embeds=[...this.embeds,...queue.slice(0,popped)],probs=[...stored,...fifoProbs.slice(0,popped)];
      if(embeds.length>C.cache){({embeds,probs}=this.compress(embeds,probs));this.compressed=true;}
      this.embeds=embeds;this.probs=probs;queue=queue.slice(popped);
    }
    this.fifo=queue;
  }
  compress(embeds,probabilities){
    const count=probabilities.length,scores=Array.from({length:count},()=>new Float64Array(8)),positive=new Uint32Array(8);
    const budget=Math.floor(C.cache/C.speakers)-C.silenceSlots,minPositive=Math.floor(budget*C.minPositiveRate);
    for(let t=0;t<count;t++){
      const complements=Array.from(probabilities[t],p=>Math.log(Math.max(1-p,C.scoreFloor))),sum=complements.reduce((a,b)=>a+b,0);
      for(let s=0;s<8;s++){const p=probabilities[t][s],value=p>.5?Math.log(Math.max(p,C.scoreFloor))-complements[s]+sum-Math.log(.5):-Infinity;scores[t][s]=value;if(value>0)positive[s]++;}
    }
    for(let t=0;t<count;t++)for(let s=0;s<8;s++){
      if(!(scores[t][s]>0)&&probabilities[t][s]>.5&&positive[s]>=minPositive)scores[t][s]=-Infinity;
      if(t>=C.cache)scores[t][s]+=C.latestBoost;
    }
    const boost=(number,amount)=>{for(let s=0;s<8;s++){
      const ranked=Array.from({length:count},(_,i)=>i).sort((a,b)=>scores[b][s]-scores[a][s]||a-b);
      for(let i=0;i<Math.min(number,count);i++)scores[ranked[i]][s]+=amount;
    }};
    boost(Math.floor(budget*C.strongRate),-2*Math.log(.5));boost(Math.floor(budget*C.weakRate),-Math.log(.5));
    const scored=count+C.silenceSlots,sentinel=scored*8,ranked=[];
    for(let s=0;s<8;s++)for(let frame=0;frame<scored;frame++)ranked.push({index:s*scored+frame,score:frame===count?Infinity:scores[frame][s]});
    ranked.sort((a,b)=>b.score-a.score||a.index-b.index);
    const indices=ranked.slice(0,C.cache).map(item=>item.score===-Infinity?sentinel:item.index).sort((a,b)=>a-b);
    const zero=new Float32Array(8),chosen=indices.map(index=>index===sentinel?count:Math.min(count,index%scored));
    return {embeds:chosen.map(frame=>frame===count?this.silence:embeds[frame]),probs:chosen.map(frame=>frame===count?zero:probabilities[frame])};
  }
}

function localAsset(url){if(typeof url!=='string'||!url.startsWith('blob:'))throw Error('Nemotronは導入済みのモデルだけを読み込めます。');return url;}
export async function loadNemotron(ort,{embedUrl,stepUrl,melUrl,silenceUrl},onProgress=()=>{}){
  let embed,step;
  try{
    const coefficients=async(url,size)=>{const response=await fetch(localAsset(url));if(!response.ok)throw Error('Nemotronの係数を読み込めません。');const buffer=await response.arrayBuffer();if(buffer.byteLength!==size*4)throw Error('Nemotronの係数サイズが一致しません。');const data=new Float32Array(buffer);if(!finiteArray(data))throw Error('Nemotronの係数が不正です。');return data;};
    onProgress('Nemotronの係数を読み込み中');
    const [filters,silence]=await Promise.all([coefficients(melUrl,128*257),coefficients(silenceUrl,512)]),features=createNemotronFeatureExtractor(filters);
    onProgress('Nemotronの特徴量モデルを読み込み中');embed=await ort.InferenceSession.create(localAsset(embedUrl),{executionProviders:['wasm']});
    onProgress('Nemotronの話者識別モデルを読み込み中');step=await ort.InferenceSession.create(localAsset(stepUrl),{executionProviders:['wasm']});
    let disposed=false,running=false;
    return {
      async run(audio,onProgress=()=>{}){
        if(disposed||running)throw Error('Nemotronの実行状態を確認してください。');
        if(!(audio instanceof Float32Array)||audio.length<160||!finiteArray(audio))throw Error('Nemotronの音声入力を確認してください。');
        running=true;
        try{
          const numFrames=Math.floor(audio.length/160),embeddingCount=Math.ceil(numFrames/8),probabilities=new Float32Array(embeddingCount*8*8),cache=new NemotronSpeakerCache(silence);
          for(let first=0;first<embeddingCount;first+=C.chunk){
            const end=Math.min(first+C.chunk,embeddingCount),last=Math.min(end+C.right,embeddingCount),f0=first*8,f1=Math.min(last*8,numFrames);
            const result=await embed.run({features:new ort.Tensor('float32',features(audio,f0,f1),[1,f1-f0,128])});
            const data=result.embeds?.data,shape=result.embeds?.dims;
            if(!finiteArray(data)||shape?.[0]!==1||shape?.at(-1)!==512||shape[1]!==Math.ceil((f1-f0)/8))throw Error('Nemotronの特徴量出力を確認してください。');
            const chunk=Array.from({length:shape[1]},(_,i)=>data.slice(i*512,(i+1)*512)),cached=cache.getEmbeds(),rows=[...cached,...chunk],input=new Float32Array(rows.length*512);
            rows.forEach((row,i)=>input.set(row,i*512));
            const out=await step.run({embeds:new ort.Tensor('float32',input,[1,rows.length,512])}),logits=out.logits?.data;
            if(!finiteArray(logits)||logits.length!==rows.length*8*8)throw Error('Nemotronの話者出力を確認してください。');
            const pooled=Array.from({length:rows.length},()=>new Float32Array(8));
            for(let row=0;row<rows.length;row++){for(let k=0;k<8;k++)for(let s=0;s<8;s++)pooled[row][s]+=sigmoid(logits[(row*8+k)*8+s]);for(let s=0;s<8;s++)pooled[row][s]/=8;}
            cache.update(rows,pooled,end-first);
            for(let frame=0;frame<(end-first)*8;frame++)for(let s=0;s<8;s++)probabilities[(first*8+frame)*8+s]=sigmoid(logits[(cached.length*8+frame)*8+s]);
            onProgress(end/embeddingCount);
          }
          return {probs:probabilities.subarray(0,numFrames*8),numFrames};
        }finally{running=false;}
      },
      async dispose(){if(running)throw Error('実行中のNemotronを解放できません。');if(disposed)return;disposed=true;await Promise.all([embed.release(),step.release()]);},
    };
  }catch(error){await Promise.allSettled([embed?.release(),step?.release()]);throw error;}
}
