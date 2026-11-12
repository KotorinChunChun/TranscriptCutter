function dialog(title:string){const el=document.createElement('dialog');el.className='desktop-dialog';const h=document.createElement('h2');h.textContent=title;el.append(h);document.body.append(el);el.showModal();return el;}
function button(text:string,fn:()=>void){const b=document.createElement('button');b.textContent=text;b.onclick=fn;return b;}
export function confirmAction(message:string):Promise<boolean>{return new Promise(resolve=>{const el=dialog('確認'),p=document.createElement('p');p.textContent=message;el.append(p);const done=(v:boolean)=>{el.close();el.remove();resolve(v);};el.append(button('キャンセル',()=>done(false)),button('続ける',()=>done(true)));el.oncancel=e=>{e.preventDefault();done(false);};});}
export const fileKey=(file:File)=>`${file.name}:${file.size}:${file.lastModified}`;
