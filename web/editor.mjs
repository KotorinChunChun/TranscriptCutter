export function normalizeRanges(input, duration, remove = false) {
  if (!Number.isFinite(duration) || duration <= 0 || !input.length || input.length > 200) throw Error('1〜200個の範囲を指定してください。');
  const sorted = input.map(r => ({start: Number(r.start), end: Number(r.end)})).sort((a,b)=>a.start-b.start);
  const merged=[];
  for (const r of sorted) {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.start < 0 || r.end > duration + .001 || r.end-r.start < .02) throw Error('動画内で開始より終了を後にしてください（最小0.02秒）。');
    r.end=Math.min(r.end,duration);
    const last=merged.at(-1);
    if (last && r.start<=last.end+.001) last.end=Math.max(last.end,r.end); else merged.push(r);
  }
  if (!remove) return merged;
  const kept=[]; let cursor=0;
  for (const r of merged) { if(r.start-cursor>=.02) kept.push({start:cursor,end:r.start}); cursor=r.end; }
  if(duration-cursor>=.02) kept.push({start:cursor,end:duration});
  if(!kept.length) throw Error('動画がすべて削除されます。');
  return kept;
}
export function timelineSegments(segments, kept) {
  let offset=0; const result=[];
  for (const range of kept) {
    for (const s of segments) {
      const start=Math.max(s.start,range.start),end=Math.min(s.end,range.end);
      if(end>start) {
        const cut={...s,start:start-range.start+offset,end:end-range.start+offset,sourceStart:start,sourceEnd:end};
        if(Array.isArray(s.speakerIntervals))cut.speakerIntervals=s.speakerIntervals.filter(v=>v.end>start&&v.start<end).map(v=>({...v,start:Math.max(v.start,start)-range.start+offset,end:Math.min(v.end,end)-range.start+offset}));
        result.push(cut);
      }
    }
    offset+=range.end-range.start;
  }
  return result;
}
