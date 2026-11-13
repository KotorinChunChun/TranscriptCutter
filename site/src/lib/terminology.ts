export type TermRule={id:string;from:string;to:string;reading:string;nearKana:boolean;logic:boolean;ai:boolean;enabled:boolean;note:string};
export const kana=(text:string)=>text.normalize('NFKC').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).toLowerCase();
const text=(value:unknown,max:number)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u001f<>]/.test(value))throw Error('語句の形式を確認してください。');return value.trim();};
export function validateRules(value:unknown):TermRule[]{
 if(!Array.isArray(value)||value.length>2000)throw Error('用語は2,000件まで登録できます。');
 const ids=new Set<string>();return value.map(v=>{
  if(!v||typeof v!=='object')throw Error('用語の形式が不正です。');
  const id=text(v.id,100),from=text(v.from,100),to=text(v.to,100);if(!id||ids.has(id)||!from||!to||from===to)throw Error('置換前と置換後に異なる語句を入力してください。');ids.add(id);
  for(const key of ['nearKana','logic','ai','enabled'])if(typeof v[key]!=='boolean')throw Error('用語の設定が不正です。');
  return {id,from,to,reading:text(v.reading??'',100),nearKana:v.nearKana,logic:v.logic,ai:v.ai,enabled:v.enabled,note:text(v.note??'',300)};
 });
}
function distance(a:string,b:string){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=next;}return prev[b.length];}
function boundary(value:string,at:number,term:string){return !(/^[A-Za-z0-9]/.test(term)&&/[A-Za-z0-9_]/.test(value[at-1]??'')||/[A-Za-z0-9]$/.test(term)&&/[A-Za-z0-9_]/.test(value[at+term.length]??''));}
export function replaceTerms(value:string,rules:readonly TermRule[]):{text:string;changes:number}{
 const enabled=rules.filter(r=>r.enabled&&r.logic).sort((a,b)=>b.from.length-a.from.length);
 const replacements:{start:number;end:number;to:string}[]=[];
 for(let at=0;at<value.length;){const found=enabled.find(r=>value.startsWith(r.from,at)&&boundary(value,at,r.from));if(found){replacements.push({start:at,end:at+found.from.length,to:found.to});at+=found.from.length;}else at++;}
 for(const match of value.matchAll(/[\p{Script=Katakana}ー]{4,}/gu)){
  const start=match.index!,end=start+match[0].length;if(replacements.some(r=>r.start<end&&r.end>start))continue;
  const candidates=enabled.filter(r=>r.nearKana&&(r.reading||/^[\p{Script=Katakana}\p{Script=Hiragana}ー]+$/u.test(r.from))).map(r=>({r,d:distance(kana(match[0]),kana(r.reading||r.from))})).filter(x=>x.d<=1&&kana(match[0]).length>=5).sort((a,b)=>a.d-b.d);
  if(candidates.length&&(!candidates[1]||candidates[1].d!==candidates[0].d||candidates[1].r.to===candidates[0].r.to))replacements.push({start,end,to:candidates[0].r.to});
 }
 let result=value;for(const change of replacements.sort((a,b)=>b.start-a.start))result=result.slice(0,change.start)+change.to+result.slice(change.end);
 return {text:result,changes:replacements.length};
}
/** Expand the edited span to the containing word; do not learn deletions or whole rewrites. */
export function correctionPair(before:string,after:string):{from:string;to:string}|null{
 if(before===after)return null;let start=0,end=before.length,afterEnd=after.length;
 while(start<end&&start<afterEnd&&before[start]===after[start])start++;
 while(end>start&&afterEnd>start&&before[end-1]===after[afterEnd-1]){end--;afterEnd--;}
 if(start===end||start===afterEnd)return null;
 const words=[...new Intl.Segmenter('ja',{granularity:'word'}).segment(before)].filter(w=>w.isWordLike);
 const first=words.find(w=>w.index<=start&&w.index+w.segment.length>start),last=words.find(w=>w.index<end&&w.index+w.segment.length>=end);
 if(first)start=first.index;if(last)end=last.index+last.segment.length;
 const from=before.slice(start,end).trim(),to=after.slice(start,after.length-(before.length-end)).trim();
 return from.length>=2&&to.length>=2&&from.length<=80&&to.length<=80&&!/[\n<>]/.test(from+to)?{from,to}:null;
}
