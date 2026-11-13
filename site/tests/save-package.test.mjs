import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createSaveArchive} from '../src/lib/save-archive.ts';
import {videoSaveFiles} from '../src/lib/save-package.ts';
import {buildDocument,createEditorState,addCut,importProjectJson} from '../src/lib/editor.ts';
import {parseVtt} from '../src/lib/vtt.ts';

test('all-save pairs the exported media with shifted VTT and a project without repeated cuts',async()=>{
 const doc=buildDocument(parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n前半\n\n00:00:03.000 --> 00:00:06.000\n後半\n').cues);
 const state=addCut(createEditorState(),{start:1000,end:4000,kind:'manual',precision:'manual',text:'fixture',sourceCueIds:[]});
 const files=videoSaveFiles({doc,state,sourceFile:'元字幕.vtt',sourceMedia:'元動画.mp4',sourceDurationMs:6000,comparison:null,merge:{},metrics:[],media:{blob:new Blob(['synthetic-media']),fileName:'確認_cut.mp4',durationMs:3000}});
 const contents=async name=>await files.find(file=>file.name===name).blob.text();
 assert.deepEqual(parseVtt(await contents('確認_cut.vtt')).cues.map(c=>[c.start,c.end]),[[0,1000],[1000,3000]]);
 const resume=importProjectJson(await contents('確認_cut.vtt-edit.json'));
 assert.equal(resume.state.cuts.length,0);assert.equal(resume.mediaDurationMs,3000);assert.equal(resume.sourceFile,'確認_cut.mp4');
 assert.equal(importProjectJson(await contents('元動画用_編集履歴.vtt-edit.json')).state.cuts.length,1);
 assert.equal(files.some(file=>file.name==='元動画.mp4'),false);
});
test('ZIP64 preserves Japanese names, binary and empty entries in an independent .NET reader',async()=>{
 const entries=[{name:'日本語.txt',blob:new Blob(['123456789'])},{name:'カット.mp4',blob:new Blob([new Uint8Array([0,255,1,128])])},{name:'空.txt',blob:new Blob([])}];
 const archive=await createSaveArchive(entries),bytes=new Uint8Array(await archive.arrayBuffer()),view=new DataView(bytes.buffer);
 assert.equal(view.getUint32(14,true),0xcbf43926);assert.equal(view.getUint16(4,true),45);
 const root=fileURLToPath(new URL('../../runtime/save-archive-check/',import.meta.url));await mkdir(root,{recursive:true});
 const archivePath=join(root,'fixture.zip'),expectedPath=join(root,'expected.json');await writeFile(archivePath,bytes);
 await writeFile(expectedPath,JSON.stringify(await Promise.all(entries.map(async file=>({name:file.name,sha256:createHash('sha256').update(new Uint8Array(await file.blob.arrayBuffer())).digest('hex')})))));
 execFileSync('pwsh',['-NoProfile','-Command',`$ErrorActionPreference='Stop'
 $expected=Get-Content -LiteralPath $env:TC_ARCHIVE_EXPECTED -Raw | ConvertFrom-Json
 $zip=[IO.Compression.ZipFile]::OpenRead($env:TC_ARCHIVE_TEST)
 try { if($zip.Entries.Count -ne $expected.Count){throw 'Entry count mismatch'}; foreach($item in $expected){$entry=$zip.GetEntry($item.name);if(!$entry){throw 'Missing ZIP entry'};$stream=$entry.Open();$memory=[IO.MemoryStream]::new();try{$stream.CopyTo($memory);$actual=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($memory.ToArray())).ToLowerInvariant();if($actual -ne $item.sha256){throw 'ZIP content mismatch'}}finally{$stream.Dispose();$memory.Dispose()}} }finally{$zip.Dispose()}`],{env:{...process.env,TC_ARCHIVE_TEST:archivePath,TC_ARCHIVE_EXPECTED:expectedPath},windowsHide:true,stdio:'pipe'});
 await assert.rejects(createSaveArchive([{name:'../escape',blob:new Blob(['x'])}]));
 const abort=new AbortController();abort.abort();await assert.rejects(createSaveArchive(entries,abort.signal));
});
