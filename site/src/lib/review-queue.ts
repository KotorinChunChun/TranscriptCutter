import {buildGroups,getDisplaySpeaker,getSpeakerParts,resolveEditorDocument,type EditorDocument,type EditorState} from './editor';
import {buildComparisonRows,type ComparisonSession} from './comparison';

export type ReviewItem={id:string;start:number;end:number;reason:string;text:string;cueId?:string;cutId?:string;comparisonRowId?:string};
// Two independent hashes keep acknowledgement keys small even for long transcripts.
function signature(value:unknown){let a=2166136261,b=5381;for(const c of JSON.stringify(value)){const n=c.charCodeAt(0);a=Math.imul(a^n,16777619);b=Math.imul(b,33)^n;}return (a>>>0).toString(16)+'-'+(b>>>0).toString(16);}
const norm=(text:string)=>text.replace(/\s+/g,'').trim();
export function buildReviewQueue(base:EditorDocument,state:EditorState,comparison:ComparisonSession|null):ReviewItem[]{
 const doc=resolveEditorDocument(base,state),items:ReviewItem[]=[];
 const deleted=new Set(buildGroups(doc,state,{merge:false}).filter(g=>g.deleted).flatMap(g=>g.cueIds));
 const add=(item:Omit<ReviewItem,'id'>,evidence:unknown)=>items.push({...item,id:signature([item,evidence])});
 for(let i=0;i<doc.cues.length;i++){
  const c=doc.cues[i];if(deleted.has(c.id))continue;
  const speaker=getDisplaySpeaker(c,state),common={start:c.start,end:c.end,text:c.text,cueId:c.id};
  if(!speaker||c.isMultiVoice||getSpeakerParts(speaker).length>1)add({...common,reason:speaker?'同時発話・複合話者候補':'話者不明'},[speaker,c.voiceSpans]);
  const previous=doc.cues[i-1],text=norm(c.text);
  if(/(.{3,40})\1{2,}/u.test(text)||previous&&!deleted.has(previous.id)&&c.start-previous.end<3000&&text.length>=6&&text===norm(previous.text))add({...common,reason:'繰り返し候補'},[previous?.text,c.text]);
 }
 for(const c of state.cuts)if(c.precision==='estimated')add({start:c.start,end:c.end,text:c.text??'',reason:'推定時刻のカット',cutId:c.id,cueId:c.sourceCueIds[0]},c);
 if(comparison&&comparison.sources.length>1)for(const row of buildComparisonRows(comparison)){
  const variants=comparison.sources.map(source=>({id:source.id,cues:(row.candidates[source.id]??[]).map(c=>({text:c.text,speaker:c.speaker,start:c.start,end:c.end})),aliases:comparison.speakerAliases[source.id]}));
  const texts=new Set(variants.map(v=>norm(v.cues.map(c=>c.text).join(''))));
  const speakers=new Set(variants.map(v=>v.cues.map(c=>c.speaker?comparison.speakerAliases[v.id]?.[c.speaker]??c.speaker:'').join('/')));
  if(texts.size>1||speakers.size>1)add({start:row.start,end:row.end,text:variants.map(v=>v.cues.map(c=>c.text).join('')).filter(Boolean).join(' / '),reason:'モデル間の差分',comparisonRowId:row.id},[variants,comparison.choices[row.id]]);
 }
 return items.sort((a,b)=>a.start-b.start||a.reason.localeCompare(b.reason));
}
