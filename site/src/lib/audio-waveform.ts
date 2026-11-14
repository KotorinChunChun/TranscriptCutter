import {ALL_FORMATS,Input,BlobSource,AudioBufferSink} from 'mediabunny';
import type {TimeRange} from './timeline-review';
import {measure} from '../../processing-metrics';
export type Waveform={peaks:number[];start:number;end:number};
/** Decode only the requested source range, not the full recording. */
export async function loadAudioWaveform(file:File,range:TimeRange,signal:AbortSignal):Promise<Waveform>{
 return measure('cut-waveform',{fileName:file.name,range},async()=>{
  if(range.end<=range.start||range.end-range.start>120000)throw Error('波形は2分以内の区間を選択してください。');
  const check=()=>{if(signal.aborted)throw new DOMException('波形生成を中断しました。','AbortError');};
  check();const input=new Input({formats:ALL_FORMATS,source:new BlobSource(file)});
  try{
   const track=await input.getPrimaryAudioTrack();check();
   if(!track||!await track.canDecode())throw Error('この音声形式の波形を読み取れません。');
   const sink=new AudioBufferSink(track),bins=Math.min(4096,Math.max(1,Math.ceil((range.end-range.start)/5))),peaks=new Float32Array(bins),from=range.start/1000,to=range.end/1000;
   for await(const part of sink.buffers(from,to)){
    check();const buffer=part.buffer,left=Math.max(0,Math.ceil((from-part.timestamp)*buffer.sampleRate)),right=Math.min(buffer.length,Math.ceil((to-part.timestamp)*buffer.sampleRate));
    for(let channel=0;channel<buffer.numberOfChannels;channel++){
     const pcm=buffer.getChannelData(channel);
     for(let i=left;i<right;i++){const index=Math.floor((part.timestamp+i/buffer.sampleRate-from)/(to-from)*bins);if(index>=0&&index<bins)peaks[index]=Math.max(peaks[index],Math.abs(pcm[i]));}
    }
    await new Promise<void>(resolve=>setTimeout(resolve,0));
   }
   check();return {peaks:Array.from(peaks),start:range.start,end:range.end};
  }finally{input.dispose();}
 });
}
