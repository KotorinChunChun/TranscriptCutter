import {serializeVtt} from './src/lib/vtt';
import type {Segment} from './speech-client';
export function segmentsToVtt(segments:readonly Segment[]){
 return serializeVtt(segments.filter(s=>s.text?.trim()).map(s=>{
  if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start)throw Error('字幕の時刻を確認してください。');
  return {id:String(s.id),start:Math.round(s.start*1000),end:Math.round(s.end*1000),text:s.text,speaker:s.speaker??null,sourceIds:[String(s.id)],sourceCount:1};
 }),{speakerFormat:'voice'});
}
