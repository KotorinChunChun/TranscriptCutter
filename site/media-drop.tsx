export function MediaDrop({disabled=false,onLoad,label='動画・音声を選択'}:{disabled?:boolean;onLoad:(file:File)=>void;label?:string}){
 return <div className="file-drop-zone media-drop" role="group" tabIndex={0} aria-label={label} aria-disabled={disabled} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();e.stopPropagation();if(!disabled&&e.dataTransfer.files.length===1)onLoad(e.dataTransfer.files[0]);}} onPaste={e=>{if(!disabled&&e.clipboardData.files.length===1){e.preventDefault();onLoad(e.clipboardData.files[0]);}}}>ドロップ</div>;
}
