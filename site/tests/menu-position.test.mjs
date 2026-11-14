import {test} from 'node:test';
import assert from 'node:assert/strict';
import {menuPosition} from '../menu-position.ts';

test('a menu at the leftmost plus button stays inside the viewport',()=>{
 const p=menuPosition({top:50,bottom:86,right:58},{width:240,height:130},{width:934,height:1011});
 assert.equal(p.left,8);assert.equal(p.top,90);assert.ok(p.left+240<=934-8);
});
test('right alignment and upward opening respect both viewport edges',()=>{
 const p=menuPosition({top:700,bottom:736,right:950},{width:220,height:180},{width:934,height:800});
 assert.equal(p.left,706);assert.equal(p.top,516);assert.equal(p.maxHeight,688);
});
test('a tall menu is constrained to the larger available space',()=>{
 const p=menuPosition({top:180,bottom:216,right:150},{width:300,height:900},{width:320,height:600});
 assert.equal(p.maxWidth,304);assert.equal(p.left,8);assert.equal(p.top,220);assert.equal(p.maxHeight,372);
 assert.ok(p.top+p.maxHeight<=592);
});
