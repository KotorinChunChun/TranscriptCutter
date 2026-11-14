# 発話検出とHaasの完全フロント比較

指定された5分動画を対象とする限定実験ページです。本体のモデル一覧へは統合していません。

- 動画の読込・16kHzモノラルへの変換はブラウザーのWeb Audio。
- Haas・Nemotron・Sileroの推論と前後処理は同じブラウザーのWeb Worker内。
- CPUのWASMを1スレッドで使用。各試行に新しいWorkerを作り、同時推論しません。
- Nodeはloopbackの静的配信と結果JSONの保存のみ。音声を外部推論サービスやTranscriptionServerへ送信しません。
- 元動画・既存モデル・既存サービスを変更しません。

## モデルと実行条件

Haasは前回の `dev/haas-web-prototype/` と同じ4bitモデル、revision `e46a4b107ffba60336eb3de9745da6f628cfae35`。モデルとONNX Runtime Web 1.31.1は既存の `runtime/haas-browser-check/` から読み込みます。

Nemotronは [NealCaren/Nemotron-3-Diarization-ONNX](https://huggingface.co/NealCaren/Nemotron-3-Diarization-ONNX) のrevision `46642c09b3bd014c5ceb19d20524fa2f1dc27dee`。`embed.onnx`、`step_int8.onnx`、`mel_filters.bin`、`silence_embeds.bin` を `runtime/haas-nemotron-5min/model/nemotron/` に用意します。モデルのLICENSEは同フォルダーへ保持します。取得したLFS資産のSHA256はモデルmetadataと照合しました。

NemotronのJS処理は [公開変換者の実装](https://github.com/professorcaren/transcriber/blob/b11f004341b75b58ed754ecd30fda1394d8431f5/diar.js) を固定commitで検証専用の `runtime/haas-nemotron-5min/upstream-diar.js` に取得して使用します。同リポジトリーではJSソースの独立したライセンスを確認できていないため、追跡対象や製品配布物へコピーしていません。製品統合時はライセンス確認または別実装が必要です。

## 比較方法

1. `node dev/haas-nemotron-comparison/server.mjs` をプロジェクトルートから起動します。DevServer予約番号を避けたloopback専用ポートを表示します。追加計測は `HAAS_TRIAL_RUNTIME` 環境変数にプロジェクトのruntime内の絶対フォルダーを指定し、前回記録を保持します。
2. 表示URLをCodex内蔵ブラウザーで開き、「動画から音声を準備」を押します。動画のSHA256・音声長・共通準備時間を保持します。
3. 「今回3条件を順番に実行」を押します。Haas単独は全音声、Nemotron長め／Silero長めは各検出器の発話区間をまとめた元音声の連続区間を認識します。前回Nemotron短区間は過去の記録として別表示します。
4. モデル読込、発話検出、Haas、読込込み総時間、入力秒数と認識回数を比較します。区間抽出等の詳しい時間はJSONに保持します。音声準備は共通で別記します。モデルのインターネット取得時間は含めません。

発話区間は全8話者の確率が0.5を超える区間の和集合です。前後0.25秒を残し、0.5秒以下の間隔を結合します。短い発話を切り捨てず、同時発話を重複処理しません。各連続区間の中はHaasの約28秒の低エネルギー点分割を使用します。元時刻のまま出力し、動画自体はカットしません。

上記は前回の短区間条件です。2026-11-15の追加2条件は前後0.25秒を保ち、余白適用後の間隔3秒以下を結合、約25秒の低エネルギー点分割を使用します。短い間を残して前後の文脈を保持する目的です。約25秒は分割の目標で、前後2秒の探索範囲があります。

Sileroは [公式silero-vad](https://github.com/snakers4/silero-vad/tree/066409f3d9db45a30d21dfcbf9147826ffdd7052) の固定ONNX（2,327,524 bytes、SHA256 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`）を使用します。公式のGit blobと取得内容を照合し、MITライセンスを `SILERO-LICENSE` に保持しています。16kHzの512サンプル＋直前64サンプル文脈・状態テンソルで推論し、確率0.5超を発話とします。公式のmin_speech/ヒステリシス後処理は使用せず、短い発話を残して共通の結合処理へ渡します。話者番号は生成しません。

追加計測用モデル・記録の保存先は `runtime/haas-vad-5min-20261115/`。Silero資産はこの中の `model/silero/` に置きます。NemotronとHaasの既存資産は前回runtimeから読み込むだけで、重複取得しません。CPU単スレッドの同じ連続実行組で新baselineと比較し、前回参考値との違いを画面へ明記します。

時刻はチャンク境界の暫定値であり、単語単位の精度評価には使用しません。話者区間は検出結果であり、声そのものを音源分離したデータではありません。

## 結果と検証範囲

実行結果は選択したruntimeの各mode名JSONと `events.jsonl` へ保存します。Webページの再読込後も本文・時刻・処理時間を復元できます。比較する2方式を選択し、Web画面から各VTTとJSONを保存できます。

既存のWhisper Small字幕は照合用として表示します。自動字幕であり正解ではありません。本文の差分、参考字幕の短い応答の保持、除外区間の音声を区別して評価し、文字一致率を認識精度と呼びません。

関連する区間結合・同時発話・余白・極短発話・全無発話とSilero状態/context/tailの確認は `node --test dev/haas-nemotron-comparison/speech-regions.test.mjs dev/haas-nemotron-comparison/silero.test.mjs` で実行します。EXE作成や広範囲テストは対象外です。
