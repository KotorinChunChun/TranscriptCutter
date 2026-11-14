// Original interval planning for TranscriptCutter's local browser ASR.
import {splitAtQuietPoints} from './browser-haas-frontend.mjs';

function merge(regions,gap=0) {
 const output=[];
 for(const region of regions.slice().sort((a,b)=>a.start-b.start||a.end-b.end)) {
  const last=output.at(-1);
  if(last&&region.start-last.end<=gap+1e-9)last.end=Math.max(last.end,region.end);
  else output.push({...region});
 }
 return output;
}
const totalSeconds=regions=>regions.reduce((sum,r)=>sum+r.end-r.start,0);

/** Retain short pauses in each recognition group, preserving the original time axis. */
export function regionsFromSegments(segments,duration,{pad=.25,mergeGap=3}={}) {
 if(!Number.isFinite(duration)||duration<0||!Number.isFinite(pad)||pad<0||!Number.isFinite(mergeGap)||mergeGap<0)throw Error('発話区間の設定を確認してください。');
 for(const segment of segments)if(!Number.isFinite(segment.start)||!Number.isFinite(segment.end)||segment.end<segment.start)throw Error('発話区間の時刻が不正です。');
 const speech=merge(segments.map(s=>({start:Math.max(0,s.start),end:Math.min(duration,s.end)})).filter(s=>s.end>s.start));
 const regions=merge(speech.map(s=>({start:Math.max(0,s.start-pad),end:Math.min(duration,s.end+pad)})),mergeGap);
 const removed=[];let cursor=0;
 for(const region of regions){if(region.start>cursor)removed.push({start:cursor,end:region.start});cursor=region.end;}
 if(cursor<duration)removed.push({start:cursor,end:duration});
 return {regions,removed,speechSeconds:totalSeconds(speech),retainedSeconds:totalSeconds(regions)};
}

/** Validate a selected range against its 16 kHz mono PCM before inference. */
export function validateHaasRange(audio,from,to) {
 if(!(audio instanceof Float32Array)||audio.length<320||!audio.every(Number.isFinite))throw Error('認識には20ミリ秒以上の16kHz音声が必要です。');
 if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||Math.abs(audio.length/16000-(to-from))>1/16000+1e-6)throw Error('音声と認識範囲の長さが一致しません。');
}

/** Local sample offsets and absolute original-media seconds for each Haas invocation. */
export function planHaasChunks(audio,regions,rangeFrom,{chunkSeconds=25}={}) {
 const chunks=[],duration=audio.length/16000;
 if(!Number.isFinite(rangeFrom)||rangeFrom<0||!Number.isFinite(chunkSeconds)||chunkSeconds<=2)throw Error('Haasの分割設定が不正です。');
 let previousEnd=0;
 for(const region of regions) {
  if(!Number.isFinite(region.start)||!Number.isFinite(region.end)||region.start<previousEnd-1e-9||region.end<=region.start||region.end>duration+1e-6)throw Error('Haas入力区間の順序を確認してください。');
  previousEnd=region.end;
  const startSample=Math.max(0,Math.round(region.start*16000)),endSample=Math.min(audio.length,Math.round(region.end*16000));
  if(endSample-startSample<320)throw Error('Haas入力区間は20ミリ秒以上にしてください。');
  for(const [a,b] of splitAtQuietPoints(audio.subarray(startSample,endSample),{chunkSeconds})) {
   const fromSample=startSample+a,toSample=startSample+b;
   chunks.push({fromSample,toSample,from:rangeFrom+fromSample/16000,to:rangeFrom+toSample/16000});
  }
 }
 return chunks;
}
