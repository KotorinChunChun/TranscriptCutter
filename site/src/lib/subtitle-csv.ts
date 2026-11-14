import {formatTime,type Cue} from './vtt';

/** UTF-8 BOM and RFC 4180 quoting retain Japanese, commas and multiline text. */
export function subtitleCsv(cues:readonly Pick<Cue,'start'|'end'|'speaker'|'text'>[]):string{
 const cell=(value:string)=>'"'+value.replaceAll('"','""')+'"';
 return '\ufeff'+[['開始','終了','話者','本文'],...cues.map(cue=>{
  if(!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<0||cue.end<=cue.start)throw Error('字幕の時刻を確認してください。');
  return [formatTime(cue.start,true),formatTime(cue.end,true),cue.speaker??'',cue.text];
 })].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
