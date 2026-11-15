> 2026-11-15 匿名化済み。会社・個人・アカウント・旧環境の識別情報を除去し、Git履歴も再構築しました。以下の引き継ぎ時点の記録に登場する字幕・編集/認識データ・DBエクスポート・スクリーンショット・添付画像、旧7z/Git bundle/ハッシュ一覧は削除済みです。現在のGit履歴はプロジェクト直下の`.git`にあります。同梱依存元ソースも匿名化したため、元コミットのバイト完全一致コピーではありません。証明書名・パス・ネットワーク例は架空値です。実際の配布や署名には、新しい環境で設定とソースの検証が必要です。
# 他PCへの引き継ぎ

2026-11-15時点。アプリ版は **v0.1.1**、現行ソースは`site/`、単一EXEの入口は`scripts/unified-launcher.mjs`です。旧Tauri/Rustの編集アプリは履歴として残し、現行Web版と混同しないでください。

## 最初に読む資料

- `user-instructions.md` / `user-instructions.json`：このチャットの利用者メッセージ132件の原文。最初の依頼から、追加回答・ブラウザー注釈・今回の削除指示までを収録しています。後の指示で変更された内容も消していません。
- プロジェクトルートの`AGENTS.md`：開発・配布規則。親フォルダーの共通規則は`policies/develop-AGENTS.md`へ保存しました。公開/TLS規則も同じpolicies内です。新PCへ旧PCの予約やIPをそのまま適用しないでください。
- `../v0.1.1-req.md` / `../v0.1.1-task.md` / `../v0.1.1-imp.md` / `../reject.md`：要求・進捗・実装記録・明示却下事項。
- `../../packaging/client-connection.txt`：別サーバー用のCSR申請、証明書設定、Intune/手動CA配布、IP変更、エラー別対処。
- `browser-model-feasibility-20261114.md`：ユーザー指定の外部調査資料を複製。最終実装状況はソースと要求書を優先します。

## 収録範囲と削除範囲

ソース・lockfile・Git全参照の履歴・字幕/VTT/認識結果・編集プロジェクト・調査/検証結果・スクリーンショット・アイコン素材を収録します。`runtime/`に残るテキストや画像は検証記録であり、実行環境やモデルのキャッシュではありません。

検証環境のSQLite DBは、WALも含めたコピーを読み取り、整合性検査後に全テーブルのスキーマ/行を`database-exports/`のJSONへ保存します。資格情報とBLOB本体は除外し、元のDB/WAL/SHMバイナリは削除します。このJSONは開発証跡用で、アプリへ直接読み込む編集プロジェクト形式ではありません。元動画・音声をデータURLで埋め込んだ古い検証HTMLも媒体として削除します。

利用者の明示回答に従い、プロジェクト内の元動画・音声と派生媒体も削除します。EXE/installer/DLL/Rust成果物/node_modules/ダウンロード済みモデル/実行環境/古い出力アーカイブ/合成試験証明書と鍵も削除します。Git内部オブジェクトと画像・アイコンは、履歴/素材として必要なので削除対象の「生成バイナリ」から除外します。

削除前に保持ファイルを7zへ入れ、別フォルダーへの展開と全SHA256照合を行います。対象パス・分類・サイズは`cleanup-plan.json`、最終結果は`cleanup-result.json`、アーカイブ全体のファイルハッシュはアーカイブ直下の`FILES.sha256`に記録します。稼働インストール、他プロジェクト、ブラウザープロファイルは変更していません。

ローカル添付画像8件は`attachments/`に保存し、元パスと対応を`attachments.json`へ記録しました。APIから画像本体/URLが返らない89件は画像自体を復元していません。利用者の注釈テキストは履歴に収録済みです。ほかのチャットの履歴をこのチャットの履歴として混ぜていません。

字幕やスクリーンショットには社内の会話が含まれます。7zはパスワードなしです。承認された引継ぎ先だけに渡してください。証明書秘密鍵・認識トークン・サインイン情報は引き継ぎません。

## Git履歴の復元

アーカイブを展開すると`TranscriptCutter/`（ソースと保持データ）、`TranscriptCutter.git.bundle`（mainを含む全参照）、`dependencies/TranscriptionServer-v0.1.15/`（固定版ソース）があります。bundleの検証結果と作成元は`HANDOFF.json`に記録します。

例として、アーカイブを`D:/handoff`へ展開した場合、新しい作業先へGitを復元してから保持データを重ねます。既存の作業フォルダーへ上書きせず、新しい空き先で行ってください。

```powershell
git clone D:/handoff/TranscriptCutter.git.bundle D:/develop/TranscriptCutter
Copy-Item -Path D:/handoff/TranscriptCutter/* -Destination D:/develop/TranscriptCutter -Recurse -Force
Copy-Item -LiteralPath D:/handoff/TranscriptCutter/.gitignore -Destination D:/develop/TranscriptCutter/.gitignore -Force
git -C D:/develop/TranscriptCutter status --short
```

実際に使うドライブ/パスへ読み替えてください。旧PCの追加worktreeは移行せず、候補ブランチのコミットをbundleで保持します。mainへ統合済みの候補と過去の独立worktreeを混同しないでください。

## Web開発の再開

Windowsで`pwsh`、Git、Node.js 22/npmを用意します。検証済みのNodeは22.14.0です。復元したプロジェクトで実行します。

```powershell
npm ci
npm run check:web
npm run build:web
pwsh -File scripts/Start-Web.ps1
```

loopbackの空きポートを使います。他PC公開は別の操作で、公開規則・予約・証明書を新PCで確認してから行います。表示やUIの確認にはCodex内蔵ブラウザーを優先します。全テストを無条件に走らせず、変更に関係する試験を選びます。元の5分サンプル媒体は削除済みなので、実音声の再測定には新たな媒体が必要です。自動試験の合成音声はスクリプトから再生成します。

ブラウザー内ASRのモデルは専用画面から再導入します。旧ブラウザープロファイルのCacheStorage/localStorage/IndexedDBはこのプロジェクトアーカイブに含めていません。工程間の未保存編集やFile参照は復元できません。保存済みのVTT/JSONは保持対象です。

## EXE/インストーラーの再生成

実測環境はNode22.14.0、Rust1.97.1（MSVC x64）、Inno Setup6.7.3です。RustのMSVCターゲットとWindows SDKのsigntoolを用意します。これは再導入項目で、ツール本体は7zに入れていません。

同梱サーバーの固定値は`scripts/distribution-contract.mjs`が正本です。

- TranscriptionServer v0.1.15
- 元commit：`55db7303d12c17e56e8d66e993de829ad4bdfb7a`
- 確認済み公式EXE SHA256：`3c9277b1cabb40a8d7cfea995b285d31c7a8848ee4687b4ea4af4d06768fc266`
- 取得元リポジトリ：`https://github.com/i1643/TranscriptionServer`（必要な閲覧権限は新PCで取得）

固定元ソース182ファイルを`dependencies/TranscriptionServer-v0.1.15/`へ収録しました。別リポジトリ本体の稼働環境・媒体・鍵・モデル・DBはコピーしていません。公式v0.1.15は後に同版差替えもあり、Release名だけで旧55db7303版と同一と判断しないでください。

再取得したprogram-only配布のBUILD/EXE SHAを正本と照合してから、各パスを環境変数で指定して生成します。

```powershell
$env:TC_SERVER_RELEASE='D:/dependencies/verified-TranscriptionServer'
$env:TC_ISCC='D:/tools/Inno Setup 6/ISCC.exe'
$env:TC_SIGNTOOL='C:/Program Files (x86)/Windows Kits/10/bin/SDKの版/x64/signtool.exe'
pwsh -File scripts/release.ps1
```

上のパスは例です。旧固定SHAの公式バイナリが入手できない場合は、収録ソースから再ビルドしてAPI/受入を行い、同梱固定値を明示的に見直す必要があります。署名・コンパイラー・環境差により再ビルドのSHAは元公式EXEと一致しません。検証を飛ばすための固定値解除はしないでください。

今回の指示で直前のEXE/installerも削除しました。直前配布のBUILD/SHA/受入ログは証跡として保持します。アプリ版はv0.1.1を維持していました。通常はパッチ更新ですが、今回の引き継ぎで勝手に採番変更はしていません。

## 利用データ/証明書の境界

通常のインストール先は`%LOCALAPPDATA%/Programs/TranscriptCutter`、専用データは`%LOCALAPPDATA%/TranscriptCutter/unified`です。今回の対象は開発プロジェクトだけで、このインストール領域の辞書・認識DB・媒体・鍵・ブラウザーデータはコピーも削除もしていません。利用者データも別途移行する必要がある場合は、対象Windowsユーザーを確認して別作業にします。

新サーバーでは新しい鍵/CSRを作り、社内共通CAの管理者へ実IPをSANに含めて発行依頼します。既存のサーバー鍵やCA発行鍵をアーカイブへ入れていません。共通CAの公開証明書は管理者から受け取り、Intuneまたは本人の手動登録で配布します。詳細は接続手順を参照してください。

## 検証の境界

直前の配布は関連16テスト/Web型検査/ビルド、最終EXEの10項目、installerの7項目が成功しました。別PCへの実インストール/HTTPS接続は未確認です。引き継ぎ確認は保持ファイルとGit/7zの復元検証であり、新PCのコンパイルやGPU/ASR品質まで確認したものではありません。
