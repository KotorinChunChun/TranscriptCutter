import test from "node:test";
import assert from "node:assert/strict";

import { analyzeAudioSilence, detectSubtitleGaps } from "../src/lib/silence.ts";

function makeWav({ bits = 16, channels = 1, sampleRate = 8000, seconds = 4, float = false, sample = (time) => time >= 1 && time < 3 ? 0 : 0.5 } = {}) {
  const frames = Math.round(sampleRate * seconds);
  const bytesPerSample = bits / 8;
  const blockAlign = bytesPerSample * channels;
  const buffer = new ArrayBuffer(44 + frames * blockAlign);
  const view = new DataView(buffer);
  const ascii = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, float ? 3 : 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, bits, true);
  ascii(36, "data"); view.setUint32(40, frames * blockAlign, true);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const offset = 44 + (frame * channels + channel) * bytesPerSample;
      const value = sample(frame / sampleRate, channel);
      if (float) view.setFloat32(offset, value, true);
      else if (bits === 16) view.setInt16(offset, Math.round(value * 32767), true);
      else if (bits === 24) {
        const integer = Math.round(value * 8388607);
        view.setUint8(offset, integer & 255); view.setUint8(offset + 1, (integer >> 8) & 255); view.setUint8(offset + 2, (integer >> 16) & 255);
      } else if (bits === 32) view.setInt32(offset, Math.round(value * 2147483647), true);
      else view.setUint8(offset, Math.round(value * 127 + 128));
    }
  }
  return new File([buffer], "test.wav", { type: "audio/wav" });
}

test("subtitle gaps are sorted union gaps, never asserted to be silence", () => {
  const cues = [{ start: 4000, end: 5000 }, { start: 1000, end: 2500 }, { start: 2000, end: 3000 }, { start: -200, end: 100 }, { start: NaN, end: 7 }];
  assert.deepEqual(detectSubtitleGaps(cues, { minDurationMs: 500, paddingMs: 100, durationMs: 6500 }), [
    { start: 200, end: 900, kind: "gap", precision: "gap" },
    { start: 3100, end: 3900, kind: "gap", precision: "gap" },
    { start: 5100, end: 6400, kind: "gap", precision: "gap" },
  ]);
  assert.deepEqual(detectSubtitleGaps([], { durationMs: 1000, minDurationMs: 200, paddingMs: 100 }), [{ start: 100, end: 900, kind: "gap", precision: "gap" }]);
  assert.deepEqual(detectSubtitleGaps([], {}), []);
});

for (const encoding of [{ bits: 16 }, { bits: 24 }, { bits: 32 }, { bits: 32, float: true }]) {
  test(`${encoding.float ? "float" : "PCM"} ${encoding.bits}-bit detects known quiet interval with retained padding`, async () => {
    const result = await analyzeAudioSilence(makeWav(encoding));
    assert.equal(result.durationMs, 4000);
    assert.deepEqual(result.ranges, [{ start: 1120, end: 2880, kind: "silence", precision: "audio" }]);
    assert.match(result.method, /WAV分割読込/);
  });
}

test("opposite-polarity stereo cannot cancel into false silence", async () => {
  const result = await analyzeAudioSilence(makeWav({ channels: 2, sample: (time, channel) => time >= 1 && time < 3 ? 0 : channel ? -0.5 : 0.5 }));
  assert.deepEqual(result.ranges, [{ start: 1120, end: 2880, kind: "silence", precision: "audio" }]);
});

test("all-quiet clips, short runs, amplitude threshold, and capped analysis have correct boundaries", async () => {
  const quiet = await analyzeAudioSilence(makeWav({ sample: () => 0.005 }), { durationMs: 2000 });
  assert.equal(quiet.durationMs, 4000);
  assert.deepEqual(quiet.ranges, [{ start: 120, end: 1880, kind: "silence", precision: "audio" }]);
  assert.deepEqual((await analyzeAudioSilence(makeWav({ sample: () => 0.02 }))).ranges, []);
  assert.deepEqual((await analyzeAudioSilence(makeWav({ seconds: 1, sample: () => 0 }))).ranges, []);
  assert.deepEqual((await analyzeAudioSilence(makeWav(), { durationMs: 0 })).ranges, []);
});

test("70-minute virtual PCM recording uses bounded slices and never full-file decoding", async () => {
  const headerFile = makeWav({ seconds: 0 });
  const header = new Uint8Array(await headerFile.arrayBuffer());
  const frames = 8000 * 70 * 60;
  const fileSize = 44 + frames * 2;
  new DataView(header.buffer).setUint32(4, fileSize - 8, true);
  new DataView(header.buffer).setUint32(40, frames * 2, true);
  let maximumRead = 0;
  let reads = 0;
  const virtualFile = {
    size: fileSize,
    name: "70-minutes.wav",
    arrayBuffer() { throw new Error("full-file read is prohibited"); },
    slice(start, end) {
      maximumRead = Math.max(maximumRead, end - start);
      reads++;
      const bytes = new Uint8Array(end - start);
      if (start < header.length) bytes.set(header.slice(start, Math.min(end, header.length)));
      return new Blob([bytes]);
    },
  };
  const progress = [];
  const result = await analyzeAudioSilence(virtualFile, { onProgress: (value) => progress.push(value) });
  assert.equal(result.durationMs, 70 * 60 * 1000);
  assert.deepEqual(result.ranges, [{ start: 120, end: 70 * 60 * 1000 - 120, kind: "silence", precision: "audio" }]);
  assert.ok(maximumRead <= 1024 * 1024);
  assert.ok(reads > 50);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => value >= 0 && value <= 1 && (index === 0 || value >= progress[index - 1])));
});

test("cancellation works before and during analysis", async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(analyzeAudioSilence(makeWav(), { signal: before.signal }), { name: "AbortError" });
  const during = new AbortController();
  await assert.rejects(analyzeAudioSilence(makeWav({ seconds: 60 }), { signal: during.signal, onProgress: (value) => { if (value >= 0.02) during.abort(); } }), { name: "AbortError" });
});

test("invalid configuration and corrupt/non-PCM WAV fail with actionable errors", async () => {
  assert.throws(() => detectSubtitleGaps([], { paddingMs: -1 }), /0以上/);
  await assert.rejects(analyzeAudioSilence(makeWav(), { thresholdDb: 1 }), /-120/);
  const bytes = await makeWav().arrayBuffer();
  new DataView(bytes).setUint16(20, 2, true);
  await assert.rejects(analyzeAudioSilence(new File([bytes], "compressed.wav")), /PCM WAV/);
  await assert.rejects(analyzeAudioSilence(new File([bytes.slice(0, 60)], "truncated.wav")), /途中で切れ/);
  await assert.rejects(analyzeAudioSilence(makeWav({ bits: 32, float: true, sample: () => NaN })), /無効な音声値/);
});
