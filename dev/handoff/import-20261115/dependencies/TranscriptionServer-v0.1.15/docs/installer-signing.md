# インストーラーの開発者署名

`scripts/build-release.py`は正式版・候補版のインストーラーを必ず署名します。署名なしで続行するオプションはありません。インストーラーを作らない`--program-only`の隔離候補だけは対象外です。

## 署名者と準備

- 証明書: `CN=exampleDev-Test`
- 拇印: `SIGNING_CERT_THUMBPRINT`
- 保管先: ビルド実行ユーザーの`Cert:\CurrentUser\My`（秘密鍵付き）
- 必要なツール: PowerShell 7 (`pwsh`)、Windows SDKのx64 SignTool、既存のInno Setupとビルド環境
- SHA256署名、DigiCertのRFC3161/SHA256タイムスタンプを使用します。タイムスタンプ取得にはネットワーク接続が必要です。

秘密鍵・PFX・パスワードをリポジトリや配布物へ保存しません。証明書が欠落・期限切れの場合は停止します。別証明書の自動選択・新規発行・信頼ストアへの自動登録は行いません。証明書の更新は利用者と相談して別途対応します。

## ビルドと公開

従来どおり`build-release.py --iscc <ISCC.exeの絶対パス>`を実行します。

1. ビルド前に指定証明書の秘密鍵・期限・コード署名用途とSignToolを確認します。
2. ISCCでsetupを作成した直後に`scripts/sign-installer.ps1`で署名します。
3. 指定署名者、タイムスタンプ、Authenticodeの`Valid`、`signtool verify /pa /all /tw`成功を確認します。
4. 検証後にZIPとSHA256SUMSを生成します。署名によって変わった後のsetupハッシュを記録します。
5. `publish-release.py`でもローカル確認・draft・正式公開のすべてで署名を再検証します。失敗時は認証情報取得・Git push・GitHubへの書込みへ進みません。

署名やタイムスタンプ検証失敗時は、終了コード非0で停止します。出力フォルダーに途中生成されたsetupが残っても配布物完成とは扱いません。公開前のゲートでも拒否します。公開済み成果物は通常上書きしません。

## 検証だけ実施する

```powershell
pwsh -NoProfile -File scripts/sign-installer.ps1 -Mode Check
pwsh -NoProfile -File scripts/sign-installer.ps1 -Mode Verify -Path 'C:\配布先\TranscriptionServer-vX.Y.Z-setup-x64.exe'
if ($LASTEXITCODE -ne 0) { throw '署名検証に失敗' }
```

この手順で署名するのはsetup本体です。内部サーバーEXE・アンインストーラー・ZIPへの署名は対象外です。別PCでの開発者証明書の信頼は別途必要であり、HTTPSの共通CAとは区別します。SmartScreen警告が出なくなることを保証するものではありません。
