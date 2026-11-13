import type {Model} from './speech-client';

const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const text=(v:unknown)=>typeof v==='string'?v.trim().slice(0,2000):'';

/** Historical output-character throughput is neither audio speed nor an ETA input. */
export function modelReferenceSpeed(model:Model|undefined):{summary:string;details:string[]}{
 const info=object(model?.x_meeting.modelInfo);
 if(!info||info.id!==model?.id)return {summary:'参考速度：未提供',details:[]};
 const speed=object(info.referenceSpeed);
 if(!speed||speed.kind!=='historical_measurement'||speed.unit!=='characters/s'||!positive(speed.runSeconds)||!positive(speed.characters)||!positive(speed.charactersPerSecond))return {summary:'参考速度：未測定',details:[]};
 const rate=speed.characters/speed.runSeconds;
 if(Math.abs(rate-speed.charactersPerSecond)>Math.max(0.001,rate*0.001))return {summary:'参考速度：未測定',details:[]};
 const details=[
  '測定CPU：'+(text(speed.cpu)||'未提供'),
  '実行方式：'+(text(speed.device)||'未提供')+'・サーバー版：'+(text(speed.serverVersion)||'未提供'),
  '条件：'+(text(speed.condition)||'未提供'),
  `出力 ${speed.characters}文字 ／ 処理 ${speed.runSeconds}秒`,
  text(speed.definition)||'空白を除く出力文字数 ÷ 処理秒数（待機を除く）',
  text(speed.caution)||'過去の測定です。現在の接続先の速度保証や同条件のモデル比較ではありません。',
 ];
 return {summary:`参考速度：${rate.toFixed(1)}文字/秒（過去の測定）`,details};
}
