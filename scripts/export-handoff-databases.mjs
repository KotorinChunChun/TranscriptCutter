import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const repo=resolve('C:/develop/TranscriptCutter'),out=resolve(process.argv[2]||'C:/develop/TranscriptCutter-handoff-20261115');
const plan=JSON.parse(await readFile(join(out,'cleanup-plan.json'),'utf8')).records;
const index=[];
const clean=(value,key='')=>{
 if(/^(?:token|authorization|password|api[_-]?key|client[_-]?secret|private[_-]?key)$/i.test(key))return '[excluded credential]';
 if(value instanceof Uint8Array)return {excludedBinary:true,bytes:value.byteLength};
 if(typeof value==='bigint')return {sqliteInt64:value.toString()};
 if(Array.isArray(value))return value.map(v=>clean(v));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,k)]));
 if(typeof value==='string'&&/^[\[{]/.test(value.trim())){try{return {jsonText:clean(JSON.parse(value))};}catch{}}
 return value;
};
for(const [n,row]of plan.filter(x=>x.path.endsWith('.sqlite3')).entries()){
 const copy=join(out,'db-export-work',String(n),'workbench.sqlite3');await mkdir(dirname(copy),{recursive:true});
 for(const suffix of ['','-wal','-shm']){try{await copyFile(join(repo,row.path)+suffix,copy+suffix);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const db=new DatabaseSync(copy,{readOnly:true});db.exec('PRAGMA query_only=ON');
 const tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
 const exported=[];
 for(const table of tables){const name='"'+table.name.replaceAll('"','""')+'"',rows=db.prepare('SELECT * FROM '+name).all();exported.push({name:table.name,schema:table.sql,rows:clean(rows)});}
 const integrity=db.prepare('PRAGMA integrity_check').get();db.close();
 if(Object.values(integrity)[0]!=='ok')throw Error('SQLite integrity failure: '+row.path);
 const relative='dev/handoff/database-exports/'+String(n+1).padStart(2,'0')+'.json',target=join(repo,relative);await mkdir(dirname(target),{recursive:true});
 await writeFile(target,JSON.stringify({sourcePath:row.path,readOnlyCopy:true,integrity:'ok',excluded:'credentials and BLOB bytes',tables:exported},null,2));
 index.push({source:row.path,export:relative,tables:exported.map(t=>({name:t.name,rows:t.rows.length})),integrity:'ok'});
}
await writeFile(join(repo,'dev/handoff/database-exports/index.json'),JSON.stringify(index,null,2));console.log(JSON.stringify(index.map(x=>({source:x.source,tables:x.tables})),null,2));
