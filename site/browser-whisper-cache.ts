import type {BrowserWhisperModel} from './browser-whisper-config';

export function isWhisperModelCacheUrl(value:string,model:BrowserWhisperModel,origin:string):boolean {
  try{const url=new URL(value);return url.origin===origin&&url.pathname.startsWith(`/__tc-whisper/${model.id}/`)
    ||url.origin==='https://huggingface.co'&&url.pathname.startsWith(`/${model.repo}/`);}catch{return false;}
}
export async function removeWhisperModelCache(cache:Pick<Cache,'keys'|'delete'>,model:BrowserWhisperModel,origin:string):Promise<number> {
  let count=0;
  for(const request of await cache.keys())if(isWhisperModelCacheUrl(request.url,model,origin)&&await cache.delete(request))count++;
  return count;
}
