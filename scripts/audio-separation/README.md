# 音源分離（任意導入・試験段階）

Webホスト側の専用Python環境で処理する。TranscriptionServerの既存環境は変更しない。モデルを通常起動時に取得しない。

管理者がPython 3.11または3.12の絶対パスを指定して、`pwsh -File scripts/audio-separation/Setup.ps1 -Python <Pythonの絶対パス>` を実行する。既存仮想環境を指定せず、ベースPythonを指定する。CPU版PyTorchのダウンロードは約207MB、モデルは約203MB。実行環境・モデルの複製を含め、実際のディスク使用量は増える。

導入先はruntime/source-separation/python、モデルはruntime/source-separation/models。別の場所はTC_SEPARATION_PYTHON、TC_SEPARATION_MODELSで指定できる。固定リビジョンと各ファイルのSHA256はmodels.lock.jsonへ記録する。処理開始時に照合する。モデルはApache-2.0の公式[SepFormer Libri3Mix](https://huggingface.co/speechbrain/sepformer-libri3mix)と[ECAPA VoxCeleb](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb)。モデル・音声をGitへ入れない。

最大3声・8kHzモノラル。SepFormerの学習対象は英語のLibri3Mixで、日本語の分離精度は保証しない。6秒窓・1秒重複で処理し、ECAPAの声の特徴で区間間の対応を推定する。話者名は最初の単独話者字幕からの参照であり、重なり・雑音・短い発話などで混入や話者入れ替わりが残る。表示名を変えても字幕の話者は変えない。

メディアは512MiB/2時間まで。同じバイナリの完了結果はSHA256で共用する。保存上限64件、同時処理1件。結果と参照名は最初の解析時のものを再利用する。分離音声は元動画の長さと時刻を保持し、カットやミュートを焼き込まない。試聴も分離した原音で、通常動画の編集プレビューとは別。F5時は同一動画のSHA256で同じサーバーのジョブを復元する。JSONプロジェクトへ分離WAV自体は埋め込まない。

ジョブはruntime/source-separation/jobsのUUID別フォルダーに保存する。メディア・モデルは当該Webホストで処理し、外部APIへ送信しない。任意パス入力、URLの取得、処理中のモデル取得は受け付けない。利用者側のブラウザーが他PCでも、分離はこのホスト上で処理する。サーバー公開・TLS・認証は本体の公開規則に従う。
