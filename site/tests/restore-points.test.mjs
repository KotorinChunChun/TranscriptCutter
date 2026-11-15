import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pointsToKeep,restorePointPrefix} from '../src/lib/restore-points.ts';
test('bounded restore points retain newest states without mutating history',()=>{
 const points=Array.from({length:15},(_,i)=>({key:String(i),createdAt:i,data:{cut:i}}));
 const kept=pointsToKeep(points);assert.equal(kept.length,10);assert.deepEqual(kept.map(p=>p.data.cut),[14,13,12,11,10,9,8,7,6,5]);assert.equal(points.length,15);
 assert.notEqual(restorePointPrefix('editor'),restorePointPrefix('editor:branch'));assert.ok(!restorePointPrefix('editor:branch').startsWith(restorePointPrefix('editor')));
});
