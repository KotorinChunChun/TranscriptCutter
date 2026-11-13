import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareReleaseDirectory,pruneObsoleteReleases,releaseDirectory} from './release-layout.mjs';
const root=await mkdtemp(join(tmpdir(),'tc-release-layout-'));
try{
 assert.throws(()=>releaseDirectory(root,'../escape'));
 const current=await prepareReleaseDirectory(root,'0.1.1'),base=join(root,'release');
 await assert.rejects(pruneObsoleteReleases(root,'0.1.1'),/現行配布物/);
 await writeFile(join(current,'TranscriptCutter-web-v0.1.1.zip'),'current');
 for(const name of ['v0.1.0','v0.1.1-abcdef','history'])await mkdir(join(base,name));
 await writeFile(join(base,'TranscriptCutter-web-v0.1.0.exe'),'old');
 await writeFile(join(base,'notes.txt'),'keep');
 assert.equal((await pruneObsoleteReleases(root,'0.1.1')).length,4);
 assert.deepEqual((await readdir(base)).sort(),['notes.txt','v0.1.1']);
 const outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'keep.txt'),'safe');
 await symlink(outside,join(base,'v0.1.0'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(pruneObsoleteReleases(root,'0.1.1'),/リンク/);
 assert.equal(await readFile(join(outside,'keep.txt'),'utf8'),'safe');
 await rm(join(base,'v0.1.0'));
 console.log('配布フォルダーの整理・境界・リンク拒否を確認しました。');
}finally{await rm(root,{recursive:true,force:true});}
