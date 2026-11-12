import type {Model} from './speech-client';
export type SpeechPreferences={modelId:string;mode:string;devices:Record<string,string>};
const empty=():SpeechPreferences=>({modelId:'',mode:'none',devices:{}});
const local=()=>{try{return globalThis.localStorage;}catch{return undefined;}};
const key=(url:string)=>{const u=new URL(url);if(u.username||u.password)throw Error('接続先に資格情報を含めないでください。');return 'tc-speech-preferences-v1:'+u.origin+u.pathname.replace(/\/$/,'');};
export function loadSpeechPreferences(url:string,storage:Pick<Storage,'getItem'>|undefined=local()):SpeechPreferences{
 try{const raw=JSON.parse(storage?.getItem(key(url))??'null');if(!raw||typeof raw.modelId!=='string'||typeof raw.mode!=='string')return empty();const devices:Record<string,string>={};for(const [id,value] of Object.entries(raw.devices??{}))if(typeof value==='string'&&id!=='__proto__'&&id!=='constructor')devices[id]=value;return {modelId:raw.modelId,mode:raw.mode,devices};}catch{return empty();}
}
export function saveSpeechPreferences(url:string,value:SpeechPreferences,storage:Pick<Storage,'setItem'>|undefined=local()){try{storage?.setItem(key(url),JSON.stringify(value));}catch{/* Storage restrictions must not block recognition. */}}
export function processingChoice(model:Model|undefined,preferred?:string){const x=model?.x_meeting;return x?.processingMethods.find(p=>p.id===preferred)?.id??x?.processingMethods.find(p=>p.id===x.defaultProcessingMethod)?.id??x?.processingMethods[0]?.id??'';}
export function speakerModes(models:readonly Model[]){
 const modes=new Map([['none',{id:'none',label:'話者識別なし',integrated:false}]]);
 for(const m of models){const x=m.x_meeting;if(x.integratedDiarization)modes.set('integrated:'+m.id,{id:'integrated:'+m.id,label:`${x.label}（一体型）`,integrated:true});else if(x.diarization){const id='separate:'+(x.diarizationModel??'server-default');modes.set(id,{id,label:x.diarizationLabel??'サーバー既定',integrated:false});}}
 return [...modes.values()];
}
export function modelsForSpeakerMode(models:readonly Model[],mode:string){return models.filter(m=>mode.startsWith('integrated:')?m.id===mode.slice(11):!m.x_meeting.integratedDiarization&&(mode==='none'||m.x_meeting.diarization&&mode==='separate:'+(m.x_meeting.diarizationModel??'server-default')));}
