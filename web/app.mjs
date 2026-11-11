import {parseTime,formatTime,makeExport} from './transcript-utils.mjs';
import {normalizeRanges,timelineSegments} from './editor.mjs';
const $=id=>document.getElementById(id);
const invoke=(cmd,args={})=>window.__TAURI__.core.invoke(cmd,args);
const state={media:null,models:[],job:null,segments:[],ranges:[],projects:[],dirty:new Map(),selected:new Set(),page:0,upload:false,cut:false,polling:false,loading:false,exportSpec:null};
const active=s=>['queued','running','uploading'].includes(s);
const terminal=s=>['complete','error','cancelled','interrupted'].includes(s);
const labels={queued:'待機中',running:'認識中',complete:'完了',error:'エラー',cancelled:'中止',interrupted:'中断',uploading:'送信中'};
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function action(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>notice(String(e),true)));}
function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o;}
function controls(){
 $('transcribe').disabled=!state.media || !state.models.length || state.upload || active(state.job?.status) || state.loading;
 $('cancelTranscription').disabled=!(state.upload || active(state.job?.status));
 $('open').disabled=state.upload || state.cut || state.loading;
 $('history').disabled=state.upload || state.cut || state.loading;
 $('cut').disabled=!state.media || state.cut || state.loading;
 $('cancelCut').disabled=!state.cut;
 $('saveEdits').disabled=!state.dirty.size || active(state.job?.status) || state.upload;
 $('dirty').textContent=state.dirty.size?`${state.dirty.size}件 未保存`:'';
 $('model').disabled=!state.models.length || state.upload;
 $('device').disabled=!state.models.length || state.upload;
 $('diarize').disabled=!state.models.find(m=>m.id===$('model').value)?.x_meeting?.diarization || state.upload;
}
function project(){return {path:state.media.path,job:state.job?.id??null,ranges:state.ranges,remove:$('cutMode').value==='remove',output_dir:$('outputDir').value};}
async function persist(){if(!state.media)return;const p=project();await invoke('save_project',{project:p});state.projects=state.projects.filter(v=>v.path!==p.path);state.projects.unshift(p);renderHistory();}
function renderHistory(){const h=$('history');h.replaceChildren(option('','履歴'));state.projects.forEach((p,i)=>h.append(option(String(i),p.path.split(/[\\/]/).at(-1))));}
async function saveEdits(){
 if(!state.dirty.size)return;
 if(active(state.job?.status))throw Error('認識完了後に字幕を保存してください。');
 const edits=[...state.dirty.values()].map(e=>({...e}));
 for(let n=0;n<edits.length;n+=100) await invoke('edit_segments',{id:state.job.id,edits:edits.slice(n,n+100)});
 for(const edit of edits){const current=state.dirty.get(edit.id);if(current?.text===edit.text&&current?.speaker===edit.speaker)state.dirty.delete(edit.id);}await loadSegments();controls();notice('字幕の変更を保存しました。');
}
function modelChanged(){
 const model=state.models.find(m=>m.id===$('model').value),x=model?.x_meeting??{};
 $('device').replaceChildren(...(x.processingMethods??[]).map(m=>option(m.id,m.label??m.id)));
 $('device').value=x.defaultProcessingMethod??'auto';
 if(!$('device').value && $('device').options.length)$('device').selectedIndex=0;
 $('diarize').checked=false;controls();
}
async function connect(){
 $('connection').textContent='接続中';
 try{const result=await invoke('connect_server',{url:$('serverUrl').value.trim()});
 // This application uses this PC. Explicitly exclude external API engines.
 state.models=(result.models??[]).filter(m=>['whisper','haas','qwen','reazon','parakeet'].includes(m.x_meeting?.engineId));
 $('model').replaceChildren(...state.models.map(m=>option(m.id,`${m.x_meeting.engineLabel} / ${m.x_meeting.label}`)));
 if(state.models.some(m=>m.id==='whisper/base'))$('model').value='whisper/base';
 modelChanged();$('connection').textContent=`接続済み・${state.models.length}モデル`;notice('TranscriptionServerへ接続しました。');
 }catch(e){state.models=[];$('connection').textContent='未接続';controls();throw e;}
}
function renderRanges(){
 $('ranges').replaceChildren();
 state.ranges.forEach((r,i)=>{const li=document.createElement('li');li.textContent=`${formatTime(r.start,true)} → ${formatTime(r.end,true)}`;const b=document.createElement('button');b.textContent='削除';b.onclick=()=>{state.ranges.splice(i,1);renderRanges();persist().catch(e=>notice(String(e),true));};li.append(b);$('ranges').append(li);});
 if(!state.media||!state.ranges.length){$('rangeSummary').textContent='範囲未指定';return;}
 try{const kept=normalizeRanges(state.ranges,state.media.duration,$('cutMode').value==='remove');$('rangeSummary').textContent=`出力 ${formatTime(kept.reduce((n,r)=>n+r.end-r.start,0),true)}・${kept.length}範囲`;}catch(e){$('rangeSummary').textContent=String(e);}
}
function filtered(){const query=$('search').value.trim().toLocaleLowerCase();return state.segments.filter(s=>!query||`${s.text} ${s.speaker??''}`.toLocaleLowerCase().includes(query));}
function renderSegments(){
 const all=filtered(), pages=Math.max(1,Math.ceil(all.length/200));state.page=Math.min(state.page,pages-1);const visible=all.slice(state.page*200,(state.page+1)*200);
 $('segments').replaceChildren();$('empty').hidden=Boolean(visible.length);$('page').textContent=`${state.page+1} / ${pages}`;$('prev').disabled=state.page===0;$('next').disabled=state.page+1>=pages;$('segmentCount').textContent=`${all.length} / ${state.segments.length}件`;$('selectPage').checked=Boolean(visible.length)&&visible.every(s=>state.selected.has(s.id));
 for(const segment of visible){
  const row=document.createElement('tr');row.dataset.id=segment.id;
  const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label',`字幕${segment.id}を選択`);check.checked=state.selected.has(segment.id);check.onchange=()=>{if(check.checked)state.selected.add(segment.id);else state.selected.delete(segment.id);};
  const seek=document.createElement('button');seek.textContent=`${formatTime(segment.start,true)}\n${formatTime(segment.end,true)}`;seek.style.whiteSpace='pre-line';seek.onclick=()=>{$('video').currentTime=segment.start;};
  const speaker=document.createElement('input');speaker.type='text';speaker.value=segment.speaker??'';speaker.maxLength=300;speaker.setAttribute('aria-label',`字幕${segment.id}の話者`);
  const text=document.createElement('textarea');text.value=segment.text;text.maxLength=200000;text.setAttribute('aria-label',`字幕${segment.id}の本文`);
  const edit=()=>{segment.text=text.value;segment.speaker=speaker.value;state.dirty.set(segment.id,{id:segment.id,text:segment.text,speaker:segment.speaker});controls();};speaker.oninput=edit;text.oninput=edit;
  speaker.disabled=text.disabled=active(state.job?.status);
  for(const el of [check,seek,speaker,text]){const td=document.createElement('td');td.append(el);row.append(td);}$('segments').append(row);
 }
}
async function loadSegments(){
 const id=state.job?.id;if(!id)return;
 let after=0;const rows=[];
 for(let page=0;page<10000;page++){
  const result=await invoke('get_segments',{id,after});
  if(state.job?.id!==id)return;
  const items=result.segments??[];rows.push(...items);
  if(!items.length||rows.length>=result.total)break;
  const next=Number(result.next??items.at(-1).id);if(next<=after)throw Error('字幕のページングが進みません。');after=next;
 }
 state.segments=rows.map(s=>({...s,...state.dirty.get(s.id)}));renderSegments();
}
function showJob(job){
 state.job=job;$('jobState').textContent=labels[job.status]??job.status;
 const progress=Number(job.progress??(job.status==='complete'?1:((job.processedUntil??0)/(job.duration||state.media?.duration||1))));$('jobProgress').value=progress<=1?progress*100:progress;
 $('jobDetail').textContent=[job.error,job.message,job.id?`ジョブ ${job.id}`:''].filter(Boolean).join('・');controls();
}
async function refreshJob(force=false){
 if(!state.job?.id||state.polling)return;
 state.polling=true;
 try{const previous=state.job.status;const v=await invoke('job_status',{id:state.job.id});showJob(v.job);if(force || (terminal(v.job.status)&&previous!==v.job.status))await loadSegments();}
 finally{state.polling=false;}
}
async function openMedia(path,saved){
 await saveEdits();await persist();state.loading=true;controls();
 try{
 const media=await invoke('open_media',{path});saved??=state.projects.find(p=>p.path===media.path);state.media=media;state.job=saved?.job?{id:saved.job,status:'loading'}:null;state.segments=[];state.dirty.clear();state.selected.clear();state.page=0;state.ranges=saved?.ranges??[];
 $('filename').textContent=media.path.split(/[\\/]/).at(-1);$('filename').title=media.path;$('video').src=window.__TAURI__.core.convertFileSrc(media.path);$('rangeStart').value='0';$('rangeEnd').value=String(media.duration);$('cutMode').value=saved?.remove?'remove':'keep';
 $('outputDir').value=saved?.output_dir||media.path.slice(0,Math.max(media.path.lastIndexOf('\\'),media.path.lastIndexOf('/')));$('outputName').value=$('filename').textContent.replace(/\.[^.]+$/,'')+'-cut';
 $('jobState').textContent='未実行';$('jobDetail').textContent='';$('jobProgress').value=0;renderRanges();renderSegments();await persist();
 if(state.job && state.models.length)await refreshJob(true);
 notice(`動画を開きました・${formatTime(media.duration,true)}${media.audio?'':'・音声なし'}`);
 }finally{state.loading=false;controls();}
}
let browserMode='media',currentDirectory='',parentDirectory=null;
async function browse(path){
 $('browserError').textContent='';
 try{const listing=await invoke('browse',{path});currentDirectory=listing.path;parentDirectory=listing.parent;$('browsePath').value=currentDirectory;$('entries').replaceChildren();$('useDirectory').disabled=!currentDirectory;
 for(const entry of listing.entries){if(browserMode==='directory'&&!entry.directory)continue;const b=document.createElement('button');b.textContent=`${entry.directory?'▸ ':''}${entry.name}`;b.onclick=()=>{if(entry.directory)browse(entry.path);else{ $('browser').close();openMedia(entry.path,state.projects.find(p=>p.path===entry.path)).catch(e=>notice(String(e),true)); }};$('entries').append(b);}
 }catch(e){$('browserError').textContent=String(e);}
}
async function showBrowser(mode){browserMode=mode;$('browserTitle').textContent=mode==='media'?'動画を選択':'保存先フォルダーを選択';$('useDirectory').hidden=mode!=='directory';$('browser').showModal();await browse(mode==='directory'?$('outputDir').value||currentDirectory:currentDirectory);}
action('open',()=>showBrowser('media'));action('chooseOutput',()=>showBrowser('directory'));action('closeBrowser',()=>$('browser').close());action('go',()=>browse($('browsePath').value.trim()));action('drives',()=>browse(''));action('up',()=>browse(parentDirectory??''));action('useDirectory',async()=>{$('outputDir').value=currentDirectory;$('browser').close();await persist();});
$('browsePath').addEventListener('keydown',e=>{if(e.key==='Enter')browse($('browsePath').value.trim());});
action('settingsToggle',()=>{$('settings').hidden=!$('settings').hidden;});action('connect',connect);$('model').onchange=modelChanged;
$('history').onchange=()=>{const p=state.projects[Number($('history').value)];if($('history').value!==''&&p)openMedia(p.path,p).catch(e=>notice(String(e),true));};
action('markStart',()=>{$('rangeStart').value=$('video').currentTime.toFixed(3);});action('markEnd',()=>{$('rangeEnd').value=$('video').currentTime.toFixed(3);});
$('video').ontimeupdate=()=>{const time=$('video').currentTime;$('position').textContent=`${formatTime(time,true)} / ${formatTime(state.media?.duration,true)}`;for(const tr of $('segments').children){const s=state.segments.find(s=>s.id===Number(tr.dataset.id));tr.classList.toggle('current',Boolean(s&&s.start<=time&&s.end>time));}};
$('video').onerror=()=>notice('この動画形式は画面で再生できません。FFmpegでのカット・文字起こしは利用できます。',true);
action('addRange',async()=>{if(!state.media)throw Error('動画を選択してください。');const r={start:parseTime($('rangeStart').value),end:parseTime($('rangeEnd').value)};normalizeRanges([r],state.media.duration);state.ranges=normalizeRanges([...state.ranges,r],state.media.duration);renderRanges();await persist();});
action('selectedRanges',async()=>{if(!state.media)throw Error('動画を選択してください。');const rows=state.segments.filter(s=>state.selected.has(s.id));if(!rows.length)throw Error('字幕を選択してください。');state.ranges=normalizeRanges([...state.ranges,...rows.map(s=>({start:Math.max(0,s.start),end:Math.min(state.media.duration,s.end)}))],state.media.duration);renderRanges();await persist();});
action('clearRanges',async()=>{state.ranges=[];renderRanges();await persist();});$('cutMode').onchange=()=>{renderRanges();persist().catch(e=>notice(String(e),true));};
action('transcribe',async()=>{
 await saveEdits();if(!state.media?.audio)throw Error('この動画には音声がありません。');const model=state.models.find(m=>m.id===$('model').value);if(!model)throw Error('モデルを選択してください。');
 state.upload=true;controls();notice('動画をサーバーへ送信しています。');
 try{const value=await invoke('transcribe',{engine:model.x_meeting.engineId,model:model.x_meeting.modelId,device:$('device').value,diarize:$('diarize').checked});state.segments=[];state.selected.clear();showJob(value.job);renderSegments();await persist();notice(value.warning??'認識を受け付けました。');}
 finally{state.upload=false;controls();}
});
action('cancelTranscription',async()=>{const value=await invoke('cancel_transcription',{id:state.job?.id??null});notice(value.pending?'送信受付後に認識を中止します。':'認識の中止を依頼しました。');if(value.job)showJob(value.job);});
action('refreshJob',async()=>{await saveEdits();await refreshJob(true);});action('saveEdits',saveEdits);
$('search').oninput=()=>{state.page=0;renderSegments();};action('prev',()=>{state.page--;renderSegments();});action('next',()=>{state.page++;renderSegments();});$('selectPage').onchange=()=>{for(const s of filtered().slice(state.page*200,(state.page+1)*200)){if($('selectPage').checked)state.selected.add(s.id);else state.selected.delete(s.id);}renderSegments();};
action('cut',async()=>{
 const kept=normalizeRanges(state.ranges,state.media?.duration,$('cutMode').value==='remove');await persist();
 await invoke('start_cut',{ranges:state.ranges,remove:$('cutMode').value==='remove',dir:$('outputDir').value,name:$('outputName').value.trim()});
 state.cut=true;state.exportSpec={path:state.media.path,kept};$('cutResult').textContent='書き出し中';$('cutProgress').value=0;controls();notice('動画を書き出しています。');
});
action('cancelCut',()=>invoke('cancel_cut'));
action('export',async()=>{
 await saveEdits();if(!state.segments.length)throw Error('字幕がありません。');let segments=state.segments;const metadata={...state.job.metadata,jobId:state.job.id,source:state.media.path};
 if($('exportTimeline').value==='cut'){
  const kept=normalizeRanges(state.ranges,state.media.duration,$('cutMode').value==='remove');segments=timelineSegments(segments,kept);metadata.cutRanges=kept;metadata.timeline='cut';
 }else metadata.timeline='original';
 const result=makeExport({segments,format:$('exportFormat').value,metadata});
 const path=await invoke('export_text',{dir:$('outputDir').value,name:$('outputName').value.trim()+($('exportTimeline').value==='cut'?'-cut-subtitles':'-original-subtitles'),extension:result.extension,text:result.text});notice(`保存しました: ${path}`);
});
setInterval(async()=>{
 if(state.cut){try{const s=await invoke('cut_status');$('cutProgress').value=s.progress;if(!s.running){state.cut=false;$('cutResult').textContent=s.output??s.error??'';notice(s.output?`動画を保存しました: ${s.output}`:s.error,Boolean(s.error));controls();}}catch(e){notice(String(e),true);}}
 if(active(state.job?.status)&&!state.upload&&!state.loading)refreshJob().catch(e=>notice(String(e),true));
},1500);
async function init(){
 await window.__TAURI__.event.listen('busy-close',event=>notice(event.payload,true));
 const boot=await invoke('bootstrap');state.projects=boot.projects;currentDirectory=boot.home;renderHistory();$('tools').textContent=boot.ffmpeg&&boot.ffprobe?`FFmpeg: ${boot.ffmpeg}`:'FFmpeg / FFprobeが見つかりません。';
 controls();await connect();
}
init().catch(e=>{notice(String(e),true);$('settings').hidden=false;});


let dialogueReady=false,transferBusy=false;
function stage(two){$('dialogue').hidden=!two;$('stageOne').setAttribute('aria-pressed',String(!two));$('stageTwo').setAttribute('aria-pressed',String(two));if(two)$('video').pause();else $('dialogue').contentWindow.postMessage({type:'tc-pause'},window.location.origin);}
action('stageOne',()=>stage(false));action('stageTwo',()=>stage(true));
action('handoff',async()=>{
 if(!dialogueReady)throw Error('工程2の準備中です。');
 if(transferBusy)return;if(!state.job||state.job.status!=='complete')throw Error('文字起こし完了後に引き継いでください。');
 await saveEdits();await loadSegments();if(!state.segments.length)throw Error('字幕がありません。');
 const result=makeExport({segments:state.segments,format:'vtt'});
 transferBusy=true;$('handoff').disabled=true;stage(true);
 $('dialogue').contentWindow.postMessage({type:'tc-transfer',payload:{vtt:result.text,name:state.media.path.split(/[\\/]/).at(-1)+'-'+state.job.id.slice(0,8)+'.vtt',mediaPath:state.media.path}},window.location.origin);
});
window.addEventListener('message',event=>{if(event.source!==$('dialogue').contentWindow||event.origin!==window.location.origin)return;if(event.data?.type==='tc-dialogue-ready')dialogueReady=true;if(event.data?.type==='tc-transfer-result'){transferBusy=false;$('handoff').disabled=false;notice(event.data.ok?'工程2へ追加しました。':event.data.error,!event.data.ok);}});

window.__TAURI__.event.listen('request-close',()=>{if(dialogueReady)$('dialogue').contentWindow.postMessage({type:'tc-close-request',dirty:state.dirty.size>0},window.location.origin);else if(!state.dirty.size)invoke('close_app').catch(e=>notice(String(e),true));else notice('字幕の変更を保存してから閉じてください。',true);});
window.addEventListener('message',event=>{if(event.source===$('dialogue').contentWindow&&event.origin===window.location.origin&&event.data?.type==='tc-close-approved')invoke('close_app').catch(e=>notice(String(e),true));});
