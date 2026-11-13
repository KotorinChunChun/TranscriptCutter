import {buildDocument,buildEditedCues,createEditorState,textSpansForTime,type EditorDocument,type EditorState} from './editor';
import {buildMediaCutPlan,buildRemovedMediaPlan,type MediaCutInput} from './media-plan';
import {serializeVtt,type Cue} from './vtt';
import type {ComparisonSession} from './comparison';
import type {ArchiveFile} from './save-archive';

/** Reuse the editor's Unicode/voice timing map, but retain the removed text. */
export function removedReviewCues(doc:EditorDocument,state:EditorState,durationMs:number,comparison?:ComparisonSession|null):Cue[]{
  const end=state.keepTail?undefined:doc.durationMs;
  const normal=buildMediaCutPlan(state.cuts,durationMs,end),review=buildRemovedMediaPlan(state.cuts,durationMs,end);
  if(!review.keep.length)return [];
  const covered:MediaCutInput[]=[],result:Cue[]=[];
  const collect=(source:EditorDocument,sourceState:EditorState)=>{
    const excluded=[...normal.keep,...covered];
    if(source.durationMs>durationMs)excluded.push({start:durationMs,end:source.durationMs});
    const mask:EditorState={...sourceState,cuts:excluded.map((range,index)=>({id:`review-mask-${index}`,start:range.start,end:range.end,kind:'manual',precision:'manual',sourceCueIds:[],spans:textSpansForTime(source,range.start,range.end)}))};
    for(const cue of buildEditedCues(source,mask,{merge:false,timeline:'original'})){
      for(const range of review.keep){
        const start=Math.max(cue.start,range.start),end=Math.min(cue.end,range.end);
        if(start<end)result.push({...cue,id:`review-${result.length}`,start:range.outputStart+start-range.start,end:range.outputStart+end-range.start});
      }
    }
    covered.push(...source.cues.map(({start,end})=>({start,end})));
  };
  collect(doc,state);
  // Rejected comparison rows are absent from the editor document. Fill only
  // those uncovered times, prioritizing its reference transcript over others.
  if(comparison){
    const sources=[...comparison.sources].filter(s=>!s.generated).sort((a,b)=>Number(b.id===comparison.referenceId)-Number(a.id===comparison.referenceId));
    for(const source of sources)collect(buildDocument(source.cues),createEditorState());
  }
  return result.sort((a,b)=>a.start-b.start||a.end-b.end);
}

export function removedReviewFiles(input:{doc:EditorDocument;state:EditorState;sourceDurationMs:number;comparison?:ComparisonSession|null;media:{blob:Blob;fileName:string}}):ArchiveFile[]{
  const base=input.media.fileName.replace(/\.[^./\\]+$/,'');
  const vtt=serializeVtt(removedReviewCues(input.doc,input.state,input.sourceDurationMs,input.comparison),{speakerFormat:'voice'});
  return [{name:input.media.fileName,blob:input.media.blob},{name:base+'.vtt',blob:new Blob([vtt],{type:'text/vtt;charset=utf-8'})}];
}
