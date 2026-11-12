export type MemorySample={bytes:number;kind:'js-heap-used';scope:'browser-context';method:'performance.memory';sampledAt:string};
export type ProcessingMetric={id:string;stage:string;scope:'browser';startedAt:string;durationSeconds:number;outcome:'complete'|'error'|'cancelled';memoryStart:MemorySample|null;memoryEnd:MemorySample|null;details:Record<string,unknown>};
const storageKey='transcript-cutter.processing-metrics.v1';
function restore():ProcessingMetric[]{try{if(typeof localStorage==='undefined')return [];const value=JSON.parse(localStorage.getItem(storageKey)??'[]');return Array.isArray(value)?value.filter(item=>item?.scope==='browser'&&typeof item.durationSeconds==='number'&&Number.isFinite(item.durationSeconds)).slice(-1000):[];}catch{return [];}}
const records:ProcessingMetric[]=restore();
export function sampleMemory():MemorySample|null{
 const memory=(performance as Performance&{memory?:{usedJSHeapSize?:number}}).memory,bytes=memory?.usedJSHeapSize;
 return typeof bytes==='number'&&Number.isFinite(bytes)&&bytes>=0?{bytes,kind:'js-heap-used',scope:'browser-context',method:'performance.memory',sampledAt:new Date().toISOString()}:null;
}
export function beginMetric(stage:string,details:Record<string,unknown>={}){
 const start=performance.now(),startedAt=new Date().toISOString(),memoryStart=sampleMemory();let ended=false;
 return (outcome:ProcessingMetric['outcome']='complete',extra:Record<string,unknown>={})=>{
  if(ended)return;ended=true;
  const metric:ProcessingMetric={id:crypto.randomUUID(),stage,scope:'browser',startedAt,durationSeconds:Math.max(0,(performance.now()-start)/1000),outcome,memoryStart,memoryEnd:sampleMemory(),details:{...details,...extra}};
  records.push(metric);if(records.length>1000)records.shift();try{if(typeof localStorage!=='undefined')localStorage.setItem(storageKey,JSON.stringify(records));}catch{/* Manual JSON export remains available when browser storage is full or disabled. */}return metric;
 };
}
export async function measure<T>(stage:string,details:Record<string,unknown>,work:()=>Promise<T>):Promise<T>{
 const finish=beginMetric(stage,details);try{const result=await work();finish();return result;}catch(error){finish(error instanceof DOMException&&error.name==='AbortError'?'cancelled':'error');throw error;}
}
export function processingMetrics(){return structuredClone(records);}
export function saveProcessingMetrics(){
 const blob=new Blob([JSON.stringify({schemaVersion:1,recordedAt:new Date().toISOString(),memoryNote:'memoryStart/memoryEnd are optional JS heap snapshots, not process/GPU/peak memory. null means unmeasured.',records:processingMetrics()},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`TranscriptCutter-processing-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
