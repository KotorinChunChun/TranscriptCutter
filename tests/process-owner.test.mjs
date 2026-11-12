import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
const executable=resolve('runtime/standalone-build/TranscriptCutterProcess.exe');
let available=process.platform==='win32';try{await access(executable);}catch{available=false;}
test('Windows ownership contains a restarted descendant and preserves quoted Unicode arguments',{skip:!available},async()=>{
 const folder=await mkdtemp(join(tmpdir(),'tc-job-')),path=join(folder,'日本語 空白.exe'),record=join(folder,'child.json'),argument='日本語 空白 "quoted" path\\';let owner;
 const exists=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
 try{
  const grandchild=join(folder,'child.mjs');await writeFile(grandchild,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(record)},JSON.stringify({pid:process.pid,arg:process.argv[2]}));setInterval(()=>{},1000);`);
  const source=join(folder,'restart.rs');await writeFile(source,`fn main(){std::process::Command::new(${JSON.stringify(process.execPath)}).arg(${JSON.stringify(grandchild)}).arg(std::env::args_os().nth(1).unwrap()).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();}`);
  execFileSync('rustc',['--crate-name','restart_fixture',source,'-o',path],{stdio:'pipe'});
  owner=spawn(executable,[path,argument],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const parentPid=await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('owner fixture')),4000);owner.once('error',j);owner.stdout.once('data',b=>{clearTimeout(timer);r(JSON.parse(b).pid);});});
  let child;for(let n=0;n<80;n++){try{child=JSON.parse(await readFile(record,'utf8'));if(!exists(parentPid))break;}catch{}await new Promise(r=>setTimeout(r,25));}
  assert.ok(child);assert.equal(child.arg,argument);assert.equal(exists(parentPid),false);assert.equal(exists(child.pid),true);
  await new Promise(r=>{owner.once('exit',r);owner.kill();});
  for(let n=0;n<80&&exists(child.pid);n++)await new Promise(r=>setTimeout(r,25));
  assert.equal(exists(child.pid),false);
 }finally{if(owner?.exitCode===null&&!owner.signalCode)owner.kill();await rm(folder,{recursive:true,force:true});}
});
