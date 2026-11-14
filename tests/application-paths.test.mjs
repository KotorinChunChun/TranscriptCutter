import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {applicationRoot} from '../scripts/application-paths.mjs';

test('SEA uses isolated application state without resolving synthetic source-module URLs',()=>{
 const invalidOnWindows='file:///transcript-cutter-bundle.mjs';
 assert.equal(applicationRoot({packaged:true,moduleUrl:invalidOnWindows,env:{TC_UNIFIED_STATE_DIR:'C:/develop/TranscriptCutter/runtime/path-check'}}),resolve('C:/develop/TranscriptCutter/runtime/path-check'));
 assert.equal(applicationRoot({packaged:true,moduleUrl:invalidOnWindows,env:{LOCALAPPDATA:'C:/Users/test/AppData/Local'}}),resolve('C:/Users/test/AppData/Local/TranscriptCutter/unified'));
 assert.throws(()=>applicationRoot({packaged:true,env:{}}),/専用保存先/);
});

test('source runs keep the repository-relative optional component paths',()=>{
 assert.equal(applicationRoot({packaged:false,moduleUrl:new URL('../scripts/application-paths.mjs',import.meta.url).href}),resolve('.'));
});
