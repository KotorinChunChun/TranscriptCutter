# Haas ブラウザー内実行プロトタイプ

2026-11-14の限定試験用。アプリ本体のモデル表へはまだ統合していません。

- 推論: ONNX Runtime Web 1.31.1 / WASM / CPU 1スレッド / Web Worker。
- モデル: kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX、revision e46a4b107ffba60336eb3de9745da6f628cfae35、int4-onecompとcommon。配布manifestのSHA256を取得後に照合しました。
- frontend.mjsとdecoder.mjsは公開Haas CPU実装の特徴量・TDT・文字列復号をJSへ移したものです。モデルのApache-2.0とNOTICEを保持しています。
- 検証用モデル・ORT配布物・音声・結果はruntime/haas-browser-check/（Git対象外）に置きます。server.mjsはこの固定フォルダーだけをloopbackへ公開し、DevServer予約済みポートを避けます。

再現時はこのフォルダーの6コードファイルをruntime/haas-browser-checkへコピーし、同フォルダーへ固定モデル、ORTのort.wasm.min.mjs/ort-wasm-simd-threaded.mjs/ort-wasm-simd-threaded.wasmを用意して、`node runtime/haas-browser-check/server.mjs`を起動します。自動取得・自動導入は行いません。

model/にはcommon/{frontend.json,decoding.json,tokens.json,prediction.onnx,joint.onnx}とint4-onecomp/{encoder.onnx,encoder.onnx.data}が必要です。ort/に上述のORTファイルを配置します。PCM16/16kHz/monoのsample-8s.wavとsample-60s.wavを用意します。試験には既存の勉強会先頭1分WAVを使用しました。

前処理は16kHz・FFT512・窓400・hop160・128mel・公開固定係数を使用。NumPy基準の合成0.24秒との最大絶対差は3.43e-6。TDTのblank/duration/max_symbols/UTF-8 byte fallback/中止を限定確認しました。長音声は公開実装に沿って約28秒付近の低エネルギー点で分割します。各チャンクの時刻は字幕候補用で、単語の正確な境界を保証するものではありません。

ブラウザーのモデル読込・文字起こし操作のみで実行し、推論サーバーへ音声を送っていません。中止は当該Workerだけを終了します。結果は同じloopbackの/reportへ記録し、音声・モデルを外部へ送信しません。

## 参照元

- https://huggingface.co/kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX
- 上記固定版 haas_cpu/core/features.py、tdt.py、detokenize.py、external/onnx_graphs.py
- https://www.npmjs.com/package/onnxruntime-web/v/1.31.1
