"use client";
import {normalizeMutes,muteCoverage,setMuteRanges,muteAt,type MuteRange} from '@/src/lib/audio-mute';
import {SpeakerWaveforms} from '@/components/speaker-waveforms';
import {MuteDialog} from '@/components/mute-dialog';
import {subtitleCsv} from '@/src/lib/subtitle-csv';
import {HelpDialog} from '@/components/help-dialog';
import {TranscriptContextMenu} from '@/components/transcript-context-menu';
import {readTranscriptSelection,type TranscriptSelection} from '@/src/lib/text-selection';
import {WordTimingInput} from '@/components/word-timing-input';
import {attachWordTimings,readWordSegments} from '@/src/lib/word-timing';
import {createSaveArchive} from '@/src/lib/save-archive';
import {removedReviewFiles} from '@/src/lib/removed-review';
import {comparisonSaveFiles,videoSaveFiles,saveBaseName} from '@/src/lib/save-package';
import {processingMetrics} from '@/processing-metrics';
import {createPortal} from 'react-dom';
import {comparisonFileName} from '@/comparison-layout';
import {TimelineReview,GapRow,type ReviewTarget,type Verdict} from '@/components/timeline-review';
import {reviewGaps,type TimeRange} from '@/src/lib/timeline-review';
import {confirmAction,fileKey} from '@/browser';
import {MediaDrop} from '@/media-drop';
import {VttPasteDialog} from '@/components/subtitle-input';
import {useSaveOptions} from '@/save-menu';
import { Fragment,useCallback,useEffect,useMemo,useRef,useState,type MouseEvent as ReactMouseEvent } from "react";
import { AlertCircle,ArrowDownToLine,Check,ChevronRight,FileText,Film,MessagesSquare,UserRound,Save,Scissors,Search,Trash2,Undo2,Upload,X } from "lucide-react";
import { parseVtt,serializeVtt,formatTime,type Cue } from "@/src/lib/vtt";
import { SAMPLE_VTT } from "@/src/lib/sample";
import { buildDocument,resolveEditorDocument,replaceCueText,changeSelectionSpeaker,createEditorState,buildGroups,getSpeakerParts,getDeletedTokenIds,getDeletedSpansByCue,deleteTokens,deleteLines,deleteTextSpans,restoreTextSpans,addCut,updateCut,removeCut,renameSpeaker,mergeWithNeighbor,findFillers,deleteFillers,normalizeCuts,getTranscriptTailCut,getEffectiveCuts,buildEditedCues,exportCutJson,exportCutCsv,exportProjectJson,importProjectJson,textCutCandidate,deleteTimeRange,timeRangesForText,type EditorState,type EditorDocument,type CutRecord,type FillerCandidate,type TextSpan } from "@/src/lib/editor";
import { analyzeAudioSilence,detectSubtitleGaps,type SilenceRange,type SubtitleGap } from "@/src/lib/silence";
import { Modal,speakerPalette } from "@/components/editor-ui";
import {TranscriptGroupRow,type TranscriptRowContext} from "@/components/transcript-group";
import {EditorSidebar} from "@/components/editor-sidebar";
import {EditorToolbar,PlaybackStrip,WorkspaceToolbar} from "@/components/editor-toolbars";
import {RenameSpeakerDialog,FillerDialog,SilenceDialog,CutsDialog,formatSeconds as fmtSeconds} from "@/components/editor-dialogs";
import {resetHistory,pushHistory,undoHistory,redoHistory,type EditorHistory} from "@/src/lib/editor-history";
import {isEditorMediaFile} from "@/src/lib/media-file";
import {DownloadResult,prepareDownload,prepareBinaryDownload,requestBrowserDownload,type DownloadFile} from "@/components/download-result";
import {VideoExportDialog} from "@/components/video-export";
import type {TranscriptInteractionMode} from "@/components/transcript-token";
import {useTranscriptSelection} from "@/components/use-transcript-selection";
import {VttComparison} from "@/components/vtt-comparison";
import {createEditableComparison,getComparisonSkippedRanges,createComparisonSession,addComparisonSources,getSelectedCues,exportComparisonJson,importComparisonJson,type ComparisonSession,type ComparisonSource} from "@/src/lib/comparison";
import {createSampleComparison} from "@/src/lib/comparison-sample";
import {restoredWorkspace,useWorkspaceSave,workspaceRestoreError} from '@/workspace-storage';
import {useTranscriptPlayback} from "@/components/use-transcript-playback";
import {buildTimedItemIndex,findActiveTimedItems,type PlaybackMode} from "@/src/lib/transcript-playback";
import {TextCorrectionDialog,SelectionSpeakerDialog,type TranscriptCorrection,type SpeakerSelectionScope} from "@/components/transcript-edit-dialogs";
import {buildSpeakerFilterContext,type FilterGap} from "@/src/lib/filter-context";
import {TerminologyDialog} from '@/components/terminology-dialog';
import {SubtitleCleanupDialog} from '@/components/subtitle-cleanup-ai-dialog';
import {learnTermPairs} from '@/terminology-store';
import {correctionPair} from '@/src/lib/terminology';
import './subtitle-cleanup.css';
import "./comparison.css";
import "./transcript-editing.css";
import "./compact-workspace.css";
import "./comparison-layout-preview.css";

const SAMPLE_DOC=buildDocument(parseVtt(SAMPLE_VTT).cues);
const EMPTY_DOC=buildDocument([]);
const EMPTY=createEditorState();
const parts=getSpeakerParts;
const isCompound=(name:string|null)=>parts(name).length>1;
type ModalName="terminology"|"cleanup"|"correct"|"selection-speaker"|"video"|"download"|"export"|"settings"|"help"|"rename"|"fillers"|"silence"|"cuts"|"mutes"|null;
type ToastMessage={text:string;undoFrom?:EditorState};

export type WorkspaceView="chat"|"vtt"|"compare";
type EditorSnapshot={project:string;comparison:string|null;isSample:boolean;warnings:string[];merging:boolean;maxGap:string;showTimes:boolean;largeText:boolean;showDeleted:boolean};
function restoreEditor(workspaceKey:string){
 const saved=restoredWorkspace<EditorSnapshot>(workspaceKey);
 if(!saved)return null;
 try{return {...saved,data:{...saved.data,parsed:importProjectJson(saved.data.project),session:saved.data.comparison?importComparisonJson(saved.data.comparison):null}};}
 catch(error){workspaceRestoreError(error);return null;}
}
export default function Home({active=true,view:requestedView,onViewChange,onWorkspaceBusyChange,workspaceKey="editor",initialMedia,initialVtt,onRetranscribe,recognitionBusy=false}:{workspaceKey?:string;initialMedia?:File|null;initialVtt?:string;onRetranscribe?:(file:File,vtt:string)=>void;recognitionBusy?:boolean;active?:boolean;view?:WorkspaceView;onViewChange?:(view:WorkspaceView)=>void;onWorkspaceBusyChange?:(busy:boolean)=>void}){
 const [restored]=useState(()=>restoreEditor(workspaceKey));
 const [baseDoc,setDoc]=useState<EditorDocument>(()=>restored?.data.parsed.doc??(initialVtt?buildDocument(parseVtt(initialVtt).cues):EMPTY_DOC));
 const [reviewTarget,setReviewTarget]=useState<ReviewTarget|null>(null),[reviewRange,setReviewRange]=useState<TimeRange|null>(null),[reviewText,setReviewText]=useState<TextSpan[]>([]),[reviewCutId,setReviewCutId]=useState<string|null>(null),[visualResults,setVisualResults]=useState<Record<string,Verdict>>({});
 const [comparison,setComparison]=useState<ComparisonSession|null>(()=>restored?.data.session??null);
 const [wordInput,setWordInput]=useState(false);
 const [pasteOpen,setPasteOpen]=useState(false),[pasteText,setPasteText]=useState('');
 const [downloadFile,setDownloadFile]=useState<DownloadFile|null>(null);
 const [history,setHistory]=useState<EditorHistory>(()=>resetHistory(restored?.data.parsed.state??EMPTY));
 const state=history.present;
 const doc=useMemo(()=>resolveEditorDocument(baseDoc,state),[baseDoc,state.cueRevisions]);
 const hasTranscript=doc.cues.length>0;
 const [fileName,setFileName]=useState(()=>restored?.data.parsed.sourceFile??(initialMedia?initialMedia.name+".vtt":""));const [isSample,setIsSample]=useState(restored?.data.isSample??false);
 const [warnings,setWarnings]=useState<string[]>(restored?.data.warnings??[]);const [error,setError]=useState("");const [toast,setToast]=useState<ToastMessage|null>(null);const [toastPaused,setToastPaused]=useState(false);const [loading,setLoading]=useState(false);
 const [modal,setModal]=useState<ModalName>(null);const [sidebarOpen,setSidebarOpen]=useState(false);const [dragging,setDragging]=useState(false);const [mounted,setMounted]=useState(false);
 const [merging,setMerging]=useState(restored?.data.merging??true);const [maxGap,setMaxGap]=useState(restored?.data.maxGap??"none");const [showTimes,setShowTimes]=useState(restored?.data.showTimes??true);const [largeText,setLargeText]=useState(restored?.data.largeText??false);
 const [query,setQuery]=useState("");const [filter,setFilter]=useState("all");const [localView,setLocalView]=useState<WorkspaceView>("chat");const view=requestedView??localView;const setView=useCallback((next:WorkspaceView)=>{setLocalView(next);onViewChange?.(next);},[onViewChange]);const [interactionMode,setInteractionMode]=useState<TranscriptInteractionMode>("play");const [showDeleted,setShowDeleted]=useState(restored?.data.showDeleted??false);
 const [selectedLines,setSelectedLines]=useState<Set<string>>(new Set());const [visibleCount,setVisibleCount]=useState(24);
 const [renameTarget,setRenameTarget]=useState("");const [renameValue,setRenameValue]=useState("");
 const [correctionCueIds,setCorrectionCueIds]=useState<string[]>([]);
 const [contextMenu,setContextMenu]=useState<{x:number;y:number;selection:TranscriptSelection|null;restore?:TextSpan}|null>(null);
 const closeContextMenu=useCallback(()=>setContextMenu(null),[]);
 const [speakerSelection,setSpeakerSelection]=useState<{spans:TextSpan[];text:string}|null>(null);
 const [followPlayback,setFollowPlayback]=useState(true);
 const [fillerTerms,setFillerTerms]=useState("えっと、えーと、えーっと、まあ");const [fillerCandidates,setFillerCandidates]=useState<FillerCandidate[]>([]);const [chosenFillers,setChosenFillers]=useState<Set<string>>(new Set());
 const [silenceMode,setSilenceMode]=useState<"gap"|"audio">("gap");const [silenceThreshold,setSilenceThreshold]=useState("1.5");const [volumeThreshold,setVolumeThreshold]=useState("-40");const [padding,setPadding]=useState("120");
 const [silenceCandidates,setSilenceCandidates]=useState<(SilenceRange|SubtitleGap)[]>([]);const [detecting,setDetecting]=useState(false);const [progress,setProgress]=useState(0);const [analysisNote,setAnalysisNote]=useState("");
 const [mediaFile,setMediaFile]=useState<File|null>(restored?.file??initialMedia??null);const [mediaUrl,setMediaUrl]=useState(()=>restored?.file||initialMedia?URL.createObjectURL((restored?.file??initialMedia)!):"");const [mediaDuration,setMediaDuration]=useState<number|undefined>(restored?.data.parsed.mediaDurationMs);
 const snapshot=useMemo(()=>({project:exportProjectJson(baseDoc,history.present,{sourceFile:fileName,...(mediaDuration!==undefined?{mediaDurationMs:mediaDuration}:{})}),comparison:comparison?exportComparisonJson(comparison):null,isSample,warnings,merging,maxGap,showTimes,largeText,showDeleted} satisfies EditorSnapshot),[baseDoc,history.present,fileName,mediaDuration,comparison,isSample,warnings,merging,maxGap,showTimes,largeText,showDeleted]);
 useWorkspaceSave(workspaceKey,snapshot,mediaFile);
 const [removedReview,setRemovedReview]=useState(false);
 const [bundleExport,setBundleExport]=useState(false),[archiveBusy,setArchiveBusy]=useState(false);
 const [mediaExportBusy,setMediaExportBusy]=useState(false),[aiCleanupBusy,setAiCleanupBusy]=useState(false);
 useEffect(closeContextMenu,[doc,state,view,active,modal,mediaExportBusy,closeContextMenu]);
 useEffect(()=>{onWorkspaceBusyChange?.(mediaExportBusy||aiCleanupBusy||archiveBusy);},[mediaExportBusy,aiCleanupBusy,archiveBusy,onWorkspaceBusyChange]);
 const [exportTimeline,setExportTimeline]=useState<"original"|"edited">("original");const [speakerFormat,setSpeakerFormat]=useState<"voice"|"prefix">("voice");
 const vttInput=useRef<HTMLInputElement>(null),mediaInput=useRef<HTMLInputElement>(null),searchInput=useRef<HTMLInputElement>(null),sentinel=useRef<HTMLDivElement>(null);
 const transcriptRef=useRef<HTMLElement|null>(null);
 const selectionResetKey=useMemo(()=>({}),[doc,state,query,filter,view,modal,merging,maxGap,showDeleted]);
 const {selection:textSelection,clearSelection,shouldIgnoreClick,handlers:selectionHandlers}=useTranscriptSelection(transcriptRef,{enabled:view==="chat"&&!modal,resetKey:selectionResetKey});
 const mediaRef=useRef<HTMLMediaElement|null>(null);const dragDepth=useRef(0);const importVersion=useRef(0);const analysisAbort=useRef<AbortController|null>(null);const analysisVersion=useRef(0);
 const notify=useCallback((text:string,undoable=false)=>{setToast({text,...(undoable?{undoFrom:state}:{})});setToastPaused(false);},[state]);
 const apply=useCallback((action:(s:EditorState)=>EditorState)=>{setHistory(h=>{try{return pushHistory(h,action);}catch(e){queueMicrotask(()=>{setError(e instanceof Error?e.message:"編集を適用できませんでした。");setToast(null);});return h;}});},[]);
 const undo=useCallback(()=>{setHistory(undoHistory);setSelectedLines(new Set());setToast(null);clearSelection();},[clearSelection]);
 const redo=useCallback(()=>{setHistory(redoHistory);setSelectedLines(new Set());setToast(null);clearSelection();},[clearSelection]);
 const toastCanUndo=!!toast?.undoFrom&&history.past.at(-1)===toast.undoFrom;
 const deleteSelection=useCallback((selection:TranscriptSelection)=>{if(!selection.spans.length)return;apply(s=>deleteTextSpans(doc,s,selection.spans));notify(`選択した${selection.characterCount}文字を削除しました`,true);clearSelection();setSelectedLines(new Set());},[apply,clearSelection,doc,notify]);
 const deleteTextSelection=useCallback(()=>{if(textSelection)deleteSelection(textSelection);},[deleteSelection,textSelection]);
 const restoreText=useCallback((span:TextSpan)=>{apply(s=>restoreTextSpans(doc,s,[span]));notify("選んだテキストを復元しました",true);clearSelection();},[apply,clearSelection,doc,notify]);
 const mergeOptions=useMemo(()=>({merge:merging,maxGapMs:maxGap==="none"?null:Number(maxGap)*1000}),[merging,maxGap]);
 const displayMergeOptions=useMemo(()=>({...mergeOptions,mergeUnknown:true}),[mergeOptions]);
 const groups=useMemo(()=>buildGroups(doc,state,displayMergeOptions),[doc,state,displayMergeOptions]);
 const deletedTokens=useMemo(()=>getDeletedTokenIds(doc,state),[doc,state]);
 const deletedSpans=useMemo(()=>getDeletedSpansByCue(doc,state),[doc,state]);
 const duration=mediaDuration??doc.durationMs;
 const automaticTail=useMemo(()=>hasTranscript&&!state.keepTail?getTranscriptTailCut(doc,mediaDuration):null,[doc,mediaDuration,hasTranscript,state.keepTail]);
 const effectiveCuts=useMemo(()=>hasTranscript?getEffectiveCuts(doc,state,mediaDuration):[],[doc,state,mediaDuration,hasTranscript]);
 const ranges=useMemo(()=>normalizeCuts(effectiveCuts,duration),[effectiveCuts,duration]);
 const comparisonCuts=useMemo(()=>comparison?getComparisonSkippedRanges(comparison):[],[comparison]);
 const comparisonEnd=useMemo(()=>Math.max(1,...(comparison?.sources.map(source=>source.cues.reduce((end,cue)=>Math.max(end,cue.end),0))??[])),[comparison?.sources]);
 const playback=useTranscriptPlayback(mediaRef,{sourceKey:mediaUrl,mutes:view==='compare'?[]:state.mutes,cuts:view==='compare'?comparisonCuts:effectiveCuts,subtitleEndMs:view==='compare'?mediaDuration??comparisonEnd:hasTranscript&&!state.keepTail?doc.durationMs:mediaDuration??doc.durationMs,mediaDurationMs:mediaDuration,onError:notify});
 useEffect(()=>{playback.pause();},[active,view]);
 const gaps=useMemo(()=>reviewGaps(doc.cues,mediaDuration),[doc,mediaDuration]);
 const gapByCue=useMemo(()=>new Map(gaps.filter(g=>g.nextCueId).map(g=>[g.nextCueId!,g])),[gaps]);
 const reviewTextValid=reviewText.every(span=>{const cue=doc.cueById.get(span.cueId);return !!cue&&span.from>=0&&span.to>span.from&&span.to<=cue.text.length;});
 const reviewSelection=useMemo(()=>!reviewTextValid?[]:reviewRange?[reviewRange]:reviewText.length?timeRangesForText(doc,reviewText):reviewTarget?[{start:reviewTarget.start,end:reviewTarget.end}]:[],[doc,reviewText,reviewRange,reviewTextValid,reviewTarget]);
 const reviewMethod=!reviewTextValid?undefined:reviewRange?'手動で調整':reviewText.length?[...new Set(reviewText.map(s=>textCutCandidate(doc.cueById.get(s.cueId)!,s.from,s.to).method))].join('・'):undefined;
 const previewStop=useRef<number|null>(null);
 useEffect(()=>{const media=mediaRef.current;if(!media)return;const stop=()=>{if(previewStop.current!==null&&media.currentTime*1000>=previewStop.current){previewStop.current=null;playback.pause();}};media.addEventListener('timeupdate',stop);return()=>media.removeEventListener('timeupdate',stop);},[mediaUrl,playback.pause]);
 const previewReview=(range:TimeRange)=>{previewStop.current=range.end;playback.playFrom(range.start,'original');};
 const openReview=(target:ReviewTarget)=>{playback.pause();clearSelection();setReviewCutId(null);setReviewText([]);setReviewRange({start:target.start,end:target.end});setReviewTarget(target);};
 const chooseReviewRange=(range:TimeRange)=>{clearSelection();setReviewRange(range);};
 const deleteReview=()=>{
  if(mediaExportBusy||!reviewSelection.length)return;
  const bounds=reviewRange??{start:Math.min(...reviewSelection.map(r=>r.start)),end:Math.max(...reviewSelection.map(r=>r.end))};
  const current=state.cuts.find(c=>c.id===reviewCutId);
  const next=current?updateCut(state,current.id,{...bounds,precision:'manual'}):reviewText.length?deleteTextSpans(doc,state,reviewText,bounds):deleteTimeRange(doc,state,bounds.start,bounds.end);
  if(next===state)return;
  const record=current??next.cuts.find(c=>!state.cuts.some(old=>old.id===c.id));
  apply(()=>next);clearSelection();setReviewRange(bounds);setReviewCutId(record?.id??null);notify(current?'カット範囲を更新しました':'選択区間をカットしました',true);
 };
 const selectReviewCut=(id:string)=>{const cut=state.cuts.find(c=>c.id===id);if(!cut)return;playback.pause();clearSelection();setReviewCutId(id);setReviewText(cut.spans?.map(s=>({...s}))??[]);setReviewRange({start:cut.start,end:cut.end});setReviewTarget(previous=>previous?{...previous,start:Math.min(previous.start,cut.start),end:Math.max(previous.end,cut.end)}:{start:cut.start,end:cut.end,kind:'speech',label:'カットの確認'});};
 const restoreReviewCut=()=>{if(!reviewCutId||mediaExportBusy)return;apply(s=>removeCut(s,reviewCutId));setReviewCutId(null);notify('このカットを取り消しました',true);};
 const changeMutes=(ranges:readonly MuteRange[],muted:boolean)=>{if(!ranges.length||mediaExportBusy||!mediaFile)return;const previous=state.mutes??[],next=setMuteRanges(previous,ranges,muted);if(next===previous)return;playback.pause();apply(s=>({...s,mutes:setMuteRanges(s.mutes??[],ranges,muted)}));clearSelection();notify(muted?'選択区間の音声をミュートしました':'選択区間のミュートを解除しました',true);};
 const toggleMutes=(ranges:readonly MuteRange[])=>changeMutes(ranges,muteCoverage(state.mutes??[],ranges)!=='full');
 useEffect(()=>{if(reviewCutId&&!state.cuts.some(c=>c.id===reviewCutId))setReviewCutId(null);},[reviewCutId,state.cuts]);
 const positionReview=(ms:number)=>{playback.pause();if(mediaRef.current&&mediaDuration!==undefined)mediaRef.current.currentTime=Math.min(mediaDuration/1000,ms/1000);};
 useEffect(()=>{setVisualResults({});setReviewCutId(null);setReviewTarget(null);setReviewRange(null);setReviewText([]);},[mediaFile,baseDoc]);
 useEffect(()=>{setReviewText([]);setReviewRange(null);setReviewCutId(null);},[doc]);
 useEffect(()=>{if(!textSelection?.spans.length)return;const timeRanges=timeRangesForText(doc,textSelection.spans);if(!timeRanges.length)return;playback.pause();setReviewCutId(null);setReviewText(textSelection.spans.map(s=>({...s})));setReviewRange(null);const cues=textSelection.spans.map(s=>doc.cueById.get(s.cueId)!).filter(Boolean);setReviewTarget({start:Math.min(...cues.map(c=>c.start)),end:Math.max(...cues.map(c=>c.end)),kind:'speech',label:'選択した文字の映像・時間軸'});},[textSelection]);
 const cueTimeIndex=useMemo(()=>buildTimedItemIndex(doc.cues),[doc]);
 const tokenTimeIndex=useMemo(()=>buildTimedItemIndex(doc.tokens),[doc]);
 const activeCues=mediaFile&&(playback.playing||playback.currentMs>0)?findActiveTimedItems(cueTimeIndex,playback.currentMs):[];
 const activeTokens=mediaFile&&(playback.playing||playback.currentMs>0)?findActiveTimedItems(tokenTimeIndex,playback.currentMs):[];
 const activeCueIds=new Set(activeCues.map(cue=>cue.id));
 const activeTokenIds=new Set(activeTokens.map(token=>token.id));
 const activeLineIds=new Set(activeTokens.map(token=>token.lineId));
 const groupOfCue=useMemo(()=>new Map(groups.flatMap(group=>group.cueIds.map(id=>[id,group] as const))),[groups]);
 const activeGroup=activeCues.length?groupOfCue.get(activeCues[0].id):undefined;
 const originalPreview=!!mediaFile&&playback.mode==="original"&&(playback.playing||playback.currentMs>0);
 const activeOriginalGroupId=originalPreview?activeGroup?.id:undefined;
 const tailNotice=state.keepTail?`VTT終了後も元メディアの末尾まで残します。`:automaticTail?`VTT終了 ${formatTime(doc.durationMs,true)} 以降の ${fmtSeconds(automaticTail.end-automaticTail.start)} を自動カットします。`:mediaDuration===undefined?`VTT終了 ${formatTime(doc.durationMs,true)} 以降を自動カットします。動画を追加すると末尾の長さが確定します。`:`書き出しの上限はVTT終了 ${formatTime(doc.durationMs,true)}。元ファイルはこの時刻以前に終了しています。`;
 const removedMs=ranges.reduce((sum,range)=>sum+range.end-range.start,0);
 const atoms=useMemo(()=>[...new Set(doc.cues.flatMap(cue=>parts(cue.speaker)))],[doc]);
 const alias=(name:string)=>state.aliases[name]??name;
 const speakerCounts=useMemo(()=>atoms.map(name=>({id:name,label:state.aliases[name]??name,count:groups.filter(g=>parts(g.canonicalSpeaker).includes(name)&&!g.deleted).length})),[atoms,state.aliases,groups]);
 const filtered=useMemo(()=>groups.filter(group=>(showDeleted||!group.deleted||group.id===activeOriginalGroupId)&&(filter==="all"||filter==="unknown"?filter!=="unknown"||!group.canonicalSpeaker:parts(group.canonicalSpeaker).includes(filter))&&(!query.trim()||`${group.speaker??"話者不明"} ${group.text}`.toLowerCase().includes(query.trim().toLowerCase()))),[groups,filter,query,showDeleted,activeOriginalGroupId]);
 const visible=filtered.slice(0,visibleCount);
 const displayedLineCount=filtered.reduce((count,group)=>count+group.lines.filter(line=>showDeleted||line.tokens.some(token=>token.text.trim()&&!deletedTokens.has(token.id))).length,0);
 const filterContext=useMemo(()=>buildSpeakerFilterContext(groups,filtered,filter,showDeleted),[groups,filtered,filter,showDeleted]);
 const groupIndices=useMemo(()=>new Map(groups.map((group,index)=>[group.id,index])),[groups]);
 const playheadVisible=!!activeGroup&&filtered.some(group=>group.id===activeGroup.id);
 const activeGroups=groups.filter(g=>!g.deleted).length;
 const isDirty=!!state.mutes?.length||!state.keepTail||!!state.cueRevisions||state.cuts.length>0||Object.keys(state.aliases).length>0||Object.keys(state.speakerOverrides).length>0||state.forcedJoins.length>0;
 const baseName=fileName.replace(/\.(vtt|json)$/i,"").replace(/\.vtt-edit$/,"");
 const exportOptions={sourceFile:fileName,...(mediaDuration!==undefined?{mediaDurationMs:mediaDuration}:{})};
 const exportResult=useMemo(()=>{if(modal!=="export"&&view!=="vtt")return {text:"",error:"",count:0};try{const result=buildEditedCues(doc,state,{...mergeOptions,timeline:exportTimeline});return {text:serializeVtt(result,{speakerFormat}),error:"",count:result.length};}catch(e){return {text:"",error:e instanceof Error?e.message:"出力内容を作成できませんでした。",count:0};}},[modal,view,doc,state,mergeOptions,exportTimeline,speakerFormat]);

 useEffect(()=>setMounted(true),[]);
 useEffect(()=>{setInteractionMode("play");},[baseDoc]);
 useEffect(()=>()=>{if(downloadFile)URL.revokeObjectURL(downloadFile.url);},[downloadFile]);
 useEffect(()=>{if(!toast||toastPaused)return;const id=setTimeout(()=>setToast(null),toast.undoFrom?8000:3500);return()=>clearTimeout(id);},[toast,toastPaused]);
 useEffect(()=>{setVisibleCount(24);setSelectedLines(new Set());},[doc,query,filter,merging,maxGap,showDeleted]);
 useEffect(()=>{if(!transcriptRef.current||!sentinel.current||visibleCount>=filtered.length||view!=="chat")return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))setVisibleCount(n=>Math.min(n+24,filtered.length));},{root:transcriptRef.current,rootMargin:"1000px 0px"});observer.observe(sentinel.current);return()=>observer.disconnect();},[visibleCount,filtered.length,view]);
 useEffect(()=>()=>{if(mediaUrl)URL.revokeObjectURL(mediaUrl);},[mediaUrl]);
 useEffect(()=>()=>analysisAbort.current?.abort(),[]);
 useEffect(()=>{
  if(!followPlayback||!playback.playing||view!=="chat"||modal||textSelection||selectedLines.size||!activeGroup)return;
  const index=filtered.findIndex(group=>group.id===activeGroup.id);
  if(index<0)return;
  if(index>=visibleCount)setVisibleCount(Math.max(index+12,visibleCount));
  const tokenId=activeTokens.find(token=>groupOfCue.get(token.cueId)?.id===activeGroup.id)?.id;
  const root=transcriptRef.current;
  const leaf=tokenId?root?.querySelector<HTMLElement>(`[data-token-id="${CSS.escape(tokenId)}"]`):null;
  const target=leaf??root?.querySelector<HTMLElement>(`[data-group-id="${CSS.escape(activeGroup.id)}"]`);
  if(!root||!target)return;
  const rect=target.getBoundingClientRect(),viewport=root.getBoundingClientRect();
  const top=viewport.top+root.clientTop,bottom=top+root.clientHeight;
  const inset=Math.min(24,root.clientHeight/4);
  if(rect.top<top+inset||rect.bottom>bottom-inset){
   const offset=rect.top-top-(root.clientHeight-Math.min(rect.height,root.clientHeight))/2;
   // Frequent token updates must not cancel or restart a pending scroll animation.
   root.scrollTo({top:Math.max(0,root.scrollTop+offset),behavior:"auto"});
  }
 },[activeTokens[0]?.id,activeGroup?.id,playback.playing,followPlayback,view,modal,!!textSelection,selectedLines.size,visibleCount,filtered,groupOfCue]);
 
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(!active)return;const input=e.target instanceof HTMLElement&&!!e.target.closest("input,textarea,select,[contenteditable=true]");if(modal||e.isComposing)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setView("chat");searchInput.current?.focus();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!input&&view!=="compare"){e.preventDefault();if(e.shiftKey)redo();else undo();}else if(!input&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key==="Delete"||e.key==="Backspace")&&textSelection){e.preventDefault();deleteTextSelection();}else if(!input&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key==="Delete"||e.key==="Backspace")&&reviewSelection.length){e.preventDefault();deleteReview();}else if(e.key==="Escape"){clearSelection();setSelectedLines(new Set());setSidebarOpen(false);dragDepth.current=0;setDragging(false);}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[active,modal,view,redo,undo,textSelection,deleteTextSelection,clearSelection,reviewSelection,deleteReview]);
 const blockedByBusyWork=(message:string)=>{if(!mediaExportBusy&&!aiCleanupBusy)return false;notify(message);return true;};
 const stopAnalysis=()=>{analysisVersion.current++;analysisAbort.current?.abort();setDetecting(false);};
 const loadMedia=(file:File)=>{if(blockedByBusyWork("現在の処理が完了するか中止してから、ファイルを変更してください。"))return;stopAnalysis();playback.reset();setMediaFile(file);setMediaUrl(URL.createObjectURL(file));setMediaDuration(undefined);setSilenceCandidates([]);setAnalysisNote("");notify(view==="compare"?"元動画・音声を開きました。比較行の時刻から再生できます。":"動画・音声を追加しました。右上の「保存・書き出し」から保存できます。");};
 const applyWordTiming=(value:unknown)=>{const segments=readWordSegments(value);if(!segments.some(s=>s.words.length))throw Error('有効な単語時刻がありません。');if(!hasTranscript)throw Error('先に原文字幕を読み込んでください。');const cues=attachWordTimings(doc.cues,segments),count=cues.reduce((n,c)=>n+(c.wordTiming?.units.length??0),0);if(!count)throw Error('原文と一意に一致する単語時刻がありません。推定時刻を維持します。');apply(s=>({...s,cueRevisions:cues}));notify(`原文を維持し、${count}単位の時刻候補を追加しました`,true);};
 const loadFile=async(file:File,associatedMedia?:File)=>{
  if(blockedByBusyWork("動画の書き出しを中止してから、ファイルを変更してください。"))return;
  if(!/\.(vtt|json)$/i.test(file.name)){if(isEditorMediaFile(file)){loadMedia(file);return;}setError("VTT・編集プロジェクト、または元の動画・音声を選択してください。");return;}
  setError("");const limit=/\.json$/i.test(file.name)?100:20;if(file.size>limit*1024*1024){setError(`${limit} MB以下のファイルを選択してください。`);return;}const version=++importVersion.current;setLoading(true);
  try{const text=new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer());let nextDoc:EditorDocument,nextState:EditorState,nextName:string,nextWarnings:string[]=[],savedDuration:number|undefined,nextComparison:ComparisonSession|null=null;
   if(/\.json$/i.test(file.name)){const raw=JSON.parse(text);if(Array.isArray(raw?.segments)){if(version!==importVersion.current)return;applyWordTiming(raw);if(associatedMedia)loadMedia(associatedMedia);return;}if(raw?.kind==="vtt-dialogue-comparison"){const session=importComparisonJson(text);if(version!==importVersion.current)return;if(comparison&&!(await confirmAction("現在の比較を読み込んだ比較プロジェクトで置き換えます。必要な比較は先に保存してください。")))return;if(version!==importVersion.current)return;setComparison(session);setView("compare");setSidebarOpen(false);if(associatedMedia)loadMedia(associatedMedia);notify(`${session.sources.length}つのVTTと採用結果を読み込みました`);return;}const project=importProjectJson(text);nextDoc=project.doc;nextState=project.state;nextName=project.sourceFile;savedDuration=project.mediaDurationMs;if(raw.comparison)nextComparison=importComparisonJson(JSON.stringify(raw.comparison));}else{const result=parseVtt(text);nextDoc=buildDocument(result.cues);nextState=createEditorState();nextName=file.name;nextWarnings=result.warnings;}
   if(version!==importVersion.current)return;if((isDirty||comparison)&&!(await confirmAction("今の編集内容と比較設定を置き換えます。続きから再開するには、先に「編集プロジェクトを保存」で保存してください。ファイルを開きますか？")))return;
   if(version!==importVersion.current)return;
   stopAnalysis();playback.reset();setDoc(nextDoc);setComparison(nextComparison);setHistory(resetHistory(nextState));setFileName(nextName);setIsSample(false);setWarnings(nextWarnings);setQuery("");setFilter("all");setSelectedLines(new Set());setVisibleCount(24);setView("chat");setSidebarOpen(false);if(associatedMedia)loadMedia(associatedMedia);else if(hasTranscript||!mediaFile){setMediaFile(null);setMediaUrl("");setMediaDuration(savedDuration);}setSilenceCandidates([]);setFillerCandidates([]);setAnalysisNote("");notify(`${nextDoc.cues.length.toLocaleString()}件の字幕を読み込みました`);
  }catch(e){if(version===importVersion.current)setError(e instanceof Error?e.message:"ファイルを読み込めませんでした。UTF-8のVTTを選択してください。");}finally{if(version===importVersion.current)setLoading(false);}
 };
 useEffect(()=>{const receive=(event:Event)=>{try{if(mediaExportBusy||aiCleanupBusy)throw Error('現在の処理が完了してから引き継いでください。');const p=(event as CustomEvent).detail;if((p?.workspaceKey??"editor")!==workspaceKey)return;if(!p?.media||!(p.media instanceof File))throw Error('元動画を読み込んでください。');if(mediaFile&&fileKey(mediaFile)!==fileKey(p.media))throw Error('別の元動画が選択されています。元動画を合わせてから追加してください。');const parsed=parseVtt(p.vtt);if(p.segments)parsed.cues=attachWordTimings(parsed.cues,readWordSegments(p.segments));if(!parsed.cues.length)throw Error('字幕がありません。');const source=makeComparisonSource(parsed.cues,p.name,p.name,parsed.warnings);if(!hasTranscript&&!comparison){stopAnalysis();playback.reset();setDoc(buildDocument(parsed.cues));setHistory(resetHistory(createEditorState()));setFileName(p.name);setWarnings(parsed.warnings);setQuery('');setFilter('all');setView('chat');}else{const next=comparison?addComparisonSources(comparison,[source]):createComparisonSession([makeComparisonSource(doc.cues,fileName,fileName,warnings),source]);setComparison(next);setView('compare');}if(!mediaFile)loadMedia(p.media);setError('');window.dispatchEvent(new CustomEvent('tc-transfer-result',{detail:{ok:true}}));}catch(e){setError(String(e));window.dispatchEvent(new CustomEvent('tc-transfer-result',{detail:{ok:false,error:String(e)}}));}};window.addEventListener('tc-transfer',receive);return()=>window.removeEventListener('tc-transfer',receive);});
 useEffect(()=>{if(!active)playback.pause();},[active]);
 const seek=useCallback((ms:number)=>{if(mediaExportBusy)return;clearSelection();playback.playFrom(ms,view==='compare'?'edited':undefined);},[playback.playFrom,clearSelection,mediaExportBusy,view]);
 const middleSeek=(milliseconds:number)=>({
  onMouseDown:(event:ReactMouseEvent<HTMLButtonElement>)=>{if(event.button===1)event.preventDefault();},
  onAuxClick:(event:ReactMouseEvent<HTMLButtonElement>)=>{if(event.button!==1)return;event.preventDefault();event.stopPropagation();seek(milliseconds);},
 });
 const playUtterance=(start:number,end:number,mode:PlaybackMode)=>{
  if(playback.playing&&playback.mode===mode&&playback.currentMs>=start&&playback.currentMs<end)playback.pause();
  else playback.playFrom(start,mode);
 };
 const openCorrection=(cueIds:string[])=>{playback.pause();clearSelection();setError("");setCorrectionCueIds(cueIds);setModal("correct");};
 const saveCorrection=(changes:TranscriptCorrection[],learn=false)=>{
  try{let next=state;for(const change of changes)next=replaceCueText(resolveEditorDocument(baseDoc,next),next,change.cueId,change.text);
   if(next===state){setModal(null);return;}
   if(learn){const pairs=changes.map(change=>correctionPair(doc.cueById.get(change.cueId)?.text??'',change.text)).filter((p):p is {from:string;to:string}=>!!p);if(pairs.length)learnTermPairs(pairs);}stopAnalysis();apply(()=>next);setModal(null);setQuery("");setSelectedLines(new Set());setFillerCandidates([]);setSilenceCandidates([]);clearSelection();notify("字幕を修正しました。音声とカット時刻は保持しています。",true);
  }catch(e){setError(e instanceof Error?e.message:"字幕を修正できませんでした。");}
 };
 const editSelectionSpeaker=(selection:TranscriptSelection)=>{if(!selection.spans.length)return;playback.pause();setSpeakerSelection({spans:selection.spans.map(span=>({...span})),text:selection.text});setError("");setModal("selection-speaker");};
 const openSelectionSpeaker=()=>{if(textSelection)editSelectionSpeaker(textSelection);};
 const saveSelectionSpeaker=(name:string,scope:SpeakerSelectionScope)=>{
  if(!speakerSelection)return;
  try{const canonical=name==="話者不明"?null:atoms.find(atom=>alias(atom)===name)??name;const next=changeSelectionSpeaker(doc,state,speakerSelection.spans,canonical,{scope});
   if(next===state){setModal(null);return;}
   stopAnalysis();apply(()=>next);setModal(null);setSpeakerSelection(null);setFilter("all");setQuery("");setSelectedLines(new Set());setFillerCandidates([]);setSilenceCandidates([]);clearSelection();notify(`選択した部分の話者を「${name}」に変更しました。`,true);
  }catch(e){setError(e instanceof Error?e.message:"話者を変更できませんでした。");}
 };
 const deleteToken=useCallback((id:string)=>{apply(s=>deleteTokens(doc,s,[id]));notify("単語を削除しました。推定カット時刻を記録しています。",true);},[doc,apply,notify]);
 const renderFilterGap=(gap:FilterGap|null|undefined)=>gap&&<div className="filtered-gap" role="note"><MessagesSquare size={13}/><strong>{gap.position==="before"?"この前":gap.position==="after"?"この後":"この間"}に{gap.otherSpeakerCount===gap.count?"他の話者の":""}発言 {gap.count}件</strong>{gap.searchHiddenCount>0&&<span className="gap-detail">他の話者 {gap.otherSpeakerCount}件・検索対象外 {gap.searchHiddenCount}件</span>}{gap.end>=gap.start&&<time>{formatTime(gap.start)}–{formatTime(gap.end)}</time>}<span className="gap-detail">{gap.end>=gap.start?`間隔 ${fmtSeconds(gap.elapsedMs)}`:"字幕時刻が重複"}</span><button onClick={()=>{setFilter("all");setQuery("");}}>全体を見る</button></div>;
 const saveFile=(name:string,body:string,type="application/json;charset=utf-8")=>{try{const file=prepareDownload(name,body,type);try{requestBrowserDownload(file);}catch{}setDownloadFile(file);setToast(null);setModal("download");}catch(e){setError(e instanceof Error?e.message:"ファイルを作成できませんでした。");}};
 const downloadProject=()=>{const project=JSON.parse(exportProjectJson(doc,state,exportOptions));if(comparison)project.comparison=JSON.parse(exportComparisonJson(comparison));saveFile(`${baseName}.vtt-edit.json`,JSON.stringify(project,null,2));};
 const downloadCuts=(format:"json"|"csv")=>{try{saveFile(`${baseName}_cuts.${format}`,format==="json"?exportCutJson(doc,state,exportOptions):exportCutCsv(doc,state,exportOptions),format==="json"?"application/json;charset=utf-8":"text/csv;charset=utf-8");}catch(e){notify(e instanceof Error?e.message:"カット記録を作成できませんでした。");}};
 const downloadVtt=()=>{if(exportResult.error){setError(exportResult.error);return;}saveFile(`${baseName}_${exportTimeline==="edited"?"cut-timeline":"edited"}.vtt`,exportResult.text,"text/vtt;charset=utf-8");};
 const resetSample=async()=>{if(blockedByBusyWork("動画の書き出しを中止してから、サンプルを開いてください。"))return;if((isDirty||comparison)&&!(await confirmAction("サンプルに戻すと現在の編集内容と比較設定が置き換わります。必要な内容は保存しましたか？")))return;++importVersion.current;stopAnalysis();setLoading(false);playback.reset();setDoc(SAMPLE_DOC);setComparison(null);setHistory(resetHistory(createEditorState()));setFileName("3人の会議_サンプル.vtt");setIsSample(true);setWarnings([]);setError("");setQuery("");setFilter("all");setView("chat");setMediaFile(null);setMediaUrl("");setMediaDuration(undefined);setSidebarOpen(false);setSilenceCandidates([]);};
 const makeComparisonSource=(cues:Cue[],name:string,sourceFile:string,notes:string[]=[]):ComparisonSource=>({id:`model-${crypto.randomUUID()}`,name:name.replace(/\.vtt$/i,"").slice(0,80)||"モデル",fileName:sourceFile,cues,warnings:notes});
 const cleanupSources=useMemo(()=>comparison?comparison.sources.filter(s=>!s.generated):hasTranscript?[makeComparisonSource(buildEditedCues(doc,state,{merge:false,maxGapMs:null,timeline:'original'}),fileName,fileName,warnings)]:[],[comparison,doc,state,hasTranscript,fileName,warnings]);
 const addCleanup=async(source:ComparisonSource)=>{const base=comparison??createComparisonSession(cleanupSources);if(base.sources.some(source=>source.generated)&&!(await confirmAction('生成結果で現在のカスタム列を置き換えます。必要な比較は先に保存してください。')))throw Error('反映を取り消しました。生成結果はこの画面から再度追加できます。');setComparison(createEditableComparison(base,source));setView('compare');setModal(null);notify('生成結果を編集可能なカスタム列に追加しました。');};
 const enterComparison=()=>{if(blockedByBusyWork("動画の書き出しを中止してから比較を開いてください。"))return;if(!comparison&&hasTranscript&&!isSample)setComparison(createComparisonSession([makeComparisonSource(doc.cues,fileName,fileName,warnings)]));setView("compare");setQuery("");setSidebarOpen(false);clearSelection();};
 useEffect(()=>{if(active&&view==="compare"&&!comparison)enterComparison();},[active,view]);
 const chooseComparison=()=>{if(blockedByBusyWork("動画の書き出しを中止してからVTTを追加してください。"))return;setPasteOpen(true);};
 const loadComparisonFiles=async(files:File[],append:boolean,associatedMedia?:File)=>{if(blockedByBusyWork("現在の処理が完了するか中止してからファイルを変更してください。"))return;const base=append?comparison:null;if(!files.length)return;if(files.some(file=>!/\.vtt$/i.test(file.name))){setError("比較にはVTTファイルを選択してください。比較プロジェクトのJSONは1つだけで開けます。");return;}if(files.length+(base?.sources.filter(s=>!s.generated).length??0)>3){setError("比較できるVTTは最大3つです。追加する場合は比較画面でモデルを1つ外してください。");setView("compare");return;}if(files.some(file=>file.size>20*1024*1024)){setError("VTTは1ファイル20 MB以下で選択してください。");return;}const version=++importVersion.current;setLoading(true);setError("");try{const inputs=await Promise.all(files.map(async file=>{const raw=new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer());const parsed=parseVtt(raw);return makeComparisonSource(parsed.cues,file.name,file.name,parsed.warnings);}));if(version!==importVersion.current)return;const next=base?addComparisonSources(base,inputs):createComparisonSession(inputs);if(!append&&comparison&&!(await confirmAction("現在の比較を新しいVTTで置き換えます。必要な比較は先に保存してください。")))return;if(version!==importVersion.current)return;if(associatedMedia)loadMedia(associatedMedia);setComparison(next);setView("compare");setSidebarOpen(false);setQuery("");notify(`${next.sources.length}つのVTTを共通の時刻で並べました`);}catch(e){if(version===importVersion.current)setError(e instanceof Error?e.message:"比較用VTTを読み込めませんでした。");}finally{if(version===importVersion.current)setLoading(false);}};
 const handleFiles=(files:File[],forComparison=false)=>{
   if(!files.length)return;
   const media=files.filter(isEditorMediaFile),subtitles=files.filter(file=>!isEditorMediaFile(file));
   if(media.length>1){setError('動画・音声は1つずつドロップしてください。');return;}
   if(blockedByBusyWork('動画の書き出しを中止してからファイルを変更してください。'))return;
   if(!subtitles.length){if(media.length)loadMedia(media[0]);return;}
   if(subtitles.length===1&&(/\.json$/i.test(subtitles[0].name)||!/\.vtt$/i.test(subtitles[0].name))){void loadFile(subtitles[0],media[0]);return;}
   if(forComparison||view==='compare'||subtitles.length>1){void loadComparisonFiles(subtitles,forComparison||view==='compare',media[0]);return;}
   void loadFile(subtitles[0],media[0]);
 };
 useEffect(()=>{const help=()=>setModal('help');window.addEventListener('tc-help',help);const drag=(event:DragEvent)=>{if(active&&view==='compare'&&event.dataTransfer?.types.includes('Files'))event.preventDefault();};const drop=(event:DragEvent)=>{if(!active||view!=='compare'||!event.dataTransfer?.files.length||(event.target instanceof Element&&event.target.closest('.app-shell')))return;event.preventDefault();handleFiles(Array.from(event.dataTransfer.files));};window.addEventListener('dragover',drag);window.addEventListener('drop',drop);return()=>{window.removeEventListener('tc-help',help);window.removeEventListener('dragover',drag);window.removeEventListener('drop',drop);};});
 const saveComparison=()=>{if(!comparison){notify("比較するVTTを追加してください。");return;}try{saveFile(comparisonFileName(comparison.sources.filter(source=>!source.generated).map(source=>source.fileName)),exportComparisonJson(comparison));}catch(e){setError(e instanceof Error?e.message:"比較内容を保存できませんでした。");}};
 const downloadComparisonVtt=()=>{if(!comparison)return;try{const cues=getSelectedCues(comparison);const source=comparison.sources.find(source=>source.id===comparison.referenceId)??comparison.sources[0];saveFile(`${source.fileName.replace(/\.vtt$/i,"")}_selected.vtt`,serializeVtt(cues,{speakerFormat:"voice"}),"text/vtt;charset=utf-8");}catch(e){setError(e instanceof Error?e.message:"採用結果を出力できませんでした。");}};
 const applyComparison=async()=>{if(!comparison)return;try{const cues=getSelectedCues(comparison);if(!cues.length)throw new Error("採用する字幕を1つ以上選択してください。");const nextDoc=buildDocument(cues);if(isDirty&&!(await confirmAction("採用結果を会話編集に反映すると、現在の字幕編集・カット記録を置き換えます。必要な編集プロジェクトは先に保存してください。反映しますか？")))return;stopAnalysis();playback.reset();++importVersion.current;const source=comparison.sources.find(source=>source.id===comparison.referenceId)??comparison.sources[0];setDoc(nextDoc);let nextState=createEditorState();for(const range of getComparisonSkippedRanges(comparison))nextState=addCut(nextState,{...range,kind:"gap",precision:"gap",text:"字幕比較で採用解除"});setHistory(resetHistory(nextState));setFileName(`${source.fileName.replace(/\.vtt$/i,"")}_selected.vtt`);setIsSample(false);setWarnings([]);setError("");setQuery("");setFilter("all");setSelectedLines(new Set());setVisibleCount(24);setView("chat");setSilenceCandidates([]);setFillerCandidates([]);setAnalysisNote("");clearSelection();notify(`${cues.length}件の採用字幕を会話編集に反映しました。比較内容も保持しています。`);}catch(e){setError(e instanceof Error?e.message:"採用結果を反映できませんでした。");}};
 const loadComparisonDemo=async()=>{if(comparison&&!(await confirmAction("現在の比較をサンプルに置き換えます。必要な比較は先に保存してください。")))return;setComparison(createSampleComparison());setError("");setView("compare");};
 const openRename=(name:string)=>{setRenameTarget(name);setRenameValue(alias(name));setModal("rename");};
 const submitRename=()=>{const name=renameValue.trim();if(!name||name.length>80||/[\r\n<>]/.test(name)){setError("話者名は1〜80文字で、改行や < > を含めず入力してください。");return;}try{const next=renameSpeaker(state,renameTarget,name);apply(()=>next);setModal(null);notify(`「${renameTarget}」の表示名を一括変更しました`,true);}catch(e){setError(e instanceof Error?e.message:"話者名を変更できませんでした。");}};
 const scanFillers=()=>{const terms=fillerTerms.split(/[、,\n]/).map(s=>s.trim()).filter(Boolean);const candidates=findFillers(doc,terms).filter(candidate=>!state.cuts.some(c=>c.spans?.some(s=>s.cueId===candidate.cueId&&s.from<=candidate.from&&s.to>=candidate.to)));setFillerCandidates(candidates);setChosenFillers(new Set(candidates.map(c=>c.id)));};
 const deleteChosenFillers=(chosen:FillerCandidate[])=>{apply(s=>deleteFillers(doc,s,chosen));setModal(null);notify(`${chosen.length}件のフィラーを削除し、推定時刻を記録しました`,true);};
 const removeSelectedLines=()=>{if(!selectedLines.size)return;apply(s=>deleteLines(doc,s,[...selectedLines]));notify(`${selectedLines.size}行を削除し、カット時刻を記録しました`,true);setSelectedLines(new Set());};
 const scanSilence=async()=>{const minimum=Number(silenceThreshold)*1000,pad=Number(padding),db=Number(volumeThreshold);if(!Number.isFinite(minimum)||minimum<100||minimum>600000||!Number.isFinite(pad)||pad<0||pad>10000){setError("無音の長さと前後に残す時間を確認してください。");return;}const version=++analysisVersion.current;analysisAbort.current?.abort();const controller=new AbortController();analysisAbort.current=controller;setError("");setProgress(0);setDetecting(true);setSilenceCandidates([]);setAnalysisNote("");
  try{if(silenceMode==="gap"){const candidates=detectSubtitleGaps(doc.cues,{minDurationMs:minimum,paddingMs:pad,...(mediaDuration?{durationMs:mediaDuration}:{})});setSilenceCandidates(candidates);setAnalysisNote("字幕のない区間です。音声の無音は未確認です。必要な区間を確認してカットしてください。");}else{if(!mediaFile)throw new Error("動画・音声を追加してから解析してください。");const result=await analyzeAudioSilence(mediaFile,{thresholdDb:db,minDurationMs:minimum,paddingMs:pad,signal:controller.signal,onProgress:setProgress});if(version!==analysisVersion.current)return;setMediaDuration(result.durationMs);setSilenceCandidates(result.ranges);setAnalysisNote(`${result.method} / 音量が ${db} dBFS 以下の区間。小さい声も含む可能性があるため再生で確認できます。`);}setProgress(1);}catch(e){if(version===analysisVersion.current&&!(e instanceof DOMException&&e.name==="AbortError"))setError(e instanceof Error?e.message:"無音を解析できませんでした。");}finally{if(version===analysisVersion.current)setDetecting(false);}
 };
 const changeSilenceMode=(mode:"gap"|"audio")=>{stopAnalysis();setSilenceMode(mode);setSilenceCandidates([]);setAnalysisNote("");};
 const candidateAlreadyCut=(range:SilenceRange|SubtitleGap)=>ranges.some(c=>c.start<=range.start&&c.end>=range.end);
 const cutCandidate=(range:SilenceRange|SubtitleGap)=>{if(candidateAlreadyCut(range))return;apply(s=>addCut(s,{...range,text:range.kind==="gap"?"字幕のない区間（音声未確認）":"音量しきい値による無音区間",sourceCueIds:[]}));notify("カット区間を記録しました",true);};
 const cutAllCandidates=()=>{const remaining=silenceCandidates.filter(c=>!candidateAlreadyCut(c));apply(s=>remaining.reduce((next,c)=>addCut(next,{...c,text:c.kind==="gap"?"字幕のない区間（音声未確認）":"音量しきい値による無音区間",sourceCueIds:[]}),s));notify(`${remaining.length}区間のカットを記録しました`,true);};
 const updateCutTime=(cut:CutRecord,start:number,end:number)=>{if(end>Math.max(doc.durationMs,mediaDuration??0))throw new Error("終了時刻が読み込んだ字幕・メディアの範囲外です。");apply(s=>updateCut(s,cut.id,{start,end,precision:"manual"}));notify("カット時刻を更新しました",true);};
 const colorFor=(canonical:string|null)=>speakerPalette(canonical,atoms);
 const renderReviewGap=(gap:ReturnType<typeof reviewGaps>[number],trailing=false)=>{const cut=ranges.some(range=>range.start<=gap.start&&range.end>=gap.end);if(cut&&!showDeleted)return null;return <GapRow key={gap.id} gap={gap} cut={cut} disabled={saveBusy} verdict={visualResults[gap.id]} onCut={()=>{if(saveBusy)return;playback.pause();apply(s=>addCut(s,{start:gap.start,end:gap.end,kind:'gap',precision:'gap',text:'字幕の空白（無音未確認）',sourceCueIds:[]}));notify('空白をカットしました',true);}} onOpen={()=>openReview({...gap,label:'字幕の空白',kind:'gap'})} keepTail={!!state.keepTail} onToggleTail={trailing?()=>apply(s=>({...s,keepTail:!s.keepTail})):undefined}/>;};
 const canMergeInView=filter==="all"&&!query.trim();

 const saveComparisonArchive=async()=>{if(!comparison||archiveBusy)return;setArchiveBusy(true);try{const blob=await createSaveArchive(comparisonSaveFiles(comparison,processingMetrics()));const file=prepareBinaryDownload(saveBaseName(comparison.sources[0]?.fileName??'比較')+'_比較一式.zip',blob);try{requestBrowserDownload(file);}catch{}setDownloadFile(file);setModal('download');}catch(e){setError(String(e));}finally{setArchiveBusy(false);}};
 const bundleMedia=async(media:{blob:Blob;fileName:string;durationMs:number;sourceDurationMs:number},signal:AbortSignal,onProgress:(fraction:number)=>void)=>({blob:await createSaveArchive(videoSaveFiles({doc,state,sourceFile:fileName,sourceMedia:mediaFile?.name??fileName,sourceDurationMs:media.sourceDurationMs,comparison,merge:mergeOptions,metrics:processingMetrics(),media}),signal,onProgress),fileName:saveBaseName(media.fileName)+'_全部保存.zip'});
 const bundleRemoved=async(media:{blob:Blob;fileName:string;durationMs:number;sourceDurationMs:number},signal:AbortSignal,onProgress:(fraction:number)=>void)=>({blob:await createSaveArchive(removedReviewFiles({doc,state,sourceDurationMs:media.sourceDurationMs,comparison,media}),signal,onProgress),fileName:saveBaseName(media.fileName)+'.zip'});
 const saveBusy=loading||mediaExportBusy||aiCleanupBusy||archiveBusy;
 useSaveOptions(active,view==='compare'?[
  {id:'comparison-all',label:'比較データ一式（ZIP）',description:'元字幕・採用字幕・比較プロジェクト・計測記録',disabled:saveBusy||!comparison,run:()=>void saveComparisonArchive()},
  {id:'comparison-project',label:'比較プロジェクト（JSON）',description:'元字幕・カスタム列・採用状態を保存して再開',disabled:saveBusy||!comparison,run:saveComparison},
  {id:'adopted-csv',label:'採用した字幕（CSV）',description:'開始・終了・話者・本文を表形式で保存',disabled:saveBusy||!comparison,run:()=>{if(comparison)saveFile(baseName+'_adopted.csv',subtitleCsv(getSelectedCues(comparison)),'text/csv;charset=utf-8');}},
  {id:'adopted-vtt',label:'採用した字幕（VTT）',description:'採用した文章と話者を字幕ファイルへ出力',disabled:saveBusy||!comparison,run:downloadComparisonVtt},
 ]:[
  {id:'editor-all',label:'すべて保存（動画・字幕・作業データ）',description:'カット後の動画とVTT・再開用プロジェクト・編集履歴をZIPに保存',disabled:saveBusy||!hasTranscript||!mediaFile,run:()=>{stopAnalysis();mediaRef.current?.pause();setRemovedReview(false);setBundleExport(true);setModal('video');}},
  {id:'editor-project',label:'編集プロジェクト（JSON）',description:'本文・話者・カット位置を保存して再開',disabled:saveBusy||!hasTranscript,run:downloadProject},
  {id:'edited-csv',label:'編集済み字幕（CSV）',description:'字幕の時刻設定を選んでVTTまたはCSVを保存',disabled:saveBusy||!hasTranscript,run:()=>setModal('export')},
  {id:'edited-vtt',label:'編集済み字幕（VTT）',description:'時刻と話者の出力設定を選んで保存',disabled:saveBusy||!hasTranscript,run:()=>setModal('export')},
  {id:'cut-media',label:'カットした動画・音声',description:'カット区間を除いてつなぎ直した映像・音声',disabled:saveBusy||!hasTranscript||!mediaFile,run:()=>{stopAnalysis();mediaRef.current?.pause();setRemovedReview(false);setBundleExport(false);setModal('video');}},
  {id:'removed-review',label:'カット部分の確認用（メディア・VTT）',description:'削除部分だけを連結したメディアと対応VTTをZIPに保存',disabled:saveBusy||!hasTranscript||!mediaFile||(!state.cuts.length&&state.keepTail),run:()=>{stopAnalysis();mediaRef.current?.pause();setRemovedReview(true);setBundleExport(false);setModal('video');}},
  {id:'cuts-json',label:'カット記録（JSON）',description:'削除区間の開始・終了時刻と理由',disabled:saveBusy||!hasTranscript,run:()=>downloadCuts('json')},
  {id:'cuts-csv',label:'カット記録（CSV）',description:'カット編集用の削除区間を表形式で出力',disabled:saveBusy||!hasTranscript||mediaDuration===undefined,run:()=>downloadCuts('csv')},
 ]);
 const rowContext:TranscriptRowContext={groups,canMergeInView,query,showTimes,mounted,interactionMode,playbackMode:playback.mode,playbackPlaying:playback.playing,hasMedia:!!mediaFile,busy:mediaExportBusy,selectedLines,deletedTokens,deletedSpans,activeLineIds,activeTokenIds,shouldIgnoreClick,middleSeek,
  renderLineGap:(line,group)=>gapByCue.get(line.cueId)&&doc.linesByCue.get(line.cueId)?.[0]?.id===line.id&&line.id!==group.lines[0]?.id&&renderReviewGap(gapByCue.get(line.cueId)!),
  onSeek:seek,onRestoreText:restoreText,onDeleteToken:deleteToken,onPlayUtterance:playUtterance,onReview:openReview,onCorrect:openCorrection,
  onSelectLine:(lineId,selected)=>setSelectedLines(current=>{const next=new Set(current);if(selected)next.add(lineId);else next.delete(lineId);return next;}),
  lineMuteState:line=>muteCoverage(state.mutes??[],[line]),
  onToggleLineMute:line=>toggleMutes([line]),
  onDeleteLine:lineId=>{apply(s=>deleteLines(doc,s,[lineId]));notify("行を削除し、カット時刻を記録しました",true);},
  onMerge:(groupId,direction)=>{apply(s=>mergeWithNeighbor(doc,s,groupId,direction,displayMergeOptions));notify(direction==="up"?"上の発言に話者を合わせて結合しました。時刻は保持しています。":"下の発言に話者を合わせて結合しました。時刻は保持しています。",true);},
  onCopy:group=>{navigator.clipboard.writeText(`${group.speaker??"話者不明"}：${group.text}`).then(()=>notify("発言をコピーしました")).catch(()=>notify("本文を選択してコピーしてください"));},
 };
 const editorTools=(
 <EditorToolbar active={active} hasTranscript={hasTranscript} showMenuButton={hasTranscript||!!mediaFile} sidebarOpen={sidebarOpen} onToggleSidebar={()=>setSidebarOpen(!sidebarOpen)} addDisabled={saveBusy} onPasteVtt={()=>setPasteOpen(true)} onWordTiming={()=>setWordInput(true)} onFillers={()=>{setModal("fillers");scanFillers();}} onSilence={()=>{setModal("silence");setError("");}} cleanupDisabled={mediaExportBusy||!cleanupSources.length} onCleanup={()=>setModal("cleanup")} canUndo={!!history.past.length} canRedo={!!history.future.length} onUndo={undo} onRedo={redo} cutCount={ranges.length} muteCount={state.mutes?.length??0} onCuts={()=>setModal("cuts")} onMutes={()=>setModal("mutes")} onRetranscribe={()=>{stopAnalysis();playback.pause();setRemovedReview(false);setBundleExport(false);setModal("video");}} retranscribeDisabled={!mediaFile||saveBusy||recognitionBusy||!onRetranscribe}/>
 );
 return <div className={`app-shell compact-ui pane-editor${view==="compare"?" compare-mode":""}${largeText?" large-text":""}${showDeleted?" show-deleted":""}${reviewTarget?" has-review":""}`} onDragEnter={e=>{if(Array.from(e.dataTransfer.types).includes("Files")){e.preventDefault();dragDepth.current++;setDragging(true);}}} onDragOver={e=>{if(Array.from(e.dataTransfer.types).includes("Files")){e.preventDefault();e.dataTransfer.dropEffect="copy";}}} onDragLeave={e=>{e.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}} onDrop={e=>{e.preventDefault();dragDepth.current=0;setDragging(false);handleFiles(Array.from(e.dataTransfer.files));}}>
 <div className="body-layout">{sidebarOpen&&<button className="sidebar-scrim" aria-label="メニューを閉じる" onClick={()=>setSidebarOpen(false)}/>}
 <EditorSidebar open={sidebarOpen} onClose={()=>setSidebarOpen(false)} showTranscriptInfo={view!=="compare"&&hasTranscript} fileName={fileName} mediaFile={mediaFile} mediaUrl={mediaUrl} mediaDuration={mediaDuration} busy={mediaExportBusy} playbackRate={playback.playbackRate} onPlaybackRate={playback.setPlaybackRate} onInvalidRate={notify} onMediaElement={node=>{mediaRef.current=node;}} onMediaDuration={setMediaDuration} onCloseMedia={()=>{stopAnalysis();playback.reset();setMediaFile(null);setMediaUrl("");setMediaDuration(undefined);setSilenceCandidates([]);}} automaticTail={automaticTail} tailNotice={tailNotice} transcriptDurationMs={doc.durationMs} cutRanges={ranges} timelineDurationMs={duration} removedMs={removedMs} onSeek={seek} speakerCount={atoms.length} speakers={speakerCounts} activeGroupCount={activeGroups} unknownCount={groups.some(g=>!g.canonicalSpeaker)?groups.filter(g=>!g.canonicalSpeaker&&!g.deleted).length:null} filter={filter} onFilterAll={()=>{setFilter("all");setView("chat");setSidebarOpen(false);}} onFilterSpeaker={speaker=>{setFilter(speaker);setView("chat");}} onFilterUnknown={()=>setFilter("unknown")} onRename={openRename}/>
 <main className="workspace">
 {error&&<div className="error-banner" role="alert"><AlertCircle size={18}/><span>{error}</span><button className="icon-button" aria-label="エラーを閉じる" onClick={()=>setError("")}><X size={16}/></button></div>}
 {view!=="compare"&&warnings.length>0&&<details className="warning-details"><summary>読み込みメモ {warnings.length}件</summary><ul>{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
 {view!=='compare'&&!hasTranscript&&editorTools}
 {view==="compare"?<section className="workspace-scroll-panel comparison-scroll-panel" aria-label="字幕比較のスクロール領域" tabIndex={0}><VttComparison active={active} onSample={loadComparisonDemo} canSample={!hasTranscript&&!comparison&&!mediaFile} session={comparison} onChange={setComparison} onAddFiles={chooseComparison} onGenerate={()=>setModal('cleanup')} onApply={applyComparison} onExportVtt={downloadComparisonVtt} onSeek={seek} canPlay={!!mediaFile} currentMs={playback.currentMs} durationMs={mediaDuration??comparisonEnd} playing={playback.playing} onTogglePlayback={()=>playback.playing?playback.pause():playback.playFrom(playback.currentMs,'edited')} onScrub={ms=>{if(playback.playing)playback.playFrom(ms,'edited');else if(mediaRef.current)mediaRef.current.currentTime=ms/1000;}} busy={saveBusy}/></section>:!hasTranscript?<section className="workspace-empty" aria-label="字幕・元動画のドロップ領域"><span>字幕(vtt)・動画（MP4・WebM）・プロジェクトをドロップ</span>{!mediaFile&&!comparison&&<button className="button secondary empty-sample" disabled={saveBusy} onClick={resetSample}>サンプル</button>}</section>:<>
 {mediaFile&&<PlaybackStrip playing={playback.playing} waiting={playback.waiting} mode={playback.mode} currentMs={playback.currentMs} totalMs={mediaDuration??duration} busy={mediaExportBusy} muted={!!muteAt(state.mutes??[],playback.currentMs)} activeGroup={activeGroup} playheadVisible={playheadVisible} followPlayback={followPlayback} onFollowPlayback={setFollowPlayback} onToggle={()=>playback.playing?playback.pause():playback.playFrom(playback.currentMs,playback.mode)} onScrub={ms=>{if(playback.playing)playback.playFrom(ms,playback.mode);else if(mediaRef.current)mediaRef.current.currentTime=ms/1000;}}/>}
 <WorkspaceToolbar hasMedia={!!mediaFile} busy={mediaExportBusy} interactionMode={interactionMode} onInteractionMode={mode=>{clearSelection();setInteractionMode(mode);}} view={view} onView={setView} showDeleted={showDeleted} onShowDeleted={setShowDeleted} largeText={largeText} onLargeText={setLargeText} merging={merging} onMerge={()=>setMerging(true)} filterLabel={filter!=="all"?(filter==="unknown"?"話者不明":alias(filter)):null} onClearFilter={()=>setFilter("all")} searchInput={searchInput} query={query} onQuery={value=>{setQuery(value);setView("chat");}} onClearQuery={()=>setQuery("")} onSettings={()=>setModal("settings")}/>
 {editorTools}
 {mediaFile&&<SpeakerWaveforms file={mediaFile} cues={doc.cues} currentMs={playback.currentMs} playing={playback.playing} active={active} onPosition={positionReview} onSeek={seek} onPause={playback.pause} disabled={mediaExportBusy} onSelect={(start,end)=>openReview({kind:'speech',start,end,label:"分離波形の選択区間"})}/>}
 {selectedLines.size>0&&<div className="selection-bar" role="status"><strong>{selectedLines.size}行を選択中</strong><span>元の字幕行単位で時刻を記録</span><button className="button danger small" onClick={removeSelectedLines}><Trash2 size={14}/>選択した行を削除</button><button className="icon-button" aria-label="行選択を解除" onClick={()=>setSelectedLines(new Set())}><X size={16}/></button></div>}
 {view==="chat"?<section className="conversation workspace-scroll-panel" tabIndex={0} data-interaction-mode={interactionMode} data-show-times={showTimes} aria-label="編集できる文字起こし" onContextMenuCapture={event=>{
 if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable=true]'))return;
 event.preventDefault();event.stopPropagation();if(mediaExportBusy||aiCleanupBusy)return;
 const selected=transcriptRef.current?readTranscriptSelection(transcriptRef.current):null;
 const selection=selected?{...selected,spans:selected.spans.map(s=>({...s}))}:null;
 const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-transcript-span][data-text-deleted=true]'):null;
 const restore=target?{cueId:target.dataset.cueId!,from:Number(target.dataset.textFrom),to:Number(target.dataset.textTo)}:undefined;
 const box=(event.target as HTMLElement).getBoundingClientRect();
 setContextMenu({x:event.clientX||box.left+12,y:event.clientY||box.bottom,selection,restore});
 }} ref={transcriptRef} {...selectionHandlers} onPointerDownCapture={event=>{selectionHandlers.onPointerDownCapture(event);if(event.button===2)event.preventDefault();if(event.button===0&&event.target instanceof Element&&event.target.closest("[data-transcript-span]"))playback.pause();}}>
 <div className="conversation-columns" aria-hidden="true"><span>話者</span><span>時刻</span><span>本文</span></div>
 {visible.map(group=>{const playingGroup=group.cueIds.some(id=>activeCueIds.has(id));const groupTransportActive=!!mediaFile&&playback.currentMs>=group.start&&playback.currentMs<group.end;const revealDeleted=showDeleted||(originalPreview&&playingGroup);const palette=colorFor(group.canonicalSpeaker);const ambiguous=isCompound(group.canonicalSpeaker)||group.isMultiVoice||!group.canonicalSpeaker;const groupIndex=groupIndices.get(group.id)??-1;const firstGap=group.lines[0]?gapByCue.get(group.lines[0].cueId):undefined;return <Fragment key={group.id}>
 {renderFilterGap(filterContext.before.get(group.id))}{firstGap&&renderReviewGap(firstGap)}
 <TranscriptGroupRow ctx={rowContext} group={group} groupIndex={groupIndex} palette={palette} playing={playingGroup} transportActive={groupTransportActive} revealDeleted={revealDeleted} ambiguous={ambiguous}/></Fragment>;})}
 {visibleCount>=filtered.length&&filter==='all'&&!query.trim()&&gaps.filter(g=>g.trailing).map(g=>renderReviewGap(g,true))}
 {visibleCount>=filtered.length&&renderFilterGap(filterContext.after)}
 {!filtered.length&&<div className="empty-state"><Search size={30}/><h3>表示する発言がありません</h3><p>検索や話者の絞り込みを解除するか、削除箇所を表示してください。</p><button className="button secondary" onClick={()=>{setQuery("");setFilter("all");setShowDeleted(true);}}>全体を確認</button></div>}
 <div ref={sentinel} className="load-more-sentinel" aria-live="polite">{visibleCount<filtered.length?`${visible.length} / ${filtered.length}発言 · スクロールすると続きを表示`:<span className="end-of-transcript">全{displayedLineCount.toLocaleString()}行</span>}</div></section>:<section className="workspace-scroll-panel vtt-preview-panel" aria-label="編集済みVTTプレビュー" tabIndex={0}><div className="export-options"><label className="form-label" htmlFor="preview-timeline">字幕のタイムライン</label><select className="select-input" id="preview-timeline" value={exportTimeline} onChange={e=>setExportTimeline(e.target.value as "original"|"edited")}><option value="original">元動画の時刻を保持</option><option value="edited">カット後の動画に合わせて時刻を詰める</option></select></div><p className="raw-note">検索・話者フィルターに関わらず、全体の編集結果を表示しています。</p>{exportResult.error?<div className="error-banner">{exportResult.error}</div>:<pre className="raw-vtt" tabIndex={0}>{exportResult.text}</pre>}</section>}
 </>}
 </main></div>
 {modal==="mutes"&&<MuteDialog ranges={state.mutes??[]} onRemove={range=>changeMutes([range],false)} onSeek={seek} onClose={()=>setModal(null)}/>}
 {reviewTarget&&<TimelineReview cutRecords={state.cuts} activeCutId={reviewCutId} onChooseCut={selectReviewCut} onRestoreCut={restoreReviewCut} linkedText={reviewText.map(span=>doc.cueById.get(span.cueId)?.text.slice(span.from,span.to)??'').join('')} onAddMedia={()=>setSidebarOpen(true)} mutes={state.mutes??[]} onMute={value=>changeMutes(reviewSelection,value)} target={reviewTarget} file={mediaFile} selection={reviewSelection} candidateLabel={reviewMethod} onPreview={previewReview} cuts={ranges} currentMs={playback.currentMs} onSelect={chooseReviewRange} onDelete={deleteReview} onSeek={positionReview} onClose={()=>{setReviewTarget(null);setReviewRange(null);setReviewText([]);}} disabled={mediaExportBusy} onVerdict={v=>setVisualResults(prev=>({...prev,[`gap-${reviewTarget.start}-${reviewTarget.end}`]:v}))}/>}
 {dragging&&<div className="drop-overlay"><div className="drop-modal"><div className="drop-icon"><Upload size={36}/></div><h2>ここにファイルをドロップ</h2><p>VTTは最大3つまで同時に比較できます。編集プロジェクト・動画・音声は1つずつ読み込みます。</p></div></div>}
 {contextMenu&&<TranscriptContextMenu x={contextMenu.x} y={contextMenu.y} onClose={closeContextMenu} items={[
 {label:'話者を変更',disabled:!contextMenu.selection,run:()=>{if(contextMenu.selection)editSelectionSpeaker(contextMenu.selection);}},
 {label:'選択範囲を削除',disabled:!contextMenu.selection,run:()=>{if(contextMenu.selection)deleteSelection(contextMenu.selection);}},
 {label:contextMenu.selection&&muteCoverage(state.mutes??[],timeRangesForText(doc,contextMenu.selection.spans))==='full'?'選択範囲のミュートを解除':'選択範囲をミュート',disabled:!contextMenu.selection||!mediaFile,run:()=>{if(contextMenu.selection)toggleMutes(timeRangesForText(doc,contextMenu.selection.spans));}},
 {label:'1手戻す',disabled:!history.past.length,run:undo},
 ...(contextMenu.restore?[{label:'この文字を復元',run:()=>restoreText(contextMenu.restore!)}]:[])
 ]}/>}
 {textSelection&&<div className="text-selection-bar" role="region" aria-label="テキストの選択操作" onPointerDown={e=>e.preventDefault()}><strong>{textSelection.characterCount}文字を選択</strong><button className="button secondary small" onClick={openSelectionSpeaker}><UserRound size={15}/>話者を変更</button><button className="button danger small" aria-keyshortcuts="Delete Backspace" title="選択範囲を削除（Delete／Backspace）" onClick={deleteTextSelection}><Trash2 size={15}/>選択範囲を削除</button><button className="icon-button" aria-label="テキストの選択を解除" onClick={()=>{clearSelection();setReviewText([]);setReviewRange(null);}}><X size={16}/></button></div>}
 {toast&&<div className="toast" role="status" onMouseEnter={()=>setToastPaused(true)} onMouseLeave={()=>setToastPaused(false)} onFocus={()=>setToastPaused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setToastPaused(false);}}><Check size={17}/><span>{toast.text}</span>{toastCanUndo&&<button className="toast-undo" aria-label="直前の編集を元に戻す" onClick={()=>{undo();notify("直前の編集を元に戻しました");}}><Undo2 size={15}/>元に戻す</button>}<button className="icon-button" aria-label="通知を閉じる" onClick={()=>setToast(null)}><X size={14}/></button></div>}
 {wordInput&&<WordTimingInput onLoad={applyWordTiming} onClose={()=>setWordInput(false)}/>}
 {pasteOpen&&<VttPasteDialog disabled={saveBusy} value={pasteText} onChange={setPasteText} onClose={()=>setPasteOpen(false)} onFiles={files=>handleFiles(files,view==='compare')}/>}
 {modal==="terminology"&&<TerminologyDialog onClose={()=>setModal(null)}/>}
 {modal==="cleanup"&&<SubtitleCleanupDialog sources={cleanupSources} onGenerated={addCleanup} onBusy={setAiCleanupBusy} onClose={()=>setModal(null)}/>}
 {modal==="correct"&&<TextCorrectionDialog cues={correctionCueIds.map(id=>doc.cueById.get(id)).filter((cue):cue is Cue=>!!cue)} onSave={saveCorrection} onClose={()=>{setModal(null);setError("");}} error={error}/>}
 {modal==="selection-speaker"&&speakerSelection&&<SelectionSpeakerDialog text={speakerSelection.text} speakers={[...new Set([...atoms.map(alias),"話者不明"])]} canChangeFromSelection={new Set(speakerSelection.spans.map(span=>span.cueId)).size===1} onSave={saveSelectionSpeaker} onClose={()=>{setModal(null);setError("");}} error={error}/>}
 {modal==="download"&&downloadFile&&<DownloadResult key={downloadFile.url} file={downloadFile} onClose={()=>setModal(null)}/>}
 {modal==="rename"&&<RenameSpeakerDialog target={renameTarget} value={renameValue} error={error} onChange={setRenameValue} onSubmit={submitRename} onClose={()=>setModal(null)}/>}
 {modal==="fillers"&&<FillerDialog doc={doc} terms={fillerTerms} candidates={fillerCandidates} chosen={chosenFillers} onTermsChange={setFillerTerms} onScan={scanFillers} onChosenChange={setChosenFillers} onDelete={deleteChosenFillers} onClose={()=>setModal(null)}/>}
 {modal==="silence"&&<SilenceDialog mode={silenceMode} threshold={silenceThreshold} padding={padding} volumeThreshold={volumeThreshold} mediaFile={mediaFile} mediaExportBusy={mediaExportBusy} detecting={detecting} progress={progress} analysisNote={analysisNote} error={error} candidates={silenceCandidates} isCut={candidateAlreadyCut} onModeChange={changeSilenceMode} onThresholdChange={setSilenceThreshold} onPaddingChange={setPadding} onVolumeThresholdChange={setVolumeThreshold} onLoadMedia={loadMedia} onScan={()=>void scanSilence()} onStop={stopAnalysis} onSeek={seek} onCut={cutCandidate} onCutAll={cutAllCandidates} onClose={()=>{stopAnalysis();setModal(null);}}/>}
 {modal==="cuts"&&<CutsDialog cuts={state.cuts} rangeCount={ranges.length} removedMs={removedMs} tailNotice={tailNotice} automaticTail={automaticTail} mediaDuration={mediaDuration} hasMedia={!!mediaFile} onSeek={seek} onUpdate={updateCutTime} onRestore={cut=>{apply(s=>removeCut(s,cut.id));notify("このカットを取り消しました",true);}} onDownload={downloadCuts} onClose={()=>setModal(null)}/>}
 {mediaFile&&hasTranscript&&<VideoExportDialog onRetranscribe={onRetranscribe?file=>{const vtt=serializeVtt(buildEditedCues(doc,state,{...mergeOptions,timeline:"edited"}),{speakerFormat:"voice"});onRetranscribe(file,vtt);}:undefined} recognitionBusy={recognitionBusy} mutes={state.mutes} open={modal==="video"} file={mediaFile} cuts={state.cuts} subtitleEndMs={doc.durationMs} preserveTail={!!state.keepTail} onClose={()=>setModal(null)} onBusyChange={setMediaExportBusy} removedOnly={removedReview} bundle={removedReview?bundleRemoved:bundleExport?bundleMedia:undefined}/>}{modal==="export"&&<Modal title="編集結果を保存・書き出し" eyebrow="SAVE YOUR EDIT" wide onClose={()=>setModal(null)} footer={<button className="button secondary" onClick={()=>setModal(null)}>閉じる</button>}><div className="export-section"><h3><FileText size={18}/>編集済みVTT</h3><p className="form-help">削除した本文と話者名の変更を反映します。検索・絞り込みに関わらず全発言が対象です。</p><div className="export-options"><label className="form-field"><span className="form-label">時刻の基準</span><select className="select-input" value={exportTimeline} onChange={e=>setExportTimeline(e.target.value as "original"|"edited")}><option value="original">元動画の時刻を保持</option><option value="edited">カット後の動画に合わせて時刻を詰める</option></select></label><label className="form-field"><span className="form-label">話者の表記</span><select className="select-input" value={speakerFormat} onChange={e=>setSpeakerFormat(e.target.value as "voice"|"prefix")}><option value="voice">WebVTT話者タグ — &lt;v 話者名&gt;</option><option value="prefix">話者名：本文</option></select></label></div>{exportResult.error?<div className="error-banner">{exportResult.error}</div>:<><div className="panel-actions"><span>出力する字幕：{exportResult.count.toLocaleString()}件</span><button className="button primary" onClick={downloadVtt}><ArrowDownToLine size={16}/>編集済みVTTを保存</button><button className="button secondary" onClick={()=>saveFile(baseName+"_"+exportTimeline+".csv",subtitleCsv(parseVtt(exportResult.text).cues),"text/csv;charset=utf-8")}>字幕CSVを保存</button></div><details><summary className="export-preview-title">出力の先頭を確認</summary><pre className="export-preview">{exportResult.text.split("\n").slice(0,22).join("\n")}{exportResult.text.split("\n").length>22?"\n…":""}</pre></details></>}<p className="form-help">カット区間をまたぐ字幕は分割します。元の装飾・配置用メタデータは会話向けに整理されます。</p></div><div className="export-section"><h3><Film size={18}/>カットした動画・音声</h3><p className="form-help">元の動画・音声から、選択したカット区間を除いてつなぎ直します。</p>{mediaFile?<button className="button primary" onClick={()=>{stopAnalysis();mediaRef.current?.pause();setRemovedReview(false);setBundleExport(false);setModal("video");}}><Film size={16}/>動画・音声を書き出す</button>:<MediaDrop onLoad={f=>{setModal(null);loadMedia(f);}} label="出力用動画・音声のドロップ領域"/>}<p className="form-help">動画出力中はアプリを開いたままにしてください。字幕も合わせる場合は「カット後の動画に合わせて時刻を詰める」を選びます。</p></div><div className="export-section"><h3><Scissors size={18}/>カット編集用のカット記録</h3><p className="form-help">{ranges.length}区間・合計{fmtSeconds(removedMs)}。元動画の開始／終了時刻（ミリ秒）と、削除理由・時刻の確度を記録します。重複区間は統合します。</p><div className="action-group"><button className="button secondary" onClick={()=>downloadCuts("json")}><ArrowDownToLine size={16}/>JSONで保存</button><button className="button secondary" disabled={mediaDuration===undefined} title={mediaDuration===undefined?"元動画を追加すると、末尾の終了時刻を含めてCSVに保存できます":undefined} onClick={()=>downloadCuts("csv")}><ArrowDownToLine size={16}/>CSVで保存</button><button className="button ghost small" onClick={()=>setModal("cuts")}>時刻を確認・修正<ChevronRight size={14}/></button></div>{state.cuts.some(c=>c.precision==="estimated")&&<p className="inline-notice">推定の単語時刻が含まれています。動画の実カット前に再生・時刻の確認ができます。</p>}<p className="form-help">{tailNotice}{mediaDuration===undefined&&" JSONには末尾を保持するかどうかも保存します。CSVは元の動画・音声を追加してから保存できます。"}</p></div><div className="export-section"><h3><Save size={18}/>続きから編集する</h3><p className="form-help">元字幕・話者名・結合・カット記録を1つのJSONに保存します。次回はそのファイルをドロップして再開できます。動画・音声は必要に応じて選び直してください。</p><button className="button secondary" onClick={downloadProject}><Save size={16}/>編集プロジェクトを保存</button></div></Modal>}
 {modal==="settings"&&<Modal title="表示と結合の設定" eyebrow="READING PREFERENCES" onClose={()=>setModal(null)} footer={<button className="button primary" onClick={()=>setModal(null)}><Check size={16}/>完了</button>}><div className="setting-row"><div><strong>大きめの文字で表示</strong><p className="form-help">長い会議録を読みやすく。</p></div><button className={`toggle${largeText?" checked":""}`} role="switch" aria-label="大きめの文字で表示" aria-checked={largeText} onClick={()=>setLargeText(!largeText)}><span className="toggle-knob"/></button></div><div className="setting-row"><div><strong>タイムスタンプを表示</strong><p className="form-help">発言と元字幕行の時刻を表示します。</p></div><button className={`toggle${showTimes?" checked":""}`} role="switch" aria-label="タイムスタンプを表示" aria-checked={showTimes} onClick={()=>setShowTimes(!showTimes)}><span className="toggle-knob"/></button></div><div className="form-field"><label className="form-label" htmlFor="max-gap">自動結合を区切る発言間隔</label><select id="max-gap" className="select-input" value={maxGap} onChange={e=>setMaxGap(e.target.value)}><option value="none">制限なし</option><option value="2">2秒を超えたら区切る</option><option value="5">5秒を超えたら区切る</option><option value="10">10秒を超えたら区切る</option><option value="30">30秒を超えたら区切る</option></select></div><p className="modal-help">自動結合は元の字幕順と話者ラベルで判定します。「上と結合」「下と結合」は隣の発言に話者を合わせ、元の各字幕の時刻を保持します。</p><p className="form-help">ページ分割・長文の折りたたみはありません。下へスクロールしてすべての発言を読めます。</p></Modal>}
 {modal==="help"&&createPortal(<HelpDialog onClose={()=>setModal(null)}/>,document.body)}
 </div>;
}
