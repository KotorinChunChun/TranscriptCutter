import { createComparisonSession } from "./comparison";
import { parseVtt } from "./vtt";

const examples = [
  {
    id: "sample-model-a",
    name: "モデル A",
    body: `WEBVTT

00:00:00.000 --> 00:00:04.000
<v 話者1>今日はAI勉強会を始めます。</v>

00:00:04.000 --> 00:00:07.000
<v 話者2>資料の整理について確認します。</v>

00:00:07.500 --> 00:00:10.000
<v 話者1>画像の分類を試します。</v>

00:00:10.500 --> 00:00:13.000
<v 話者2>結果を比較して確認しましょう。</v>

00:00:13.500 --> 00:00:16.000
<v 話者1>これで説明を終わります。</v>
`,
  },
  {
    id: "sample-model-b",
    name: "モデル B",
    body: `WEBVTT

00:00:00.100 --> 00:00:02.000
<v SPEAKER_00>本日のAI勉強会を</v>

00:00:02.000 --> 00:00:04.200
<v SPEAKER_00>始めます。</v>

00:00:04.200 --> 00:00:07.200
<v SPEAKER_01>資料を整理する方法を確認します。</v>

00:00:07.400 --> 00:00:10.100
<v SPEAKER_00>画像分類を試してみます。</v>

00:00:10.400 --> 00:00:13.200
<v SPEAKER_01>結果を比較しましょう。</v>

00:00:13.400 --> 00:00:16.100
<v SPEAKER_00>以上で説明を終わります。</v>
`,
  },
  {
    id: "sample-model-c",
    name: "モデル C",
    body: `WEBVTT

00:00:00.000 --> 00:00:04.100
<v 話者1>AI研修を始めましょう。</v>

00:00:04.100 --> 00:00:07.100
<v 話者2>資料整理の手順を確認しましょう。</v>

00:00:07.600 --> 00:00:10.200
<v 話者1>画像を分類してみます。</v>

00:00:10.600 --> 00:00:13.100
<v 話者2>違いを比較して確かめましょう。</v>

00:00:13.600 --> 00:00:15.900
<v 話者1>今回の説明はここまでです。</v>

00:00:18.000 --> 00:00:20.000
<v 話者3>ほかに質問はありますか？</v>
`,
  },
];

export function createSampleComparison() {
  return createComparisonSession(examples.map(({ id, name, body }) => {
    const parsed = parseVtt(body);
    return { id, name, fileName: `${name}.vtt`, cues: parsed.cues, warnings: parsed.warnings };
  }));
}
