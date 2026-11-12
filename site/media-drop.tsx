import {chooseFiles} from './browser';
export function MediaDrop({disabled=false,onLoad,label='動画・音声を選択'}:{disabled?:boolean;onLoad:(file:File)=>void;label?:string}){
 return <button type="button" className="file-drop-zone media-drop" aria-label={label} disabled={disabled} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!disabled&&e.dataTransfer.files.length===1)onLoad(e.dataTransfer.files[0]);}} onClick={async()=>{const files=await chooseFiles('media');if(files[0])onLoad(files[0]);}}>ドロップ</button>;
}
