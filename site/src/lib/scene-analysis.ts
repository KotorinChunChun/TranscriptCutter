import {findSceneBoundaries} from './scene-boundaries';
import type {TimeRange} from './timeline-review';
import {measure} from '../../processing-metrics';

export async function analyzeSceneBoundaries(file:File,range:TimeRange,signal:AbortSignal,progress:(fraction:number)=>void){
 return measure('gap-scene-boundaries',{fileName:file.name,range},async()=>{
  const video=document.createElement('video'),url=URL.createObjectURL(file);video.muted=true;video.playsInline=true;video.preload='auto';
  const wait=(event:string,begin:()=>void)=>new Promise<void>((resolve,reject)=>{
   const finish=(e?:unknown)=>{clearTimeout(timer);video.removeEventListener(event,ready);video.removeEventListener('error',fail);signal.removeEventListener('abort',cancel);e?reject(e):resolve();};
   const ready=()=>finish(),fail=()=>finish(Error('映像を読み取れません。')),cancel=()=>finish(new DOMException('映像解析を中断しました。','AbortError'));
   const timer=setTimeout(()=>finish(Error('映像の読込がタイムアウトしました。')),20000);
   video.addEventListener(event,ready,{once:true});video.addEventListener('error',fail,{once:true});signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}try{begin();}catch(e){finish(e);}
  });
  try{
   await wait('loadeddata',()=>{video.src=url;video.load();});
   if(!video.videoWidth||!Number.isFinite(video.duration)||range.end>video.duration*1000+2)throw Error('映像がないか、空白区間が動画の長さを超えています。');
   const canvas=document.createElement('canvas');canvas.width=160;canvas.height=Math.max(1,Math.round(160*video.videoHeight/video.videoWidth));
   const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('映像を解析できません。');
   return await findSceneBoundaries(range,async ms=>{
    if(Math.abs(video.currentTime-ms/1000)>.0001)await wait('seeked',()=>{video.currentTime=ms/1000;});
    ctx.drawImage(video,0,0,canvas.width,canvas.height);return ctx.getImageData(0,0,canvas.width,canvas.height).data;
   },signal,progress);
  }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
 });
}
