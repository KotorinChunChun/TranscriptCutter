既定の `/` はサーバー管理です。文字起こしの操作画面はTranscriptCutterなどの利用アプリへ集約し、本サーバーはAPIを提供します。右上の「設定・更新」から更新確認・適用・接続設定を開けます。これらの画面整理はv0.1.10に含まれます。モデル管理と旧名データ移行の詳細は [管理手順](docs/model-management.md) を参照してください。

v0.1.11は既存共通CAのHTTPS、同ポートHTTP併用、一括モデル導入/削除、行別の進捗・完了と固定の再起動通知に対応します。本PCは更新済みです。別PCでは証明書の参照と利用PCへのCA初回登録を個別に行います。[HTTPSと利用PCへのCA登録](docs/https-and-client-certificates.md)、[実装・適用結果](dev/v0.1.11-imp.md)を参照してください。

# TranscriptionServer v0.1.12

v0.1.12では、起動時に不足する4種類の実行環境だけをまとめて準備します。準備中も管理HTTP・PID記録・進捗を提供し、認識受付は準備後に開始します。初回準備と管理画面からの再導入は同じプロセスへ反映し、手動再起動は不要です。モデル本体は起動時に取得しません。管理画面に実行環境ごとの状態・容量と合計を表示します。本PCへの適用はリリースと別操作です。本リリースだけで稼働版を更新しません。[準備・容量・オフライン設定](docs/runtime-management.md)、[実装・検証結果](dev/v0.1.12-imp.md)を参照してください。

v0.1.10は管理画面専用化、CPU/GPU/アンロード操作の統一、参考速度とクライアント向けモデル情報API、旧アップロードの指紋補完・重複整理CLIを追加しました。実行環境とモデルの一括導入、確認付き削除、見出しソート、簡易/詳細表示も引き続き利用できます。19GBのNemotron一体型は既定で無効です。明示有効化した環境だけで導入・実行します。詳細は[組込み契約](docs/embedding-contract.md)と[モデル情報API](docs/model-information.md)を参照してください。

動画・音声の文字起こしを複数アプリから利用する共通サーバーです。CLI・HTTP/API・SQLite履歴・ジョブ/子プロセス管理・自己更新をRustで実行します。Pythonはオンライン導入するWhisper専用ワーカーだけで使用し、HTTPサーバーとして使用しません。Haas/Qwen3-ASR/ReazonSpeech/ParakeetとNemotron話者分離はspeech.cpp、明示選択した外部APIはRustから直接実行します。

ユーザー指定でRust世代はv0.1.0から開始し、旧v0.4.0の機能をv0.1.2へ再採番しました。旧v0.2.0・v0.3.0のReleaseは撤回済みです。既存protocolVersion=3、appId、ジョブID・字幕を維持します。

## Windowsへの導入

非公開GitHubの `TranscriptionServer-v0.1.12-setup-x64.exe` を実行します。ユーザー単位で導入し、WindowsサービスやPC起動時の自動起動は作りません。スタートメニューから起動できます。FFmpeg/FFprobeとspeech.cppは不足時に管理画面から専用領域へ導入できます。[実行環境の管理](docs/runtime-management.md)を参照してください。配布物は本体・Web画面・資料だけです。Whisper/NeMo/speech.cpp実行環境・FFmpeg/FFprobe・モデル重みは管理画面から必要なものをオンライン導入します。CUDA/ドライバーは別途準備します。

旧v0.4.0等の番号訂正に関する上書き移行は対象外です。通常の自己更新・インストーラーによる更新は維持します。

```pwsh
./TranscriptionServer.exe --lan --host 0.0.0.0 --port 8769 --no-browser
```

起動時に他PC用の実IPのURL、許可サブネット、モデルごとの導入済み/初回取得/実行不可とCPU/GPU候補を表示します。0.0.0.0は待受用で、接続先URLには使いません。起動点検ではモデルを取得せず、GPU実推論・API利用枠まで確認済みとは扱いません。

信頼LANでは接続キーの手入力は不要です。healthの `authMode=lan` と起動ごとの `token` を取得し、変更APIへX-Local-Tokenを自動設定します。接続元は有効なプライベートIPv4サブネット、Host/Originへ限定します。利用者は同じ履歴を共有します。

Windows FWは同梱 `Configure-LanFirewall.ps1 -Action Plan -LocalAddress <実IP> -AllowedNetwork <サブネット>` で条件を確認し、管理者で `-Action Enable` を実行します。対象EXE・TCP8769・Private・必要なサブネットだけを許可します。アプリの導入は管理者権限不要、FW変更はWindows管理者権限が必要です。

同PC限定は `--local --host 127.0.0.1`、外部公開用Bearer認証は `--server` と32文字以上の `MEETING_SERVER_API_KEY` で明示します。ブラウザーの追加originは `--allow-origin` で指定します。HTTPS対応は `--tls-cert` / `--tls-key` で既存共通証明書を参照し、既存ポートでHTTPと併用できます。[HTTPS設定と利用PCへのCA配布・登録](docs/https-and-client-certificates.md)を参照してください。

## 保存と更新

既定設定は `%LOCALAPPDATA%\TranscriptionServer\settings.json`、データは同フォルダーのdataです。旧既定のHaasMeetingWorkbenchは整合バックアップと照合を行って新名へ移行し、旧データは退避として残します。明示の別保存先は変更しません。録音・字幕・設定をアンインストールで削除しません。

更新用の非公開GitHub読み取りトークンを「アプリの更新」で設定すると、起動後と24時間ごとに確認します。保存先はWindows資格情報または環境変数で、設定JSONやログへ出しません。利用者が確認してから更新・再起動し、処理/転送中は適用しません。取得サイズ/SHA256、プログラム/DBバックアップ、旧版復旧をRustで実行します。更新管理はサーバーPC上のみ利用できます。

Rust世代のReleaseだけを更新対象とし、旧v4系を新版と誤認しません。旧番号導入版はアンインストール後の新規導入を前提とします。通常のv0.1.x間の更新は自己更新または新インストーラーを利用できます。インストーラーは未署名です。

## 処理とAPI

- v0.1.2は [Nemotron 3.5 ASR Streaming 0.6B](docs/nemotron-asr.md) を追加。日本語・多言語のASR専用で、既存Diarizationと併用できます。追加Pythonは不要。初回は管理画面から742MBの重みを導入します。録音と30秒以下のリアルタイムジョブに対応し、WebSocket/要求間キャッシュは未提供です。

- v0.3.0は [単独話者分離API](docs/standalone-diarization.md) を追加。Nemotron 3 Diarizationだけを実行し、ASRとはtaskで区別します。Nemotron 3.5 Transcribeは別モデルで、対応推論サーバー未設定時は利用不可の理由を返します。

- file/realtime各1枠。realtimeは30秒以下、GPU候補は直列処理します。
- Whisperモデルは各枠1つ再利用し、モデル変更・中止・失敗・180秒待機で解放します。
- 履歴のアプリ分類/SQLページング、字幕編集・Range再生、稼働/容量確認と録音だけの明示整理を提供します。
- 別モデルや外部APIへ自動で切り替えません。外部APIは明示選択した場合だけ音声を送信します。

[API契約](docs/server-api.md)、[運用](docs/operations.md)、[LAN/Bearer](docs/server-runtime.md)、[導入と更新](docs/installation-updates.md)、[開発環境](docs/local-runtime.md)を参照してください。

## 開発とビルド

RustツールチェーンとWindows C++ビルド環境を使用します。Python 3.12/Whisper/PyInstallerは専用ワーカーの開発・梱包用です。

```pwsh
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
node --test tests/*.test.mjs
python -m pip install -r requirements-whisper.txt -r requirements-build.txt
python scripts/build-release.py --iscc 'C:/path/to/Inno Setup 6/ISCC.exe'
```

ビルドはコミット済みのソースからRust本体・ユーザー単位インストーラー・Windows ZIP・ソースZIP・SHA256を生成します。Rust本体はCRTを静的リンクし、Pythonや別途VCランタイムへ依存しないことをPEのimportで確認します。Rust依存一覧とライセンスを同梱し、Whisper依存物のライセンスは専用環境のオンライン導入時に配置します。録音・DB・重み・認証情報・本PC専用台帳は配布しません。ソースとタグを非公開GitHubへ保存した後に成果物をReleaseします。

処理時間: v0.1.4から処理経過・所要時間とキュー/GPU待機を分けて表示・保存します。計測範囲と旧履歴の扱いは[運用API](docs/operations.md#処理時間の記録)、GPU候補と自動選択は[処理方法](docs/gpu-execution.md)を参照してください。

v0.1.5: 実行環境導入後にサーバー再起動が必要なことを明示し、管理画面に再起動ボタンと自動再接続を追加しました。自動はGPU候補を優先して試し、失敗時にCPUへ切り替えます。明示GPU/CPUの指定は維持します。既存の字幕切り出し/DB書込みの改善も統合しています。

v0.1.7: Nemotron ASRの録音ファイルを、固定300秒ではなく無音と話者の切り替わりで最大30秒に区切って認識し、高速化しました。無音のない発話は300秒まで切りません。字幕の区切り・文面はv0.1.5と変わります。詳細は[Nemotron ASR](docs/nemotron-asr.md)を参照してください。
