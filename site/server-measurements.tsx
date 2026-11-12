import type {Job} from './speech-client';
export function serverMeasurements(job:Job){
 const measurements=job.metadata?.measurements as {stages?:unknown[]}|undefined;
 if(!Array.isArray(measurements?.stages))return [];
 return measurements.stages.filter(value=>value&&typeof value==='object').map(value=>{
  const stage=value as Record<string,unknown>,memory=stage.memory as Record<string,unknown>|null;
  const seconds=typeof stage.elapsedSeconds==='number'&&Number.isFinite(stage.elapsedSeconds)&&stage.elapsedSeconds>=0?stage.elapsedSeconds:null;
  const bytes=memory?.unit==='bytes'&&typeof memory.peakBytes==='number'&&Number.isFinite(memory.peakBytes)&&memory.peakBytes>=0?memory.peakBytes:null;
  return {id:String(stage.id??stage.stage??''),label:String(stage.label??stage.stage??'工程'),status:String(stage.status??''),seconds,bytes,scope:memory?.scope,metric:memory?.metric,sampleCount:memory?.sampleCount};
 });
}
export function ServerMeasurements({job}:{job:Job}){
 const rows=serverMeasurements(job);if(!rows.length)return null;
 return <details className="stage-measurements"><summary>工程別の時間・メモリ</summary><table><thead><tr><th>工程</th><th>所要時間</th><th>採取した最大メモリ</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.id+'-'+index}><td>{row.label}</td><td>{row.seconds===null?'未計測':row.seconds.toFixed(2)+'秒'}</td><td>{row.bytes===null?'未計測':(row.bytes/1024**2).toFixed(1)+' MiB'}{row.bytes!==null&&<small> {String(row.scope??'対象未記載')} / {String(row.metric??'方式未記載')}</small>}</td></tr>)}</tbody></table></details>;
}
