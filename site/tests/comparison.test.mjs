import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { parseVtt, serializeVtt } from "../src/lib/vtt.ts";
import { buildDocument, createEditorState, getTranscriptTailCut } from "../src/lib/editor.ts";

// Match the browser compiler while resolving its extensionless imports for Node.
const source = (await readFile(new URL("../src/lib/comparison.ts", import.meta.url), "utf8"))
  .replace('from "./editor"', `from "${new URL("../src/lib/editor.ts", import.meta.url).href}"`)
  .replace('from "./vtt"', `from "${new URL("../src/lib/vtt.ts", import.meta.url).href}"`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const {
  createComparisonSession, addComparisonSources, setComparisonReference,
  removeComparisonSource, buildComparisonRows, getComparisonChoice,
  getComparisonSpeakers, getSelectedCues, getComparisonSummary,
  exportComparisonJson, importComparisonJson,
  toggleComparisonText, getComparisonSkippedRanges,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const cue = (id, text, start, end, speaker = "話者1") => ({ id, text, start, end, speaker, sourceIds: [id], sourceCount: 1 });
const model = (id, cues, name = `モデル${id.toUpperCase()}`) => ({ id, name, fileName: `${id}.vtt`, cues, warnings: [] });
const contents = cues => cues.map(({ start, end, text, speaker }) => ({ start, end, text, speaker }));
const chooseAll = (session, sourceId) => ({
  ...session,
  choices: Object.fromEntries(buildComparisonRows(session).map(row => [row.id, {
    textSourceId: row.candidates[sourceId]?.length ? sourceId : null, speaker: null,
  }])),
});
const choose = (session, row, textSourceId, speaker = null) => ({ ...session, choices: { ...session.choices, [row.id]: { textSourceId, speaker } } });

test("comparison playback: toggling adoption permits zero choices and follows the adopted speaker", () => {
  const session=createComparisonSession([model('a',[cue('a','先頭',0,3000,'話者A')]),model('b',[cue('b','別案',0,3000,'話者B')])]);
  const row=buildComparisonRows(session)[0];
  const edited=choose(session,row,'a',{custom:'以前の指定'});
  assert.deepEqual(toggleComparisonText(edited,row,'b',true),{textSourceId:'b',speaker:null});
  edited.choices[row.id]=toggleComparisonText(edited,row,'a',true);
  assert.deepEqual(getSelectedCues(edited),[]);
  const restored=importComparisonJson(exportComparisonJson(edited));
  assert.equal(getComparisonChoice(restored,buildComparisonRows(restored)[0]).textSourceId,null);
  assert.deepEqual(getComparisonSkippedRanges(restored),[{start:0,end:3000}]);
  assert.match(serializeVtt(getSelectedCues(restored)),/^WEBVTT/);
});

test("comparison playback: explicit exclusions protect overlapping adopted speech and retain unmentioned gaps", () => {
  const session=createComparisonSession([model('a',[cue('a0','前',0,4000),cue('a1','後',4000,8000),cue('a2','末',12000,14000)]),model('b',[cue('b','長い候補',1000,5000)])]);
  const rows=buildComparisonRows(session);
  let edited=choose(session,rows[0],'b');
  edited=choose(edited,rows[1],null);
  assert.deepEqual(getComparisonSkippedRanges(edited),[{start:5000,end:8000}]);
  assert.deepEqual(getComparisonSkippedRanges(session),[]);
});

test("comparison playback: same-label warning is omitted while exported speaker scoping stays intact", () => {
  const session=createComparisonSession([model('a',[cue('a0','前',0,2000),cue('a1','後',2000,4000)]),model('b',[cue('b','後案',2000,4000)])]);
  const rows=buildComparisonRows(session),edited=choose(session,rows[1],'b');
  assert.equal(getComparisonSummary(edited).speakerCollisionCount,1);
  assert.equal(getComparisonSummary(edited).warnings.some(w=>w.includes('同じ話者ラベル')),false);
  assert.match(getSelectedCues(edited)[1].speaker,/モデルB/);
});
function fixtures() {
  return [
    model("a", [cue("cue-1", "今日はAI勉強会を始めます。", 0, 4000), cue("cue-2", "資料の整理について確認します。", 4000, 7000, "話者2"), cue("cue-3", "画像の分類を試します😀。", 7500, 10000), cue("cue-4", "結果を比較して確認しましょう。", 10500, 13000, "話者2"), cue("cue-5", "これで説明を終わります。", 13500, 16000)]),
    model("b", [cue("cue-1", "本日のAI勉強会を", 100, 2000, "SPEAKER_00"), cue("cue-2", "始めます。", 2000, 4200, "SPEAKER_00"), cue("cue-3", "資料を整理する方法を確認します。", 4200, 7200, "SPEAKER_01"), cue("cue-4", "画像分類を試してみます😀。", 7400, 10100, "SPEAKER_00"), cue("cue-5", "結果を比較しましょう。", 10400, 13200, "SPEAKER_01"), cue("cue-6", "以上で説明を終わります。", 13400, 16100, "SPEAKER_00")]),
    model("c", [cue("cue-1", "AI研修を始めましょう。", 0, 4100), cue("cue-2", "資料整理の手順を確認しましょう。", 4100, 7100, "話者2"), cue("cue-3", "画像を分類してみます🚀。", 7600, 10200), cue("cue-4", "違いを比較して確かめましょう。", 10600, 13100, "話者2"), cue("cue-5", "今回の説明はここまでです。", 13600, 15900), cue("cue-6", "追加の質疑応答です。", 18000, 20000, "話者3")]),
  ];
}

test("one to three sources are atomic, uniquely identified, and independently cloned", () => {
  const inputs = fixtures();
  const session = createComparisonSession(inputs);
  assert.equal(session.sources.length, 3);
  assert.notStrictEqual(session.sources[0].cues[0], inputs[0].cues[0]);
  assert.throws(() => createComparisonSession([]));
  assert.throws(() => createComparisonSession([...inputs, model("d", [cue("1", "four", 0, 1000)])]), /最大3/);
  assert.throws(() => createComparisonSession([inputs[0], inputs[0]]), /重複/);
  const before = JSON.stringify(session);
  assert.throws(() => addComparisonSources(session, [model("d", [cue("1", "four", 0, 1000)])]), /最大3/);
  assert.equal(JSON.stringify(session), before);
  const one = createComparisonSession([inputs[0]]);
  assert.throws(() => addComparisonSources(one, [inputs[1], { ...inputs[2], cues: [] }]));
  assert.equal(one.sources.length, 1);
  assert.equal(addComparisonSources(one, inputs.slice(1)).sources.length, 3);
});

test("fixed reference rows align 1:n cues and offsets while retaining original bounds", () => {
  const session = createComparisonSession(fixtures());
  const rows = buildComparisonRows(session);
  assert.deepEqual(rows.map(row => [row.start, row.end]), [[0, 4000], [4000, 7000], [7500, 10000], [10500, 13000], [13500, 16000], [18000, 20000]]);
  assert.deepEqual(rows.map(row => row.candidates.b.map(cue => cue.id)), [["cue-1", "cue-2"], ["cue-3"], ["cue-4"], ["cue-5"], ["cue-6"], []]);
  assert.equal(rows[0].candidates.b[1].end, 4200);
  assert.equal(getComparisonChoice(session, rows.at(-1)).textSourceId, null);
  assert.deepEqual(contents(getSelectedCues(session, rows)), contents(session.sources[0].cues));
  const selected = choose(session, rows[0], "b");
  assert.deepEqual(contents(getSelectedCues(selected, rows)).slice(0, 2), contents(session.sources[1].cues).slice(0, 2));
  assert.equal(getComparisonSummary(selected, rows).overlapCount, 1);
});

test("adopting any entire model reproduces that model's exact times and text, including unmatched cues", () => {
  const session = createComparisonSession(fixtures());
  for (const source of session.sources) {
    const selected = getSelectedCues(chooseAll(session, source.id));
    assert.deepEqual(contents(selected), contents(source.cues));
    assert.deepEqual(contents(parseVtt(serializeVtt(selected)).cues), contents(source.cues));
    assert.equal(new Set(selected.map(cue => cue.id)).size, source.cues.length);
  }
});

test("many-to-one candidates are assigned once without transitive chain collapse or invented words", () => {
  const reference = Array.from({ length: 120 }, (_, i) => cue(`r${i}`, `基準 ${i}`, i * 1000, (i + 1) * 1000));
  const shifted = Array.from({ length: 119 }, (_, i) => cue(`s${i}`, `重なる原文😀 ${i}`, i * 1000 + 500, i * 1000 + 2500));
  const wide = [cue("whole", "長い発言は分割しない。", 0, 120000)];
  const session = createComparisonSession([model("a", reference), model("b", shifted), model("c", wide)]);
  const rows = buildComparisonRows(session);
  assert.equal(rows.length, 120);
  for (const source of session.sources) {
    const candidates = rows.flatMap(row => row.candidates[source.id]);
    assert.equal(candidates.length, source.cues.length);
    assert.equal(new Set(candidates.map(cue => cue.id)).size, source.cues.length);
    assert.deepEqual(contents(getSelectedCues(chooseAll(session, source.id))), contents(source.cues));
  }
  assert.equal(rows.filter(row => row.candidates.c.length).length, 1);
  assert.equal(rows.find(row => row.candidates.c.length).candidates.c[0].text, "長い発言は分割しない。");
});

test("unmatched cues get fixed extra anchors and later models can align to them", () => {
  const session = createComparisonSession([
    model("a", [cue("r", "基準", 5000, 6000)]),
    model("b", [cue("before", "前", 0, 1000), cue("adjacent", "隣", 1000, 2000), cue("after", "後", 7000, 8000)]),
    model("c", [cue("before", "前の別モデル", 100, 900), cue("after", "後の別モデル", 7100, 8200)]),
  ]);
  const rows = buildComparisonRows(session);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.start), [0, 1000, 5000, 7000]);
  assert.equal(rows[0].candidates.c.length, 1);
  assert.equal(rows[3].candidates.c.length, 1);
  assert.equal(rows[3].end, 8000);
  assert.equal(getComparisonSummary(session).skippedRowCount, 3);
  assert.equal(getSelectedCues(session).length, 1);
  assert.equal(getSelectedCues(chooseAll(session, "b")).length, 3);
});

test("overlap ties choose nearest midpoint then earliest anchor deterministically", () => {
  const session = createComparisonSession([
    model("a", [cue("first", "first", 0, 1000), cue("second", "second", 1000, 2000)]),
    model("b", [cue("tie", "exact tie", 500, 1500), cue("touch", "touch only", 2000, 2500)]),
  ]);
  const rows = buildComparisonRows(session);
  assert.deepEqual(rows[0].candidates.b.map(cue => cue.id), ["tie"]);
  assert.equal(rows[1].candidates.b.length, 0);
  assert.equal(rows[2].candidates.b[0].id, "touch");
  assert.deepEqual(buildComparisonRows(session).map(row => row.id), rows.map(row => row.id));
});

test("text and speaker adoption are independent and provenance follows both selected sources", () => {
  const session = createComparisonSession(fixtures());
  const rows = buildComparisonRows(session);
  const edited = choose(session, rows[0], "b", { sourceId: "c", label: "話者1" });
  const selected = getSelectedCues(edited, rows);
  assert.deepEqual(selected.slice(0, 2).map(cue => cue.text), session.sources[1].cues.slice(0, 2).map(cue => cue.text));
  assert.ok(selected.slice(0, 2).every(cue => cue.speaker === "話者1［モデルC］"));
  assert.equal(selected[3].speaker, "話者1［モデルA］");
  assert.equal(selected[0].comparisonSourceId, "b");
  assert.equal(selected[0].comparisonSpeakerSourceId, "c");
  assert.equal(selected[0].comparisonSourceCueId, "cue-1");
  assert.equal(selected[0].comparisonRowId, rows[0].id);
  assert.equal(selected[0].id, "comparison:b:cue-1");
  assert.deepEqual(selected[0].sourceIds, ["comparison:b:cue-1"]);
  assert.equal(getComparisonSummary(edited, rows).speakerCollisionCount, 1);
});

test("explicit source-scoped aliases and custom names can intentionally unify speaker identities", () => {
  const session = createComparisonSession(fixtures());
  const rows = buildComparisonRows(session);
  const selected = choose(session, rows[0], "b", { sourceId: "c", label: "話者1" });
  selected.speakerAliases = { a: { 話者1: "田中" }, c: { 話者1: "田中" } };
  const adopted = getSelectedCues(selected, rows);
  assert.equal(adopted[0].speaker, "田中");
  assert.equal(adopted[3].speaker, "田中");
  assert.equal(getComparisonSummary(selected, rows).speakerCollisionCount, 0);
  const custom = getSelectedCues(choose(selected, rows[0], "b", { custom: "山田😀" }));
  assert.equal(custom[0].speaker, "山田😀");
  assert.equal(custom[0].comparisonSpeakerSourceId, null);
  const unknown = getSelectedCues(choose(selected, rows[0], "b", { sourceId: "c", label: null }));
  assert.equal(unknown[0].speaker, null);
  assert.equal(unknown[0].comparisonSpeakerSourceId, "c");
});

test("identical model names still produce distinct unaliased speaker identities", () => {
  const session = createComparisonSession([
    model("a", [cue("same", "first", 0, 1000)], "モデル"),
    model("b", [cue("same", "second", 1000, 2000)], "モデル"),
  ]);
  const rows = buildComparisonRows(session);
  const adopted = getSelectedCues(choose(session, rows[1], "b"));
  assert.deepEqual(adopted.map(cue => cue.speaker), ["話者1［モデル 1］", "話者1［モデル 2］"]);
  assert.equal(new Set(adopted.map(cue => cue.id)).size, 2);
  assert.equal(new Set(adopted.flatMap(cue => cue.sourceIds)).size, 2);
});

test("compound labels offer their individual candidates and accept source-local aliases", () => {
  const source = model("a", [cue("1", "発言", 0, 1000, "話者1 / 話者2")]);
  const session = createComparisonSession([source]);
  const [row] = buildComparisonRows(session);
  assert.deepEqual(getComparisonSpeakers(session.sources[0]), ["話者1 / 話者2", "話者1", "話者2"]);
  assert.equal(getSelectedCues(choose(session, row, "a", { sourceId: "a", label: "話者2" }))[0].speaker, "話者2");
  session.speakerAliases = { a: { 話者1: "田中" } };
  assert.equal(getSelectedCues(session)[0].speaker, "田中 / 話者2");
});

test("comparison import/export preserves original sources, Unicode, decisions, and aliases", () => {
  const session = createComparisonSession(fixtures());
  const rows = buildComparisonRows(session);
  const edited = choose(session, rows[0], "b", { sourceId: "c", label: "話者1" });
  edited.choices[rows.at(-1).id] = { textSourceId: "c", speaker: { custom: "質疑担当🚀" } };
  edited.speakerAliases = { c: { 話者1: "佐藤😀" } };
  edited.sources[0].warnings = ["確認してください"];
  const serialized = exportComparisonJson(edited);
  const restored = importComparisonJson(serialized);
  assert.deepEqual(JSON.parse(exportComparisonJson(restored)), JSON.parse(serialized));
  assert.deepEqual(getSelectedCues(restored), getSelectedCues(edited));
  assert.equal(restored.sources[0].fileName, "a.vtt");
  assert.equal(getSelectedCues(restored).at(-1).speaker, "質疑担当🚀");
});

test("malformed, stale, oversized-source, and prototype-like project references fail atomically", () => {
  const session = createComparisonSession(fixtures());
  const rows = buildComparisonRows(session);
  const base = JSON.parse(exportComparisonJson(session));
  const reject = mutate => { const value = structuredClone(base); mutate(value); assert.throws(() => importComparisonJson(JSON.stringify(value))); };
  reject(value => { value.schemaVersion = 2; });
  reject(value => { value.extra = "unsupported"; });
  reject(value => { value.sources.push(structuredClone(value.sources[0])); });
  reject(value => { value.sources[1].id = "a"; });
  reject(value => { value.referenceId = "missing"; });
  reject(value => { value.sources[0].name = "x".repeat(129); });
  reject(value => { value.sources[0].cues[0].end = value.sources[0].cues[0].start; });
  reject(value => { value.sources[0].cues[0].start = 0.5; });
  reject(value => { value.sources[0].cues[1].id = "cue-1"; });
  reject(value => { value.sources[0].cues[0].id = "__proto__"; });
  reject(value => { value.choices.stale = { textSourceId: "a", speaker: null }; });
  reject(value => { value.choices[rows.at(-1).id] = { textSourceId: "a", speaker: null }; });
  reject(value => { value.choices[rows[0].id] = { textSourceId: "missing", speaker: null }; });
  reject(value => { value.choices[rows[0].id] = { textSourceId: "a", speaker: { sourceId: "c", label: "missing" } }; });
  reject(value => { value.choices[rows[0].id] = { textSourceId: "a", speaker: { custom: "", sourceId: "c" } }; });
  reject(value => { value.speakerAliases = { missing: { 話者1: "田中" } }; });
  reject(value => { value.speakerAliases = { a: { missing: "田中" } }; });
  reject(value => { Object.defineProperty(value.choices, "__proto__", { value: {}, enumerable: true }); });
  assert.throws(() => importComparisonJson("not json"));
  assert.equal({}.polluted, undefined);
});

test("filtered or stale UI rows cannot filter selected exports or their summary", () => {
  const session = createComparisonSession(fixtures());
  const rows = buildComparisonRows(session);
  assert.equal(getSelectedCues(session, rows.slice(0, 1)).length, 5);
  assert.equal(getSelectedCues(session, []).length, 5);
  assert.equal(getComparisonSummary(session, rows.slice(0, 1)).selectedRowCount, 5);
  const changed = chooseAll(session, "c");
  assert.equal(getSelectedCues(changed, rows).length, 6);
  const reanchored = setComparisonReference(session, "b");
  assert.deepEqual(contents(getSelectedCues(reanchored, rows)), contents(session.sources[1].cues));
});

test("changing reference and removing sources leave no stale choices or aliases", () => {
  const session = createComparisonSession(fixtures());
  const rows = buildComparisonRows(session);
  const edited = choose(session, rows[0], "b", { sourceId: "c", label: "話者1" });
  edited.speakerAliases = { b: { SPEAKER_00: "田中" }, c: { 話者1: "佐藤" } };
  assert.strictEqual(setComparisonReference(edited, "a"), edited);
  const reanchored = setComparisonReference(edited, "b");
  assert.equal(Object.keys(reanchored.choices).length, 0);
  assert.equal(getSelectedCues(reanchored).length, 6);
  const removeText = removeComparisonSource(edited, "b");
  assert.equal(getComparisonChoice(removeText, buildComparisonRows(removeText)[0]).textSourceId, null);
  assert.equal(removeText.speakerAliases.b, undefined);
  assert.doesNotThrow(() => importComparisonJson(exportComparisonJson(removeText)));
  const removeSpeaker = removeComparisonSource(edited, "c");
  assert.equal(getComparisonChoice(removeSpeaker, buildComparisonRows(removeSpeaker)[0]).speaker, null);
  assert.equal(removeSpeaker.sources.length, 2);
  assert.doesNotThrow(() => importComparisonJson(exportComparisonJson(removeSpeaker)));
  const removeReference = removeComparisonSource(edited, "a");
  assert.equal(removeReference.referenceId, "b");
  assert.equal(Object.keys(removeReference.choices).length, 0);
  assert.throws(() => removeComparisonSource(createComparisonSession([fixtures()[0]]), "a"));
});

test("all operations tolerate frozen source data without mutating original cues or choices", () => {
  const inputs = fixtures();
  for (const source of inputs) {
    source.cues.forEach(cue => { Object.freeze(cue.sourceIds); Object.freeze(cue); });
    Object.freeze(source.cues); Object.freeze(source.warnings); Object.freeze(source);
  }
  Object.freeze(inputs);
  const before = JSON.stringify(inputs);
  const session = createComparisonSession(inputs);
  const sessionBefore = JSON.stringify(session);
  const rows = buildComparisonRows(session);
  getSelectedCues(choose(session, rows[0], "b"), rows);
  getComparisonSummary(session, rows);
  removeComparisonSource(session, "b");
  setComparisonReference(session, "b");
  exportComparisonJson(session);
  assert.equal(JSON.stringify(inputs), before);
  assert.equal(JSON.stringify(session), sessionBefore);
});

test("multi-voice payload stays intact by default and explicit speaker adoption replaces its labels", () => {
  const parsed = parseVtt("WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n<v 話者A>こんにちは😀</v>\n<v 話者B>はい、&amp;ありがとう。</v>\n");
  const session = createComparisonSession([model("a", parsed.cues)]);
  const [row] = buildComparisonRows(session);
  assert.deepEqual(getComparisonSpeakers(session.sources[0]), ["話者A", "話者B"]);
  assert.equal(getSelectedCues(session)[0].voicePayload, parsed.cues[0].voicePayload);
  assert.equal(getSelectedCues(session)[0].text, parsed.cues[0].text);
  const changed = getSelectedCues(choose(session, row, "a", { sourceId: "a", label: "話者B" }))[0];
  assert.equal(changed.speaker, "話者B");
  assert.equal(changed.text, "こんにちは😀\nはい、&ありがとう。");
  assert.equal(changed.isMultiVoice, undefined);
  assert.equal(changed.voicePayload, undefined);
  assert.equal(changed.start, 0); assert.equal(changed.end, 3000);
});

test("source-local aliases and model collisions also apply inside preserved multi-voice cues", () => {
  const multi = parseVtt("WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n<v.first 話者A>こんにちは😀</v>\n<v 話者B>はい。</v>\n").cues;
  const session = createComparisonSession([model("a", multi), model("b", [cue("b", "別モデル", 3000, 4000, "話者A")])]);
  const rows = buildComparisonRows(session);
  const edited = choose(session, rows[1], "b");
  const original = JSON.stringify(session.sources);
  const selected = getSelectedCues(edited);
  assert.match(selected[0].voicePayload, /<v.first 話者A［モデルA］>/);
  assert.equal(selected[1].speaker, "話者A［モデルB］");
  assert.equal(getComparisonSummary(edited).speakerCollisionCount, 1);
  edited.speakerAliases = { a: { 話者A: "田中 & 佐藤", 話者B: "山田" }, b: { 話者A: "田中 & 佐藤" } };
  const renamed = getSelectedCues(edited);
  assert.match(renamed[0].voicePayload, /<v.first 田中 &amp; 佐藤>/);
  assert.equal(renamed[0].text, "田中 & 佐藤：こんにちは😀\n山田：はい。");
  assert.equal(renamed[1].speaker, "田中 & 佐藤");
  assert.deepEqual(contents(parseVtt(serializeVtt(renamed)).cues), contents(renamed));
  assert.equal(JSON.stringify(session.sources), original);
});

test("selected VTT endpoint drives the existing tail cut after adoption", () => {
  const session = createComparisonSession(fixtures());
  for (const [sourceId, expectedEnd] of [["a", 16000], ["b", 16100], ["c", 20000]]) {
    const doc = buildDocument(getSelectedCues(chooseAll(session, sourceId)));
    const tail = getTranscriptTailCut(doc, 22000);
    assert.equal(tail.start, expectedEnd);
    assert.equal(tail.end, 22000);
    assert.equal(createEditorState().cuts.length, 0);
  }
});

test("thousands of offset cues remain bounded by fixed anchors instead of forming one overlap component", () => {
  const count = 2000;
  const sources = [0, 1, 2].map(modelIndex => model(String(modelIndex), Array.from({ length: count }, (_, i) => cue(`cue-${i}`, `字幕 ${i}`, i * 1000 + modelIndex * 100, i * 1000 + 1000 + modelIndex * 100))));
  const session = createComparisonSession(sources);
  const rows = buildComparisonRows(session);
  assert.equal(rows.length, count);
  for (const source of sources) assert.equal(rows.flatMap(row => row.candidates[source.id]).length, count);
  assert.equal(getSelectedCues(chooseAll(session, "2"), rows).length, count);
});
