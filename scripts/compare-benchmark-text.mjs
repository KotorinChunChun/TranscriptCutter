import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,sep,join} from 'node:path';
import {formatTime} from '../web/transcript-utils.mjs';
const args=process.argv.slice(2),index=args.indexOf('--run');if(index<0||!args[index+1])throw Error('--run で収集済みrun.jsonを指定してください。');
const path=resolve(args[index+1]),root=dirname(path),run=JSON.parse(await readFile(path,'utf8'));
const windows=[[60,90],[600,630],[1800,1830],[3600,3630]],cell=s=>String(s).replace(/\|/g,'／').replace(/\r?\n/g,' '),results=[];
for(const result of run.results){let details=null;if(result.details){const file=resolve(root,result.details);if(!file.startsWith(root+sep))throw Error('結果ファイルが記録フォルダーの外です。');details=JSON.parse(await readFile(file,'utf8'));}results.push({result,details});}
let report=`# 共通時刻の字幕比較：${run.label}\n\nサーバーv${run.serverVersion}。元動画SHA256：${run.video.sha256}\n\n同じ元動画時刻の字幕を並べます。行の分割数や時刻精度はエンジンによって異なります。正解字幕がないためCER/WERや正確性の順位は付けません。各行の全内容はリンク先VTT/JSONを参照してください。\n\n`;
for(const [start,end] of windows){report+=`## ${formatTime(start)} → ${formatTime(end)}\n\n| エンジン/モデル | 記録状態 | この時刻に重なる字幕 |\n|---|---|---|\n`;
 for(const {result:r,details} of results){let text;if(!details)text='未測定/実行中';else if(r.status!=='complete'&&Number(r.processedUntil??0)<end)text='未到達（部分結果）。この時刻の精度比較には使えません。';else{const selected=details.segments.filter(s=>s.start<end&&s.end>start);text=selected.length?selected.map(s=>`${formatTime(s.start,true)}–${formatTime(s.end,true)} ${s.speaker??''} ${s.text}`).join(' ／ '):'該当字幕なし（無音とは限りません）';}report+=`| ${cell(r.model)} | ${cell(r.status)} | ${cell(text)} |\n`;}report+='\n';
}
report+='## 元ファイル\n\n'+results.map(({result:r})=>`- ${r.model}：${r.vtt?`[${r.status==='complete'?'完了VTT':'部分VTT'}](${encodeURIComponent(r.vtt)})`:'まだVTTなし'}${r.details?` / [元字幕と処理記録](${encodeURIComponent(r.details)})`:''}`).join('\n')+'\n';
await writeFile(join(root,'comparison-excerpts.md'),report);console.log(join(root,'comparison-excerpts.md'));
