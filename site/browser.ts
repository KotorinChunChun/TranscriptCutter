function dialog(title:string){const el=document.createElement('dialog');el.className='desktop-dialog';const h=document.createElement('h2');h.textContent=title;el.append(h);document.body.append(el);el.showModal();return el;}
function button(text:string,fn:()=>void){const b=document.createElement('button');b.textContent=text;b.onclick=fn;return b;}
export function confirmAction(message:string):Promise<boolean>{return new Promise(resolve=>{const el=dialog('確認'),p=document.createElement('p');p.textContent=message;el.append(p);const done=(v:boolean)=>{el.close();el.remove();resolve(v);};el.append(button('キャンセル',()=>done(false)),button('続ける',()=>done(true)));el.oncancel=e=>{e.preventDefault();done(false);};});}
export function chooseFiles(mode:'subtitle'|'media',multiple=false):Promise<File[]>{return new Promise(resolve=>{
 const el=dialog(mode==='media'?'動画・音声を読み込む':'VTT・プロジェクトを読み込む');
 const zone=document.createElement('div');zone.className='file-drop-zone';zone.tabIndex=0;zone.setAttribute('aria-label','ファイルのドロップ領域');zone.textContent=mode==='media'?'動画・音声をここへドロップ':'VTT・プロジェクトをここへドロップ';
 const message=document.createElement('p');message.setAttribute('role','status');let files:File[]=[];
 const accept=(incoming:File[])=>{const valid=incoming.every(f=>mode==='subtitle'?/\.(vtt|json)$/i.test(f.name):/\.(mp4|mov|mkv|webm|avi|m4v|wmv|mts|m2ts|wav|mp3|m4a|ogg|flac|aac)$/i.test(f.name));if(!valid||(!multiple&&incoming.length!==1)){message.textContent='ファイルの形式・件数を確認してください。';return;}files=incoming;message.textContent=files.map(f=>f.name).join('\n');};
 zone.ondragover=e=>{e.preventDefault();};zone.ondrop=e=>{e.preventDefault();e.stopPropagation();accept(Array.from(e.dataTransfer?.files??[]));};
 // Also supports browser automation and accessible file delivery without opening an OS picker.
 const input=document.createElement('input');input.type='file';input.multiple=multiple;input.hidden=true;input.className='drop-input';input.accept=mode==='subtitle'?'.vtt,.json':'video/*,audio/*';input.onchange=()=>accept(Array.from(input.files??[]));
 const done=(value:File[])=>{el.close();el.remove();resolve(value);};el.append(zone,input,message);
 if(mode==='subtitle'){const text=document.createElement('textarea');text.setAttribute('aria-label','VTTを貼り付け');text.placeholder='WEBVTT';el.append(text,button('貼り付けたVTTを読み込む',()=>{if(!text.value.trim())return;done([new File([text.value],'貼付字幕.vtt',{type:'text/vtt'})]);}));}
 el.append(button('読み込む',()=>{if(files.length)done(files);}),button('キャンセル',()=>done([])));el.oncancel=e=>{e.preventDefault();done([]);};
});}
export const fileKey=(file:File)=>`${file.name}:${file.size}:${file.lastModified}`;
