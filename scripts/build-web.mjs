import {mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
await mkdir('dist-web',{recursive:true});
await build({entryPoints:['site/entry.tsx'],bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',tsconfig:'tsconfig.site.json',outfile:'dist-web/app.js',minify:true});
await writeFile('dist-web/index.html','<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>動画編集 - TranscriptCutter - v0.2611.6</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>');
