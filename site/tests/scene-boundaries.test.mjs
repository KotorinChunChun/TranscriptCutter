import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findSceneBoundaries,splitReviewGap,readGapSplits} from '../src/lib/scene-boundaries.ts';
import {buildDocument,createEditorState,exportProjectJson,importProjectJson} from '../src/lib/editor.ts';
const frame=v=>new Uint8ClampedArray([v,v,v,255]);
test('coarse scan refines cuts, keeps stable gaps and reports completion',async()=>{
 let progress=0;const points=await findSceneBoundaries({start:1000,end:5000},async ms=>frame(ms<2230?0:ms<3710?255:0),new AbortController().signal,n=>progress=n);
 assert.deepEqual(points,[2250,3750]);assert.equal(progress,1);
 assert.deepEqual(await findSceneBoundaries({start:0,end:2000},async()=>frame(40),new AbortController().signal),[]);
});
test('abort and unreasonable range do not return partial results',async()=>{
 const a=new AbortController();let calls=0;
 await assert.rejects(findSceneBoundaries({start:0,end:4000},async()=>{if(++calls===2)a.abort();return frame(0);},a.signal),{name:'AbortError'});
 await assert.rejects(findSceneBoundaries({start:0,end:600001},async()=>frame(0),new AbortController().signal));
});
test('split keeps exact gap coverage, isolated media and survives project import',()=>{
 const split={start:1000,end:5000,points:[2250,3750],mediaKey:'media-a'},gap={start:1000,end:5000,id:'gap',nextCueId:'c',trailing:false};
 const parts=splitReviewGap(gap,[split],'media-a');assert.deepEqual(parts.map(p=>[p.start,p.end]),[[1000,2250],[2250,3750],[3750,5000]]);
 assert.equal(splitReviewGap(gap,[split],'media-b').length,1);
 assert.throws(()=>readGapSplits([{...split,points:[3750,2250]}]));
 const doc=buildDocument([{id:'c',start:5000,end:6000,text:'本文',speaker:null,sourceCount:1,sourceIds:['c']}]);
 const restored=importProjectJson(exportProjectJson(doc,{...createEditorState(),gapSplits:[split]},{sourceFile:'test.vtt'}));assert.deepEqual(restored.state.gapSplits,[split]);
});
