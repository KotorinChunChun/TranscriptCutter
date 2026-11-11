export interface FilterContextGroup {
  id: string;
  start: number;
  end: number;
  canonicalSpeaker: string | null;
  deleted: boolean;
}

export interface FilterGap {
  count: number;
  otherSpeakerCount: number;
  searchHiddenCount: number;
  start: number;
  end: number;
  elapsedMs: number;
  position: "before" | "between" | "after";
}

/** Count actual conversation groups, independently of progressive rendering. */
export function buildSpeakerFilterContext(
  groups: readonly FilterContextGroup[],
  filtered: readonly FilterContextGroup[],
  speakerFilter: string,
  showDeleted = false,
): { before: Map<string, FilterGap>; after: FilterGap | null } {
  const before = new Map<string, FilterGap>();
  if (speakerFilter === "all" || !filtered.length) return { before, after: null };
  const matches = (group: FilterContextGroup) => speakerFilter === "unknown"
    ? !group.canonicalSpeaker
    : (group.canonicalSpeaker ?? "").split(/[\/／]/).some(part => part.trim() === speakerFilter);
  const indices = new Map<string, number>();
  const total = [0], other = [0];
  let end = 0;
  groups.forEach((group, index) => {
    indices.set(group.id, index);
    const included = showDeleted || !group.deleted;
    total.push(total[index] + (included ? 1 : 0));
    other.push(other[index] + (included && !matches(group) ? 1 : 0));
    end = Math.max(end, group.end);
  });
  const gap = (from: number, to: number, start: number, end: number, position: FilterGap["position"]): FilterGap | null => {
    const count = total[to] - total[from];
    if (!count) return null;
    const otherSpeakerCount = other[to] - other[from];
    return { count, otherSpeakerCount, searchHiddenCount: count - otherSpeakerCount, start, end, elapsedMs: Math.max(0, end - start), position };
  };
  let previous: FilterContextGroup | undefined;
  let previousIndex = -1;
  for (const group of filtered) {
    const index = indices.get(group.id);
    if (index === undefined || index <= previousIndex) continue;
    const context = gap(previousIndex + 1, index, previous?.end ?? 0, group.start, previous ? "between" : "before");
    if (context) before.set(group.id, context);
    previous = group;
    previousIndex = index;
  }
  return { before, after: previous ? gap(previousIndex + 1, groups.length, previous.end, end, "after") : null };
}
