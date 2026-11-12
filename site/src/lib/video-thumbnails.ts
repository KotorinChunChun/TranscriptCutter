import {thumbnailTimes,compareFrames,type TimeRange,type FrameDifference} from './timeline-review';
import {measure} from '../../processing-metrics';
export type Thumbnail=TimeRange & {url:string};
const aborted=()=>new DOMException('画像生成を中断しました。','AbortError');
async function generateThumbnailsImpl(file:File,range:TimeRange,signal:AbortSignal,onFrame:(frame:Thumbnail,done:number,total:number)=>void):Promise<FrameDifference[]>{
 const video=document.createElement('video'),source=URL.createObjectURL(file);video.muted=true;video.playsInline=true;video.preload='auto';
 const wait=(event:string,begin?:()=>void)=>new Promise<void>((resolve,reject)=>{
  const finish=(error?:unknown)=>{clearTimeout(timer);video.removeEventListener(event,ready);video.removeEventListener('error',fail);signal.removeEventListener('abort',cancel);error?reject(error):resolve();};
  const ready=()=>finish(),fail=()=>finish(Error('映像を読み取れません。このブラウザーの対応形式を確認してください。')),cancel=()=>finish(aborted());
  const timer=setTimeout(()=>finish(Error('映像の読み込みがタイムアウトしました。')),20000);video.addEventListener(event,ready,{once:true});video.addEventListener('error',fail,{once:true});signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}try{begin?.();}catch(error){finish(error);}
 });
 try{
  await wait('loadeddata',()=>{video.src=source;video.load();});
  if(!video.videoWidth||!Number.isFinite(video.duration)||range.end>video.duration*1000+2)throw Error('映像の長さ・対象区間を確認してください。');
  const times=thumbnailTimes(range),canvas=document.createElement('canvas');canvas.width=160;canvas.height=Math.max(1,Math.round(160*video.videoHeight/video.videoWidth));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('画像を生成できません。');
  let previous:Uint8ClampedArray|null=null;const differences:FrameDifference[]=[];
  for(let i=0;i<times.length;i++){
   if(signal.aborted)throw aborted();const time=times[i]/1000;
   if(Math.abs(video.currentTime-time)>0.0001)await wait('seeked',()=>{video.currentTime=time;});
   if(signal.aborted)throw aborted();ctx.drawImage(video,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   if(previous)differences.push(compareFrames(previous,pixels));previous=pixels;
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('画像を生成できません。')),'image/webp',0.8));if(signal.aborted)throw aborted();
   const url=URL.createObjectURL(blob);try{onFrame({start:times[i],end:Math.min(times[i]+1000,range.end),url},i+1,times.length);}catch(error){URL.revokeObjectURL(url);throw error;}
  }
  return differences;
 }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(source);}
}
export function generateThumbnails(...args:Parameters<typeof generateThumbnailsImpl>){return measure('thumbnails-and-visual-analysis',{fileName:args[0].name,range:args[1]},()=>generateThumbnailsImpl(...args));}
