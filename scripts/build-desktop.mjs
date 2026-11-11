import { cp, mkdir } from 'node:fs/promises';
import {writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
await mkdir('dist', {recursive:true});
await cp('web', 'dist', {recursive:true});
await build({entryPoints:['dialogue/entry.tsx'],bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',tsconfig:'tsconfig.json',outfile:'dist/dialogue/entry.js',minify:true});
await writeFile('dist/dialogue/index.html','<!doctype html><html lang="ja"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>統合・編集 - TranscriptCutter</title><link rel="stylesheet" href="entry.css"><div id="root"></div><script type="module" src="entry.js"></script></html>');
