import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = (await readFile(new URL("../src/lib/transcript-playback.ts", import.meta.url), "utf8"))
  .replace("from './audio-mute'", `from "${new URL("../src/lib/audio-mute.ts", import.meta.url).href}"`)
  .replace('from "./media-plan"', `from "${new URL("../src/lib/media-plan.ts", import.meta.url).href}"`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { buildPlaybackTimeline, resolvePlaybackPosition, buildTimedItemIndex, findActiveTimedItems, createTranscriptPlaybackController } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("original playback ignores text deletions and the VTT cap, edited playback shares their union", () => {
  const timeline = buildPlaybackTimeline([{ start: 2000, end: 4000 }, { start: 3000, end: 5000 }, { start: 5000, end: 5500 }], 10_000, 12_000);
  assert.deepEqual(timeline.plan.cuts, [{ start: 2000, end: 5500 }, { start: 10000, end: 12000 }]);
  assert.deepEqual(resolvePlaybackPosition(timeline, 2500, "original"), { currentMs: 2500, done: false, skipped: false, nextBoundaryMs: 12000 });
  assert.deepEqual(resolvePlaybackPosition(timeline, 2500, "edited"), { currentMs: 5500, done: false, skipped: true, nextBoundaryMs: 10000 });
  assert.equal(resolvePlaybackPosition(timeline, 11000, "original").done, false);
  assert.equal(resolvePlaybackPosition(timeline, 10000, "edited").done, true);
});

test("cut boundaries are exclusive at the end and original time is never retimed", () => {
  const timeline = buildPlaybackTimeline([{ start: 1000, end: 2000 }], 4000, 5000);
  assert.equal(resolvePlaybackPosition(timeline, 999.99, "edited").currentMs, 999.99);
  assert.equal(resolvePlaybackPosition(timeline, 1000, "edited").currentMs, 2000);
  assert.equal(resolvePlaybackPosition(timeline, 2000, "edited").skipped, false);
  assert.equal(resolvePlaybackPosition(timeline, 3500, "edited").currentMs, 3500);
  assert.equal(resolvePlaybackPosition(timeline, -1, "original").currentMs, 0);
  assert.equal(resolvePlaybackPosition(timeline, 5000, "original").done, true);
});

test("unknown duration still respects the subtitle end, shorter media is never extended, all-cut is explicit", () => {
  const unknown = buildPlaybackTimeline([], 8000);
  assert.equal(unknown.originalEndMs, null);
  assert.equal(resolvePlaybackPosition(unknown, 20000, "original").done, false);
  assert.equal(resolvePlaybackPosition(unknown, 8000, "edited").done, true);
  const shorter = buildPlaybackTimeline([], 8000, 5000);
  assert.equal(shorter.editedEndMs, 5000);
  assert.equal(resolvePlaybackPosition(shorter, 6000, "edited").currentMs, 5000);
  const allCut = buildPlaybackTimeline([{ start: 0, end: 20_000 }], 8000, 10_000);
  assert.equal(resolvePlaybackPosition(allCut, 0, "edited").done, true);
  assert.equal(resolvePlaybackPosition(buildPlaybackTimeline([], 0), 0, "edited").done, true);
  assert.throws(() => buildPlaybackTimeline([], NaN));
  assert.throws(() => buildPlaybackTimeline([], 5000, 0));
  assert.throws(() => resolvePlaybackPosition(unknown, Infinity, "edited"));
});

test("highlight index retains overlap, Unicode item identity, gaps, and half-open boundaries", () => {
  const source = [
    { id: "😀", start: 1000, end: 2000 }, { id: "long", start: 0, end: 7000 },
    { id: "adjacent", start: 2000, end: 2500 }, { id: "zero", start: 3000, end: 3000 },
    { id: "later", start: 8000, end: 9000 },
  ];
  const copy = structuredClone(source);
  const index = buildTimedItemIndex(source);
  assert.deepEqual(source, copy);
  assert.deepEqual(findActiveTimedItems(index, 1500).map(item => item.id), ["long", "😀"]);
  assert.strictEqual(findActiveTimedItems(index, 1500)[1], source[0]);
  assert.deepEqual(findActiveTimedItems(index, 2000).map(item => item.id), ["long", "adjacent"]);
  assert.deepEqual(findActiveTimedItems(index, 7500), []);
  assert.deepEqual(findActiveTimedItems(index, NaN), []);
  assert.deepEqual(findActiveTimedItems(buildTimedItemIndex([]), 0), []);
});

test("long overlapping subtitles do not change highlight results in a large transcript", () => {
  const items = [{ id: "long", start: 0, end: 7_200_000 }, ...Array.from({ length: 50_000 }, (_, i) => ({ id: `word-${i}`, start: i * 100, end: i * 100 + 75 }))];
  const index = buildTimedItemIndex(items);
  assert.deepEqual(findActiveTimedItems(index, 4_500_020).map(item => item.id), ["long", "word-45000"]);
  assert.deepEqual(findActiveTimedItems(index, 4_500_090).map(item => item.id), ["long"]);
});

class FakeMedia extends EventTarget {
  time = 0; duration = 12; paused = true; ended = false; seeking = false; readyState = 4; playbackRate = 1;
  defaultPlaybackRate = 1; preservesPitch = false;
  seeks = []; playCalls = 0; pauseCalls = 0; nextPlay = null;
  get currentTime() { return this.time; }
  set currentTime(value) {
    this.time = value; this.ended = false; this.seeks.push(value); this.seeking = true;
    this.dispatchEvent(new Event("seeking")); this.seeking = false; this.dispatchEvent(new Event("seeked"));
  }
  play() {
    this.playCalls++; this.paused = false; this.ended = false;
    this.dispatchEvent(new Event("play")); this.dispatchEvent(new Event("playing"));
    return this.nextPlay ?? Promise.resolve();
  }
  pause() {
    this.pauseCalls++; if (this.paused) return;
    this.paused = true; this.dispatchEvent(new Event("pause"));
  }
}

function harness(options = {}) {
  const media = new FakeMedia();
  let now = 0, id = 0;
  const frames = new Map(), timers = new Map(), snapshots = [], errors = [];
  const scheduler = {
    now: () => now,
    requestFrame: callback => { const next = ++id; frames.set(next, callback); return next; },
    cancelFrame: key => frames.delete(key),
    setTimer: (callback, delay) => { const next = ++id; timers.set(next, { callback, at: now + delay }); return next; },
    clearTimer: key => timers.delete(key),
  };
  const config = { cuts: [{ start: 2000, end: 4000 }], subtitleEndMs: 10000, ...options };
  const controller = createTranscriptPlaybackController(media, config, { onChange: snapshot => snapshots.push(snapshot), onError: message => errors.push(message) }, scheduler);
  const advance = (milliseconds, fireFrame = true) => {
    now += milliseconds;
    if (!media.paused) media.time += milliseconds * media.playbackRate / 1000;
    for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.callback(); }
    if (fireFrame) { const queued = [...frames]; frames.clear(); for (const [, callback] of queued) callback(); }
  };
  return { media, controller, snapshots, errors, frames, timers, advance, config };
}

test("controller edited playback skips deleted time, continues across utterances and stops at VTT end", async () => {
  const h = harness();
  h.controller.playFrom(1500, "edited"); await Promise.resolve();
  h.advance(500, false); // Boundary timer also works without an animation frame.
  assert.equal(h.media.currentTime, 4);
  assert.equal(h.controller.getSnapshot().mode, "edited");
  assert.equal(h.controller.getSnapshot().currentMs, 4000);
  assert.equal(h.media.paused, false);
  h.advance(6000);
  assert.equal(h.media.currentTime, 10);
  assert.equal(h.media.paused, true);
  assert.equal(h.controller.getSnapshot().playing, false);
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  h.controller.destroy();
});

test("original playback includes deleted words and continues beyond VTT end", async () => {
  const h = harness();
  h.controller.playFrom(2000, "original"); await Promise.resolve();
  assert.equal(h.media.currentTime, 2);
  h.advance(8500);
  assert.equal(h.media.paused, false);
  assert.equal(h.controller.getSnapshot().currentMs, 10500);
  h.advance(1500);
  assert.equal(h.media.paused, true);
  assert.equal(h.media.currentTime, 12);
  h.controller.destroy();
});

test("native pause, resume and scrubbing obey the active edited mode", async () => {
  const h = harness();
  h.controller.playFrom(0, "edited"); await Promise.resolve();
  h.advance(200); h.media.pause();
  assert.equal(h.controller.getSnapshot().playing, false);
  assert.equal(h.frames.size, 0);
  h.media.currentTime = 3;
  assert.equal(h.media.currentTime, 4);
  assert.equal(h.media.paused, true);
  await h.media.play(); h.advance(100);
  assert.equal(h.controller.getSnapshot().playing, true);
  assert.equal(h.controller.getSnapshot().currentMs, 4100);
  h.media.currentTime = 11;
  assert.equal(h.media.currentTime, 10);
  assert.equal(h.media.paused, true);
  h.controller.destroy();
});

test("late play rejection cannot interrupt a newer mode or revive a paused controller", async () => {
  const h = harness();
  let rejectOld;
  h.media.nextPlay = new Promise((_, reject) => { rejectOld = reject; });
  h.controller.playFrom(0, "edited");
  h.media.nextPlay = null;
  h.controller.playFrom(6000, "original");
  rejectOld(Object.assign(new Error("old request"), { name: "NotAllowedError" }));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.errors.length, 0); assert.equal(h.media.paused, false);
  assert.equal(h.controller.getSnapshot().mode, "original");
  let resolveOld;
  h.media.nextPlay = new Promise(resolve => { resolveOld = resolve; });
  h.controller.playFrom(0, "edited"); h.controller.pause(); resolveOld();
  await Promise.resolve();
  assert.equal(h.media.paused, true); assert.equal(h.controller.getSnapshot().playing, false);
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  h.controller.destroy();
});

test("metadata-delayed playback starts at the requested position and uses actual shorter duration", async () => {
  const h = harness(); h.media.readyState = 0; h.media.duration = NaN;
  h.controller.playFrom(3000, "edited");
  assert.equal(h.media.playCalls, 0); assert.equal(h.controller.getSnapshot().waiting, true);
  h.media.readyState = 4; h.media.duration = 5; h.media.dispatchEvent(new Event("loadedmetadata"));
  await Promise.resolve();
  assert.equal(h.media.currentTime, 4); assert.equal(h.media.playCalls, 1);
  h.advance(1000); assert.equal(h.media.currentTime, 5); assert.equal(h.media.paused, true);
  h.controller.destroy();
});

test("editing cuts while playing honors the new cuts and all-cut playback gives a clear notice", async () => {
  const h = harness();
  h.controller.playFrom(1000, "edited"); await Promise.resolve();
  h.controller.updateOptions({ cuts: [{ start: 500, end: 6000 }], subtitleEndMs: 10000 });
  assert.equal(h.media.currentTime, 6); assert.equal(h.media.paused, false);
  h.controller.updateOptions({ cuts: [{ start: 0, end: 10000 }], subtitleEndMs: 10000 });
  assert.equal(h.media.paused, true);
  h.controller.playFrom(0, "edited");
  assert.match(h.errors.at(-1), /再生できる削除後の区間がありません/);
  assert.equal(h.media.paused, true);
  h.controller.destroy();
});

test("snapshot time is rate limited, buffering is exposed, and destroyed sources cannot report later events", async () => {
  const h = harness();
  h.controller.playFrom(0); await Promise.resolve();
  h.snapshots.length = 0;
  for (let i = 0; i < 60; i++) h.advance(1000 / 60);
  assert.ok(h.snapshots.length <= 21, `Emitted ${h.snapshots.length} snapshots`);
  h.media.dispatchEvent(new Event("waiting")); assert.equal(h.controller.getSnapshot().waiting, true);
  h.media.dispatchEvent(new Event("playing")); assert.equal(h.controller.getSnapshot().waiting, false);
  h.controller.destroy();
  const count = h.snapshots.length;
  h.media.time = 8; h.media.dispatchEvent(new Event("timeupdate")); h.media.dispatchEvent(new Event("error"));
  h.advance(1000);
  assert.equal(h.snapshots.length, count); assert.equal(h.errors.length, 0);
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
});

test("generic seeks retain edited mode across pause and skip a deleted target instead of restoring original playback", async () => {
  const h = harness();
  h.controller.playFrom(0, "edited"); await Promise.resolve();
  h.controller.pause();
  h.controller.playFrom(2500); await Promise.resolve();
  assert.equal(h.media.currentTime, 4);
  assert.equal(h.controller.getSnapshot().mode, "edited");
  assert.equal(h.media.paused, false);
  h.controller.playFrom(11000);
  assert.equal(h.controller.getSnapshot().mode, "edited");
  assert.equal(h.media.currentTime, 10);
  assert.equal(h.media.paused, true);
  h.controller.playFrom(2500, "original"); await Promise.resolve();
  assert.equal(h.media.currentTime, 2.5);
  assert.equal(h.controller.getSnapshot().mode, "original");
  h.controller.destroy();
});

test("changing numeric speed retimes the next cut boundary without changing position, mode, or running state", async () => {
  const h = harness();
  h.controller.playFrom(1000, "edited"); await Promise.resolve();
  const playCalls = h.media.playCalls, pauseCalls = h.media.pauseCalls;
  assert.equal(h.controller.setPlaybackRate(2), true);
  assert.equal(h.media.currentTime, 1);
  assert.equal(h.controller.getSnapshot().playbackRate, 2);
  assert.equal(h.media.defaultPlaybackRate, 2);
  assert.equal(h.media.preservesPitch, true);
  assert.equal(h.media.playCalls, playCalls);
  assert.equal(h.media.pauseCalls, pauseCalls);
  h.advance(250, false);
  assert.equal(h.media.currentTime, 1.5);
  assert.equal(h.controller.setPlaybackRate(4), true);
  h.advance(125, false);
  assert.equal(h.media.currentTime, 4);
  assert.equal(h.media.paused, false);
  assert.equal(h.controller.getSnapshot().mode, "edited");
  h.advance(1500, false);
  assert.equal(h.media.currentTime, 10);
  assert.equal(h.media.paused, true);
  assert.equal(h.controller.getSnapshot().playbackRate, 4);
  h.controller.destroy();
});

test("fractional and native speed changes update a paused snapshot, and reset keeps the selected speed", () => {
  const h = harness();
  assert.equal(h.controller.setPlaybackRate(1.75), true);
  assert.equal(h.controller.getSnapshot().playbackRate, 1.75);
  assert.equal(h.media.paused, true);
  assert.equal(h.media.playCalls, 0);
  h.controller.reset();
  assert.equal(h.controller.getSnapshot().playbackRate, 1.75);
  h.media.playbackRate = 1.25;
  h.media.dispatchEvent(new Event("ratechange"));
  assert.equal(h.controller.getSnapshot().playbackRate, 1.25);
  assert.equal(h.media.paused, true);
  h.controller.destroy();
});

test("invalid or browser-rejected speeds preserve the current speed and playback", async () => {
  const h = harness();
  h.controller.playFrom(0, "edited"); await Promise.resolve();
  h.controller.setPlaybackRate(2);
  for (const rate of [0, -1, NaN, Infinity, 0.1, 5]) {
    assert.equal(h.controller.setPlaybackRate(rate), false);
    assert.equal(h.media.playbackRate, 2);
    assert.equal(h.controller.getSnapshot().mode, "edited");
    assert.equal(h.media.paused, false);
  }
  let actualRate = 2;
  Object.defineProperty(h.media, "playbackRate", {
    get: () => actualRate,
    set: rate => { if (rate === 3) throw new Error("Unsupported"); actualRate = rate; },
  });
  assert.equal(h.controller.setPlaybackRate(3), false);
  assert.equal(h.media.playbackRate, 2);
  assert.equal(h.controller.getSnapshot().playbackRate, 2);
  assert.equal(h.media.paused, false);
  assert.match(h.errors.at(-1), /再生速度を設定できません/);
  h.controller.destroy();
});

test("a generic seek while metadata is pending preserves edited mode and the numeric speed", async () => {
  const h = harness(); h.media.readyState = 0; h.media.duration = NaN;
  h.controller.playFrom(0, "edited");
  h.controller.setPlaybackRate(2);
  h.controller.playFrom(3000);
  assert.equal(h.controller.getSnapshot().mode, "edited");
  assert.equal(h.controller.getSnapshot().playbackRate, 2);
  assert.equal(h.media.playCalls, 0);
  h.media.readyState = 4; h.media.duration = 12; h.media.dispatchEvent(new Event("loadedmetadata"));
  await Promise.resolve();
  assert.equal(h.media.currentTime, 4);
  assert.equal(h.media.playCalls, 1);
  assert.equal(h.media.playbackRate, 2);
  h.controller.destroy();
});
