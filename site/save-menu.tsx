import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {saveProcessingMetrics} from './processing-metrics';

type SaveOption={id:string;label:string;description:string;disabled?:boolean;run:()=>void};
const requestEvent='tc-request-save-options',changedEvent='tc-save-options-changed';
export function useSaveOptions(active:boolean,options:SaveOption[]){
 const latest=useRef(options);latest.current=options;
 useEffect(()=>{if(!active)return;const listener=(event:Event)=>{(event as CustomEvent<SaveOption[]>).detail.push(...latest.current);};window.addEventListener(requestEvent,listener);return()=>window.removeEventListener(requestEvent,listener);},[active]);
 useEffect(()=>{if(active)window.dispatchEvent(new Event(changedEvent));});
}
function collect(){
 const options:SaveOption[]=[];window.dispatchEvent(new CustomEvent(requestEvent,{detail:options}));
 return [...options,{id:'metrics',label:'処理計測記録（JSON）',description:'各工程の処理時間・取得できたメモリ情報',run:saveProcessingMetrics}];
}
export function SaveMenu({stage}:{stage:number}){
 const [open,setOpen]=useState(false),[options,setOptions]=useState<SaveOption[]>([]);
 const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const refresh=useCallback(()=>setOptions(collect()),[]);
 useEffect(()=>setOpen(false),[stage]);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpen(false);};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}};
  window.addEventListener('pointerdown',outside);window.addEventListener('keydown',key,true);window.addEventListener(changedEvent,refresh);
  menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',key,true);window.removeEventListener(changedEvent,refresh);};
 },[open,refresh]);
 return <><button ref={trigger} className="workflow-save" title="保存する内容を選択" aria-haspopup="menu" aria-expanded={open} aria-controls={open?'save-options':undefined} onClick={()=>{if(!open)refresh();setOpen(!open);}}>保存</button>{open&&createPortal(<div id="save-options" ref={menu} className="save-options" role="menu" aria-label="保存する内容" onKeyDown={event=>{
  if(!['ArrowDown','ArrowUp','Home','End','Tab'].includes(event.key))return;
  if(event.key==='Tab'){setOpen(false);return;}
  event.preventDefault();const buttons=Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
 }}>{options.map(option=><button type="button" role="menuitem" key={option.id} disabled={option.disabled} onClick={()=>{const current=collect().find(item=>item.id===option.id);if(!current||current.disabled)return;setOpen(false);trigger.current?.focus();current.run();}}><strong>{option.label}</strong><span>{option.description}</span></button>)}</div>,document.body)}</>;
}
