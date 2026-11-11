type Tauri = {core:{invoke:<T=any>(name:string,args?:object)=>Promise<T>;convertFileSrc:(path:string)=>string}};
const tauri=()=> (window as any).__TAURI__ as Tauri;
export const invoke=<T=any>(name:string,args:object={})=>tauri().core.invoke<T>(name,args);
export type DesktopFile=File & {desktopPath?:string;desktopUrl?:string;durationMs?:number};
function dialog(title:string){
 const el=document.createElement('dialog');el.className='desktop-dialog';
 const heading=document.createElement('h2');heading.textContent=title;el.append(heading);document.body.append(el);el.showModal();
 return el;
}
function button(label:string,fn:()=>void){const b=document.createElement('button');b.textContent=label;b.onclick=fn;return b;}
export function confirmAction(message:string):Promise<boolean>{return new Promise(resolve=>{
 const el=dialog('確認');const p=document.createElement('p');p.textContent=message;el.append(p);
 const done=(yes:boolean)=>{el.close();el.remove();resolve(yes);};
 el.append(button('キャンセル',()=>done(false)),button('続ける',()=>done(true)));el.oncancel=e=>{e.preventDefault();done(false);};
});}
export async function choosePaths(mode:'subtitle'|'media'|'directory',multiple=false):Promise<string[]>{
 const boot=await invoke('bootstrap');
 return new Promise(resolve=>{
  const el=dialog(mode==='directory'?'保存先を選択':mode==='media'?'動画・音声を選択':'VTT・プロジェクトを選択');
  const path=document.createElement('input');path.setAttribute('aria-label','フォルダー');path.value=boot.home;
  const message=document.createElement('p'),list=document.createElement('div');list.className='desktop-entries';let current='',parent='';const selected=new Set<string>();
  const done=(paths:string[])=>{el.close();el.remove();resolve(paths);};
  const browse=async(value:string)=>{try{const data=await invoke('browse',{path:value});current=data.path;parent=data.parent??'';path.value=current;list.replaceChildren();message.textContent='';
   for(const entry of data.entries){if(!entry.directory&&(mode==='directory'||!(mode==='subtitle'?/\.(vtt|json)$/i:/\.(mp4|mov|mkv|webm|avi|m4v|wmv|mts|m2ts|wav|mp3|m4a|ogg|flac|aac)$/i).test(entry.name)))continue;
    const b=button((entry.directory?'▸ ':'')+entry.name,()=>{if(entry.directory){void browse(entry.path);return;}if(!multiple){done([entry.path]);return;}if(selected.has(entry.path))selected.delete(entry.path);else selected.add(entry.path);b.classList.toggle('selected',selected.has(entry.path));message.textContent=`${selected.size}件 選択`;});b.classList.toggle('selected',selected.has(entry.path));list.append(b);
   }
  }catch(error){message.textContent=String(error);}};
  el.append(path,button('移動',()=>void browse(path.value)),button('上へ',()=>void browse(parent)),button('ドライブ',()=>void browse('')),message,list);
  if(mode==='directory'||multiple)el.append(button('選択を確定',()=>{if(mode==='directory'){if(current)done([current]);}else if(selected.size)done([...selected]);}));
  el.append(button('キャンセル',()=>done([])));el.oncancel=e=>{e.preventDefault();done([]);};path.onkeydown=e=>{if(e.key==='Enter')void browse(path.value);};void browse(path.value);
 });
}
export async function readSubtitle(path:string){const data=await invoke('read_subtitle',{path});return new File([data.text],data.name,{type:/\.vtt$/i.test(data.name)?'text/vtt':'application/json'});}
export async function mediaFile(path:string):Promise<DesktopFile>{
 const info=await invoke('inspect_dialogue_media',{path});const url=tauri().core.convertFileSrc(info.path);
 const file=new File([],info.path.split(/[\\/]/).at(-1),{type:info.width?'video/mp4':'audio/wav'}) as DesktopFile;
 Object.defineProperty(file,'size',{value:info.bytes});
 file.desktopPath=info.path;file.desktopUrl=url;file.durationMs=Math.round(info.duration*1000);
 file.arrayBuffer=async()=>{const r=await fetch(url);if(!r.ok)throw Error('メディアを読み込めません。');return r.arrayBuffer();};
 file.slice=(start=0,end=info.bytes,type='')=>({arrayBuffer:async()=>{const r=await fetch(url,{headers:{Range:`bytes=${start}-${end-1}`}});if(!r.ok)throw Error('メディアを読み込めません。');const bytes=await r.arrayBuffer();return r.status===206?bytes:bytes.slice(start,end);},size:end-start,type}) as Blob;
 return file;
}
export async function saveText(name:string,text:string){
 const dirs=await choosePaths('directory');if(!dirs.length)return null;
 const el=dialog('保存名');const input=document.createElement('input');input.value=name;input.setAttribute('aria-label','保存名');el.append(input);
 return new Promise<string|null>(resolve=>{
  const done=(result:string|null)=>{el.close();el.remove();resolve(result);};const error=document.createElement('p');el.append(error);
  el.append(button('保存',()=>{void (async()=>{try{const match=/^(.*)\.(vtt|srt|txt|json|csv)$/i.exec(input.value.trim());if(!match)throw Error('拡張子を確認してください。');const result=await invoke<string>('export_text',{dir:dirs[0],name:match[1],extension:match[2].toLowerCase(),text});done(result);}catch(e){error.textContent=String(e);}})();}),button('キャンセル',()=>done(null)));
  el.oncancel=e=>{e.preventDefault();done(null);};
 });
}
