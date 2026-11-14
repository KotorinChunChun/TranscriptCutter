import type {Cue} from './vtt';
export interface WordTimingUnit {from:number;to:number;start:number;end:number}
export interface WordTiming {text:string;units:WordTimingUnit[]}
export type WordSegment={start:number;end:number;words:{word:string;start:number;end:number}[]};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Optional seconds-based recognition data; never replaces the original subtitle. */
export function readWordSegments(value:unknown):WordSegment[]{
 const rows=Array.isArray(value)?value:object(value)?value.segments:undefined;
 if(!Array.isArray(rows)||rows.length>200000)throw Error('単語時刻JSONのsegmentsを確認してください。');
 let count=0;
 return rows.flatMap(s=>{
  if(!object(s)||typeof s.start!=='number'||typeof s.end!=='number'||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||!Array.isArray(s.words))return [];
  const words=s.words.flatMap((w:unknown)=>{
   if(++count>400000)throw Error('単語時刻の件数が多すぎます。');
   if(!object(w)||typeof w.word!=='string'||w.word.length>4096||typeof w.start!=='number'||typeof w.end!=='number'||!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<=w.start)return [];
   return [{word:w.word,start:w.start,end:w.end}];
  });
  return [{start:s.start,end:s.end,words}];
 });
}
/** Reject stale, out-of-cue, overlapping or non-monotonic timing on every import. */
export function validatedWordTiming(cue:Pick<Cue,'text'|'start'|'end'>,value:unknown):WordTiming|undefined{
 if(!object(value)||value.text!==cue.text||!Array.isArray(value.units)||value.units.length>10000)return;
 const units:WordTimingUnit[]=[];
 for(const raw of value.units){
  if(!object(raw))return;
  const {from,to,start,end}=raw;
  if(![from,to,start,end].every(Number.isSafeInteger))return;
  const u={from:from as number,to:to as number,start:start as number,end:end as number},previous=units.at(-1);
  const boundary=(i:number)=>i===0||i===cue.text.length||!(/[\uD800-\uDBFF]/.test(cue.text[i-1])&&/[\uDC00-\uDFFF]/.test(cue.text[i]));
  if(u.from<0||u.to<=u.from||u.to>cue.text.length||!boundary(u.from)||!boundary(u.to)||u.start<cue.start||u.end>cue.end||u.end<=u.start||previous&&(previous.to>u.from||previous.end>u.start))return;
  units.push(u);
 }
 return units.length?{text:cue.text,units}:undefined;
}
export function attachWordTimings<T extends Cue>(cues:readonly T[],segments:readonly WordSegment[]):T[]{
 const sorted=[...segments].sort((a,b)=>a.start-b.start),ends:number[]=[];
 sorted.forEach((s,i)=>ends.push(Math.max(s.end,ends[i-1]??0)));
 return cues.map(cue=>{
  let lo=0,hi=sorted.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(ends[mid]*1000<=cue.start)lo=mid+1;else hi=mid;}
  const words:WordSegment['words']=[];
  for(let i=lo;i<sorted.length&&sorted[i].start*1000<cue.end;i++)if(sorted[i].end*1000>cue.start)words.push(...sorted[i].words);
  if(words.length>10000)return cue;
  const joined=words.map(w=>w.word).join(''),counts=new Map<string,number>();
  words.forEach(w=>{const text=w.word.trim();counts.set(text,(counts.get(text)??0)+1);});
  let offset=0;
  const candidates=words.flatMap(w=>{
   const text=w.word.trim(),at=offset+w.word.length-w.word.trimStart().length;offset+=w.word.length;
   const from=cue.text.indexOf(text),start=Math.round(w.start*1000),end=Math.round(w.end*1000);
   if(!text||counts.get(text)!==1||from<0||cue.text.indexOf(text,from+1)>=0||start<cue.start||end>cue.end||end<=start)return [];
   let left=0,right=0;
   while(left<24&&from>left&&at>left&&cue.text[from-left-1]===joined[at-left-1])left++;
   while(right<24&&from+text.length+right<cue.text.length&&at+text.length+right<joined.length&&cue.text[from+text.length+right]===joined[at+text.length+right])right++;
   if(text.length+left+right<3)return [];
   return [{from,to:from+text.length,start,end}];
  }).sort((a,b)=>a.from-b.from);
  // Discard both sides of crossing correspondences instead of guessing.
  const prefix:{to:number;end:number}[]=[],suffix:{from:number;start:number}[]=[];
  candidates.forEach((u,i)=>prefix.push({to:Math.max(u.to,prefix[i-1]?.to??0),end:Math.max(u.end,prefix[i-1]?.end??0)}));
  for(let i=candidates.length-1;i>=0;i--)suffix[i]={from:Math.min(candidates[i].from,suffix[i+1]?.from??Infinity),start:Math.min(candidates[i].start,suffix[i+1]?.start??Infinity)};
  const units=candidates.filter((u,i)=>(!prefix[i-1]||prefix[i-1].to<=u.from&&prefix[i-1].end<=u.start)&&(!suffix[i+1]||u.to<=suffix[i+1].from&&u.end<=suffix[i+1].start));
  const wordTiming=validatedWordTiming(cue,{text:cue.text,units});
  const {wordTiming:_old,...original}=cue;
  return {...original,...(wordTiming?{wordTiming}:{})} as T;
 });
}
/** Holes fall back for the entire selected range. */
export function wordCutCandidate(cue:Cue,from:number,to:number):{start:number;end:number;interpolated:boolean}|null{
 const timing=cue.wordTiming;
 if(!timing||timing.text!==cue.text)return null;
 const units=timing.units.filter(u=>u.from<to&&u.to>from);
 let cursor=from;
 for(const u of units){if(cue.text.slice(cursor,Math.max(cursor,u.from)).trim())return null;cursor=Math.max(cursor,Math.min(to,u.to));}
 if(!units.length||cue.text.slice(cursor,to).trim())return null;
 const first=units[0],last=units.at(-1)!;
 const position=(u:WordTimingUnit,at:number)=>{
  const total=Array.from(cue.text.slice(u.from,u.to)).length,part=Array.from(cue.text.slice(u.from,Math.max(u.from,Math.min(u.to,at)))).length;
  return Math.round(u.start+(u.end-u.start)*part/total);
 };
 const start=position(first,from),end=position(last,to);
 return end>start?{start,end,interpolated:from>first.from||to<last.to}:null;
}
