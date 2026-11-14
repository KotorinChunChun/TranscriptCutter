const $ = selector => document.querySelector(selector);
const video = $('video');
const controls = {prepare:$('#prepare'),haas:$('#run-haas'),nemotron:$('#run-nemotron'),both:$('#run-both'),stop:$('#stop')};
let prepared = null, busy = false, currentWorker = null, cancelRun = null, stopRequested = false, playUntil = null;
let runs = [], review = null;
const objectUrls = [];
const names = {haas:'Haas単独','nemotron-haas':'Nemotron＋Haas'};
const seconds = value => Number.isFinite(value) ? `${value.toFixed(2)}秒` : '—';
const shortTime = value => {const tenth=Math.max(0,Math.round(value*10)),whole=Math.floor(tenth/10);return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}.${tenth%10}`;};
function clock(value) {const ms=Math.max(0,Math.round(value*1000));return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
function node(tag,text,className) {const element=document.createElement(tag);if(text!=null)element.textContent=text;if(className)element.className=className;return element;}
function setStatus(message,fraction=null) {$('#status').textContent=message;const bar=$('#progress');if(Number.isFinite(fraction))bar.value=Math.min(1,Math.max(0,fraction));else bar.removeAttribute('value');}
function setBusy(value) {busy=value;controls.prepare.disabled=value;for(const key of ['haas','nemotron','both'])controls[key].disabled=value||!prepared;controls.stop.disabled=!value;}
function showError(error) {$('#error').textContent=error?.message??String(error);}
function playRange(start,end) {playUntil=Number.isFinite(end)&&end>start?end:null;video.currentTime=Math.max(0,start);void video.play().catch(showError);}
video.addEventListener('timeupdate',()=>{if(playUntil!=null&&video.currentTime>=playUntil){video.pause();playUntil=null;}});
video.addEventListener('seeking',()=>{if(playUntil!=null&&video.currentTime>playUntil+.1)playUntil=null;});
function timeButton(start,end) {const button=node('button',`${shortTime(start)}–${shortTime(end)}`,'time');button.title=`${clock(start)} → ${clock(end)} を再生`;button.addEventListener('click',()=>playRange(start,end));return button;}
const latest = mode => runs.filter(run=>run.mode===mode).at(-1);

async function prepareAudio() {
  if(busy)return;setBusy(true);controls.stop.disabled=true;$('#error').textContent='';setStatus('動画の音声を準備中');
  const started=performance.now();let context;
  try {
    const response=await fetch('./sample.mp4');if(!response.ok)throw Error(`動画の読込に失敗しました (${response.status})`);
    const source=await response.arrayBuffer();
    const hashBuffer=await crypto.subtle.digest('SHA-256',source);
    const sourceSha256=Array.from(new Uint8Array(hashBuffer),byte=>byte.toString(16).padStart(2,'0')).join('');
    context=new AudioContext({sampleRate:16000});
    const decodeStart=performance.now(),buffer=await context.decodeAudioData(source.slice(0));
    const audioDecodeSeconds=(performance.now()-decodeStart)/1000;
    if(buffer.sampleRate!==16000)throw Error(`音声のサンプルレートが16kHzになりませんでした (${buffer.sampleRate}Hz)`);
    const audio=new Float32Array(buffer.length);
    for(let channel=0;channel<buffer.numberOfChannels;channel++){const input=buffer.getChannelData(channel);for(let i=0;i<audio.length;i++)audio[i]+=input[i]/buffer.numberOfChannels;}
    if(!audio.length)throw Error('動画から音声を取り出せませんでした');
    prepared={audio,inputSeconds:audio.length/16000,sampleRate:16000,sourceSha256,sourceBytes:source.byteLength,audioDecodeSeconds,prepareSeconds:(performance.now()-started)/1000};
    $('#source-info').textContent=`動画 ${source.byteLength.toLocaleString()} bytes ／ 音声 ${seconds(prepared.inputSeconds)} ／ 準備 ${seconds(prepared.prepareSeconds)}（デコード ${seconds(audioDecodeSeconds)}）`;
    setStatus('音声の準備ができました',1);
  } catch(error) {showError(error);setStatus('音声を準備できませんでした',0);}
  finally {if(context)await context.close();setBusy(false);}
}

function workerRun(mode) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker('./worker.mjs',{type:'module'});currentWorker=worker;
    const finish=(error,result)=>{worker.terminate();if(currentWorker===worker)currentWorker=null;cancelRun=null;error?reject(error):resolve(result);};
    cancelRun=()=>finish(new DOMException('中止しました','AbortError'));
    worker.onmessage=({data})=>{
      if(data.action==='progress'){setStatus(`${names[mode]}：${data.message??data.stage??'処理中'}`,data.fraction);return;}
      if(data.action==='result')finish(null,data);
      else if(data.action==='error')finish(Error(data.message??'認識に失敗しました'));
    };
    worker.onerror=event=>finish(Error(event.message||'Workerでエラーが発生しました'));
    const audio=prepared.audio.slice();
    worker.postMessage({action:'run',mode,audio,inputSeconds:prepared.inputSeconds,audioDecodeSeconds:prepared.audioDecodeSeconds,sourceSha256:prepared.sourceSha256,sampleRate:16000},[audio.buffer]);
  });
}

async function execute(modes) {
  if(busy||!prepared)return;setBusy(true);stopRequested=false;$('#error').textContent='';
  try {
    for(const mode of modes) {
      if(stopRequested)break;setStatus(`${names[mode]}：実行を開始`,0);
      const result=await workerRun(mode);
      Object.assign(result,{sourceSha256:prepared.sourceSha256,sourceBytes:prepared.sourceBytes,audioDecodeSeconds:prepared.audioDecodeSeconds,prepareSeconds:prepared.prepareSeconds,observedAt:new Date().toISOString()});
      runs.push(result);render();
      try {const response=await fetch('./report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});if(!response.ok)throw Error(`HTTP ${response.status}`);$('#saved-state').textContent='このブラウザーで実行した結果を保存しました';}
      catch(error){$('#saved-state').textContent=`認識は完了しましたが、処理記録の保存に失敗しました：${error.message}`;}
    }
    setStatus(stopRequested?'中止しました':'認識が完了しました',stopRequested?0:1);
  } catch(error) {if(error.name==='AbortError')setStatus('中止しました',0);else{showError(error);setStatus('認識できませんでした',0);}}
  finally {currentWorker?.terminate();currentWorker=null;cancelRun=null;setBusy(false);}
}

function linkDownload(container,text,data,type,filename) {
  const url=URL.createObjectURL(new Blob([data],{type}));objectUrls.push(url);
  const anchor=node('a',text,'button');anchor.href=url;anchor.download=filename;container.append(anchor);
}
function vtt(run) {
  const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return 'WEBVTT\n\n'+(run.segments??[]).filter(segment=>segment.end>segment.start&&segment.text?.trim()).map((segment,index)=>`${index+1}\n${clock(segment.start)} --> ${clock(segment.end)}\n${escape(segment.text)}\n`).join('\n');
}
function renderMethod(mode,prefix) {
  const run=latest(mode),downloads=$(`#${prefix}-downloads`),transcript=$(`#${prefix}-transcript`);downloads.replaceChildren();transcript.replaceChildren();
  if(!run){transcript.append(node('p','実行結果がありません','empty'));return;}
  linkDownload(downloads,'VTT',vtt(run),'text/vtt;charset=utf-8',`${mode}-5min.vtt`);
  linkDownload(downloads,'処理記録JSON',JSON.stringify(run,null,2),'application/json',`${mode}-5min.json`);
  downloads.append(node('span',`${run.segments?.length??0}区間 ／ ${(run.segments??[]).reduce((sum,s)=>sum+(s.text??'').length,0)}文字`,'muted'));
  for(const segment of run.segments??[]) {const cue=node('div',null,'cue');cue.append(timeButton(segment.start,segment.end),node('p',segment.text||'（認識文字なし）'));transcript.append(cue);}
  if(!run.segments?.length)transcript.append(node('p','認識文字がありません','empty'));
}
function renderTiming() {
  const body=$('#timing-body');body.replaceChildren();
  for(const mode of ['haas','nemotron-haas']) {
    const run=latest(mode);if(!run)continue;
    const row=node('tr');row.append(node('td',names[mode],'method-name'));
    const processing=Number.isFinite(run.processingSeconds)?run.processingSeconds:Number.isFinite(run.totalSeconds)&&Number.isFinite(run.loadSeconds)?Math.max(0,run.totalSeconds-run.loadSeconds):null;
    for(const value of [run.loadSeconds,run.diarizationSeconds??0,run.regionSeconds??0,run.haasSeconds,processing,run.totalSeconds,run.retainedSeconds??run.inputSeconds])row.append(node('td',seconds(value)));
    body.append(row);
  }
  if(!body.childNodes.length){const row=node('tr'),cell=node('td','実行結果がありません');cell.colSpan=8;row.append(cell);body.append(row);}
  const a=latest('haas'),b=latest('nemotron-haas'),notes=['処理計はモデル読込を除く時間です。音声準備は両方式で共通に行い、別記します。'];
  if(a?.totalSeconds&&b?.totalSeconds)notes.push(`読込込み総時間：Nemotron＋HaasはHaas単独の${(b.totalSeconds/a.totalSeconds).toFixed(2)}倍。`);
  const last=runs.at(-1);if(last?.prepareSeconds)notes.push(`共通の音声準備 ${seconds(last.prepareSeconds)}（うちデコード ${seconds(last.audioDecodeSeconds)}）。`);
  $('#timing-note').textContent=notes.join(' ');
}
function renderRemoved() {
  const run=latest('nemotron-haas'),container=$('#removed');container.replaceChildren();
  $('#removed-summary').textContent=run?`NemotronがHaas入力から除外した区間：${run.removed?.length??0}件・計${seconds(run.removedSeconds)}`:'NemotronがHaas入力から除外した区間';
  for(const region of run?.removed??[])container.append(timeButton(region.start,region.end));
  if(!run?.removed?.length)container.append(node('p',run?'除外区間はありません':'実行後に表示します','muted'));
}
function renderReview() {
  $('#review-section').hidden=!review;const host=$('#review');host.replaceChildren();if(!review)return;
  if(typeof review==='string'){host.append(node('p',review));return;}
  if(review.summary)host.append(node('p',review.summary));
  const details=node('details'),container=node('div');
  details.append(node('summary','欠落・認識差の詳細と元動画の確認'),container);host.append(details);
  for(const item of review.notes??[])container.append(node('p',typeof item==='string'?item:JSON.stringify(item),'review-note'));
  for(const item of review.observations??[]) {
    const note=node('div',null,'review-note');
    if(Number.isFinite(item.start))note.append(timeButton(item.start,item.end));
    if(item.title)note.append(node('strong',item.title));
    for(const key of ['heard','haas','nemotron','finding','note'])if(item[key])note.append(node('p',`${({heard:'音声確認',haas:'Haas単独',nemotron:'Nemotron＋Haas',finding:'確認結果',note:'注記'})[key]}：${item[key]}`));
    container.append(note);
  }
  const known=new Set(['summary','notes','observations']);const other=Object.fromEntries(Object.entries(review).filter(([key])=>!known.has(key)));
  if(Object.keys(other).length){const details=node('details'),summary=node('summary','確認記録の詳細');details.append(summary,node('pre',JSON.stringify(other,null,2)));container.append(details);}
}
function render() {objectUrls.splice(0).forEach(url=>URL.revokeObjectURL(url));renderTiming();renderMethod('haas','haas');renderMethod('nemotron-haas','nemotron');renderRemoved();renderReview();}

controls.prepare.addEventListener('click',()=>void prepareAudio());
controls.haas.addEventListener('click',()=>void execute(['haas']));
controls.nemotron.addEventListener('click',()=>void execute(['nemotron-haas']));
controls.both.addEventListener('click',()=>void execute(['haas','nemotron-haas']));
controls.stop.addEventListener('click',()=>{stopRequested=true;cancelRun?.();});
let referenceLoaded=false;
$('#reference-details').addEventListener('toggle',async()=>{
  if(!$('#reference-details').open||referenceLoaded)return;referenceLoaded=true;
  try {
    const response=await fetch('./reference.vtt');if(!response.ok)throw Error(`照合用字幕を読めません (${response.status})`);
    const raw=await response.text(),container=$('#reference');container.replaceChildren();
    const stamp=text=>{const parts=text.replace(',','.').split(':').map(Number);return parts.reduce((value,part)=>value*60+part,0);};
    for(const block of raw.replaceAll('\r','').split(/\n\s*\n/)) {
      const lines=block.split('\n'),index=lines.findIndex(line=>line.includes(' --> '));if(index<0)continue;
      const match=lines[index].match(/([\d:.]+)\s+-->\s+([\d:.]+)/);if(!match)continue;
      const cue=node('div',null,'cue'),plain=lines.slice(index+1).join('\n').replace(/<v\s+([^>]+)>/g,'$1：').replace(/<[^>]+>/g,'');
      cue.append(timeButton(stamp(match[1]),stamp(match[2])),node('p',plain));container.append(cue);
    }
  }catch(error){$('#reference').replaceChildren(node('p',error.message));referenceLoaded=false;}
});
void fetch('./results.json',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(data=>{
  if(!data)return;runs=Array.isArray(data.runs)?data.runs:[];review=data.review??null;render();
  if(runs.length){setStatus('保存済みの実行結果を表示しています',1);$('#saved-state').textContent='以下は実行済み記録です。再実行する場合は音声を準備してください。';const source=runs.at(-1);$('#source-info').textContent=`音声 ${seconds(source.inputSeconds)} ／ 元動画SHA256 ${source.sourceSha256??'未記録'}`;}
}).catch(error=>{$('#saved-state').textContent=`保存済み結果を読めませんでした：${error.message}`;});
