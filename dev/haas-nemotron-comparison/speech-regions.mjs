const SPEAKERS=8, FRAME_SECONDS=.01;

function speakerActivity(probs,numFrames,threshold) {
  const segments=[];
  for (let speaker=0;speaker<SPEAKERS;speaker++) {
    let start=-1;
    for (let frame=0;frame<=numFrames;frame++) {
      const active=frame<numFrames && probs[frame*SPEAKERS+speaker]>threshold;
      if (active && start<0) start=frame;
      if (!active && start>=0) {
        segments.push({start:start/100,end:frame/100,speaker});
        start=-1;
      }
    }
  }
  return segments.sort((a,b)=>a.start-b.start || a.speaker-b.speaker);
}

function merge(regions, gap=0) {
  const out=[];
  for (const region of regions.slice().sort((a,b)=>a.start-b.start || a.end-b.end)) {
    const last=out.at(-1);
    if (last && region.start-last.end <= gap+1e-9) last.end=Math.max(last.end,region.end);
    else out.push({...region});
  }
  return out;
}

const seconds=regions=>regions.reduce((sum,r)=>sum+r.end-r.start,0);

/** Keep short pauses inside an ASR group without concatenating distant time ranges. */
export function regionsFromSegments(segments,duration,{pad=.25,mergeGap=3}={}) {
  if(!Number.isFinite(duration)||duration<0||!Number.isFinite(pad)||pad<0||!Number.isFinite(mergeGap)||mergeGap<0)throw Error('Invalid region settings');
  for(const s of segments)if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<s.start)throw Error('Invalid source segment');
  const speech=merge(segments.map(s=>({start:Math.max(0,s.start),end:Math.min(duration,s.end)})).filter(s=>s.end>s.start));
  const regions=merge(speech.map(s=>({start:Math.max(0,s.start-pad),end:Math.min(duration,s.end+pad)})),mergeGap);
  const removed=[];let cursor=0;
  for(const r of regions){if(r.start>cursor)removed.push({start:cursor,end:r.start});cursor=r.end;}
  if(cursor<duration)removed.push({start:cursor,end:duration});
  return {regions,removed,speechSeconds:seconds(speech),retainedSeconds:seconds(regions),speakerSegments:[]};
}

/** Frame probabilities -> original-media seconds; simultaneous speech is counted once. */
export function speechRegions(probs,numFrames,duration,{threshold=.5,pad=.25,mergeGap=.5}={}) {
  if (!Number.isInteger(numFrames) || numFrames<0 || !Number.isFinite(duration) || duration<0) {
    throw Error('Invalid Nemotron duration/frame count');
  }
  if (probs.length!==numFrames*SPEAKERS || !probs.every(v=>Number.isFinite(v) && v>=0 && v<=1)) {
    throw Error('Invalid Nemotron probabilities');
  }
  if (!(threshold>=0 && threshold<=1) || !Number.isFinite(pad) || pad<0 || !Number.isFinite(mergeGap) || mergeGap<0) {
    throw Error('Invalid speech-region settings');
  }
  if (numFrames*FRAME_SECONDS > duration+.010001) throw Error('Frame count exceeds media duration');
  const speakerSegments=speakerActivity(probs,numFrames,threshold)
    .map(s=>({...s,start:Math.max(0,s.start),end:Math.min(duration,s.end)}))
    .filter(s=>s.end>s.start);
  const speech=merge(speakerSegments.map(({start,end})=>({start,end})));
  const regions=merge(speech.map(s=>({start:Math.max(0,s.start-pad),end:Math.min(duration,s.end+pad)})),mergeGap);
  const removed=[];
  let cursor=0;
  for (const region of regions) {
    if (region.start>cursor+1e-9) removed.push({start:cursor,end:region.start});
    cursor=region.end;
  }
  if (cursor<duration-1e-9) removed.push({start:cursor,end:duration});
  // The default .25s margin makes positive retained intervals >=.02s except for
  // media shorter than .02s. Never silently discard a one-frame utterance.
  const shortRegions=regions.filter(r=>r.end-r.start<.02-1e-9);
  return {speakerSegments,regions,removed,speechSeconds:seconds(speech),retainedSeconds:seconds(regions),shortRegions};
}
