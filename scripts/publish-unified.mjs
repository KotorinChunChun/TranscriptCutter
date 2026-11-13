import {readFile,writeFile,readdir,lstat,copyFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareReleaseDirectory,pruneObsoleteReleases} from './release-layout.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),{version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const source=process.env.TC_ACCEPT_EXE||join(root,'runtime','unified-build',`TranscriptCutter-v${version}.exe`),receipt=JSON.parse(await readFile(source+'.json','utf8')),acceptance=JSON.parse(await readFile(source+'.acceptance.json','utf8'));
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
if(receipt.version!==version||receipt.sourceDirty!==false||receipt.distribution!=='unified-single-exe'||receipt.sha256!==await hash(source)||acceptance.sha256!==receipt.sha256||acceptance.passed?.length<8)throw Error('確認済みの単一EXEを指定してください。');
const dir=await prepareReleaseDirectory(root,version),name=`TranscriptCutter-v${version}.exe`,target=join(dir,name);
await copyFile(source,target);if(await hash(target)!==receipt.sha256)throw Error('配布EXEが一致しません。');
await writeFile(join(dir,'BUILD.json'),JSON.stringify({...receipt,file:name,acceptance:{checkedAt:acceptance.checkedAt,passed:acceptance.passed},lanAcceptance:receipt.lanAcceptance??'別の物理PCからの操作は未受入'},null,2)+'\n');
await writeFile(join(dir,'お読みください.txt'),`TranscriptCutter v${version} / TranscriptionServer v${receipt.server.version}\n\n使うプログラムは ${name} 一つです。インストールは不要です。\n起動するとブラウザーで利用方式を選びます。\n・このPCだけ: 文字起こしサーバーと編集画面を自PC内で起動します。外部サーバーにも接続できます。\n・他PCにも公開: HTTPSの公開URL、固定ポート、対応する証明書と秘密鍵のパスを設定します。クライアントPCでは公開URLを開きます。信頼LAN限定です。\n利用方式は保存され、次回も同じ方式で起動します。「利用方式」またはEXEの --setup から設定へ戻れます。\n\nNode.jsとTranscriptionServerのプログラムを内包しています。初回に%LOCALAPPDATA%/TranscriptCutter/unifiedへ検証して展開します。\nモデル・Python/認識実行環境・FFmpeg/FFprobeは同梱していません。「初回導入・サーバー管理」から必要なものをオンライン導入してください。\n導入後にサーバー管理が再起動を要求した場合は、管理画面の「再起動」で反映します。\nデータと設定は同じ専用領域へ保存します。元動画や既存の別サーバーを変更しません。\nGUIはブラウザーです。起動用コンソールを閉じると専用サーバーを終了します。ブラウザーを閉じただけでは終了しません。\n\n他PCへ公開する場合は、証明書の信頼とOSファイアウォールを管理者の方針で設定してください。証明書の自動生成、信頼登録、ファイアウォール変更は行いません。この開発PCではDevServerの事前予約が必要です。\n信頼LAN上の利用者は認識履歴・サーバー管理を共用します。Entra認証やインターネット公開用の認証は同梱していません。\nAI字幕整理にはサーバーPCのCodex CLIとログインが別途必要です。既知のブラウザーWhisperの認識品質の問題は今回修正していません。\nWindows x64・未署名。ライセンスは起動後の /licenses.txt と展開先の transcription-server/licenses を参照してください。\n\nSHA256SUMS.txtは同梱ファイルの整合確認用、BUILD.jsonは作成元と検証範囲の記録です。\n`);
// Delete only generated, recognized old deliverables after validating every path.
const obsolete=[];
for(const old of await readdir(dir))if(![name,'BUILD.json','お読みください.txt','SHA256SUMS.txt'].includes(old)&&(/^TranscriptCutter-/.test(old)||old==='README.md'||/^v\d+\.\d+\.\d+-配布案内\.txt$/.test(old))){const path=resolve(dir,old),rel=relative(dir,path),s=await lstat(path);if(!rel||rel.startsWith('..')||isAbsolute(rel)||!s.isFile()||s.isSymbolicLink())throw Error('旧配布物の削除先を確認してください。');obsolete.push(path);}
for(const path of obsolete)await rm(path);
await pruneObsoleteReleases(root,version);
const lines=[];for(const n of (await readdir(dir)).sort())if(n!=='SHA256SUMS.txt')lines.push(`${await hash(join(dir,n))}  ${n}`);await writeFile(join(dir,'SHA256SUMS.txt'),lines.join('\n')+'\n');
console.log(`配布EXE: ${target}\nSHA256: ${receipt.sha256}`);
