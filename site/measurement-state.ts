import type {Job} from './speech-client';
export function serverMeasurements(job:Job){
 const measurements=job.metadata?.measurements as {stages?:unknown[]}|undefined;
 if(!Array.isArray(measurements?.stages))return [];
 return measurements.stages.filter(value=>value&&typeof value==='object').map(value=>{
  const stage=value as Record<string,unknown>,memory=stage.memory as Record<string,unknown>|null;
  const seconds=typeof stage.elapsedSeconds==='number'&&Number.isFinite(stage.elapsedSeconds)&&stage.elapsedSeconds>=0?stage.elapsedSeconds:null;
  const bytes=memory?.unit==='bytes'&&typeof memory.sampleCount==='number'&&memory.sampleCount>0&&typeof memory.peakBytes==='number'&&Number.isFinite(memory.peakBytes)&&memory.peakBytes>=0?memory.peakBytes:null;
  return {id:String(stage.id??stage.stage??''),label:String(stage.label??stage.stage??'工程'),status:String(stage.status??''),seconds,bytes,scope:memory?.scope,metric:memory?.metric,sampleCount:memory?.sampleCount};
 });
}
