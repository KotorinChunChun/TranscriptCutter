import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY_LIMIT, pushHistory, redoHistory, resetHistory, undoHistory } from "../src/lib/editor-history.ts";
import { isAudioOnlyFile, isEditorMediaFile, isRecognitionMediaName } from "../src/lib/media-file.ts";

const state = id => ({ id });

test("history push, undo and redo keep the present and clear redo after a new edit", () => {
  let history = resetHistory(state(0));
  history = pushHistory(history, () => state(1));
  history = pushHistory(history, () => state(2));
  assert.deepEqual(history.past.map(s => s.id), [0, 1]);
  history = undoHistory(history);
  assert.equal(history.present.id, 1);
  assert.deepEqual(history.future.map(s => s.id), [2]);
  history = redoHistory(history);
  assert.equal(history.present.id, 2);
  history = undoHistory(history);
  history = pushHistory(history, () => state(3));
  assert.deepEqual(history.future, []);
  assert.equal(history.present.id, 3);
});

test("history ignores no-op edits and empty undo/redo, and keeps only the latest entries", () => {
  const start = resetHistory(state(0));
  assert.equal(pushHistory(start, s => s), start);
  assert.equal(undoHistory(start), start);
  assert.equal(redoHistory(start), start);
  let history = start;
  for (let i = 1; i <= HISTORY_LIMIT + 5; i++) history = pushHistory(history, () => state(i));
  assert.equal(history.past.length, HISTORY_LIMIT);
  assert.equal(history.past[0].id, 5);
  assert.throws(() => pushHistory(history, () => { throw new Error("x"); }), /x/);
});

test("media checks keep editor, audio player and recognition formats separate", () => {
  assert.equal(isEditorMediaFile({ name: "a.MP4", type: "" }), true);
  assert.equal(isEditorMediaFile({ name: "a.bin", type: "video/mp4" }), true);
  assert.equal(isEditorMediaFile({ name: "a.avi", type: "" }), false);
  assert.equal(isEditorMediaFile({ name: "a.vtt", type: "text/vtt" }), false);
  assert.equal(isAudioOnlyFile({ name: "a.m4a", type: "" }), true);
  assert.equal(isAudioOnlyFile({ name: "a.mp4", type: "video/mp4" }), false);
  assert.equal(isAudioOnlyFile({ name: "a.mp4", type: "audio/mp4" }), true);
  assert.equal(isRecognitionMediaName("a.avi"), true);
  assert.equal(isRecognitionMediaName("a.m2ts"), true);
  assert.equal(isRecognitionMediaName("a.vtt"), false);
});
