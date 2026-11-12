import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('a mounted media export dialog stays absent until explicitly opened',async()=>{
 const folder=await mkdtemp(resolve('runtime/dialog-render-'));
 try{
  const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {VideoExportDialog} from './site/components/video-export.tsx';export const render=open=>renderToStaticMarkup(React.createElement(VideoExportDialog,{open,file:{name:'fixture.mp4',size:123},cuts:[],subtitleEndMs:1000,onClose(){}}));`,resolveDir:process.cwd(),sourcefile:'dialog-test.tsx'},bundle:true,platform:'node',format:'esm',jsx:'automatic',write:false,packages:'external',tsconfig:resolve('tsconfig.site.json')});
  const file=join(folder,'render.mjs');await writeFile(file,result.outputFiles[0].contents);
  const {render}=await import(pathToFileURL(file).href);
  assert.equal(render(false),'');assert.match(render(true),/role="dialog"/);
 }finally{await rm(folder,{recursive:true,force:true});}
});
