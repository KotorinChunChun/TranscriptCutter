import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
type Item={label:string;disabled?:boolean;run:()=>void};
export function AddMenu({items,disabled=false,label='字幕・列を追加'}:{items:Item[];disabled?:boolean;label?:string}){
 const [position,setPosition]=useState<{top:number;right:number}|null>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!position)return;
  const close=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setPosition(null);};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setPosition(null);trigger.current?.focus();}};
  window.addEventListener('pointerdown',close);window.addEventListener('keydown',key,true);
  menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key,true);};
 },[position]);
 return <><button ref={trigger} className="comparison-plus" aria-label={label} aria-haspopup="menu" aria-expanded={!!position} disabled={disabled} onClick={()=>{const box=trigger.current!.getBoundingClientRect();setPosition(position?null:{top:box.bottom+4,right:Math.max(8,innerWidth-box.right)});}}>＋</button>{position&&createPortal(<div ref={menu} className="comparison-add-menu" role="menu" aria-label="追加する内容" style={position} onKeyDown={event=>{
  if(event.key==='Tab'){setPosition(null);return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const buttons=Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
 }}>{items.map(item=><button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={()=>{setPosition(null);trigger.current?.focus();item.run();}}>{item.label}</button>)}</div>,document.body)}</>;
}
