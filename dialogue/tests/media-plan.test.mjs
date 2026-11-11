import test from "node:test";
import assert from "node:assert/strict";
import { buildMediaCutPlan, mapSampleToKeptRanges } from "../src/lib/media-plan.ts";

test("the generic planner without a subtitle cap retains the real media bounds", () => {
  assert.deepEqual(buildMediaCutPlan([], 4_200_000), {
    durationMs: 4_200_000,
    cutDurationMs: 0,
    outputDurationMs: 4_200_000,
    cuts: [],
    keep: [{ start: 0, end: 4_200_000, outputStart: 0, outputEnd: 4_200_000 }],
    clippedCutCount: 0,
  });
});

test("overlap, duplicates and touching bounds remove time once without mutating inputs", () => {
  const cuts = [{ start: 3000, end: 5000 }, { start: 1000, end: 3000 }, { start: 2000, end: 4000 }, { start: 1000, end: 3000 }, { start: 8000, end: 10000 }];
  const original = structuredClone(cuts);
  const plan = buildMediaCutPlan(cuts, 15000);
  assert.deepEqual(cuts, original);
  assert.deepEqual(plan.cuts, [{ start: 1000, end: 5000 }, { start: 8000, end: 10000 }]);
  assert.equal(plan.cutDurationMs, 6000);
  assert.equal(plan.outputDurationMs, 9000);
  assert.equal(plan.clippedCutCount, 0);
  assert.deepEqual(plan.keep, [
    { start: 0, end: 1000, outputStart: 0, outputEnd: 1000 },
    { start: 5000, end: 8000, outputStart: 1000, outputEnd: 4000 },
    { start: 10000, end: 15000, outputStart: 4000, outputEnd: 9000 },
  ]);
});

test("clipping counts each affected input, including completely out-of-bounds cuts", () => {
  const plan = buildMediaCutPlan([
    { start: 1000, end: 2000 },
    { start: 8000, end: 15000 },
    { start: 12000, end: 13000 },
    { start: 10000, end: 10001 },
    { start: 0, end: 500 },
  ], 10000);
  assert.equal(plan.clippedCutCount, 3);
  assert.deepEqual(plan.cuts, [{ start: 0, end: 500 }, { start: 1000, end: 2000 }, { start: 8000, end: 10000 }]);
  assert.equal(plan.cutDurationMs, 3500);
  assert.equal(plan.outputDurationMs, 6500);
  assert.equal(plan.keep.at(-1).end, 8000);
});

test("all-cut media is explicit rather than inventing an output segment", () => {
  const plan = buildMediaCutPlan([{ start: 0, end: 10000 }], 10000);
  assert.equal(plan.cutDurationMs, 10000);
  assert.equal(plan.outputDurationMs, 0);
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(mapSampleToKeptRanges(plan, 0, 10), []);
});

test("an explicitly uncapped generic plan retains later media after earlier edits", () => {
  const plan = buildMediaCutPlan([{ start: 6000, end: 8000 }, { start: 12000, end: 14000 }], 70000);
  assert.deepEqual(plan.keep[0], { start: 0, end: 6000, outputStart: 0, outputEnd: 6000 });
  assert.deepEqual(plan.keep.at(-1), { start: 14000, end: 70000, outputStart: 10000, outputEnd: 66000 });
  assert.equal(plan.outputDurationMs, 66000);
});

test("VTT endpoint removes the real media tail in addition to explicit cuts", () => {
  const plan = buildMediaCutPlan([{ start: 2000, end: 3000 }, { start: 6000, end: 8000 }], 12000, 10000);
  assert.deepEqual(plan.cuts, [{ start: 2000, end: 3000 }, { start: 6000, end: 8000 }, { start: 10000, end: 12000 }]);
  assert.equal(plan.durationMs, 12000); assert.equal(plan.outputDurationMs, 7000); assert.equal(plan.cutDurationMs, 5000);
  assert.equal(plan.keep[0].start, 0); assert.equal(plan.keep.at(-1).end, 10000);
  assert.deepEqual(mapSampleToKeptRanges(plan, 10, 12), []);
  assert.equal(plan.clippedCutCount, 0);
});

test("automatic tail unions with overlapping manual cuts without mutating input or double counting", () => {
  const cuts = [{ start: 1000, end: 2000 }, { start: 9000, end: 11000 }, { start: 11500, end: 13000 }];
  const original = structuredClone(cuts);
  const plan = buildMediaCutPlan(cuts, 12000, 10000);
  assert.deepEqual(cuts, original);
  assert.deepEqual(plan.cuts, [{ start: 1000, end: 2000 }, { start: 9000, end: 12000 }]);
  assert.equal(plan.cutDurationMs, 4000); assert.equal(plan.outputDurationMs, 8000);
  assert.equal(plan.clippedCutCount, 1);
});

test("equal and longer subtitle ends cannot extend the real input, while zero discards all media", () => {
  for (const subtitleEndMs of [10000, 12000]) {
    const plan = buildMediaCutPlan([], 10000, subtitleEndMs);
    assert.equal(plan.outputDurationMs, 10000); assert.equal(plan.cutDurationMs, 0);
    assert.deepEqual(plan.keep, [{ start: 0, end: 10000, outputStart: 0, outputEnd: 10000 }]);
  }
  const empty = buildMediaCutPlan([], 10000, 0);
  assert.equal(empty.outputDurationMs, 0); assert.equal(empty.cutDurationMs, 10000);
  assert.deepEqual(empty.keep, []);
});

test("subtitle endpoint is exclusive and clips a boundary sample at the exact millisecond", () => {
  const plan = buildMediaCutPlan([{ start: 1000, end: 2000 }], 12000, 10007);
  const pieces = mapSampleToKeptRanges(plan, 9.997, 10.1);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].sourceEnd, 10.007); assert.equal(pieces[0].outputEnd, 9.007);
  assert.deepEqual(mapSampleToKeptRanges(plan, 10.007, 10.1), []);
  assert.equal(plan.outputDurationMs, 9007);
});

test("malformed subtitle caps fail instead of silently retaining or extending media", () => {
  for (const cap of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '1000']) {
    assert.throws(() => buildMediaCutPlan([], 12000, cap), /VTTの終了時刻/);
  }
});

test("invalid durations and ranges fail before clipping", () => {
  for (const duration of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildMediaCutPlan([], duration), /整数ミリ秒/);
  }
  for (const cut of [
    { start: -1, end: 3 }, { start: 2, end: 2 }, { start: 3, end: 2 },
    { start: 0.1, end: 2 }, { start: 0, end: 2.1 }, { start: NaN, end: 3 },
    { start: 0, end: Infinity }, { start: 0, end: Number.MAX_SAFE_INTEGER + 1 }, null,
  ]) assert.throws(() => buildMediaCutPlan([cut], 1000), /カット区間/);
  assert.throws(() => buildMediaCutPlan(null, 1000), /一覧/);
});

test("a sample crossing a cut produces two cropped pieces with continuous output times", () => {
  const plan = buildMediaCutPlan([{ start: 1000, end: 2000 }], 4000);
  assert.deepEqual(mapSampleToKeptRanges(plan, 0.5, 2.5), [
    { sourceStart: 0.5, sourceEnd: 1, outputStart: 0.5, outputEnd: 1 },
    { sourceStart: 2, sourceEnd: 2.5, outputStart: 1, outputEnd: 1.5 },
  ]);
  assert.deepEqual(mapSampleToKeptRanges(plan, 1, 2), []);
  assert.deepEqual(mapSampleToKeptRanges(plan, 2, 3), [{ sourceStart: 2, sourceEnd: 3, outputStart: 1, outputEnd: 2 }]);
});

test("sample intersections preserve submillisecond precision and exact half-open boundaries", () => {
  const plan = buildMediaCutPlan([{ start: 1005, end: 1008 }], 2000);
  assert.deepEqual(mapSampleToKeptRanges(plan, 1.005, 1.008), []);
  const pieces = mapSampleToKeptRanges(plan, 1.0045, 1.0085);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].sourceStart, 1.0045);
  assert.equal(pieces[0].sourceEnd, 1.005);
  assert.equal(pieces[1].sourceStart, 1.008);
  assert.equal(pieces[1].sourceEnd, 1.0085);
  assert.ok(Math.abs(pieces[1].outputStart - 1.005) < 1e-12);
  assert.ok(Math.abs(pieces[1].outputEnd - 1.0055) < 1e-12);
});

test("samples outside the clip are clamped; empty samples are harmless; malformed times fail", () => {
  const plan = buildMediaCutPlan([], 1000);
  assert.deepEqual(mapSampleToKeptRanges(plan, -1, 0.25), [{ sourceStart: 0, sourceEnd: 0.25, outputStart: 0, outputEnd: 0.25 }]);
  assert.deepEqual(mapSampleToKeptRanges(plan, 0.75, 2), [{ sourceStart: 0.75, sourceEnd: 1, outputStart: 0.75, outputEnd: 1 }]);
  assert.deepEqual(mapSampleToKeptRanges(plan, -2, -1), []);
  assert.deepEqual(mapSampleToKeptRanges(plan, 1, 2), []);
  assert.deepEqual(mapSampleToKeptRanges(plan, 0.5, 0.5), []);
  for (const bounds of [[NaN, 1], [0, Infinity], [2, 1]]) assert.throws(() => mapSampleToKeptRanges(plan, ...bounds), /サンプル/);
});

test("70-minute plan with thousands of cuts maps a tail sample with bounded binary search", () => {
  const durationMs = 70 * 60 * 1000;
  const cuts = [];
  for (let start = 500; start < durationMs; start += 1000) cuts.push({ start, end: start + 100 });
  const plan = buildMediaCutPlan(cuts, durationMs);
  assert.equal(plan.cuts.length, 4200);
  assert.equal(plan.keep.length, 4201);
  assert.equal(plan.cutDurationMs, 420000);
  assert.equal(plan.outputDurationMs, 3780000);
  assert.equal(plan.keep.at(-1).end, durationMs);
  let segmentReads = 0;
  const tracked = new Proxy(plan.keep, { get(target, property, receiver) {
    if (typeof property === "string" && /^\d+$/.test(property)) segmentReads++;
    return Reflect.get(target, property, receiver);
  } });
  const result = mapSampleToKeptRanges({ ...plan, keep: tracked }, 4199.85, 4200);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceStart, 4199.85);
  assert.equal(result[0].sourceEnd, 4200);
  assert.ok(Math.abs(result[0].outputStart - 3779.85) < 1e-10);
  assert.equal(result[0].outputEnd, 3780);
  assert.ok(segmentReads <= Math.ceil(Math.log2(plan.keep.length)) + 3, `read ${segmentReads} segments`);
  assert.equal(plan.keep.reduce((sum, piece) => sum + piece.end - piece.start, 0) + plan.cutDurationMs, durationMs);
});
