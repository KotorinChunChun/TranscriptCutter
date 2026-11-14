import {useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
type Item={label:string;disabled?:boolean;run:()=>void};
export function TranscriptContextMenu({x,y,items,onClose}:{x:number;y:number;items:Item[];onClose:()=>void}){
 const root=useRef<HTMLDivElement>(null),[position,setPosition]=useState({left:x,top:y});
 useLayoutEffect(()=>{
  const menu=root.current!;const box=menu.getBoundingClientRect();
  setPosition({left:Math.max(4,Math.min(x,innerWidth-box.width-4)),top:Math.max(4,Math.min(y,innerHeight-box.height-4))});
  (menu.querySelector<HTMLButtonElement>('button:not(:disabled)')??menu).focus({preventScroll:true});
  const outside=(e:PointerEvent)=>{if(!menu.contains(e.target as Node))onClose();};
  const scroll=(e:Event)=>{if(!menu.contains(e.target as Node))onClose();};
  window.addEventListener('pointerdown',outside,true);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',onClose);
  return()=>{window.removeEventListener('pointerdown',outside,true);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',onClose);};
 },[x,y,onClose]);
 return createPortal(<div ref={root} className="transcript-context-menu" role="menu" aria-label="字幕の操作" tabIndex={-1} style={position} onPointerDown={e=>e.preventDefault()} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{
  e.stopPropagation();if(e.key==='Escape'||e.key==='Tab'){if(e.key==='Escape')e.preventDefault();onClose();return;}
  if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
  e.preventDefault();const buttons=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
 }}>{items.map(item=><button key={item.label} role="menuitem" disabled={item.disabled} onClick={()=>{item.run();onClose();}}>{item.label}</button>)}</div>,document.body);
}
