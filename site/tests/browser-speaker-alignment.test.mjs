import test from 'node:test';
import assert from 'node:assert/strict';
import {alignHaasChunk} from '../browser-speaker-alignment.mjs';
import {NemotronSpeakerCache,createNemotronFeatureExtractor,loadNemotron} from '../browser-nemotron-core.mjs';

const tokens={pieces:['▁こんにちは','。','▁次です','！','<0xE6>','<0x97>','<0xA5>','▁です'],unk_id:99,add_dummy_prefix:true};
const probabilities=(frames,spans)=>{const p=new Float32Array(frames*8);for(const [from,to,speaker,score=.95] of spans)for(let f=from;f<to;f++)p[f*8+speaker]=score;return p;};
const content=rows=>rows.map(row=>row.text).join('');
const nonspace=value=>value.replace(/\s/g,'');

test('TDT時刻候補で原文を保持し、元動画の時刻へ戻して複数話者を付ける',()=>{
  const rows=alignHaasChunk({text:'こんにちは。 次です！',ids:[0,1,2,3],timestamps:[0,5,10,15],tokens,from:10,to:12,audioFrom:10,
    probs:probabilities(200,[[0,80,0],[80,200,1]]),numFrames:200,nextId:7});
  assert.equal(content(rows),'こんにちは。 次です！');
  assert.ok(rows.some(r=>r.speaker==='話者1'));assert.ok(rows.some(r=>r.speaker==='話者2'));
  assert.equal(rows[0].id,7);assert.equal(rows[0].start,10);assert.ok(rows.every(r=>r.start>=10&&r.end<=12&&r.end>r.start));
  assert.ok(rows.every(r=>r.timestampType==='tdt-token-candidate'&&r.words.length));
  for(let i=1;i<rows.length;i++)assert.ok(rows[i].start>=rows[i-1].end);
});

test('同時発話は複数候補を残し、未検出は話者不明にする',()=>{
  const rows=alignHaasChunk({text:'こんにちは。 次です！',ids:[0,1,2,3],timestamps:[0,5,10,15],tokens,from:0,to:2,
    probs:probabilities(200,[[0,80,0],[0,80,1]]),numFrames:200});
  assert.ok(rows.some(r=>r.speaker==='話者1 / 話者2'&&r.speakerCandidates.length===2));
  assert.ok(rows.some(r=>r.speaker==='話者不明'&&!r.speakerCandidates.length));
  assert.ok(rows.some(r=>r.speakerIntervals.some(s=>s.speaker==='話者2')));
  assert.equal(nonspace(content(rows)),'こんにちは。次です！');
});

test('時刻不一致・全ゼロ・テキスト不一致は文字比推定に戻して原文を変えない',()=>{
  for(const options of [{timestamps:[0,0,0,0]},{timestamps:[1,0,3,4]},{text:'原文を勝手に直さない。'}]){
    const source={text:'こんにちは。 次です！',ids:[0,1,2,3],timestamps:[0,5,10,15],tokens,from:20,to:24,...options};
    const rows=alignHaasChunk(source);assert.equal(content(rows),source.text);assert.ok(rows.every(r=>r.timestampType==='character-estimate'&&!r.words.length));
    assert.equal(rows[0].start,20);assert.equal(rows.at(-1).end,24);assert.ok(rows.every(r=>r.end>r.start));
  }
});

test('UTF-8 byte fallbackは完成するまで時刻候補をまとめ、文字を落とさない',()=>{
  const rows=alignHaasChunk({text:'こんにちは。日 です',ids:[0,1,4,5,6,7],timestamps:[0,2,4,5,6,8],tokens,from:0,to:2});
  assert.equal(content(rows),'こんにちは。日 です');assert.ok(!content(rows).includes('\ufffd'));
  assert.ok(rows.flatMap(r=>r.words).some(w=>w.word.includes('日')));
  assert.ok(rows.every(r=>r.start>=0&&r.end<=2&&r.end>r.start));
});

test('話者識別なしではラベルを付けず、8秒目安で字幕を区切る',()=>{
  const text='あいうえおかきくけこ',rows=alignHaasChunk({text,from:0,to:20,maxCueSeconds:8});
  assert.equal(content(rows),text);assert.ok(rows.length>=3);assert.ok(rows.every(r=>!('speaker' in r)&&r.end-r.start<=8));
  assert.throws(()=>alignHaasChunk({text,from:1,to:1}));
});

test('空白だけの字幕やサロゲート対の途中切れを作らない',()=>{
  const table={pieces:['\ud83d','\ude00','。','▁','次'],unk_id:99,add_dummy_prefix:false};
  const rows=alignHaasChunk({text:'😀。 次',ids:[0,1,2,3,4],timestamps:[0,1,2,3,4],tokens:table,from:0,to:1});
  assert.equal(content(rows),'😀。 次');assert.ok(rows.every(r=>r.text.trim()));
  assert.ok(rows.every(r=>!/[\uD800-\uDBFF]$/.test(r.text)&&!/^\p{Surrogate}/u.test(r.text)));
  assert.throws(()=>alignHaasChunk({text:'a',from:0,to:1,probs:new Float32Array(8),numFrames:2}));
});

test('公式キャッシュ方針はFIFOの40フレームを残し264へ圧縮する',()=>{
  const silence=new Float32Array(512),cache=new NemotronSpeakerCache(silence);
  const rows=Array.from({length:380},(_,i)=>new Float32Array(512).fill(i+1));
  const probs=Array.from({length:380},(_,i)=>Float32Array.from({length:8},(_,s)=>s===i%8?.95:.01));
  cache.update(rows,probs,340);
  assert.equal(cache.embeds.length,264);assert.equal(cache.fifo.length,40);assert.equal(cache.getEmbeds().length,304);
  assert.equal(cache.compressed,true);assert.equal(cache.fifo[0][0],301);assert.ok(cache.embeds.some(row=>row===silence));
  assert.ok(cache.probs.every(p=>p.length===8&&p.every(Number.isFinite)));
});

test('Nemotron特徴量は無音でも有限で、フレームとmelの順序を保つ',()=>{
  const extract=createNemotronFeatureExtractor(new Float32Array(128*257));
  const result=extract(new Float32Array(1600),0,10);
  assert.equal(result.length,1280);assert.ok(result.every(v=>Math.abs(v-Math.log(2**-24))<1e-5));
});

test('Nemotron mock推論はキャッシュを継続し、別録音ではリセットする',async()=>{
  const previousFetch=globalThis.fetch,feeds=[];let released=0;
  globalThis.fetch=async url=>new Response(new Float32Array(url==='blob:mel'?128*257:512).buffer);
  class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}}
  const ort={Tensor,InferenceSession:{async create(url,options){assert.deepEqual(options,{executionProviders:['wasm']});return {
    async run(feed){if(url==='blob:embed'){const frames=Math.ceil(feed.features.dims[1]/8);return {embeds:new Tensor('float32',new Float32Array(frames*512),[1,frames,512])};}
      const frames=feed.embeds.dims[1];feeds.push(frames);const logits=Float32Array.from({length:frames*64},(_,i)=>i%8===0?3:-3);return {logits:new Tensor('float32',logits,[1,frames*8,8])};},async release(){released++;}
  };}}};
  try{
    const model=await loadNemotron(ort,{embedUrl:'blob:embed',stepUrl:'blob:step',melUrl:'blob:mel',silenceUrl:'blob:silence'});
    const audio=new Float32Array(2736*160),one=await model.run(audio),two=await model.run(audio);
    assert.equal(one.numFrames,2736);assert.equal(one.probs.length,2736*8);assert.deepEqual(one.probs,two.probs);
    assert.deepEqual(feeds,[342,306,342,306]);assert.ok(one.probs.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    await model.dispose();await model.dispose();assert.equal(released,2);
  }finally{globalThis.fetch=previousFetch;}
});
