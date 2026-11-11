import type { TextSpan } from "./editor";

export interface TranscriptSelection {
  spans: TextSpan[];
  /** Selected, nondeleted source text only; visible row changes use newlines. */
  text: string;
  /** Unicode code points in selected active leaves; inserted separators excluded. */
  characterCount: number;
}

const LEAF_SELECTOR = "[data-transcript-span][data-cue-id][data-text-from][data-text-to]";
type LeafInfo = {
  element: HTMLElement;
  cueId: string;
  from: number;
  to: number;
  text: string;
  deleted: boolean;
  line: Element | null;
};
type SelectedLeaf = { info: LeafInfo; intervals: { from: number; to: number }[] };

function contains(root: HTMLElement, node: Node | null): boolean {
  return !!node && (node === root || root.contains(node));
}

function nativeSelection(root: HTMLElement): Selection | null {
  return root.ownerDocument.getSelection?.() ?? root.ownerDocument.defaultView?.getSelection() ?? null;
}

function intersects(range: Range, node: Node): boolean {
  try { return range.intersectsNode(node); } catch { return false; }
}

/** Includes selections of labels inside the transcript, so a clearing click is safe. */
export function hasNativeTranscriptSelection(root: HTMLElement): boolean {
  const selection = nativeSelection(root);
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!range.collapsed && intersects(range, root)) return true;
  }
  return false;
}

/** Clear transcript-contained ranges without clearing unrelated page selections. */
export function clearNativeTranscriptSelection(root: HTMLElement): void {
  const selection = nativeSelection(root);
  if (!selection || selection.isCollapsed) return;
  for (let index = selection.rangeCount - 1; index >= 0; index -= 1) {
    const range = selection.getRangeAt(index);
    // A range that also contains outside text is left intact, rather than
    // discarding the user's outside selection as a side effect of an edit.
    if (contains(root, range.startContainer) && contains(root, range.endContainer)) {
      try { selection.removeRange(range); } catch { /* a live DOM change already removed it */ }
    }
  }
}

function leafInfo(element: HTMLElement): LeafInfo | null {
  const cueId = element.getAttribute("data-cue-id") ?? "";
  const startValue = element.getAttribute("data-text-from");
  const endValue = element.getAttribute("data-text-to");
  if (!cueId || startValue === null || endValue === null || !/^\d+$/.test(startValue) || !/^\d+$/.test(endValue)) return null;
  const from = Number(startValue), to = Number(endValue);
  const text = element.textContent ?? "";
  // A mismatched DOM leaf cannot be mapped safely; never guess source offsets.
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from || text.length !== to - from) return null;
  return { element, cueId, from, to, text, deleted: element.getAttribute("data-text-deleted") === "true", line: element.closest("[data-line-id]") };
}

/** Narrow most single-word/line selections before querying all transcript leaves. */
function candidateLeaves(root: HTMLElement, range: Range): HTMLElement[] {
  const common = range.commonAncestorContainer;
  const commonElement = common.nodeType === 1 ? common as Element : common.parentElement;
  const mappedAncestor = commonElement?.closest<HTMLElement>(LEAF_SELECTOR);
  if (mappedAncestor && contains(root, mappedAncestor)) return [mappedAncestor];
  const scope = commonElement && contains(root, commonElement) ? commonElement : root;
  const leaves = Array.from(scope.querySelectorAll<HTMLElement>(LEAF_SELECTOR));
  if (scope.matches(LEAF_SELECTOR)) leaves.unshift(scope as HTMLElement);
  return leaves;
}

/** Count UTF-16 text before a DOM boundary, including nested Highlight marks. */
function offsetInsideLeaf(leaf: LeafInfo, container: Node, offset: number): number {
  const prefix = leaf.element.ownerDocument.createRange();
  prefix.selectNodeContents(leaf.element);
  prefix.setEnd(container, offset);
  return Math.max(0, Math.min(leaf.text.length, prefix.toString().length));
}

function mergeIntervals(intervals: readonly { from: number; to: number }[]): { from: number; to: number }[] {
  const result: { from: number; to: number }[] = [];
  for (const interval of [...intervals].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const previous = result[result.length - 1];
    if (previous && interval.from <= previous.to) previous.to = Math.max(previous.to, interval.to);
    else result.push({ ...interval });
  }
  return result;
}

/**
 * Read only source-mapped transcript leaves. Native Range endpoints are already
 * normalized for backward drags. Labels, timestamps and action text never enter
 * the returned source spans, preview, or count.
 */
export function readTranscriptSelection(root: HTMLElement): TranscriptSelection | null {
  const selection = nativeSelection(root);
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const ranges: Range[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!range.collapsed && intersects(range, root)) ranges.push(range.cloneRange());
  }
  ranges.sort((a, b) => a.compareBoundaryPoints(0, b)); // START_TO_START
  const selectedLeaves = new Map<HTMLElement, SelectedLeaf>();
  const sourceSpans: TextSpan[] = [];

  for (const range of ranges) {
    const spansInRange = new Map<string, TextSpan>();
    for (const element of candidateLeaves(root, range)) {
      if (!intersects(range, element)) continue;
      const info = leafInfo(element);
      if (!info) continue;
      const startWithin = contains(element, range.startContainer) ? offsetInsideLeaf(info, range.startContainer, range.startOffset) : 0;
      const endWithin = contains(element, range.endContainer) ? offsetInsideLeaf(info, range.endContainer, range.endOffset) : info.text.length;
      if (endWithin <= startWithin) continue;
      const from = info.from + startWithin, to = info.from + endWithin;
      const existingLeaf = selectedLeaves.get(element);
      if (existingLeaf) existingLeaf.intervals.push({ from, to });
      else selectedLeaves.set(element, { info, intervals: [{ from, to }] });
      const previous = spansInRange.get(info.cueId);
      if (previous) { previous.from = Math.min(previous.from, from); previous.to = Math.max(previous.to, to); }
      else spansInRange.set(info.cueId, { cueId: info.cueId, from, to });
    }
    // The min/max source range within each cue includes omitted newlines and
    // invisible deleted fragments. The editor subtracts already-deleted spans.
    sourceSpans.push(...spansInRange.values());
  }

  const orderedLeaves = [...selectedLeaves.values()].sort((a, b) => {
    if (a.info.element === b.info.element) return 0;
    const position = a.info.element.compareDocumentPosition(b.info.element);
    return position & 4 ? -1 : position & 2 ? 1 : 0; // FOLLOWING / PRECEDING
  });
  const preview: string[] = [];
  let characterCount = 0;
  let previousLine: Element | null = null;
  let previousCue: string | null = null;
  for (const selected of orderedLeaves) {
    if (selected.info.deleted) continue;
    for (const interval of mergeIntervals(selected.intervals)) {
      const text = selected.info.text.slice(interval.from - selected.info.from, interval.to - selected.info.from);
      if (!text) continue;
      if (preview.length && (previousCue !== selected.info.cueId || previousLine !== selected.info.line)) preview.push("\n");
      preview.push(text);
      characterCount += Array.from(text).length;
      previousLine = selected.info.line;
      previousCue = selected.info.cueId;
    }
  }
  if (!characterCount) return null;

  const byCue = new Map<string, { from: number; to: number }[]>();
  for (const span of sourceSpans) {
    const list = byCue.get(span.cueId);
    if (list) list.push(span);
    else byCue.set(span.cueId, [span]);
  }
  const spans: TextSpan[] = [];
  for (const [cueId, intervals] of byCue) for (const interval of mergeIntervals(intervals)) spans.push({ cueId, ...interval });
  return { spans, text: preview.join(""), characterCount };
}
