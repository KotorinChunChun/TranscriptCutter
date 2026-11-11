import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, formatTime, normalizeChunks, makeExport } from '../web/transcript-utils.mjs';

test('time inputs support recording durations over an hour and decimal seconds', () => {
  assert.equal(parseTime('01:10:49.536'), 4249.536);
  assert.equal(parseTime('10:49.5'), 649.5);
  assert.equal(parseTime(' 4249.536 '), 4249.536);
  assert.equal(parseTime(90), 90);
  assert.equal(parseTime('2:3'), 123);
  assert.equal(parseTime('', { allowEmpty: true }), null);
  assert.equal(parseTime(null, { allowEmpty: true }), null);
});

test('malformed, negative, and overflowing time inputs are rejected', () => {
  for (const input of ['', '-1', '1e3', 'Infinity', '1:60', '60:00', '1:60:00',
    '00:00:60', '1.5:20', '1::2', '1:2:3:4', 'hello', '1秒', '1:2x', '0.']) {
    assert.throws(() => parseTime(input), Error, input);
  }
});

test('timestamp formatting carries rounded milliseconds correctly', () => {
  assert.equal(formatTime(4249.536), '01:10:49');
  assert.equal(formatTime(4249.536, true), '01:10:49.536');
  assert.equal(formatTime(59.9996, true), '00:01:00.000');
  assert.equal(formatTime(3599.9996, true), '01:00:00.000');
  assert.equal(formatTime(100 * 3600 + 1, true), '100:00:01.000');
  assert.equal(formatTime(null), '—');
  assert.equal(formatTime(NaN), '—');
});

test('normalization offsets local timestamps and marks inferred end boundaries', () => {
  const result = normalizeChunks({ chunks: [
    { timestamp: [0.4, null], text: ' 最初の発言です。 ' },
    { timestamp: [2.5, 4], text: '次の発言です。' },
    { timestamp: [4.2, null], text: '最後です。' },
  ] }, { offset: 3600, duration: 8 });
  assert.deepEqual(result, [
    { start: 3600.4, end: 3602.5, text: '最初の発言です。', speaker: '', estimatedEnd: true },
    { start: 3602.5, end: 3604, text: '次の発言です。', speaker: '' },
    { start: 3604.2, end: 3608, text: '最後です。', speaker: '', estimatedEnd: true },
  ]);
});

test('normalization keeps bounds honest, removes empty chunks, and marks missing starts', () => {
  const result = normalizeChunks({ chunks: [
    { timestamp: [-2, 2], text: '前半' },
    { timestamp: [2, 3], text: '  ' },
    { timestamp: [null, 20], text: '後半' },
  ] }, { offset: 60, duration: 10 });
  assert.deepEqual(result, [
    { start: 60, end: 62, text: '前半', speaker: '', estimatedStart: true },
    { start: 62, end: 70, text: '後半', speaker: '', estimatedStart: true, estimatedEnd: true },
  ]);
  assert.deepEqual(normalizeChunks({ text: '' }, { duration: 10 }), []);
  assert.deepEqual(normalizeChunks({ text: '時刻なしの結果' }, { offset: 30, duration: 10 }), [
    { start: 30, end: 40, text: '時刻なしの結果', speaker: '', estimatedStart: true, estimatedEnd: true },
  ]);
});

test('SRT output keeps Japanese content and absolute millisecond timestamps', () => {
  const output = makeExport({ format: 'srt', segments: [
    { id: 23, start: 3599.9996, end: 3603.2, text: '議事録を確認します。', speaker: '話者1' },
    { id: 30, start: 3604, end: 3605, text: '承知しました。', speaker: '' },
  ] });
  assert.equal(output.extension, 'srt');
  assert.equal(output.text, '1\n01:00:00,000 --> 01:00:03,200\n話者1：議事録を確認します。\n\n2\n01:00:04,000 --> 01:00:05,000\n承知しました。\n');
});

test('VTT output escapes literal markup and prevents blank lines from breaking cues', () => {
  const output = makeExport({ format: 'vtt', segments: [
    { start: 1, end: 2, text: 'A & B <例>\n\n続き', speaker: '<手入力>' },
  ] });
  assert.equal(output.text, 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n&lt;手入力&gt;：A &amp; B &lt;例&gt;\n\u200B\n続き\n');
  assert.equal(output.mime, 'text/vtt;charset=utf-8');
});

test('JSON distinguishes manual speaker labels from automatic diarization', () => {
  const segments = [{ id: 6, start: 1, end: 4, text: '発言', speaker: '田中', estimatedEnd: true }];
  const metadata = { fileName: '会議.m4a', model: 'whisper-base' };
  const data = JSON.parse(makeExport({ format: 'json', segments, metadata }).text);
  assert.deepEqual(data.metadata, metadata);
  assert.equal(data.diarization, 'not_performed');
  assert.equal(data.diarizationStatus, 'not_performed');
  assert.equal(data.timestampType, 'segment');
  assert.equal(data.speakerLabels, 'manual');
  assert.deepEqual(data.segments, segments);
});

test('API speaker provenance and approximate timestamp flags survive JSON export and manual naming', () => {
  const segment = { start: 60, end: 120, text: '議題を確認します。', speaker: '佐藤', speakerSource: 'manual', apiSpeakerId: 'speaker_0', apiSpeakerScope: 2, timestampType: 'api_chunk_estimated', estimatedStart: true, estimatedEnd: true };
  const metadata = { provider: 'openai', diarizationModel: 'gpt-4o-transcribe-diarize', diarizationStatus: 'partial', runtime: 'openai', timestampType: 'api_chunk_estimated' };
  const data = JSON.parse(makeExport({ format: 'json', segments: [segment], metadata }).text);
  assert.equal(data.diarization, 'gpt-4o-transcribe-diarize');
  assert.equal(data.diarizationStatus, 'partial');
  assert.equal(data.timestampType, 'api_chunk_estimated');
  assert.equal(data.segments[0].estimatedStart, true);
  assert.equal(data.segments[0].apiSpeakerId, 'speaker_0');
});

test('JSON preserves explicit legacy completion and avoids claiming missing diarization output', () => {
  const metadata = { diarizationStatus: 'complete', intervals: [{ start: 0, end: 3, speaker: 0 }] };
  const data = JSON.parse(makeExport({ format: 'json', metadata }).text);
  assert.equal(data.diarization, 'nemotron_3');
  assert.equal(data.diarizationStatus, 'complete');
  assert.equal(data.speakerLabels, 'automatic_with_manual_edits');
  assert.deepEqual(data.metadata, metadata);
  for (const diarizationStatus of ['failed', 'canceled', 'cancelled', 'error', 'running', 'partial', undefined]) {
    const incomplete = JSON.parse(makeExport({ format: 'json', metadata: { diarizationStatus, diarizationRequested: true } }).text);
    assert.equal(incomplete.diarization, 'not_performed');
    assert.equal(incomplete.diarizationStatus, 'not_performed');
    assert.equal(incomplete.speakerLabels, 'manual');
  }
});

test('partial native exports preserve confirmed automatic speaker evidence after interruption or manual naming', () => {
  const segment = {
    start: 600, end: 610, text: '確定済みの発言', speaker: '話者1', speakerSource: 'automatic',
    speakerIntervals: [{ start: 600.2, end: 609.4, speaker: '話者1' }],
  };
  for (const status of ['running', 'cancelled', 'error', 'partial']) {
    const metadata = { processingStatus: status, diarizationStatus: status, timestampType: 'vad_utterance' };
    const data = JSON.parse(makeExport({ format: 'json', segments: [segment], metadata }).text);
    assert.equal(data.diarization, 'nemotron_3');
    assert.equal(data.diarizationStatus, 'partial');
    assert.equal(data.speakerLabels, 'automatic_with_manual_edits');
    assert.equal(data.timestampType, 'vad_utterance');
    assert.deepEqual(data.metadata, metadata);
    assert.deepEqual(data.segments[0].speakerIntervals, segment.speakerIntervals);
  }
  const renamed = { ...segment, speaker: '田中', speakerSource: 'manual' };
  const manualName = JSON.parse(makeExport({ format: 'json', segments: [renamed] }).text);
  assert.equal(manualName.diarizationStatus, 'partial');
  assert.equal(manualName.diarization, 'nemotron_3');

  const provenanceOnly = { ...segment };
  delete provenanceOnly.speakerIntervals;
  assert.equal(JSON.parse(makeExport({ format: 'json', segments: [provenanceOnly] }).text).diarizationStatus, 'partial');

  for (const missingEvidence of [
    { ...renamed, speakerIntervals: [] },
    { ...renamed, speakerIntervals: [{ start: 600, end: 600, speaker: '話者1' }] },
    { ...segment, speaker: '', speakerSource: 'unassigned', speakerIntervals: [] },
  ]) {
    const data = JSON.parse(makeExport({ format: 'json', segments: [missingEvidence], metadata: { diarizationRequested: true } }).text);
    assert.equal(data.diarization, 'not_performed');
    assert.equal(data.diarizationStatus, 'not_performed');
    assert.equal(data.speakerLabels, 'manual');
  }
});

test('TXT exports include timestamps and labels only when supplied', () => {
  const result = makeExport({ format: 'txt', segments: [
    { start: 0, end: 2, text: 'こんにちは。', speaker: '' },
    { start: 3, end: 4, text: 'よろしくお願いします。', speaker: '話者2' },
  ] });
  assert.equal(result.text, '[00:00:00.000 → 00:00:02.000]\nこんにちは。\n\n[00:00:03.000 → 00:00:04.000]\n話者2：よろしくお願いします。\n');
});

test('invalid export ranges are rejected instead of silently changing times', () => {
  assert.throws(() => makeExport({ format: 'srt', segments: [{ start: 5, end: 3, text: '不正' }] }));
  assert.throws(() => makeExport({ format: 'srt', segments: [{ start: 0, end: NaN, text: '不正' }] }));
  assert.throws(() => makeExport({ format: 'unknown' }));
});
