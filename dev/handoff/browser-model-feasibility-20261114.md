# 連携アプリ向けブラウザー実行モデル調査

調査日：2026-11-14。対象：TranscriptionServer v0.1.12のソースに登録されたローカル15モデル（補助モデル・明示有効化が必要な一体型を含む）。対象読者：本サーバーとの連携や、クライアント内での音声処理を検討するアプリ開発者。

Whisper以外にも、Nemotron ASR・Nemotron話者分離・Qwen3-ASR 0.6Bにはブラウザー内推論の公開実装があります。ブラウザー対応の可否はPythonを使うかではなく、モデルの演算・前処理・復号処理をWebAssemblyまたはWebGPUで実装できるかで決まります。

本調査は資料・ソースの確認であり、本アプリへのブラウザー推論実装や、このPCでのブラウザー実測を示すものではありません。以下の難易度は組み込み作業の見積もりです。公開実例は提供者の報告で、公式モデル提供元によるブラウザー対応保証とは区別します。

## モデル別の実現性と必要作業

| 現行モデル | ブラウザー内実行の根拠と制約 | 主な追加作業 | 難易度 |
|---|---|---|---|
| Whisper Tiny／Base／Small | Transformers.jsのWhisper対応を利用可能 [1] | ONNX版の選定、音声入力、認識結果・時刻情報の接続 | 低～中 |
| Whisper Medium／Large v3／Large v3 Turbo | 同系列を利用可能。Large v3とTurboのTransformers.js用モデルも公開済み [2][3]。大きいモデルほど端末メモリ・処理時間の制約が増える | 量子化、長音声の分割、メモリ管理 | 中 |
| Silero VAD | vad-webにブラウザー実装とv6モデルあり [4]。現行サーバーのv6.2と配布モデルの厳密な一致は未確認 | モデル版・入力窓・状態・閾値の照合、音声区間の接続 | 低 |
| Nemotron 3.5 ASR Streaming 0.6B | 同じモデルのINT4 ONNX版を用いたWebGPU／WASM実装あり [5] | 音声前処理、RNNT復号、ストリーム状態、字幕時刻、日本語での一致・精度検証 | 中 |
| Nemotron 3 Diarization | 同じモデルのONNX版とブラウザー処理例あり [6] | 音声特徴抽出、話者キャッシュ、認識結果との時刻照合、長音声での話者継続確認 | 中 |
| Qwen3-ASR 0.6B | WASM版の実行報告 [7] とWebGPU用ONNX変換 [8] あり | 実行方式選定、モデル読み込み、音声分割、字幕時刻対応。WebGPU版はshader-f16等の要件を確認 | 中 |
| Qwen3-ASR 1.7B | 移植候補。今回確認したWASM実測例は0.6Bで、1.7Bの動作保証にはならない [7] | 1.7Bの変換・対応演算・メモリ使用量の確認、長音声処理 | 中～高 |
| Haas-ja-v1.0 | CPU用ONNX変換あり [9]。ブラウザー完結の実行例は今回未確認 | ONNX Runtime Webへの接続、音声前処理と復号のJS移植、対応演算・量子化の精度確認 | 高 |
| Parakeet TDT/CTC 0.6B 日本語 | parakeet.jsの代表例はTDT 0.6B v3で、現在の日本語版と異なる [10]。日本語版LiteRT変換の公開記録にはWebGPUで実行できなかった条件もある [11] | 日本語モデル変換、語彙・特徴量・TDT復号の調整。TDTとCTCの対応範囲を明示 | 中～高 |
| ReazonSpeech v2（NeMo版） | 現行のNeMo版について完成したブラウザー実装は今回未確認。ONNXで提供されるk2-v2は別モデル [12] | ONNX変換またはC++のWASM化、前処理・RNNT復号の移植、精度比較 | 高 |
| Nemotron 3.5 Transcribe 30B-A4B（一体型） | 同一モデルのブラウザー完結例は今回未確認。現行のIQ4_NL重みだけで約19GB | 大容量読み込み・専用演算・作業用メモリの設計が必要。ブラウザーの大容量制限も考慮 [13] | 非常に高い |

「未確認」は不可能という意味ではありません。また、Web画面を持つPython・ネイティブ推論サーバーは、ブラウザー内実行の根拠には数えていません。OpenAIなどの外部APIはこの15モデルの対象外で、ブラウザーから呼べても推論は外部サーバーです。

## 連携アプリが区別する情報

- **サーバーで実行する場合**：接続先の [モデル情報API](../docs/model-information.md) を使用し、保有・導入可能・現在利用可能を区別する。`modelInstalled`、`runtimeReady`、`available`、`processingMethods`などは接続先サーバーについての情報。
- **ブラウザーで実行する場合**：本資料を技術選定の参考にし、ブラウザー用ランタイム、モデル版、端末能力、キャッシュ状態をアプリ側で別途管理する。現行APIはブラウザー実行可否を通知していない。
- **速度と容量**：サーバーの`referenceSpeed`は測定環境付きの参考値。クライアントのブラウザー速度へ流用しない。ブラウザー版の量子化・モデル形式・ランタイムが異なる場合、保存容量・RAM・VRAMも別に測定する。
- **モデルファイル**：現在のWhisper用CTranslate2ファイルやネイティブ用GGUFを、ONNX実装でそのまま読み込めるわけではない。GGUF対応WASMを選ぶ場合も形式・演算・量子化方式の互換確認が必要。
- **動作場所**：ブラウザー方式では利用者のPCのCPU／GPU／RAMを使用する。モデル取得先を共通サーバーにしても、推論がクライアント内ならブラウザー方式。サーバーのGPUをWebGPUとして直接使うものではない。

## 対応時に共通して必要な作業

1. ブラウザー用実行エンジンとモデルの版・変換方法・ライセンスを固定する。
2. Web Workerで推論を分離し、音声のデコード・リサンプリング、長音声の分割、進捗、中止、資源解放を接続する。
3. モデル取得とブラウザー内キャッシュを実装する。サーバー側の導入済み状態と、各ブラウザーの取得済み状態は別管理とする。
4. HTTPS、WebGPU、WASMのスレッド要件を確認する。SharedArrayBufferを使う構成ではCOOP／COEP等の配信設定も必要 [5][7]。
5. 日本語の同一音声で本文・字幕時刻・話者区間を比較し、利用端末の速度・メモリを測定する。公開例の速度をそのまま保証値にしない。

通常利用時のPythonインストールは不要にできても、開発時のモデル変換にPythonを使う場合があります。ブラウザー用ページやモデルを配信する静的Webサイトと、音声を受け取って推論するバックグラウンドサーバーは別の役割です。

## 導入を検討する順序

最初はWhisper Base／SmallとSilero VAD、次にNemotron ASRとNemotron話者分離、比較候補としてQwen3-ASR 0.6Bが現実的です。Haas・日本語Parakeet・ReazonSpeechは個別の移植評価が必要です。30B一体型は大容量のため優先対象にしにくいと判断します。

これは技術的な提案であり、実装計画・モデル取得・サーバー構成変更の承認を意味しません。今回は文書化だけを行い、既存の推論経路・API・モデル情報JSONを変更していません。担当チャネルへの一斉通知は既存のリリース時通知方針に従います。

## 根拠資料

以下は2026-11-14の調査で確認した資料です。採用時には利用する版で再確認してください。

1. [Transformers.js WebGPU](https://huggingface.co/docs/transformers.js/main/guides/webgpu)
2. [Whisper Large v3 ONNX](https://huggingface.co/Xenova/whisper-large-v3)
3. [Whisper Large v3 Turbo ONNX](https://huggingface.co/onnx-community/whisper-large-v3-turbo)
4. [vad-web ブラウザー向け手順](https://docs.vad.ricky0123.com/user-guide/browser/)
5. [Nemotron_Web](https://github.com/People-11/Nemotron_Web)
6. [Nemotron 3 Diarization ONNXとブラウザー処理](https://huggingface.co/NealCaren/Nemotron-3-Diarization-ONNX)
7. [Qwen3-ASR WASM](https://github.com/shabier/qwen3-asr.wasm)
8. [Qwen3-ASR 0.6B WebGPU用ONNX](https://huggingface.co/goryodog/tokihisu-qwen3-asr-0.6b-webgpu)
9. [Haas-ja-v1.0 ONNX](https://huggingface.co/kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX)
10. [parakeet.js](https://github.com/ysdede/parakeet.js)
11. [日本語Parakeet LiteRT変換と端末別結果](https://huggingface.co/litert-community/parakeet-tdt_ctc-0.6b-ja/blob/main/README.md)
12. [ReazonSpeech k2-v2とNeMo版の区別](https://research.reazon.jp/blog/2024-08-01-ReazonSpeech.html)
13. [ONNX Runtime Webの大容量モデル制限](https://onnxruntime.ai/docs/tutorials/web/large-models.html)

現行モデルの照合元：`src/catalog.rs`、`src/nemo.rs`、`src/integrated.rs`、`dist/model-metadata.json`。モデル一覧には未導入モデルも含み、このPCで現在保有しているモデルだけの一覧ではありません。
