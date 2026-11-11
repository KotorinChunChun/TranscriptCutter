import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocument, createEditorState, resolveEditorDocument, replaceCueText,
  changeSelectionSpeaker, deleteTextSpans, deleteTokens, deleteLines,
  restoreTextSpans, addCut, updateCut, getDeletedSpans, getEditedLineText,
  buildGroups, buildEditedCues, exportProjectJson, importProjectJson,
  exportCutJson, getTranscriptTailCut, renameSpeaker, mergeWithNeighbor,
} from '../src/lib/editor.ts';
import { parseVtt, serializeVtt } from '../src/lib/vtt.ts';

const cue = (id, text, start = 0, end = 10000, speaker = '話者1') => ({ id, text, start, end, speaker, sourceIds: [id], sourceCount: 1 });
const span = (cueId, from, to) => ({ cueId, from, to });
const visible = (doc, state) => doc.lines.map(line => getEditedLineText(doc, state, line)).join('');
const mediaBounds = state => state.cuts.map(cut => [cut.id, cut.start, cut.end, cut.precision]);
const resolved = (base, state) => resolveEditorDocument(base, state);

test('typo correction preserves media bounds and original source, and resolves once per revision', () => {
  const base = buildDocument([cue('a', '資料を確忍します。', 1000, 9000)]), initial = createEditorState();
  const next = replaceCueText(base, initial, 'a', '資料を確認します。');
  const doc = resolved(base, next);
  assert.equal(base.cues[0].text, '資料を確忍します。');
  assert.equal(doc.cues[0].text, '資料を確認します。');
  assert.deepEqual([doc.cues[0].start, doc.cues[0].end], [1000, 9000]);
  assert.deepEqual(next.cuts, []);
  assert.strictEqual(resolved(base, initial), base);
  assert.strictEqual(resolved(base, next), doc);
  assert.strictEqual(resolved(base, { ...next, aliases: { 話者1: '佐藤' } }), doc);
  assert.strictEqual(replaceCueText(doc, next, 'a', doc.cues[0].text), next);
  assert.equal(parseVtt(serializeVtt(buildEditedCues(doc, next))).cues[0].text, '資料を確認します。');
});

test('length-changing corrections shift existing deletion offsets but never move adjusted cut times', () => {
  const base = buildDocument([cue('a', '誤字。えっと、後半です。')]);
  let state = deleteTextSpans(base, createEditorState(), [span('a', 3, 7)]);
  state = updateCut(state, state.cuts[0].id, { start: 1200, end: 3500, precision: 'manual' });
  const next = replaceCueText(base, state, 'a', '正しい文字。えっと、後半です。');
  const doc = resolved(base, next);
  assert.equal(visible(doc, next), '正しい文字。後半です。');
  assert.deepEqual(getDeletedSpans(doc, next), [span('a', 6, 10)]);
  assert.deepEqual(mediaBounds(next), mediaBounds(state));
  assert.equal(next.cuts[0].text, 'えっと、');
  assert.equal(visible(base, state), '誤字。後半です。');
});

test('correcting deleted words keeps them deleted and restoration uses their new text', () => {
  const base = buildDocument([cue('a', '頭 誤字 尾')]);
  const state = deleteTextSpans(base, createEditorState(), [span('a', 2, 4)]);
  const next = replaceCueText(base, state, 'a', '頭 正しい字 尾');
  const doc = resolved(base, next);
  assert.equal(visible(doc, next), '頭  尾');
  assert.deepEqual(mediaBounds(next), mediaBounds(state));
  assert.deepEqual(getDeletedSpans(doc, next), [span('a', 2, 6)]);
  const restored = restoreTextSpans(doc, next, [span('a', 2, 6)]);
  assert.equal(visible(doc, restored), '頭 正しい字 尾');
  assert.equal(restored.cuts.length, 0);
});

test('insertions inside a deletion stay deleted while insertion before its boundary remains visible', () => {
  const base = buildDocument([cue('a', 'ABCDE')]);
  const state = deleteTextSpans(base, createEditorState(), [span('a', 1, 4)]);
  const internal = replaceCueText(base, state, 'a', 'AB追加CDE');
  assert.equal(visible(resolved(base, internal), internal), 'AE');
  const boundary = replaceCueText(base, state, 'a', 'A追加BCDE');
  assert.equal(visible(resolved(base, boundary), boundary), 'A追加E');
  const whole = deleteTextSpans(base, createEditorState(), [span('a', 0, 5)]);
  const wholeUpdated = replaceCueText(base, whole, 'a', '追加ABCDE末尾');
  assert.equal(visible(resolved(base, wholeUpdated), wholeUpdated), '');
});

test('removing already-deleted characters preserves the independent media cut', () => {
  const base = buildDocument([cue('a', '前えっと後')]);
  const state = deleteTextSpans(base, createEditorState(), [span('a', 1, 4)]);
  const next = replaceCueText(base, state, 'a', '前後');
  const doc = resolved(base, next);
  assert.equal(visible(doc, next), '前後');
  assert.deepEqual(next.cuts[0].spans, []);
  assert.deepEqual(mediaBounds(next), mediaBounds(state));
  assert.deepEqual(importProjectJson(exportProjectJson(doc, next, { sourceFile: 'test.vtt' })).state.cuts[0].spans, []);
});

test('legacy token/line references are normalized to valid spans after text corrections', () => {
  const base = buildDocument([cue('a', 'one two three\nsecond line')]);
  let state = deleteTokens(base, createEditorState(), [base.tokens.find(token => token.text === 'two').id]);
  state = deleteLines(base, state, [base.lines[1].id]);
  const legacy = { ...state, cuts: state.cuts.map(({ spans, ...cut }) => cut) };
  const next = replaceCueText(base, legacy, 'a', 'first one two three\nsecond line');
  const doc = resolved(base, next);
  assert.equal(visible(doc, next), 'first one  three');
  assert.deepEqual(mediaBounds(next), mediaBounds(legacy));
  assert.ok(next.cuts.every(cut => cut.tokenIds === undefined && cut.lineIds === undefined));
  assert.doesNotThrow(() => importProjectJson(exportProjectJson(doc, next, { sourceFile: 'test.vtt' })));
});

test('Unicode correction and split boundaries never divide surrogate pairs', () => {
  const base = buildDocument([cue('a', 'A😀BC𠮷D', 0, 6000)]);
  const state = deleteTextSpans(base, createEditorState(), [span('a', 1, 3)]);
  const next = replaceCueText(base, state, 'a', '前A🚀BC𠮷D');
  const doc = resolved(base, next);
  assert.equal(visible(doc, next), '前ABC𠮷D');
  assert.deepEqual(getDeletedSpans(doc, next), [span('a', 2, 4)]);
  const split = changeSelectionSpeaker(doc, next, [span('a', 6, 8)], '話者2');
  assert.equal(resolved(base, split).cues.map(cue => cue.text).join(''), '前A🚀BC𠮷D');
  assert.throws(() => changeSelectionSpeaker(doc, next, [span('a', 3, 4)], '話者2'), /文字の途中/);
  assert.throws(() => replaceCueText(base, state, 'a', 'bad\ud800'), /不完全/);
});

test('mid-sentence speaker selection splits prefix/selection/suffix while preserving source and endpoint', () => {
  const base = buildDocument([cue('a', '前半後半末尾', 1000, 7000)]);
  const state = changeSelectionSpeaker(base, createEditorState(), [span('a', 2, 4)], '話者2');
  const doc = resolved(base, state);
  assert.deepEqual(doc.cues.map(cue => [cue.text, cue.start, cue.end, cue.speaker]), [['前半', 1000, 3000, '話者1'], ['後半', 3000, 5000, '話者2'], ['末尾', 5000, 7000, '話者1']]);
  assert.equal(new Set(doc.cues.map(cue => cue.id)).size, 3);
  assert.ok(doc.cues.every(cue => cue.sourceIds[0] === 'a' && cue.estimatedTiming));
  assert.ok(doc.lines.every(line => line.precision === 'estimated'));
  assert.ok(buildEditedCues(doc, state).every(cue => cue.precision === 'estimated'));
  assert.equal(doc.durationMs, base.durationMs);
  assert.deepEqual([getTranscriptTailCut(doc, 9000).start, getTranscriptTailCut(doc, 9000).end], [7000, 9000]);
  const cut = deleteLines(doc, state, [doc.lines[1].id]);
  assert.equal(cut.cuts[0].precision, 'estimated');
});

test('from-selection scope affects one cue through its end and refuses multi-cue ambiguity', () => {
  const base = buildDocument([cue('a', 'ABCD', 0, 4000), cue('b', 'EFGH', 4000, 8000)]);
  const state = changeSelectionSpeaker(base, createEditorState(), [span('a', 1, 2)], '話者2', { scope: 'fromSelection' });
  assert.deepEqual(resolved(base, state).cues.map(cue => [cue.text, cue.speaker]), [['A', '話者1'], ['BCD', '話者2'], ['EFGH', '話者1']]);
  assert.throws(() => changeSelectionSpeaker(base, createEditorState(), [span('a', 1, 2), span('b', 1, 2)], '話者2', { scope: 'fromSelection' }), /1つの字幕/);
});

test('speaker splits remap deletion spans and preserve manual cut bounds, aliases and other cues', () => {
  const base = buildDocument([cue('a', 'ABCDEFGHIJ'), cue('b', '次の字幕', 11000, 15000)]);
  let state = deleteTextSpans(base, createEditorState(), [span('a', 2, 8)]);
  state = updateCut(state, state.cuts[0].id, { start: 1500, end: 8500, precision: 'manual' });
  state = addCut(state, { id: 'silence', kind: 'silence', precision: 'audio', start: 10100, end: 10800, sourceCueIds: [] });
  state = renameSpeaker(state, '話者1', '佐藤');
  const next = changeSelectionSpeaker(base, state, [span('a', 4, 6)], '話者2');
  const doc = resolved(base, next);
  assert.equal(visible(doc, next), 'ABIJ次の字幕');
  assert.deepEqual(mediaBounds(next), mediaBounds(state));
  assert.deepEqual(next.aliases, state.aliases);
  assert.strictEqual(next.cuts[1], state.cuts[1]);
  assert.strictEqual(next.cueRevisions.at(-1), base.cues[1]);
  assert.ok(next.cuts[0].sourceCueIds.every(id => doc.cueById.has(id)));
  assert.ok(next.cuts[0].spans.every(span => doc.cueById.has(span.cueId)));
  assert.equal(next.cuts[0].spans.length, 3);
  assert.equal(visible(doc, restoreTextSpans(doc, next, next.cuts[0].spans)), 'ABCDEFGHIJ次の字幕');
});

test('multi-cue selected-only speaker changes preserve all text and existing cuts', () => {
  const base = buildDocument([cue('a', 'ABCD', 0, 4000), cue('b', 'EFGH', 4000, 8000)]);
  const state = deleteTextSpans(base, createEditorState(), [span('b', 1, 2)]);
  const next = changeSelectionSpeaker(base, state, [span('a', 2, 4), span('b', 0, 2)], '話者2');
  const doc = resolved(base, next);
  assert.equal(doc.cues.map(cue => cue.text).join(''), 'ABCDEFGH');
  assert.equal(visible(doc, next), 'ABCDEGH');
  assert.deepEqual(buildGroups(doc, next).map(group => [group.speaker, group.text]), [['話者1', 'AB'], ['話者2', 'CD\nE'], ['話者1', 'GH']]);
  assert.deepEqual(mediaBounds(next), mediaBounds(state));
});

test('forced joins cannot swallow a newly changed speaker on either adjacent edge', () => {
  const base = buildDocument([cue('a', 'AA', 0, 2000, '話者1'), cue('b', 'BBBB', 2000, 6000, '話者1 / 話者2'), cue('c', 'CC', 6000, 8000, '話者1')]);
  const state = mergeWithNeighbor(base, createEditorState(), 'group-b', 'up', { merge: false });
  assert.ok(state.forcedJoins.includes('a'));
  const changed = changeSelectionSpeaker(base, state, [span('b', 0, 2)], '話者2');
  assert.equal(changed.forcedJoins.includes('a'), false);
  assert.deepEqual(buildGroups(resolved(base, changed), changed).map(group => group.speaker), ['話者1', '話者2', '話者1']);
  const kept = changeSelectionSpeaker(base, state, [span('b', 2, 4)], '話者2');
  assert.ok(kept.forcedJoins.includes('a'));
  assert.deepEqual(buildGroups(resolved(base, kept), kept, { merge: false }).map(group => group.speaker), ['話者1', '話者2', '話者1']);
});

test('whole-cue speaker changes keep IDs and exact timing, and unchanged speakers are no-ops', () => {
  const base = buildDocument([cue('a', 'ABCD', 0, 4000)]), state = createEditorState();
  assert.strictEqual(changeSelectionSpeaker(base, state, [span('a', 1, 2)], '話者1'), state);
  const next = changeSelectionSpeaker(base, state, [span('a', 0, 4)], '話者2');
  assert.equal(resolved(base, next).cues[0].id, 'a');
  assert.equal(resolved(base, next).cues[0].estimatedTiming, undefined);
  assert.equal(resolved(base, next).lines[0].precision, 'cue');
});

test('project flattening restores corrected text, split speakers, precision and cuts without duplicate revisions', () => {
  const base = buildDocument([cue('a', 'ABCD', 1000, 5000)]);
  let state = replaceCueText(base, createEditorState(), 'a', 'AB修正CD');
  let doc = resolved(base, state);
  state = changeSelectionSpeaker(doc, state, [span('a', 2, 4)], '話者2'); doc = resolved(base, state);
  state = deleteTextSpans(doc, state, [span(doc.cues[2].id, 0, 1)]);
  const raw = exportProjectJson(base, state, { sourceFile: 'test.vtt', mediaDurationMs: 9000 });
  const json = JSON.parse(raw);
  assert.equal(json.state.cueRevisions, undefined);
  const loaded = importProjectJson(raw);
  assert.equal(loaded.doc.cues.map(cue => cue.text).join(''), 'AB修正CD');
  assert.deepEqual(loaded.doc.cues.map(cue => cue.speaker), ['話者1', '話者2', '話者1']);
  assert.equal(visible(loaded.doc, loaded.state), 'AB修正D');
  assert.ok(loaded.doc.lines.every(line => line.precision === 'estimated'));
  assert.deepEqual(mediaBounds(loaded.state), mediaBounds(state));
  assert.equal(loaded.doc.durationMs, 5000);
  assert.equal(JSON.parse(exportCutJson(loaded.doc, loaded.state, { sourceFile: 'test.vtt', mediaDurationMs: 9000 })).truncateAfterMs, 5000);
  json.cues[0].estimatedTiming = 'pretend';
  assert.throws(() => importProjectJson(JSON.stringify(json)), /精度/);
});

test('successive revisions remain independently undoable and corrections after split retain estimated timing', () => {
  const base = buildDocument([cue('a', 'ABCD', 0, 4000)]), initial = createEditorState();
  const corrected = replaceCueText(base, initial, 'a', 'AB修正CD');
  const split = changeSelectionSpeaker(resolved(base, corrected), corrected, [span('a', 2, 4)], '話者2');
  const splitDoc = resolved(base, split);
  const correctedAgain = replaceCueText(splitDoc, split, splitDoc.cues[1].id, '訂正');
  assert.equal(resolved(base, initial).cues.map(cue => cue.text).join(''), 'ABCD');
  assert.equal(resolved(base, corrected).cues.map(cue => cue.text).join(''), 'AB修正CD');
  assert.equal(resolved(base, split).cues.map(cue => cue.text).join(''), 'AB修正CD');
  assert.equal(resolved(base, correctedAgain).cues.map(cue => cue.text).join(''), 'AB訂正CD');
  assert.ok(resolved(base, correctedAgain).cues.every(cue => cue.estimatedTiming));
});

const multiDocument = payload => buildDocument(parseVtt(`WEBVTT\n\n00:00:01.000 --> 00:00:21.000\n${payload}`).cues);
const exported = (doc, state) => parseVtt(serializeVtt(buildEditedCues(doc, state, { merge: false }))).cues;
const speakerText = cues => cues.map(cue => [cue.speaker, cue.text]);

test('multi-voice typo correction preserves individual voices and original source bounds on VTT roundtrip', () => {
  const multi = multiDocument('<v 甲>今日は確認します。</v>\n<v 乙>了解です。</v>').cues[0];
  const base = buildDocument([multi, { ...multi, id: 'untouched', sourceIds: ['other'], start: 22000, end: 30000 }]);
  const state = replaceCueText(base, createEditorState(), multi.id, multi.text.replace('確認', '検証します'));
  const doc = resolved(base, state), output = exported(doc, state);
  assert.equal(doc.cues[0].text, '甲：今日は検証しますします。\n乙：了解です。');
  assert.equal(doc.cues[0].isMultiVoice, true);
  assert.equal(doc.cues[1].voicePayload, multi.voicePayload);
  assert.strictEqual(state.cueRevisions[1], base.cues[1]);
  assert.equal(output[0].isMultiVoice, true);
  assert.equal(output[0].text, doc.cues[0].text);
  assert.match(output[0].voicePayload, /<v 甲>今日は検証しますします。<\/v>\n<v 乙>了解です。<\/v>/);
  assert.deepEqual([output[0].start, output[0].end], [multi.start, multi.end]);
  const second = replaceCueText(doc, state, multi.id, doc.cues[0].text.replace('了解です', '理解できました'));
  assert.equal(exported(resolved(base, second), second)[0].text, '甲：今日は検証しますします。\n乙：理解できました。');
});

test('partial multi-voice speaker changes preserve unselected original voices and all spoken text', () => {
  const base = multiDocument('<v 甲>今日は確認します。</v>\n<v 乙>了解です。</v>'), initial = createEditorState();
  const source = base.cues[0], from = source.text.indexOf('確認');
  assert.strictEqual(changeSelectionSpeaker(base, initial, [span(source.id, from, from + 2)], '甲'), initial);
  const state = changeSelectionSpeaker(base, initial, [span(source.id, from, from + 2)], '丙');
  const doc = resolved(base, state), output = exported(doc, state);
  assert.equal(doc.cues.map(cue => cue.text).join(''), source.text);
  assert.deepEqual(speakerText(output), [['甲', '今日は'], ['丙', '確認'], ['甲', 'します。'], ['乙', '了解です。']]);
  assert.deepEqual([doc.cues[0].start, doc.cues.at(-1).end], [source.start, source.end]);
  assert.ok(doc.cues.every(cue => cue.estimatedTiming && cue.end > cue.start));
  assert.ok(doc.cues.every(cue => cue.sourceIds.join() === source.sourceIds.join()));
  assert.ok(buildEditedCues(doc, state).every(cue => cue.precision === 'estimated'));
  assert.equal(getTranscriptTailCut(doc, 30000).start, source.end);
  assert.deepEqual(speakerText(exported(base, initial)), [[null, source.text]]);
});

test('multi-voice selected ranges may cross voice boundaries and fromSelection keeps the untouched prefix', () => {
  const base = multiDocument('<v 甲>今日は確認します。</v>\n<v 乙>了解です。</v>');
  const source = base.cues[0], from = source.text.indexOf('確認'), to = source.text.indexOf('です');
  const state = changeSelectionSpeaker(base, createEditorState(), [span(source.id, from, to)], '丙');
  assert.deepEqual(speakerText(exported(resolved(base, state), state)), [['甲', '今日は'], ['丙', '確認します。\n了解'], ['乙', 'です。']]);
  const throughEnd = changeSelectionSpeaker(base, createEditorState(), [span(source.id, from, from + 2)], '丙', { scope: 'fromSelection' });
  assert.deepEqual(speakerText(exported(resolved(base, throughEnd), throughEnd)), [['甲', '今日は'], ['丙', '確認します。\n了解です。']]);
  const whole = changeSelectionSpeaker(base, createEditorState(), [span(source.id, 0, source.text.length)], '丙');
  assert.deepEqual(speakerText(exported(resolved(base, whole), whole)), [['丙', '今日は確認します。\n了解です。']]);
  assert.equal(resolved(base, whole).cues[0].id, source.id);
  assert.equal(resolved(base, whole).cues[0].estimatedTiming, undefined);
});

test('multi-voice correction and splitting retain deleted spans, exact cut bounds, aliases and saved voice metadata', () => {
  const base = multiDocument('<v 甲>今日は確認します。えっと、続きです。</v>\n<v 乙>了解です。</v>');
  const source = base.cues[0], from = source.text.indexOf('えっと、');
  let state = deleteTextSpans(base, createEditorState(), [span(source.id, from, from + 4)]);
  state = updateCut(state, state.cuts[0].id, { start: state.cuts[0].start + 10, end: state.cuts[0].end - 10, precision: 'manual' });
  state = renameSpeaker(state, '乙', '佐藤');
  const originalCuts = mediaBounds(state);
  state = replaceCueText(base, state, source.id, source.text.replace('確認', '詳しく確認'));
  let doc = resolved(base, state), selected = doc.cues[0].text.indexOf('詳しく確認');
  assert.deepEqual(mediaBounds(state), originalCuts);
  assert.ok(exported(doc, state).some(cue => cue.speaker === '佐藤' || cue.voicePayload?.includes('<v 佐藤>')));
  state = changeSelectionSpeaker(doc, state, [span(source.id, selected, selected + 5)], '丙'); doc = resolved(base, state);
  assert.deepEqual(mediaBounds(state), originalCuts);
  assert.equal(getDeletedSpans(doc, state).map(span => doc.cueById.get(span.cueId).text.slice(span.from, span.to)).join(''), 'えっと、');
  assert.ok(exported(doc, state).every(cue => !cue.text.includes('えっと')));
  const raw = exportProjectJson(base, state, { sourceFile: 'voices.vtt', mediaDurationMs: 30000 });
  const loaded = importProjectJson(raw);
  assert.deepEqual(speakerText(exported(loaded.doc, loaded.state)), speakerText(exported(doc, state)));
  assert.deepEqual(mediaBounds(loaded.state), originalCuts);
  assert.deepEqual(loaded.doc.cues.map(cue => cue.voiceSpans), doc.cues.map(cue => cue.voiceSpans));
  const tail = loaded.doc.cues.find(cue => cue.speaker === '乙');
  const again = replaceCueText(loaded.doc, loaded.state, tail.id, tail.text.replace('了解', '承知'));
  assert.ok(exported(resolved(loaded.doc, again), again).some(cue => cue.speaker === '佐藤' && cue.text === '承知です。'));
  const malformed = JSON.parse(raw);
  malformed.cues[0].voiceSpans[0].to = 999999;
  assert.throws(() => importProjectJson(JSON.stringify(malformed)), /話者/);
});

test('multi-voice markup, entities, repeated voices and implicit close tags remain attributable after correction', () => {
  const base = multiDocument('<v.one A &amp; B><b>確忍</b><br />😀 &lt;資料&gt;<v C>了解&amp;確認</v>\n<v A &amp; B>次へ</v>');
  const source = base.cues[0];
  const state = replaceCueText(base, createEditorState(), source.id, source.text.replace('確忍', '確認できる'));
  const doc = resolved(base, state), output = exported(doc, state)[0];
  assert.equal(output.isMultiVoice, true);
  assert.equal(output.text, doc.cues[0].text);
  assert.match(output.voicePayload, /<v A &amp; B>確認できる\n😀 &lt;資料&gt;<\/v>/);
  assert.match(output.voicePayload, /<v C>了解&amp;確認<\/v>/);
  assert.match(output.voicePayload, /<v A &amp; B>次へ<\/v>/);
  const from = doc.cues[0].text.indexOf('😀');
  const split = changeSelectionSpeaker(doc, state, [span(source.id, from, from + 2)], '新話者');
  assert.deepEqual(speakerText(exported(resolved(base, split), split)), [['A & B', '確認できる'], ['新話者', '😀'], ['A & B', '<資料>'], ['C', '了解&確認'], ['A & B', '次へ']]);
});

test('insertions beside multi-voice labels inherit the correct adjacent voice, including an empty final voice', () => {
  const base = multiDocument('<v 甲>確認です</v>\n<v 乙>了解です</v>'), source = base.cues[0];
  const beforeLabel = replaceCueText(base, createEditorState(), source.id, source.text.replace('乙：', '補足します\n乙：'));
  assert.match(exported(resolved(base, beforeLabel), beforeLabel)[0].voicePayload, /<v 甲>確認です\n補足します<\/v>\n<v 乙>了解です<\/v>/);
  const empty = multiDocument('<v 甲>確認です</v>\n<v 乙></v>'), emptyCue = empty.cues[0];
  const filled = replaceCueText(empty, createEditorState(), emptyCue.id, `${emptyCue.text}了解です`);
  assert.match(exported(resolved(empty, filled), filled)[0].voicePayload, /<v 乙>了解です<\/v>/);
});

test('ambiguous multi-voice source markup and synthetic heading changes reject atomically', () => {
  const base = multiDocument('<v 甲>本文です</v>\n<v 乙>了解です</v>'), state = createEditorState();
  const snapshot = JSON.stringify([base.cues, state]);
  assert.throws(() => replaceCueText(base, state, base.cues[0].id, base.cues[0].text.replace('甲：', '丙：')), /見出し/);
  assert.throws(() => changeSelectionSpeaker(base, state, [span(base.cues[0].id, 0, 1)], '丙'), /本文/);
  assert.equal(JSON.stringify([base.cues, state]), snapshot);
  const ambiguous = multiDocument('話者不明の本文<v 甲>本文です</v>\n<v 乙>了解です</v>');
  assert.throws(() => replaceCueText(ambiguous, state, ambiguous.cues[0].id, ambiguous.cues[0].text.replace('了解', '承知')), /話者タグ/);
  const mismatched = buildDocument([{ ...base.cues[0], text: '甲: 本文です\n乙: 了解です' }]);
  assert.throws(() => replaceCueText(mismatched, state, mismatched.cues[0].id, '甲: 訂正文です\n乙: 了解です'), /話者タグ/);
});

test('invalid edits fail atomically and too-short cues cannot invent positive-length splits', () => {
  const base = buildDocument([cue('a', 'ABCDE', 500, 501)]), state = createEditorState();
  const snapshot = JSON.stringify([base.cues, state]);
  for (const replacement of ['', '  ', '\u0000bad', 'x'.repeat(2_000_001)]) assert.throws(() => replaceCueText(base, state, 'a', replacement));
  assert.throws(() => replaceCueText(base, state, 'missing', 'valid'));
  assert.throws(() => changeSelectionSpeaker(base, state, [span('a', 1, 2)], '話者2'), /短すぎ/);
  assert.throws(() => changeSelectionSpeaker(base, state, [span('a', 0, 5)], ''));
  assert.throws(() => changeSelectionSpeaker(base, state, [span('a', 0, 5)], '話者2', { scope: 'unknown' }));
  assert.equal(JSON.stringify([base.cues, state]), snapshot);
});

test('large ambiguous replacements are bounded, while long cues with local typos remain editable', () => {
  const base = buildDocument([cue('a', 'A'.repeat(1200))]);
  assert.throws(() => replaceCueText(base, createEditorState(), 'a', 'B'.repeat(1200)), /修正する範囲が大きすぎ/);
  const longText = '先'.repeat(20000) + '誤' + '後'.repeat(20000);
  const long = buildDocument([cue('long', longText)]);
  const fixed = replaceCueText(long, createEditorState(), 'long', longText.replace('誤', '正'));
  assert.equal(resolved(long, fixed).cues[0].text, longText.replace('誤', '正'));
});
