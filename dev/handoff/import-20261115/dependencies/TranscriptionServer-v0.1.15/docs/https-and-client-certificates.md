# HTTPSと利用PCへのCA登録

## 構成

Rustサーバーは --tls-cert / --tls-key の両方がある場合にTLS1.2/1.3を受け付けます。既定は同じTCPポートでHTTPSと従来HTTPを併用し、--https-onlyで平文HTTPを拒否します。HTTP併用は既存アプリの段階移行用で、HTTPの通信内容は暗号化されません。案内URLはTLS有効時にHTTPSになります。接続元の実IPを維持し、信頼LAN/Host/Origin/Bearer・更新管理の同PC限定を引き継ぎます。

```powershell
# 本PCの導入先/データ/8769などの既存引数へ追加する例
--tls-cert C:\AI\Certificates\example-Dev-Server-chain.pem --tls-key C:\AI\Certificates\example-Dev-Server.key
```

上は既存の起動コマンドへ追加する引数であり、単体では実行しません。導入版では既存の `%LOCALAPPDATA%\TranscriptionServer\settings.json` の他の項目を保持したまま次の設定を追加できます（対象を正常停止し、設定を退避したうえで行う）。通常の起動は引き続きServices/scripts/Start-TranscriptionServer.ps1を使います。

```json
{"tls_cert":"C:\\AI\\Certificates\\example-Dev-Server-chain.pem","tls_key":"C:\\AI\\Certificates\\example-Dev-Server.key","https_only":false}
```

鍵の内容ではなく絶対パス参照だけを保存します。証明書の更新後は対象サーバーの再起動で読み直します。ポート/公開範囲の変更はDevServerの正式な予約・更新手順を使います。本PC以外で証明書ファイルがない場合は自動生成しません。公式Start/Stopスクリプトは設定に応じて検証付きHTTPSを使います。`https_only=true`では他のHTTPクライアント/監視も移行する必要があるため、既存構成はまずfalseの併用で移行します。旧公開版はこの設定に未対応なので、対応する本体への更新が先に必要です。

## 利用PCへ渡すもの

管理者から信頼できる経路で **example-Dev-RootCA.cerだけ**を配布します。サーバー秘密鍵、CA秘密鍵、秘密鍵付きPFXは利用PCへ渡しません。通信先サイトの証明書警告を無視して入手する手順は使いません。

2026-11-14確認の共通CA（配布前にDevServerの正本manifestと照合すること）:

- Subject: CN=example-Dev-RootCA
- Thumbprint: 1EBED0D2AD342F1C6AE9B33D7A0DEF12DD9539F6
- CER SHA256: a893c6fdbf7d1e00302f3a4a2cc6a45924fa05419eec7fab34cf10a04fe22914
- 期限: 2036-10-15 07:00:40 UTC

## Windows利用PCで初回に行うこと

利用者本人または管理者が行います。すでに同じCAを信頼登録済みなら追加不要です。以下は自動実行するものではありません。

1. 配布されたCERをローカルへ保存する。管理者から別経路で受け取った上記SHA256/拇印と照合する。

```powershell
Get-FileHash -LiteralPath C:\配布\example-Dev-RootCA.cer -Algorithm SHA256
$ca = [Security.Cryptography.X509Certificates.X509Certificate2]::new('C:\配布\example-Dev-RootCA.cer')
$ca | Select-Object Subject, Issuer, Thumbprint, NotAfter, HasPrivateKey
# Subject/Issuer/拇印が正本と一致し、HasPrivateKey=Falseであることを確認
```

2. 本人のWindowsユーザーへ信頼登録する。

```powershell
Import-Certificate -FilePath C:\配布\example-Dev-RootCA.cer -CertStoreLocation Cert:\CurrentUser\Root
```

全利用者へ配布する場合は管理者がGPO/端末管理などの承認済み手順でLocalMachineのRootへ登録します。端末の管理方針で拒否された場合は、検証を無効化せず管理者へ依頼してください。

3. Edge/Chromeを開き直し、https://192.168.49.12:8769/ を警告なしで開けること、接続先のIP/ホスト名がサーバー証明書の対象に含まれることを確認する。利用する他のブラウザーが独立した信頼ストアを使う場合は、その製品/組織の登録手順も確認する。
4. 利用アプリの接続先をHTTPSへ変更する。CORSやブラウザーのローカルネットワーク許可はTLSと別なので、必要なOrigin設定・利用者の許可も確認する。HTTPS化だけで接続キー必須にはしない。従来の信頼LAN方式を維持できる。

[Microsoft Import-Certificate](https://learn.microsoft.com/en-us/powershell/module/pki/import-certificate)、[Edgeのローカルネットワークアクセス](https://learn.microsoft.com/en-us/deployedge/ms-edge-local-network-access)を参照。

## サーバーPCを増設・移転するとき

同じCAで、そのPCのIP/DNS名をSANへ含むサーバー証明書を管理者が発行します。各サーバーの秘密鍵はサーバー側だけで保護し、CA秘密鍵は認証局の管理側へ置きます。同じCAなら既存利用PCのRootCA再登録は通常不要ですが、新しい利用PCには初回登録が必要です。

本PCで参照する既存共通サーバー証明書の対象は192.168.49.12/127.0.0.1/::1、sample-pc/localhost、期限2027-10-15です。別PCの192.168.49.105は現在の対象に含まれません。既存の共通証明書をアプリ側で勝手に再発行・上書きせず、DevServerのTLS-POLICY.mdと証明書管理手順へ従います。

## 証明書の互換性

既存共通CAを明示したNodeの通常検証では、署名チェーン・IP名・TLS1.2/1.3を検証して接続できました。本PCのWindows既定信頼ストアを使用するpwshの.NET接続と、LANアドレスの実ブラウザー表示も成功しました。一方、本PCのPython3.14の既定厳格検証では既存証明書のAuthority Key Identifier不足により拒否されました。該当するクライアントは検証を無効化せず、DevServerの証明書管理担当へ同CAでの適合証明書更新を依頼してください。本対応では共通証明書を再発行していません。物理的な別PCの受入・CA登録は別途行います。
