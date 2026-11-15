import type {EditorGroup} from './editor';
import type {TimeRange} from './timeline-review';

/** Display only: retain every cue, line, canonical label and timestamp. */
export function compactSpeakerGroups(groups:readonly EditorGroup[]):EditorGroup[]{
 const result:EditorGroup[]=[];
 for(let i=0;i<groups.length;i++){
  const a=groups[i],gap=groups[i+1],b=groups[i+2];
  if(a.canonicalSpeaker&&gap&&b&&!gap.canonicalSpeaker&&gap.end-gap.start<=1500&&
    a.canonicalSpeaker===b.canonicalSpeaker&&![a,gap,b].some(g=>g.isMultiVoice||g.deleted||g.manual)&&
    gap.start>=a.end&&b.start>=gap.end&&gap.start-a.end<=500&&b.start-gap.end<=500){
   result.push({...a,displayUnknownCueIds:gap.cueIds,cueIds:[...a.cueIds,...gap.cueIds,...b.cueIds],cues:[...a.cues,...gap.cues,...b.cues],lines:[...a.lines,...gap.lines,...b.lines],end:b.end,text:[a.text,gap.text,b.text].join('\n'),sourceCount:a.sourceCount+gap.sourceCount+b.sourceCount});i+=2;
  }else result.push(a);
 }
 return result;
}

/** Suggestions only. Seek a local low-amplitude minimum within 180ms of each edge. */
export function quietBoundaryCandidates(wave:{peaks:readonly number[];start:number;end:number},selection:TimeRange):TimeRange|null{
 if(!wave.peaks.length||wave.end<=wave.start)return null;
 const step=(wave.end-wave.start)/wave.peaks.length;
 const edge=(at:number)=>{
  const candidates=wave.peaks.map((peak,i)=>({peak,time:Math.round(wave.start+(i+.5)*step)})).filter(p=>Math.abs(p.time-at)<=180&&p.time>=wave.start&&p.time<=wave.end);
  const localMax=Math.max(0,...candidates.map(p=>p.peak));
  const quiet=candidates.filter(p=>p.peak<=Math.min(.04,localMax*.2));
  quiet.sort((a,b)=>Math.abs(a.time-at)-Math.abs(b.time-at)||a.peak-b.peak);
  return quiet[0]?.time??at;
 };
 const start=edge(selection.start),end=edge(selection.end);
 return end>start&&(start!==selection.start||end!==selection.end)?{start,end}:null;
}
