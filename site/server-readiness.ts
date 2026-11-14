import type {Model} from './speech-client';

export type ServerHealth={ready?:boolean;acceptingJobs?:boolean;startupState?:string;reason?:string;preparation?:{targetLabel?:string;phase?:string;message?:string;receivedBytes?:number;totalBytes?:number}};
export function serverAcceptsJobs(health:ServerHealth){return health.ready!==false&&health.acceptingJobs!==false&&health.startupState!=='preparing';}

// modelInfo is the server's current inspection; the outer catalog can still list a weight
// whose runtime exists but which is not usable (e.g. missing FFmpeg or pending repair).
export function usableModel(model:Model){
 const x=model.x_meeting,info=x?.modelInfo;
 const state=info&&typeof info==='object'?info as Record<string,unknown>:x;
 if(!state||state.supported===false)return false;
 if(['available','runtimeReady','modelInstalled'].some(key=>key in state))return state.available===true&&state.runtimeReady===true&&state.modelInstalled===true;
 return ['installed','ready'].includes(String(state.availability))&&!['restart_required','runtime_error','unsupported'].includes(String(state.managementState));
}

export function preparationProgress(health:ServerHealth){
 const p=health.preparation,preparing=health.startupState==='preparing',blocked=preparing||health.acceptingJobs===false;
 const fraction=p?.phase==='download'&&Number.isFinite(p.receivedBytes)&&Number.isFinite(p.totalBytes)&&p.totalBytes!>0?Math.max(0,Math.min(1,p.receivedBytes!/p.totalBytes!)):undefined;
 const phases:Record<string,string>={download:'取得中',extract:'展開中',verify:'検証中',install:'導入中',activate:'反映中'};
 const label=[preparing?'サーバー準備中':'サーバー受付停止中',p?.targetLabel,p?.phase?phases[p.phase]??'処理中':null,fraction===undefined?null:`${Math.round(fraction*100)}%`].filter(Boolean).join(' · ');
 return {blocked,label,fraction,message:p?.message||health.reason||''};
}
