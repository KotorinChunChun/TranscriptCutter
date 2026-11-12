import type {Job} from './speech-client';
import {serverMeasurements} from './measurement-state';
export function ServerMeasurements({job}:{job:Job}){
 const rows=serverMeasurements(job);if(!rows.length)return null;
 return <details className="stage-measurements"><summary>工程別の時間・メモリ</summary><table><thead><tr><th>工程</th><th>所要時間</th><th>採取した最大メモリ</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.id+'-'+index}><td>{row.label}</td><td>{row.seconds===null?'未計測':row.seconds.toFixed(2)+'秒'}</td><td>{row.bytes===null?'未計測':(row.bytes/1024**2).toFixed(1)+' MiB'}</td></tr>)}</tbody></table><small>メモリの測定対象・採取条件は処理記録に保存します。</small></details>;
}
