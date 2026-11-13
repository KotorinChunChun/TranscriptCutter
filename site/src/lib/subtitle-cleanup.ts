import {buildDocument,findFillers} from './editor';
import type {Cue} from './vtt';
import {replaceTerms,type TermRule} from './terminology';
export function cleanByRules(cues:readonly Cue[],rules:readonly TermRule[],fillers:string[]){
 const doc=buildDocument(cues),found=fillers.length?findFillers(doc,fillers):[];
 let changes=0;const result:Cue[]=[];
 for(const cue of cues){
  if(cue.isMultiVoice){result.push({...cue});continue;}
  let value=cue.text;for(const span of found.filter(f=>f.cueId===cue.id).sort((a,b)=>b.from-a.from)){value=value.slice(0,span.from)+value.slice(span.to);changes++;}
  const replaced=replaceTerms(value,rules);changes+=replaced.changes;value=replaced.text.trim();if(value)result.push({...cue,text:value});
 }
 return {cues:result,changes};
}
