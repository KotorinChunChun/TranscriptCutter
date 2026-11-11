/** Timestamp and export helpers shared by the local transcription workspace. */

const TIME_HELP = '時刻は「秒」「分:秒」「時:分:秒」で入力してください。';

/** Parse seconds, mm:ss, or hh:mm:ss. The last field may contain decimals. */
export function parseTime(value, { allowEmpty = false } = {}) {
  const input = value == null ? '' : String(value).trim();
  if (!input) {
    if (allowEmpty) return null;
    throw new Error('時刻を入力してください。' + TIME_HELP);
  }
  if (input.startsWith('-')) throw new Error('時刻に負の値は使えません。');

  const parts = input.split(':');
  if (parts.length > 3 || !parts.every((part, index) => {
    if (index === parts.length - 1) return /^\d+(?:\.\d+)?$/.test(part);
    return /^\d+$/.test(part);
  })) throw new Error(TIME_HELP);

  const fields = parts.map(Number);
  if (!fields.every(Number.isFinite)) throw new Error(TIME_HELP);
  if (parts.length > 1) {
    const seconds = fields.at(-1);
    const minutes = fields.at(-2);
    if (seconds >= 60 || minutes >= 60) {
      throw new Error('分・秒は 0〜59 の範囲で入力してください。');
    }
  }
  const seconds = fields.reduce((total, field) => total * 60 + field, 0);
  if (!Number.isFinite(seconds) || seconds > Number.MAX_SAFE_INTEGER / 1000) {
    throw new Error('時刻の値が大きすぎます。');
  }
  return seconds;
}

/** Format an absolute recording time. Unknown or invalid times display as —. */
export function formatTime(seconds, milliseconds = false) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = milliseconds ? Math.round(seconds * 1000) : Math.floor(seconds) * 1000;
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const secs = Math.floor(total / 1000) % 60;
  const base = [hours, minutes, secs].map(number => String(number).padStart(2, '0')).join(':');
  return milliseconds ? `${base}.${String(total % 1000).padStart(3, '0')}` : base;
}

const isTime = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Convert one pipeline result to absolute recording timestamps.
 * `duration` is the duration of the waveform submitted to the pipeline, not
 * the duration of the complete recording. Missing model boundaries are marked
 * as estimates; IDs are deliberately left to the caller.
 */
export function normalizeChunks(result, { offset = 0, duration } = {}) {
  if (!isTime(offset) || offset < 0 || !isTime(duration) || duration < 0) {
    throw new Error('音声区間の開始時刻と長さを確認してください。');
  }
  const source = Array.isArray(result?.chunks)
    ? result.chunks.filter(chunk => typeof chunk?.text === 'string' && chunk.text.trim())
    : [];

  if (!source.length) {
    const text = typeof result?.text === 'string' ? result.text.trim() : '';
    return text ? [{
      start: offset,
      end: offset + duration,
      text,
      speaker: '',
      estimatedStart: true,
      estimatedEnd: true,
    }] : [];
  }

  let previousEnd = 0;
  return source.map((chunk, index) => {
    const pair = Array.isArray(chunk.timestamp) ? chunk.timestamp : [];
    const startWasProvided = isTime(pair[0]);
    const localStart = clamp(startWasProvided ? pair[0] : previousEnd, 0, duration);
    let endWasProvided = isTime(pair[1]);
    let candidateEnd = endWasProvided ? pair[1] : null;
    if (!endWasProvided) {
      for (let next = index + 1; next < source.length; next += 1) {
        const nextStart = source[next]?.timestamp?.[0];
        if (isTime(nextStart) && nextStart >= localStart) {
          candidateEnd = nextStart;
          break;
        }
      }
      if (candidateEnd == null) candidateEnd = duration;
    }
    const localEnd = clamp(candidateEnd, localStart, duration);
    const estimatedStart = !startWasProvided || localStart !== pair[0];
    const estimatedEnd = !endWasProvided || localEnd !== pair[1];
    previousEnd = localEnd;
    return {
      start: offset + localStart,
      end: offset + localEnd,
      text: chunk.text.trim(),
      speaker: '',
      ...(estimatedStart ? { estimatedStart: true } : {}),
      ...(estimatedEnd ? { estimatedEnd: true } : {}),
    };
  });
}

function subtitleText(text) {
  // Empty lines terminate subtitle cues; preserve intentional paragraph breaks
  // as visually blank, nonempty lines. Escape literal markup in the transcript.
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    .map(line => line.trim() ? line : '\u200B')
    .join('\n');
}

function cueText(segment) {
  const speaker = segment.speaker.replace(/[\r\n\t]+/g, ' ').trim();
  return `${speaker ? `${speaker}：` : ''}${segment.text}`;
}

function hasAutomaticSpeakerEvidence(segment) {
  if (segment.speakerSource === 'automatic' && segment.speaker.trim()) return true;
  if (typeof segment.apiSpeakerId === 'string' && segment.apiSpeakerId.trim()
      && Number.isInteger(segment.apiSpeakerScope) && segment.apiSpeakerScope > 0) return true;
  // A later manual name correction does not erase the raw model intervals.
  return Array.isArray(segment.speakerIntervals) && segment.speakerIntervals.some(span =>
    isTime(span?.start) && isTime(span?.end) && span.start >= 0 && span.end > span.start
    && ((typeof span.speaker === 'string' && span.speaker.trim())
      || (Number.isInteger(span.speaker) && span.speaker >= 0)));
}

/** Produce UTF-8 text for a download. This function performs no I/O. */
export function makeExport({ segments = [], format = 'txt', metadata = {} } = {}) {
  const clean = segments
    .filter(segment => typeof segment?.text === 'string' && segment.text.trim())
    .map(segment => {
      if (!isTime(segment.start) || !isTime(segment.end)
        || segment.start < 0 || segment.end < segment.start) {
        throw new Error('書き出す発言の開始・終了時刻を確認してください。');
      }
      return { ...segment, text: segment.text, speaker: String(segment.speaker ?? '') };
    });

  if (format === 'json') {
    // Explicit completion remains the legacy confirmation contract. Otherwise
    // require actual segment output; a requested/running model alone is not
    // evidence that diarization has produced any speaker labels.
    const diarizationStatus = metadata?.diarizationStatus === 'complete' ? 'complete'
      : clean.some(hasAutomaticSpeakerEvidence) ? 'partial' : 'not_performed';
    const diarizationPerformed = diarizationStatus !== 'not_performed';
    const reportedModel = metadata.diarizationModel || (metadata.provider ? metadata.apiModel || metadata.modelId || metadata.provider : 'nemotron_3');
    const diarization = typeof reportedModel === 'string' && /nemotron.*3/i.test(reportedModel) ? 'nemotron_3' : reportedModel;
    return {
      text: JSON.stringify({
        metadata,
        diarization: diarizationPerformed ? diarization : 'not_performed',
        diarizationStatus,
        timestampType: metadata.timestampType || 'segment',
        speakerLabels: diarizationPerformed ? 'automatic_with_manual_edits' : 'manual',
        segments: clean,
      }, null, 2) + '\n',
      mime: 'application/json;charset=utf-8',
      extension: 'json',
    };
  }
  if (format === 'txt') {
    return {
      text: clean.map(segment =>
        `[${formatTime(segment.start, true)} → ${formatTime(segment.end, true)}]\n${cueText(segment)}`
      ).join('\n\n') + (clean.length ? '\n' : ''),
      mime: 'text/plain;charset=utf-8',
      extension: 'txt',
    };
  }
  if (format !== 'srt' && format !== 'vtt') throw new Error('未対応の書き出し形式です。');

  const stamp = seconds => {
    const text = formatTime(seconds, true);
    return format === 'srt' ? text.replace('.', ',') : text;
  };
  const cues = clean.map((segment, index) =>
    `${index + 1}\n${stamp(segment.start)} --> ${stamp(segment.end)}\n${subtitleText(cueText(segment))}`
  ).join('\n\n');
  return {
    text: (format === 'vtt' ? 'WEBVTT\n\n' : '') + cues + (cues ? '\n' : ''),
    mime: format === 'srt' ? 'application/x-subrip;charset=utf-8' : 'text/vtt;charset=utf-8',
    extension: format,
  };
}
