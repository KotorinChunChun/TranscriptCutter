/** Cut planning uses real media bounds and an optional exclusive subtitle end. */
export type MediaCutInput = { start: number; end: number };

/** Source and output positions are integer milliseconds, with exclusive ends. */
export type KeepSegment = {
  start: number;
  end: number;
  outputStart: number;
  outputEnd: number;
};

export type MediaCutPlan = {
  durationMs: number;
  cutDurationMs: number;
  outputDurationMs: number;
  cuts: MediaCutInput[];
  keep: KeepSegment[];
  /** Number of input cuts clipped or discarded beyond the real media end. */
  clippedCutCount: number;
};

export type MappedSampleRange = {
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  outputEnd: number;
};

/**
 * Normalize user cuts without changing the input. Every input is validated
 * before clipping; negative, reversed, fractional, and nonfinite bounds fail.
 * Touching/overlapping cuts form a union so media is removed only once.
 */
export function buildMediaCutPlan(cuts: readonly MediaCutInput[], durationMs: number, subtitleEndMs?: number): MediaCutPlan {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error("動画・音声の長さは、1以上の整数ミリ秒で指定してください。");
  }
  if (!Array.isArray(cuts)) throw new Error("カット区間の一覧が正しくありません。");
  if (subtitleEndMs !== undefined && (!Number.isSafeInteger(subtitleEndMs) || subtitleEndMs < 0)) {
    throw new Error("VTTの終了時刻は、0以上の整数ミリ秒で指定してください。");
  }

  let clippedCutCount = 0;
  const bounded: MediaCutInput[] = [];
  for (let index = 0; index < cuts.length; index++) {
    const cut = cuts[index];
    if (!cut || !Number.isSafeInteger(cut.start) || !Number.isSafeInteger(cut.end) || cut.start < 0 || cut.end <= cut.start) {
      throw new Error(`${index + 1}件目のカット区間が正しくありません。開始は0以上、終了は開始より後の整数ミリ秒にしてください。`);
    }
    if (cut.end > durationMs) clippedCutCount += 1;
    const start = Math.min(durationMs, Math.max(0, cut.start));
    const end = Math.min(durationMs, cut.end);
    if (end > start) bounded.push({ start, end });
  }
  // The input VTT defines the end of wanted media. Add this to the same union
  // as user cuts so an overlapping/manual tail edit is never counted twice.
  // A subtitle end past the real media end must not create padding.
  if (subtitleEndMs !== undefined && subtitleEndMs < durationMs) {
    bounded.push({ start: subtitleEndMs, end: durationMs });
  }
  bounded.sort((a, b) => a.start - b.start || a.end - b.end);

  const union: MediaCutInput[] = [];
  for (const cut of bounded) {
    const previous = union[union.length - 1];
    if (previous && cut.start <= previous.end) previous.end = Math.max(previous.end, cut.end);
    else union.push({ ...cut });
  }

  const keep: KeepSegment[] = [];
  let sourceCursor = 0;
  let outputCursor = 0;
  let cutDurationMs = 0;
  const retain = (start: number, end: number) => {
    if (end <= start) return;
    const outputEnd = outputCursor + (end - start);
    keep.push({ start, end, outputStart: outputCursor, outputEnd });
    outputCursor = outputEnd;
  };
  for (const cut of union) {
    retain(sourceCursor, cut.start);
    cutDurationMs += cut.end - cut.start;
    sourceCursor = cut.end;
  }
  // Any requested tail removal is already in the union. Preserve introductions
  // and internal gaps unless the user explicitly cut those intervals too.
  retain(sourceCursor, durationMs);
  return { durationMs, cutDurationMs, outputDurationMs: outputCursor, cuts: union, keep, clippedCutCount };
}

/** Select the removed union instead of its complement, on a fresh timeline. */
export function buildRemovedMediaPlan(cuts: readonly MediaCutInput[], durationMs: number, subtitleEndMs?: number): MediaCutPlan {
  const normal = buildMediaCutPlan(cuts, durationMs, subtitleEndMs);
  let cursor = 0;
  const keep = normal.cuts.map(range => {
    const outputStart = cursor;
    cursor += range.end - range.start;
    return { ...range, outputStart, outputEnd: cursor };
  });
  return { ...normal, cuts: normal.keep.map(({ start, end }) => ({ start, end })), keep,
    outputDurationMs: normal.cutDurationMs, cutDurationMs: normal.outputDurationMs };
}

/**
 * Intersect one decoded sample [startSeconds, endSeconds) with retained media.
 * Results use seconds and keep submillisecond sample precision. A sample that
 * straddles a cut can yield multiple cropped pieces, each with remapped times.
 *
 * Negative preroll and samples past the media end are clipped. Empty samples
 * return []; reversed/nonfinite input is rejected. `plan` must be a plan from
 * buildMediaCutPlan, with its sorted `keep` array left unchanged.
 * Complexity is O(log(keep.length) + number of intersecting keep segments).
 */
export function mapSampleToKeptRanges(plan: MediaCutPlan, startSeconds: number, endSeconds: number): MappedSampleRange[] {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds < startSeconds) {
    throw new Error("音声・映像サンプルの開始・終了時刻が正しくありません。");
  }
  const start = Math.max(0, startSeconds);
  const end = Math.min(plan.durationMs / 1000, endSeconds);
  const keep = plan.keep;
  if (end <= start || keep.length === 0) return [];

  // Compare in seconds rather than multiplying sample times by 1000: a boundary
  // such as 1.005 seconds must not produce a microscopic spurious fragment.
  let low = 0;
  let high = keep.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (keep[middle].end / 1000 <= start) low = middle + 1;
    else high = middle;
  }

  const result: MappedSampleRange[] = [];
  for (let index = low; index < keep.length; index++) {
    const segment = keep[index];
    const segmentStart = segment.start / 1000;
    if (segmentStart >= end) break;
    const sourceStart = Math.max(start, segmentStart);
    const segmentEnd = segment.end / 1000;
    const sourceEnd = Math.min(end, segmentEnd);
    if (sourceEnd <= sourceStart) continue;
    // Anchor exact boundaries to the plan so adjacent output pieces meet even
    // after floating-point arithmetic on a long source timeline.
    const outputStart = sourceStart === segmentStart ? segment.outputStart / 1000 : segment.outputStart / 1000 + (sourceStart - segmentStart);
    const outputEnd = sourceEnd === segmentEnd ? segment.outputEnd / 1000 : segment.outputStart / 1000 + (sourceEnd - segmentStart);
    result.push({ sourceStart, sourceEnd, outputStart, outputEnd });
  }
  return result;
}
