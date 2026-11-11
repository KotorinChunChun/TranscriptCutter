import test from "node:test";
import assert from "node:assert/strict";
import { buildSpeakerFilterContext } from "../src/lib/filter-context.ts";

const group = (id, canonicalSpeaker, start, end, deleted = false) => ({ id, canonicalSpeaker, start, end, deleted });
const fixture = () => [
  group("lead-b", "B", 0, 1000),
  group("lead-unknown", null, 1000, 2000),
  group("a-first", "A", 2000, 3000),
  group("b-between", "B", 3000, 4000),
  group("compound", "A ／ B", 4000, 5000),
  group("a-search-hidden", "A", 5000, 6000),
  group("b-deleted", "B", 6000, 7000, true),
  group("a-last", "A", 7000, 8000),
  group("c-trailing", "C", 8000, 9000),
  group("a-deleted-trailing", "A", 9000, 10000, true),
];
const items = (source, ids) => ids.map(id => source.find(item => item.id === id));

test("speaker filtering counts leading, intervening and trailing conversation groups", () => {
  const source = fixture();
  const filtered = items(source, ["a-first", "compound", "a-search-hidden", "a-last"]);
  const context = buildSpeakerFilterContext(source, filtered, "A");
  assert.deepEqual(context.before.get("a-first"), { count: 2, otherSpeakerCount: 2, searchHiddenCount: 0, start: 0, end: 2000, elapsedMs: 2000, position: "before" });
  assert.deepEqual(context.before.get("compound"), { count: 1, otherSpeakerCount: 1, searchHiddenCount: 0, start: 3000, end: 4000, elapsedMs: 1000, position: "between" });
  assert.equal(context.before.has("a-search-hidden"), false);
  assert.equal(context.before.has("a-last"), false); // The only intervening group is deleted.
  assert.equal(context.after.count, 1);
  assert.equal(context.after.otherSpeakerCount, 1);
  assert.equal(context.after.position, "after");
});

test("same-speaker posts hidden by search are distinguished from other-speaker posts", () => {
  const source = fixture();
  const context = buildSpeakerFilterContext(source, items(source, ["a-first", "a-last"]), "A");
  assert.deepEqual(context.before.get("a-last"), { count: 3, otherSpeakerCount: 1, searchHiddenCount: 2, start: 3000, end: 7000, elapsedMs: 4000, position: "between" });
  assert.equal(context.after.searchHiddenCount, 0);
});

test("show-deleted includes removed groups in the corresponding gap count", () => {
  const source = fixture();
  const filtered = items(source, ["a-first", "a-last"]);
  const hidden = buildSpeakerFilterContext(source, filtered, "A", false);
  const shown = buildSpeakerFilterContext(source, filtered, "A", true);
  assert.equal(hidden.before.get("a-last").count, 3);
  assert.deepEqual(shown.before.get("a-last"), { count: 4, otherSpeakerCount: 2, searchHiddenCount: 2, start: 3000, end: 7000, elapsedMs: 4000, position: "between" });
  assert.equal(shown.after.count, 2);
  assert.equal(shown.after.otherSpeakerCount, 1);
  assert.equal(shown.after.searchHiddenCount, 1);
});

test("compound labels with compact, spaced and fullwidth slashes match the chosen speaker", () => {
  const source = [
    group("a1", "A", 0, 1000),
    group("both-compact", "A/B", 1000, 2000),
    group("both-spaced", "B / A", 2000, 3000),
    group("both-fullwidth", "A／B", 3000, 4000),
    group("other-name", "AA", 4000, 5000),
    group("a2", "A", 5000, 6000),
  ];
  const gap = buildSpeakerFilterContext(source, [source[0], source[5]], "A").before.get("a2");
  assert.equal(gap.count, 4);
  assert.equal(gap.otherSpeakerCount, 1); // AA is not A, the three compound labels include A.
  assert.equal(gap.searchHiddenCount, 3);
});

test("unknown speaker filtering includes null and imported empty labels consistently", () => {
  const source = [
    group("u1", null, 0, 1000),
    group("unknown-search-hidden", "", 1000, 2000),
    group("known", "A", 2000, 3000),
    group("u2", null, 3000, 4000),
  ];
  const gap = buildSpeakerFilterContext(source, [source[0], source[3]], "unknown").before.get("u2");
  assert.equal(gap.count, 2);
  assert.equal(gap.otherSpeakerCount, 1);
  assert.equal(gap.searchHiddenCount, 1);
});

test("the full filtered timeline remains correct beyond the progressively rendered prefix", () => {
  const source = Array.from({ length: 80 }, (_, index) => group(`post-${index}`, index % 2 ? "B" : "A", index * 1000, index * 1000 + 500));
  const filtered = source.filter(item => item.canonicalSpeaker === "A");
  const context = buildSpeakerFilterContext(source, filtered, "A");
  assert.equal(context.before.get("post-50").count, 1);
  assert.equal(context.before.get("post-78").count, 1);
  assert.equal(context.before.size, 39);
  assert.equal(context.after.count, 1); // Only post-79; unseen but matching A posts are not trailing omissions.
  assert.equal(context.after.start, 78500);
  assert.equal(context.after.end, 79500);
});

test("overlapping subtitle times retain real boundaries and never invent a negative gap duration", () => {
  const source = [group("a1", "A", 0, 6000), group("b", "B", 1000, 2000), group("a2", "A", 3000, 4000)];
  assert.deepEqual(buildSpeakerFilterContext(source, [source[0], source[2]], "A").before.get("a2"), {
    count: 1, otherSpeakerCount: 1, searchHiddenCount: 0, start: 6000, end: 3000, elapsedMs: 0, position: "between",
  });
});

test("all-speaker or empty results need no gaps, and counting does not mutate conversation data", () => {
  const source = fixture().map(Object.freeze);
  Object.freeze(source);
  const filtered = Object.freeze(items(source, ["a-first", "a-last"]));
  const before = JSON.stringify(source);
  assert.equal(buildSpeakerFilterContext(source, filtered, "all").before.size, 0);
  assert.equal(buildSpeakerFilterContext(source, [], "A").after, null);
  buildSpeakerFilterContext(source, filtered, "A");
  assert.equal(JSON.stringify(source), before);
});
