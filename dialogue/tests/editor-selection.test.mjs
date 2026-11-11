import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVtt, serializeVtt } from '../src/lib/vtt.ts';
import {
  buildDocument, createEditorState, deleteTextSpans, restoreTextSpans,
  deleteLines, deleteTokens, deleteFillers, findFillers, addCut, updateCut,
  getDeletedSpans, getEditedTokenText, getEditedLineText, normalizeCuts,
  buildEditedCues, exportCutJson, exportProjectJson, importProjectJson,
} from '../src/lib/editor.ts';

const cue = (id, text, start = 0, end = 10000) => ({ id, text, start, end, speaker: '話者1', sourceIds: [id], sourceCount: 1 });
const span = (cueId, from, to) => ({ cueId, from, to });
const visible = (doc, state, cueId = doc.cues[0].id) => doc.tokens.filter(t => t.cueId === cueId).map(t => getEditedTokenText(doc, state, t)).join('');
const times = state => normalizeCuts(state.cuts).map(({ start, end }) => [start, end]);

test('selection deletes exact partial-token ranges and only adds previously visible characters', () => {
  const doc = buildDocument([cue('a', 'abcdefghij')]), initial = createEditorState();
  const sourceBefore = JSON.stringify(doc.cues);
  const selected = [span('a', 4, 7), span('a', 2, 5), span('a', 2, 5)];
  const requestBefore = JSON.stringify(selected);
  const first = deleteTextSpans(doc, initial, selected);
  assert.equal(initial.cuts.length, 0);
  assert.equal(JSON.stringify(doc.cues), sourceBefore);
  assert.equal(JSON.stringify(selected), requestBefore);
  assert.equal(first.cuts.length, 1);
  assert.equal(first.cuts[0].kind, 'selection');
  assert.equal(first.cuts[0].precision, 'estimated');
  assert.equal(first.cuts[0].text, 'cdefg');
  assert.deepEqual(first.cuts[0].spans, [span('a', 2, 7)]);
  assert.equal(visible(doc, first), 'abhij');
  const before = JSON.stringify(first);
  const second = deleteTextSpans(doc, first, [span('a', 1, 9), span('a', 3, 8)]);
  assert.equal(JSON.stringify(first), before);
  assert.equal(second.cuts.length, 3);
  assert.deepEqual(second.cuts.slice(1).map(c => c.spans[0]), [span('a', 1, 2), span('a', 7, 9)]);
  assert.equal(visible(doc, second), 'aj');
  assert.deepEqual(times(second), [[1000, 9000]]);
  assert.equal(second.cuts.reduce((sum, c) => sum + c.end - c.start, 0), 8000);
  assert.strictEqual(deleteTextSpans(doc, second, [span('a', 1, 9)]), second);
  assert.strictEqual(restoreTextSpans(doc, second, [span('a', 0, 1)]), second);
});

test('multi-line and multi-cue selections retain exact source offsets and can restore a newline independently', () => {
  const doc = buildDocument([cue('a', 'AB\nCD', 0, 5000), cue('b', 'EFGH', 10000, 14000)]);
  const selected = deleteTextSpans(doc, createEditorState(), [span('b', 0, 2), span('a', 1, 5)]);
  assert.equal(visible(doc, selected, 'a'), 'A');
  assert.equal(visible(doc, selected, 'b'), 'GH');
  assert.deepEqual(times(selected), [[1000, 5000], [10000, 12000]]);
  const restored = restoreTextSpans(doc, selected, [span('a', 2, 4)]);
  assert.equal(visible(doc, restored, 'a'), 'A\nC');
  assert.equal(visible(doc, restored, 'b'), 'GH');
  assert.deepEqual(doc.lines.filter(l => l.cueId === 'a').map(l => getEditedLineText(doc, restored, l)), ['A', 'C']);
  assert.deepEqual(getDeletedSpans(doc, restored), [span('a', 1, 2), span('a', 4, 5), span('b', 0, 2)]);
  assert.deepEqual(times(restored), [[1000, 2000], [4000, 5000], [10000, 12000]]);
  assert.strictEqual(restored.cuts.find(c => c.sourceCueIds[0] === 'b'), selected.cuts.find(c => c.sourceCueIds[0] === 'b'));
  const whole = deleteTextSpans(doc, createEditorState(), [span('b', 0, 4)]);
  assert.equal(whole.cuts[0].precision, 'cue');
  assert.deepEqual(times(whole), [[10000, 14000]]);
});

test('partial restoration of a legacy whole-line cut removes stale line/token refs and splits its video intervals', () => {
  const doc = buildDocument([cue('a', 'alpha beta gamma', 0, 16000)]);
  const deleted = deleteLines(doc, createEditorState(), [doc.lines[0].id]);
  const legacy = { ...deleted, cuts: deleted.cuts.map(({ spans, ...cut }) => cut) };
  const before = JSON.stringify(legacy);
  const restored = restoreTextSpans(doc, legacy, [span('a', 6, 10)]);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(visible(doc, restored), 'beta');
  assert.equal(restored.cuts.length, 2);
  assert.equal(restored.cuts[0].id, legacy.cuts[0].id);
  assert.notEqual(restored.cuts[1].id, legacy.cuts[0].id);
  assert.deepEqual(times(restored), [[0, 6000], [10000, 16000]]);
  assert.ok(restored.cuts.every(c => c.tokenIds === undefined && c.lineIds === undefined && c.precision === 'estimated'));
  assert.deepEqual(restored.cuts.map(c => c.text), ['alpha ', ' gamma']);
  const output = buildEditedCues(doc, restored, { timeline: 'original' });
  assert.deepEqual(output.map(c => [c.text, c.start, c.end]), [['beta', 6000, 10000]]);
  assert.deepEqual(buildEditedCues(doc, restored, { timeline: 'edited' }).map(c => [c.text, c.start, c.end]), [['beta', 0, 4000]]);
  const oneFragment = restoreTextSpans(doc, restored, restored.cuts[0].spans);
  assert.equal(visible(doc, oneFragment), 'alpha beta');
  assert.deepEqual(times(oneFragment), [[10000, 16000]]);
});

test('legacy token-only cuts restore a substring without restoring the surrounding token', () => {
  const doc = buildDocument([cue('a', 'one abcdef two', 0, 14000)]);
  const token = doc.tokens.find(t => t.text === 'abcdef');
  const deleted = deleteTokens(doc, createEditorState(), [token.id]);
  const legacy = { ...deleted, cuts: deleted.cuts.map(({ spans, ...cut }) => cut) };
  const restored = restoreTextSpans(doc, legacy, [span('a', token.from + 2, token.from + 4)]);
  assert.equal(visible(doc, restored), 'one cd two');
  assert.deepEqual(restored.cuts.map(c => c.text), ['ab', 'ef']);
  assert.deepEqual(times(restored), [[4000, 6000], [8000, 10000]]);
});

test('restoring part of one filler does not restore another filler from the same batch', () => {
  const doc = buildDocument([cue('a', 'えっと、開始。まあ、続き。', 0, 13000)]);
  const candidates = findFillers(doc);
  assert.equal(candidates.length, 2);
  const deleted = deleteFillers(doc, createEditorState(), candidates);
  const second = deleted.cuts[1];
  const restored = restoreTextSpans(doc, deleted, [span('a', 1, 3)]);
  assert.equal(visible(doc, restored), 'っと開始。続き。');
  assert.deepEqual(restored.cuts.slice(0, 2).map(c => c.text), ['え', '、']);
  assert.strictEqual(restored.cuts.at(-1), second);
  assert.deepEqual(times(restored), [[0, 1000], [3000, 4000], [7000, 10000]]);
  assert.ok(restored.cuts.slice(0, 2).every(c => c.tokenIds === undefined && c.lineIds === undefined));
  // Older/custom projects may store several filler spans in one edit record.
  const batch = addCut(createEditorState(), { id: 'legacy-batch', start: 0, end: 10000, kind: 'filler', precision: 'estimated', sourceCueIds: ['a'], spans: candidates.flatMap(c => c.spans), tokenIds: candidates.flatMap(c => c.tokenIds) });
  const batchRestored = restoreTextSpans(doc, batch, candidates[0].spans);
  assert.equal(visible(doc, batchRestored), 'えっと、開始。続き。');
  assert.deepEqual(batchRestored.cuts[0].spans, candidates[1].spans);
  assert.deepEqual(times(batchRestored), [[7000, 10000]]);
});

test('restoration subtracts a range from every overlapping textual edit and leaves media-only edits untouched', () => {
  const doc = buildDocument([cue('a', 'abcdefghij')]);
  let state = deleteTextSpans(doc, createEditorState(), [span('a', 2, 8)]);
  state = addCut(state, { id: 'overlap', start: 4000, end: 6000, kind: 'word', precision: 'estimated', sourceCueIds: ['a'], spans: [span('a', 4, 6)] });
  state = addCut(state, { id: 'silence', start: 2500, end: 3500, kind: 'silence', precision: 'audio', text: '音声の無音', sourceCueIds: ['a'] });
  state = addCut(state, { id: 'manual', start: 8000, end: 8500, kind: 'manual', precision: 'manual', text: '音声だけの手動編集', sourceCueIds: ['a'] });
  const restored = restoreTextSpans(doc, state, [span('a', 5, 7)]);
  assert.equal(visible(doc, restored), 'abfgij');
  assert.deepEqual(getDeletedSpans(doc, restored), [span('a', 2, 5), span('a', 7, 8)]);
  assert.deepEqual(times(restored), [[2000, 5000], [7000, 8500]]);
  for (const id of ['silence', 'manual']) assert.strictEqual(restored.cuts.find(c => c.id === id), state.cuts.find(c => c.id === id));
  const allText = restoreTextSpans(doc, restored, [span('a', 0, 10)]);
  assert.equal(visible(doc, allText), 'abcdefghij');
  assert.deepEqual(allText.cuts.map(c => c.id), ['silence', 'manual']);
  assert.deepEqual(times(allText), [[2500, 3500], [8000, 8500]]);
});

test('partial restoration proportionally maps adjusted media bounds and preserves surviving outer endpoints', () => {
  const doc = buildDocument([cue('a', 'abcdefghij')]);
  const deleted = deleteTextSpans(doc, createEditorState(), [span('a', 2, 8)]);
  const adjusted = updateCut(deleted, deleted.cuts[0].id, { start: 1500, end: 9500, precision: 'manual' });
  const restored = restoreTextSpans(doc, adjusted, [span('a', 4, 6)]);
  assert.deepEqual(times(restored), [[1500, 4167], [6833, 9500]]);
  assert.deepEqual(restored.cuts.map(c => c.text), ['cd', 'gh']);
  assert.ok(restored.cuts.every(c => c.precision === 'estimated'));
  assert.equal(visible(doc, restored), 'abefij');
  const restoredLeft = restoreTextSpans(doc, adjusted, [span('a', 2, 4)]);
  assert.deepEqual(times(restoredLeft), [[4167, 9500]]);
  const restoredRight = restoreTextSpans(doc, adjusted, [span('a', 6, 8)]);
  assert.deepEqual(times(restoredRight), [[1500, 6833]]);
  assert.deepEqual(times(adjusted), [[1500, 9500]]);
});

test('multi-cue legacy records split into exact remaining spans with no stale cross-cue references', () => {
  const doc = buildDocument([cue('a', 'ABCD', 1000, 5000), cue('b', 'WXYZ', 10000, 14000)]);
  const state = addCut(createEditorState(), { id: 'multi-cue', start: 2000, end: 13000, kind: 'selection', precision: 'estimated', sourceCueIds: ['a', 'b'], spans: [span('a', 1, 3), span('b', 1, 3)] });
  const restored = restoreTextSpans(doc, state, [span('a', 2, 3), span('b', 1, 2)]);
  assert.equal(visible(doc, restored, 'a'), 'ACD');
  assert.equal(visible(doc, restored, 'b'), 'WXZ');
  assert.deepEqual(restored.cuts.map(c => c.spans), [[span('a', 1, 2)], [span('b', 2, 3)]]);
  assert.deepEqual(restored.cuts.map(c => c.sourceCueIds), [['a'], ['b']]);
  assert.deepEqual(times(restored), [[2000, 3000], [12000, 13000]]);
});

test('source offsets validate atomically and cannot split a surrogate pair', () => {
  const doc = buildDocument([cue('a', 'A😀BC𠮷D', 0, 6000)]), initial = createEditorState();
  const deleted = deleteTextSpans(doc, initial, [span('a', 1, 3)]);
  assert.equal(visible(doc, deleted), 'ABC𠮷D');
  assert.deepEqual(times(deleted), [[1000, 2000]]);
  for (const invalid of [span('missing', 0, 1), span('a', -1, 1), span('a', 0, 9), span('a', 3, 1), span('a', 0.5, 1), span('a', 0, NaN), span('a', 0, Infinity), span('a', 2, 3), span('a', 1, 2), span('a', 6, 7), span('a', 2, 2)]) {
    assert.throws(() => deleteTextSpans(doc, initial, [span('a', 0, 1), invalid]));
    assert.throws(() => restoreTextSpans(doc, deleted, [span('a', 1, 3), invalid]));
  }
  assert.equal(initial.cuts.length, 0);
  assert.equal(visible(doc, deleted), 'ABC𠮷D');
  assert.strictEqual(deleteTextSpans(doc, initial, [span('a', 3, 3)]), initial);
  assert.strictEqual(restoreTextSpans(doc, deleted, []), deleted);
  assert.equal(visible(doc, restoreTextSpans(doc, deleted, [span('a', 1, 3)])), 'A😀BC𠮷D');
  const whole = deleteTextSpans(doc, initial, [span('a', 0, 8)]);
  const restored = restoreTextSpans(doc, whole, [span('a', 1, 3)]);
  assert.equal(visible(doc, restored), '😀');
  assert.deepEqual(times(restored), [[0, 1000], [2000, 6000]]);
});

test('sub-millisecond character positions remain valid bounded estimated media cuts', () => {
  const doc = buildDocument([cue('a', 'A😀BCD', 500, 501)]);
  const deleted = deleteTextSpans(doc, createEditorState(), [span('a', 0, 6)]);
  const restored = restoreTextSpans(doc, deleted, [span('a', 1, 3)]);
  assert.equal(visible(doc, restored), '😀');
  assert.ok(restored.cuts.every(c => Number.isSafeInteger(c.start) && Number.isSafeInteger(c.end) && c.start >= 500 && c.end <= 501 && c.end > c.start && c.precision === 'estimated'));
});

test('selection/restoration roundtrips schema 1 projects and VTT/cut exports reflect the restored text and media', () => {
  const doc = buildDocument([cue('a', 'alpha beta gamma', 0, 16000)]);
  const deleted = deleteTextSpans(doc, createEditorState(), [span('a', 0, 16)]);
  const restored = restoreTextSpans(doc, deleted, [span('a', 6, 10)]);
  const project = exportProjectJson(doc, restored, { sourceFile: '会議.vtt', mediaDurationMs: 20000 });
  assert.equal(JSON.parse(project).schemaVersion, 1);
  const loaded = importProjectJson(project);
  assert.equal(loaded.sourceFile, '会議.vtt');
  assert.deepEqual(loaded.state, restored);
  assert.equal(visible(loaded.doc, loaded.state), 'beta');
  const original = buildEditedCues(loaded.doc, loaded.state, { timeline: 'original' });
  const edited = buildEditedCues(loaded.doc, loaded.state, { timeline: 'edited' });
  assert.deepEqual(parseVtt(serializeVtt(original)).cues.map(c => [c.text, c.start, c.end]), [['beta', 6000, 10000]]);
  assert.deepEqual(parseVtt(serializeVtt(edited)).cues.map(c => [c.text, c.start, c.end]), [['beta', 0, 4000]]);
  const log = JSON.parse(exportCutJson(loaded.doc, loaded.state, { sourceFile: loaded.sourceFile, mediaDurationMs: 20000 }));
  assert.deepEqual(log.cutRanges.map(c => [c.start, c.end]), [[0, 6000], [10000, 20000]]);
  assert.ok(log.cutRanges.every(c => c.estimated && c.kinds.includes('selection')));
  assert.ok(log.cutRanges.at(-1).kinds.includes('tail'));
  assert.equal(log.truncateAfterMs, 16000);
  assert.deepEqual(log.keepRanges.map(c => [c.start, c.end]), [[6000, 10000]]);
  assert.equal(restoreTextSpans(loaded.doc, loaded.state, [span('a', 0, 16)]).cuts.length, 0);

  const unicode = buildDocument([cue('unicode', 'A😀B')]);
  const bad = JSON.parse(exportProjectJson(unicode, deleteTextSpans(unicode, createEditorState(), [span('unicode', 1, 3)]), { sourceFile: 'unicode.vtt' }));
  bad.state.cuts[0].spans[0].from = 2;
  assert.throws(() => importProjectJson(JSON.stringify(bad)), /文字の途中/);
});

test('real transcript selections and independent fragment restores preserve all other source text', { skip: !process.env.VTT_TEST_FILE }, () => {
  const doc = buildDocument(parseVtt(readFileSync(process.env.VTT_TEST_FILE, 'utf8')).cues);
  assert.equal(doc.cues.length, 693);
  const selectedCues = doc.cues.filter(c => [...c.text].length >= 8).slice(0, 6);
  const selections = selectedCues.map(c => ({ cueId: c.id, from: [...c.text].slice(0, 1).join('').length, to: [...c.text].slice(0, 7).join('').length }));
  const deleted = deleteTextSpans(doc, createEditorState(), selections);
  const target = selections[2], targetCue = doc.cueById.get(target.cueId);
  const restore = span(target.cueId, target.from, target.from + [...targetCue.text.slice(target.from, target.to)].slice(0, 2).join('').length);
  const restored = restoreTextSpans(doc, deleted, [restore]);
  for (const source of doc.cues) {
    const selected = selections.find(s => s.cueId === source.id);
    const expected = !selected ? source.text : source.text.slice(0, selected.from) + (selected.cueId === restore.cueId ? source.text.slice(restore.from, restore.to) : '') + source.text.slice(selected.to);
    assert.equal(visible(doc, restored, source.id), expected);
  }
  const loaded = importProjectJson(exportProjectJson(doc, restored, { sourceFile: 'transcript.vtt' }));
  assert.deepEqual(loaded.state, restored);
  assert.deepEqual(loaded.doc.cues, JSON.parse(JSON.stringify(doc.cues)));
  assert.equal(new Set(restored.cuts.map(c => c.id)).size, restored.cuts.length);
});
