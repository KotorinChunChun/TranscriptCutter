import {isSea} from 'node:sea';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

/** A packaged executable has no source-module path; keep optional data in its own state root. */
export function applicationRoot({packaged=isSea(),env=process.env,moduleUrl=import.meta.url}={}){
 if(!packaged)return resolve(fileURLToPath(new URL('../',moduleUrl)));
 const root=env.TC_UNIFIED_STATE_DIR||(env.LOCALAPPDATA?resolve(env.LOCALAPPDATA,'TranscriptCutter','unified'):null);
 if(!root||!isAbsolute(root))throw Error('アプリの専用保存先を確認してください。');
 return resolve(root);
}
