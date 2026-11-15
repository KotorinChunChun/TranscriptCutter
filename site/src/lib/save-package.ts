import {bookmarksAfterCuts} from './review-marks';
import {getEffectiveCuts,normalizeCuts} from './editor';
import {buildDocument,buildEditedCues,createEditorState,exportProjectJson,exportCutJson,exportCutCsv,type EditorDocument,type EditorState,type GroupOptions} from './editor';
import {serializeVtt,parseVtt} from './vtt';
import {exportComparisonJson,getSelectedCues,type ComparisonSession} from './comparison';
import type {ArchiveFile} from './save-archive';
const text=(name:string,body:string):ArchiveFile=>({name,blob:new Blob([body],{type:'text/plain;charset=utf-8'})});
export const saveBaseName=(name:string)=>name.replace(/\.[^./\\]+$/,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')||'TranscriptCutter';
const metricsFile=(metrics:unknown)=>text('処理計測記録.json',JSON.stringify({schemaVersion:1,recordedAt:new Date().toISOString(),scope:'browser',memoryNote:'Optional JS heap snapshots; not process/GPU/peak memory.',records:metrics},null,2));
export function comparisonSaveFiles(session:ComparisonSession,metrics:unknown):ArchiveFile[]{
 return [text('比較プロジェクト.compare.json',exportComparisonJson(session)),text('採用字幕.vtt',serializeVtt(getSelectedCues(session),{speakerFormat:'voice'})),...session.sources.map((source,index)=>text(`字幕_${index+1}.vtt`,serializeVtt(source.cues,{speakerFormat:'voice'}))),metricsFile(metrics)];
}
export function videoSaveFiles(input:{doc:EditorDocument;state:EditorState;sourceFile:string;sourceMedia:string;sourceDurationMs:number;comparison:ComparisonSession|null;merge:GroupOptions;metrics:unknown;media:{blob:Blob;fileName:string;durationMs:number}}):ArchiveFile[]{
 const {doc,state,media}=input,base=saveBaseName(media.fileName),options={sourceFile:input.sourceFile,mediaDurationMs:input.sourceDurationMs};
 const original=JSON.parse(exportProjectJson(doc,state,options));if(input.comparison)original.comparison=JSON.parse(exportComparisonJson(input.comparison));
 const cues=buildEditedCues(doc,state,{...input.merge,timeline:'edited'}).filter(cue=>cue.start<media.durationMs).map(cue=>({...cue,end:Math.min(cue.end,media.durationMs)})).filter(cue=>cue.start<cue.end);
 const vtt=serializeVtt(cues,{speakerFormat:'voice'});
 // Resume against the exported media with its new timeline and no cuts to reapply.
 const resume=exportProjectJson(buildDocument(parseVtt(vtt).cues),{...createEditorState(),bookmarks:bookmarksAfterCuts(state.bookmarks??[],normalizeCuts(getEffectiveCuts(doc,state,input.sourceDurationMs),input.sourceDurationMs),input.sourceDurationMs)},{sourceFile:media.fileName,mediaDurationMs:media.durationMs});
 const files:ArchiveFile[]=[{name:media.fileName,blob:media.blob},text(base+'.vtt',vtt),text(base+'.vtt-edit.json',resume),text('元動画用_編集履歴.vtt-edit.json',JSON.stringify(original,null,2)),text('元動画用_カット記録.json',exportCutJson(doc,state,options)),text('元動画用_カット記録.csv',exportCutCsv(doc,state,options)),metricsFile(input.metrics)];
 if(input.comparison)files.push(text('元動画用_比較プロジェクト.compare.json',exportComparisonJson(input.comparison)));
 files.push(text('保存内容.json',JSON.stringify({schemaVersion:1,app:'TranscriptCutter',version:'0.1.1',outputMedia:media.fileName,outputDurationMs:media.durationMs,outputVtt:base+'.vtt',resumeProject:base+'.vtt-edit.json',originalMedia:input.sourceMedia,originalMediaIncluded:false,files:[...files.map(file=>file.name),'保存内容.json','お読みください.txt']},null,2)));
 files.push(text('お読みください.txt',`ZIPを展開し、${base}.vtt-edit.json と ${media.fileName} をドロップすると出力動画の続きから編集できます。\n${base}.vtt はカット後の動画と同じ時間軸です。\n「元動画用」のファイルは編集前の動画に対応します。編集履歴を再開する場合は元動画 ${input.sourceMedia} を別途読み込んでください。元動画はこのZIPには同梱していません。\n`));
 return files;
}
