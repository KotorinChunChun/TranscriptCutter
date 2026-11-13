# 会議動画のAIカット候補を表示・編集できるOSSフロントエンド調査

## 調査結論

2026年11月10日時点で、今回の要件――**バックエンド側でAIが算出した「必要／不要」区間を、動画を見ながら確認・修正し、編集結果を再びバックエンドへ渡す**――に対して、最も現実的な選択肢は「完成済み動画編集アプリをそのまま流用する」よりも、**動画プレイヤー + 専用タイムラインOSSを組み合わせ、カット候補レビューに絞ったUIを作る構成**です。

第一推奨は **Canvas Timeline + HTML `<video>` / Video.js** です。Canvas Timeline はタイムライン状態をシリアライズ可能なJSONとして持ち、クリップ、マーカー、in/out範囲、トリム、スナップ、履歴、再生同期を部品として提供します。動画データやバックエンドを自前で所有する前提の設計なので、Haas-ja-v1.0、Nemotron 3 Diarization、speech.cpp、FFmpegという既存バックエンド構成をほぼ邪魔しません。ライセンスもMPL-2.0で、アプリ全体を強いコピーレフトに巻き込みにくい点が有利です。ただし、まだ若いプロジェクトでGitHub規模は小さく、採用時にはAPI固定化やラッパー層を設けるべきです。citeturn499505search0turn499505search1turn499505search3

第二推奨は、より短期のMVPなら **WaveSurfer.js Regions + `<video>`** です。Regionsプラグインは開始・終了時刻を持つ区間を表示し、ドラッグやリサイズで更新でき、`update-end`イベントで変更後の時刻を取得できます。AIの「不要区間」をそのままRegionとして投入するだけなので、今回の中心機能に非常に近く、BSD-3-Clauseでライセンス上も扱いやすいです。一方、WaveSurfer.js自体は音声波形プレイヤーであり、動画編集タイムラインではありません。動画との再生同期、文字起こし表示、区間の必要／不要状態、Undo、複数選択などはアプリ側で足す必要があります。citeturn711155search8turn711155search9turn206213search0turn206213search5

完成済みエディタをフォークするなら **OpenCut** が最有力です。MITライセンスで、活発に開発され、マルチトラック、トリム、再生、波形、字幕、JSONプロジェクト入出力などを既に持っています。ただし、今回必要な「AI判定区間レビュー」はOpenCutの標準概念ではなく、内部タイムラインモデルへAI区間を注入するアダプターと専用UIを実装する必要があります。また、OpenCutは2026年にもRust/WASMコアへの大きなアーキテクチャ変更が続いており、フォークすると上流追従コストが高くなります。citeturn847131search0turn847131search1turn821525search0

既存OSSの中で要件そのものに最も近いのは **Rescript** です。文字起こし、話者ラベル、波形、カット区間、区間端のドラッグ、ライブプレビュー、外部字幕インポートまで揃っています。しかし現在のライセンスは **PolyForm Noncommercial 1.0.0** であり、商用利用を前提にする場合はそのまま採用できません。過去のMIT版を使う方法はありますが、最新機能と保守を失うため、実装参考として見るのが妥当です。citeturn847131search5turn847131search6

## 有力OSSの比較

下表の「標準」はライブラリまたはアプリが既にその概念/APIを持つもの、「拡張」は比較的小さなアダプターやUI追加が必要なもの、「大幅拡張」は内部モデルへの変更が必要になるものを示します。

| OSS | GitHub / ライセンス | AI区間取り込み | 区間表示 | 区間修正 | バックエンド受渡し | 評価 |
|---|---|---:|---:|---:|---:|---|
| **Canvas Timeline** | [GitHub](https://github.com/TechSquidTV/Canvas-Timeline) / MPL-2.0 | 標準に近い | 標準 | 標準 | 標準に近い | **最有力** |
| **WaveSurfer.js** | [GitHub](https://github.com/katspaugh/wavesurfer.js) / BSD-3-Clause | 標準 | 標準 | 標準 | 拡張 | **MVP向き** |
| **OpenCut** | [GitHub](https://github.com/OpenCut-app/OpenCut) / MIT | 拡張 | 拡張 | 標準 | 拡張 | **完成UI流用向き** |
| **LosslessCut** | [GitHub](https://github.com/mifi/lossless-cut) / GPL-2.0 | **標準** | 標準 | 標準 | **標準** | デスクトップ用途なら強い |
| **react-timeline-editor** | [GitHub](https://github.com/xzdarcy/react-timeline-editor) / MIT | 標準に近い | 標準 | 標準 | 標準に近い | 軽量だが動画機能は自作 |
| **Ektie React Video Timeline Editor** | [GitHub](https://github.com/Ektie/react-video-timeline-editor) / AGPL-3.0 | 標準に近い | 標準 | 標準 | 標準 | 機能的には好適、ライセンス注意 |
| **Abekyo Editor** | [GitHub](https://github.com/abekyo/abekyo-editor) / MIT | 標準に近い | 標準 | 標準 | **標準** | AI連携思想は非常に近い |
| **Rescript** | [GitHub](https://github.com/wassgha/rescript) / PolyForm NC | 標準 | **標準** | **標準** | 標準 | 商用利用制約が致命的 |
| **Shotcut** | [GitHub](https://github.com/mltframework/shotcut) / GPLv3 | 拡張 | 標準 | 標準 | 拡張 | 埋め込みには重い |
| **Olive** | [GitHub](https://github.com/olive-editor/olive) / GPLv3 | 大幅拡張 | 標準 | 標準 | 大幅拡張 | 保守状況から非推奨 |

Canvas Timelineでは状態モデルが「pure serializable JSON」と明記され、トラック、クリップ、マーカー、再生、履歴、スナップをheadless coreが管理します。HTML Media Adapterでは`sourceId`を介してタイムラインと動画・音声を同期できるため、AIから `{start, end, decision, confidence}` のような独自データを受け取り、それをクリップまたはマーカーとして変換する層を非常に薄くできます。citeturn499505search3turn499505search5turn499505search6

WaveSurfer.jsでは公式Regionsプラグインが「visual overlays and markers for regions」を提供し、実装例では`start`と`end`を指定してRegionを生成し、リサイズ完了時の`update-end`イベントから変更された開始・終了時刻を取得しています。したがって、AI判定JSON→Region生成→ユーザー変更→JSON再生成、という今回の基本ループはほぼ直接実装できます。2026年にもRegionsのドラッグ・リサイズ・タッチ操作に更新が入っており、メンテナンスも継続中です。citeturn206213search0turn206213search2turn206213search5

OpenCutは2026年のv0.3.0で字幕ファイルインポート、複数クリップの移動・リサイズ、波形改善、精密なタイム表現などを追加しています。タイムラインの内部時間は浮動小数秒から120,000 ticks/secの整数ベースへ移行しており、フレーム整合性も強化されています。JSONプロジェクト入出力についても、外部AIツールが編集プロジェクトを生成する用途を想定した実装が進んでいます。一方で、コアエンジン、WASM、永続化、プラグインAPIが大幅に再設計されているため、現在のUIコードを直接フォークして深く改変すると、将来のマージコストは小さくありません。citeturn847131search1turn821525search0turn821525search1

LosslessCutはこの用途で見落としにくい候補です。CSVは1行を`start,end,label`として読み込め、EDL、SRT、OpenTimelineIO、FCPXMLなど多数の形式からセグメントを取り込めます。セグメントを反転、分割、結合、ラベル付けでき、再びCSV等へ書き出せます。つまりAIから「削除候補区間CSV」を生成するだけで、かなりのレビュー操作が**無改造**で成立します。最新リリース3.70.2は2026年10月28日で、現在も積極的に保守されています。最大の弱点はElectron型の完成アプリであり、Webアプリの一部として自然に埋め込むコンポーネントではない点とGPL-2.0です。citeturn711155search1turn711155search2turn491237search3

EktieのReact Video Timeline Editorは「React NLEをアプリに埋め込み、project documentを渡して`onChange`で編集結果を受け取る」という構造で、今回の要件には非常にきれいに対応します。トラック、クリップ、trim/split/move、undo、captions、browser previewを提供し、バックエンド、認証、永続化は利用側が持つ思想です。ただしAGPL-3.0で、ネットワークサービスとして改変版を提供する場合は対応するソース提供義務を検討する必要があります。また、2026年時点でGitHubのスター・フォーク数は非常に少なく、成熟度の判断には注意が必要です。citeturn847131search2turn491237search4

Abekyo Editorは特に興味深く、プロジェクト全体が公開JSON Schemaで表現され、外部AIやスクリプトがproject JSONを作成し、ブラウザ側で人間が最終調整することを明示的な用途として掲げています。字幕、動画クリップ、トリム、タイムライン、プレビューを持ち、MITライセンスです。ただしレンダリングがRemotion依存です。Remotionは2026年時点でOSI準拠OSSではなくsource-availableであり、4人以上の営利組織では原則Company Licenseが必要で、動画エディタのような自動化用途には「Remotion for Automators」が適用されます。今回FFmpegをバックエンドに使う予定であれば、AbekyoからUIだけ抽出する場合でもRemotion依存を切り離す作業が必要です。citeturn847131search4turn491237search2turn947862search0turn947862search3

iturn134686image1turn987488image0turn414320image0turn414320image2

上の例は順にOpenCut、LosslessCut、WaveSurfer.js Regions系UI、React Timeline Editor系UIです。OpenCutは一般的なNLE、LosslessCutは区間レビュー、WaveSurfer.jsは区間アノテーション、React Timeline Editorは汎用タイムラインという違いが視覚的にも明確です。今回のアプリは、一般NLEよりも**LosslessCutとWaveSurferの中間**に近いUIが最も自然だと考えられます。citeturn711155search1turn206213search2turn342808search0

## AIカット候補との接続方法

今回のフロントエンドでは、バックエンドのAIモデルをエディタ内部へ持ち込む必要はありません。境界を次のような単純な編集決定データに固定するのが適しています。

```json
{
  "duration": 1843.42,
  "segments": [
    {
      "id": "seg-001",
      "start": 12.40,
      "end": 21.76,
      "decision": "remove",
      "confidence": 0.94,
      "reason": "silence"
    },
    {
      "id": "seg-002",
      "start": 21.76,
      "end": 87.11,
      "decision": "keep",
      "confidence": 0.98
    }
  ]
}
```

Canvas Timelineの場合は、`segments`をタイムラインclipまたはmarkerへ変換し、編集されたstateから再び`segments`を生成します。タイムライン状態そのものがシリアライズ可能で、外部メディアを`sourceId`で参照する設計なので、この変換層をUIとバックエンド双方から独立させられます。citeturn499505search3turn499505search6

WaveSurfer.jsなら、`decision: remove`のものだけRegionsとして追加してもよく、keep/remove両方を別スタイルで描いても構いません。Regionにはstart/endがあり、リサイズ・ドラッグ後に更新イベントを受け取れるため、変更差分のみをバックエンドへ送る実装も可能です。citeturn206213search0turn206213search4

LosslessCutの場合は、同じ情報を`start,end,label`のCSVへ変換できます。たとえばlabelを`AI remove 0.94 silence`とすれば、ほぼ既存機能だけでAI候補レビューができます。これは「独自アプリを作る前にUXを検証する」プロトタイプとして非常に有効です。citeturn711155search2

文字起こしは編集区間データとは分離する方が扱いやすいです。たとえば次のようにword/utterance単位でstart/end、speaker、textを保持し、タイムライン下部または右側のTranscriptパネルから該当時刻へseekさせます。Rescriptはまさにこの構造に近く、文字を削除すると対応メディアのcut rangeになる設計を採っています。citeturn847131search5

```json
{
  "utterances": [
    {
      "speaker": "SPEAKER_01",
      "start": 21.76,
      "end": 27.31,
      "text": "それでは今日の議題から始めます"
    }
  ]
}
```

Haas-ja-v1.0等ですでにタイムスタンプ付き文字起こしがある場合は、このデータを直接ロードし、無い場合だけバックエンドで生成すればよく、フロント側の設計は共通化できます。フロントエンドは「文字起こしを生成したモデル」を知る必要がなく、区間と発話の時刻データだけを扱う方が、将来バックエンドを変更しても影響を受けにくい構成です。

## 実装方式ごとの工数と保守性

**完成OSSをフォークする方式**ではOpenCutが最有力です。動画読み込み、プレビュー、ズーム、波形、トリム、Undo/Redo、字幕など、多くの難しいUIが既に存在するため初期デモは速く作れます。MITという点も有利です。一方で、一般動画編集機能の大部分は今回不要です。OpenCutは現在も内部エンジンの再設計が続いているため、AIレビュー専用の表示やデータモデルを深く組み込むほど、上流との差分と保守量が増えます。citeturn847131search0turn847131search1turn821525search0

**タイムラインコンポーネントを組み合わせる方式**ではCanvas Timelineが最もバランスがよいです。プレイヤー、タイムライン、Transcriptパネル、AI判定一覧という必要な画面だけを組めます。Canvas Timelineは表示とheadless state、media adapterを分離しているため、FFmpegや既存バックエンドと競合しません。最大のリスクはプロジェクトがまだ新しいことです。GitHub上では2026年11月時点で小規模であり、プロダクション利用時は直接アプリ中にAPIを散らさず、`TimelineAdapter`のような自社ラッパーを1層入れるべきです。citeturn499505search0turn499505search8

**WaveSurfer.jsを中心に軽量UIを作る方式**は最小工数です。今回の会議動画は音声内容がカット判断の中心になるため、動画サムネイルを大量に並べる一般的NLEより、波形 + AI区間 + transcript + previewの方が情報密度も高くなります。WaveSurfer.jsは長期運用され、2026年現在もRegion周辺の更新が継続しています。反面、Undo、複数区間選択、clipの連結後プレビューなどは自前になります。citeturn711155search9turn206213search5

**LosslessCutをそのまま外部ツールとして採用する方式**は、社内ツールやPoCなら最小工数です。AIがCSVを書き、ユーザーがLosslessCutでレビューし、CSVを再出力するところまでコードを書かずに検証できます。ただし最終製品のUXや他画面との統合性には限界があります。GPL-2.0である点も配布形態を含めて検討が必要です。citeturn711155search0turn711155search2

**AbekyoやEktieのような完成コンポーネントを使う方式**は機能と実装量のバランスでは魅力的ですが、EktieはAGPL、AbekyoはRemotion依存というライセンス上の考慮があります。特にRemotionは現在OSSではなく、営利企業の内部利用を含めCompany Licenseの対象になり得るため、「保守コストを抑える」という目的では技術コストがライセンス運用コストへ移る可能性があります。citeturn847131search2turn847131search4turn947862search3

## 推奨アーキテクチャ

本番構成としては、**Canvas Timelineを中心にした軽量独自UI**を推奨します。

```text
┌──────────────────────────────────────────┐
│              React / Web UI              │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │          Video Preview             │  │
│  │       HTMLVideoElement             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  AI: 削除候補  12:40-13:05  [保持][削除] │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Canvas Timeline                    │  │
│  │ █ KEEP ███ RED/REMOVE ███ KEEP ██ │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Transcript / Speaker                    │
│  A 12:42 「次の議題について…」          │
│  B 12:48 「はい…」                      │
└──────────────────────────────────────────┘
             │ JSON
             ▼
┌──────────────────────────────────────────┐
│       Existing Backend / API             │
│                                          │
│ Haas-ja-v1.0                             │
│ Nemotron 3 Diarization                   │
│ speech.cpp                               │
│ AI cut decision logic                    │
│ FFmpeg                                   │
└──────────────────────────────────────────┘
```

Canvas Timelineのmedia adapterは、タイムライン状態と実メディアを分離しながらHTML media elementとの同期を提供します。この設計は「フロントエンドは編集決定だけを管理し、最終書き出しはFFmpeg」という今回の責務分離とよく一致します。citeturn499505search6

画面上では最初から一般NLEのような複数映像レイヤーを出す必要はありません。第1段階は、動画プレビュー、1本のタイムライン、AI削除候補、文字起こし、適用ボタンだけにするとよいでしょう。AI区間は赤/灰色等の区間として表示し、境界ドラッグ、keep/remove切替、split、undoだけ実装します。この設計なら編集結果は単純なEDL相当になり、FFmpeg側でも`trim`/`atrim` + `concat`等の既存処理へ渡しやすくなります。

もしCanvas Timelineの成熟度が採用基準を満たさない場合は、同じAPI境界を維持したまま **WaveSurfer.js Regions**へ差し替えられます。WaveSurfer自体はRegion生成と編集イベントが安定しており、MVPではむしろこちらの方が実装量が少なくなります。citeturn206213search0turn206213search5

## 最終推奨順位

**第一候補：Canvas Timeline + HTML video。** 今回必要な機能だけを構築でき、JSON state、マーカー、clip、編集履歴、media同期を既存実装に任せられます。完成動画編集アプリをフォークするより不要コードが少なく、既存バックエンドとの境界も明確です。MPL-2.0も商用プロダクトへ組み込みやすい部類です。最大のリスクは若いプロジェクトであることなので、自社アダプター層を挟む条件付きで推奨します。citeturn499505search0turn499505search3

**第二候補：WaveSurfer.js Regions + HTML video。** 最短でMVPを作るならこちらです。「AIの不要区間を出し、ユーザーが左右端を修正する」という要件そのものはRegionsでほぼ完成しています。Transcript、動画同期、Undoなどを自前追加する必要はありますが、ライブラリの規模が小さく、将来の置き換えもしやすい構成です。citeturn711155search9turn206213search5

**第三候補：OpenCutをフォーク。** 将来的に本格的な動画編集機能――BGM、テロップ、複数映像、エフェクト、複雑なトラック編集――まで必要になることがかなり確実なら、この選択が有利です。逆に「AIカット候補の確認・修正」が製品の中心であり続けるなら、OpenCutは必要以上に大きく、上流変更への追従コストも発生します。citeturn847131search1turn821525search0

**PoC用途：LosslessCut。** 製品に組み込む候補というより、UIを1行も書かずに「AI区間→人間レビュー→修正区間→FFmpeg」という業務フローを検証するための基準実装として非常に価値があります。CSV区間入出力が標準機能なので、AI判定精度やレビュー操作の必要性を先に評価できます。citeturn711155search1turn711155search2

RescriptはUXの参考資料として非常に良いものの、現行版は非商用ライセンスのため本番採用候補から外すべきです。Abekyoは設計思想としてはかなり近いですがRemotionの商用ライセンスが入り、EktieはAGPLが入ります。Oliveは最終コード変更が2023年、2024年のnightly再ビルド以降も保守が停滞しているため、新規プロダクトの基盤には推奨しません。citeturn847131search5turn947862search3turn847131search2turn711155search6

したがって、**開発工数と長期保守コストの合計を最小にする構成は「軽量独自UI + Canvas Timeline」、最短MVPは「WaveSurfer.js Regions + video」、将来フルNLE化する可能性が高い場合だけ「OpenCutフォーク」**という結論です。