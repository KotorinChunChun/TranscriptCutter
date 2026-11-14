// Haas token times are recognition candidates, not forced-aligned word boundaries.
// The Apache-2.0 Haas decoder is reused so byte fallback never changes the original text.
import {decodeTokens} from './browser-haas-decoder.mjs';
const FRAMES_PER_SECOND=100,SPEAKERS=8;

function estimatedSpans(text,from,to){
  const letters=Array.from(text),length=letters.length;let index=0;
  return letters.map((letter,i)=>{const start=index;index+=letter.length;return {a:start,b:index,start:from+(to-from)*i/length,end:from+(to-from)*(i+1)/length,estimated:true};});
}
function tokenSpans(text,ids,timestamps,tokens,from,to){
  if(!Array.isArray(ids)||!Array.isArray(timestamps)||!tokens?.pieces||ids.length!==timestamps.length||!ids.length)return estimatedSpans(text,from,to);
  if(timestamps.some((t,i)=>!Number.isInteger(t)||t<0||i&&t<timestamps[i-1]))return estimatedSpans(text,from,to);
  let decoded;try{decoded=decodeTokens(ids,tokens);}catch{return estimatedSpans(text,from,to);}
  if(decoded.trim()!==text.trim())return estimatedSpans(text,from,to);
  const decodedLeading=decoded.length-decoded.trimStart().length,originalLeading=text.length-text.trimStart().length;
  const spans=[];let previousCharacter=0,previousToken=-1;
  for(let i=0;i<ids.length;i++){
    if(i+1<ids.length&&timestamps[i+1]===timestamps[i])continue;
    let prefix;try{prefix=decodeTokens(ids.slice(0,i+1),tokens).slice(decodedLeading);}catch{continue;}
    if(!text.startsWith(prefix,originalLeading))continue;
    let boundary=Math.min(text.length,originalLeading+prefix.length);if(i===ids.length-1)boundary=text.length;
    if(boundary>0&&boundary<text.length&&/[\uD800-\uDBFF]/.test(text[boundary-1])&&/[\uDC00-\uDFFF]/.test(text[boundary]))continue;
    if(boundary<=previousCharacter)continue;
    const start=from+timestamps[previousToken+1]*.08,end=Math.min(to,from+(i+1<ids.length?timestamps[i+1]*.08:timestamps[i]*.08+.08));
    if(!(start>=from&&end>start&&end<=to)||spans.length&&start<spans.at(-1).end)return estimatedSpans(text,from,to);
    spans.push({a:previousCharacter,b:boundary,start,end,estimated:false});previousCharacter=boundary;previousToken=i;
  }
  if(previousCharacter!==text.length||spans.length<2&&Array.from(text).length>1)return estimatedSpans(text,from,to);
  return spans;
}
function probabilitiesAvailable(probs,numFrames){return probs instanceof Float32Array&&Number.isSafeInteger(numFrames)&&numFrames>=0&&probs.length===numFrames*8;}
function speakerForSpan(probs,numFrames,start,end,audioFrom){
  const first=Math.max(0,Math.floor((start-audioFrom)*100)),last=Math.min(numFrames,Math.ceil((end-audioFrom)*100)),scores=new Float64Array(8);
  if(last>first)for(let f=first;f<last;f++)for(let s=0;s<8;s++)scores[s]+=probs[f*8+s]/(last-first);
  const candidates=Array.from(scores,(score,index)=>({speaker:`話者${index+1}`,score})).filter(item=>item.score>.5).sort((a,b)=>b.score-a.score||a.speaker.localeCompare(b.speaker));
  return {speaker:candidates.length?candidates.map(item=>item.speaker).sort().join(' / '):'話者不明',candidates};
}
function intervalsForCue(probs,numFrames,start,end,audioFrom){
  const first=Math.max(0,Math.floor((start-audioFrom)*100)),last=Math.min(numFrames,Math.ceil((end-audioFrom)*100)),out=[];
  for(let s=0;s<8;s++){let began=-1;for(let f=first;f<=last;f++){
    const active=f<last&&probs[f*8+s]>.5;
    if(active&&began<0)began=f;
    if(!active&&began>=0){const from=Math.max(start,audioFrom+began/100),to=Math.min(end,audioFrom+f/100);if(to>from)out.push({start:from,end:to,speaker:`話者${s+1}`});began=-1;}
  }}
  return out.sort((a,b)=>a.start-b.start||a.speaker.localeCompare(b.speaker));
}

/** Seconds on the original media; preserve every source character across cue splits. */
export function alignHaasChunk({text,ids,timestamps,tokens,from,to,probs,numFrames,audioFrom=0,nextId=1,maxCueSeconds=8}){
  if(typeof text!=='string'||!text.trim())return [];
  if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||!Number.isFinite(audioFrom)||audioFrom<0||!Number.isSafeInteger(nextId)||nextId<1||!Number.isFinite(maxCueSeconds)||!(maxCueSeconds>0))throw Error('Haas字幕の時刻を確認してください。');
  if(probs!==undefined&&(!probabilitiesAvailable(probs,numFrames)||!probs.every(p=>Number.isFinite(p)&&p>=0&&p<=1)))throw Error('Nemotron話者時刻の形式を確認してください。');
  const diarize=probabilitiesAvailable(probs,numFrames),spans=tokenSpans(text,ids,timestamps,tokens,from,to),groups=[];
  let current;
  for(const span of spans){
    const identity=diarize?speakerForSpan(probs,numFrames,span.start,span.end,audioFrom):{speaker:undefined,candidates:[]};
    const preceding=current?text.slice(current.a,current.b):'';
    if(current&&(current.speaker!==identity.speaker||span.end-current.start>maxCueSeconds||/[。！？!?]\s*$/.test(preceding))){groups.push(current);current=undefined;}
    if(!current)current={a:span.a,b:span.b,start:span.start,end:span.end,speaker:identity.speaker,parts:[],candidates:[]};
    current.b=span.b;current.end=span.end;current.parts.push(span);current.candidates.push(...identity.candidates);
  }
  if(current)groups.push(current);
  const visible=[];let leading;
  for(const g of groups){
    if(!text.slice(g.a,g.b).trim()){
      if(visible.length){const prior=visible.at(-1);prior.b=g.b;prior.end=g.end;prior.parts.push(...g.parts);}
      else if(leading){leading.b=g.b;leading.end=g.end;leading.parts.push(...g.parts);}
      else leading=g;
    }else{
      if(leading){g.a=leading.a;g.start=leading.start;g.parts.unshift(...leading.parts);leading=undefined;}
      visible.push(g);
    }
  }
  return visible.map((g,index)=>{
    const candidates=new Map();for(const c of g.candidates){const old=candidates.get(c.speaker);if(!old||c.score>old.score)candidates.set(c.speaker,c);}
    const estimated=g.parts.some(p=>p.estimated),row={id:nextId+index,start:g.start,end:g.end,text:text.slice(g.a,g.b),timestampType:estimated?'character-estimate':'tdt-token-candidate',timingEstimated:estimated,
      words:estimated?[]:g.parts.map(p=>({word:text.slice(p.a,p.b),start:p.start,end:p.end}))};
    if(diarize)Object.assign(row,{speaker:g.speaker,speakerCandidates:[...candidates.values()],speakerIntervals:intervalsForCue(probs,numFrames,g.start,g.end,audioFrom),speakerTimingSource:estimated?'character-estimate':'tdt-token-candidate'});
    return row;
  });
}
