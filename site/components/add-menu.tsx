import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {menuPosition} from '../menu-position';
type Item={label:string;disabled?:boolean;run:()=>void};
export function AddMenu({items,disabled=false,label='字幕・列を追加'}:{items:Item[];disabled?:boolean;label?:string}){
 const [open,setOpen]=useState(false),[position,setPosition]=useState<ReturnType<typeof menuPosition>|null>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const closeMenu=()=>{setOpen(false);setPosition(null);};
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{if(!trigger.current||!menu.current)return;const next=menuPosition(trigger.current.getBoundingClientRect(),{width:menu.current.offsetWidth,height:menu.current.scrollHeight+2},{width:innerWidth,height:innerHeight});setPosition(old=>old&&Object.keys(next).every(key=>old[key as keyof typeof next]===next[key as keyof typeof next])?old:next);};
  place();const observer=new ResizeObserver(place);observer.observe(menu.current!);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open]);
 useEffect(()=>{
  if(!open)return;
  const close=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))closeMenu();};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu();trigger.current?.focus();}};
  window.addEventListener('pointerdown',close);window.addEventListener('keydown',key,true);
  menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key,true);};
 },[open]);
 return <><button ref={trigger} className="comparison-plus" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={()=>{if(open)closeMenu();else setOpen(true);}}>＋</button>{open&&createPortal(<div ref={menu} className="comparison-add-menu" role="menu" aria-label="追加する内容" style={{...position,left:position?.left??8,top:position?.top??8,visibility:position?'visible':'hidden',minWidth:Math.min(150,Math.max(0,innerWidth-16)),overflowY:'auto'}} onKeyDown={event=>{
  if(event.key==='Tab'){closeMenu();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const buttons=Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
 }}>{items.map(item=><button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={()=>{closeMenu();trigger.current?.focus();item.run();}}>{item.label}</button>)}</div>,document.body)}</>;
}
