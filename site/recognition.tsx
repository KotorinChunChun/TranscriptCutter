import {chooseFiles} from './browser';
export function Recognition({active,onTransfer}:{active:boolean;onTransfer:(value:any)=>void}){return <section className="recognition"><h1>文字起こし</h1><button onClick={()=>void chooseFiles('media')}>動画・音声を読み込む</button></section>;}
