# このPCのWeb公開・ポート予約規程

2026-10-01ユーザー指定。C:/develop配下からこのPCで起動するWebサーバーに適用する。本番、開発、検証、一時的な画面確認、内部APIを含む。掲載・ポート予約は必須、Entra ID認証は推奨とする。

## 公開前の必須手順

1. DevServer（http://127.0.0.1:19000/）の台帳、最新待受、空き候補を確認する。停止中・予約済みの番号も割り当て済みとして扱う。Windowsの除外・動的範囲は候補にしない。
2. アプリID・サーバーID、名称、用途、環境、作業フォルダ、TCP/UDP、待受IP、公開範囲を決め、空き番号を正本local/servers.jsonへ予約する。単に空いていると確認しただけでは予約完了ではない。
3. アプリ側の起動・転送・閲覧URLを予約番号に合わせ、固定番号で起動する。使用中の場合は相手を確認し、空き番号へ自動変更しない。他プロセスを勝手に停止しない。
4. Entra ID認証の導入を検討し、アプリ別authenticationと必要なidentity_profilesを登録する。未導入なら理由を記録する。内部APIは共通入口の認証・内部接続方式を記録する。
5. 起動・停止手順、閲覧URL、設定参照と保存先、認証方針を台帳へ記録する。予約をallocation_status=allocatedへ更新し、公開前に設定・競合を再確認する。
6. 実待受と必要な実サインインを確認し、確認日時・結果を記録する。設定を保存しただけでサインイン確認済みにしない。

この手順が未完了なら新しいWebサーバーを公開しない。既存サーバーも次の変更時に情報を確認する。OSや他アプリを強制的に占有する予約ではなく、台帳と連携した起動処理で競合を防ぐ。

## 予約コマンド

管理画面で候補と現在の台帳世代を確認して実行する。以下は架空の例であり、19010が必ず空いているという意味ではない。

```powershell
cd C:\develop\DevServer
pwsh -File .\scripts\Reserve-ServerPort.ps1 -ApplicationId sample-tool -ServerId sample-tool-web -Name 'サンプルツール' -Port 19010 -WorkingDirectory C:\develop\SampleTool -Purpose '検証画面' -ExpectedRevision 3
```

CLIは予約直前に待受とWindows範囲を取り直し、台帳更新を排他・世代確認・バックアップ付きで行う。サーバーは起動しない。公開範囲の初期値はlocal/127.0.0.1で、LANはVisibility/BindAddressを明示する。管理アダプター対象の構成変更は一般予約CLIへ追加せず、候補台帳とアダプターを合わせて変更する。

停止後も予約は保持する。廃止時だけ用途・参照・起動タスクの除去を確認して正本から明示的に解放する。番号変更は停止・影響確認・再予約・関連設定更新・再検証の順とする。

## Entra ID情報の管理

共有登録はidentity_profilesを1件として管理し、各アプリのauthentication.profile_idとcredential_idから参照する。共有可否は利用者・権限・運用境界で判断し、既存登録の自動流用を標準にはしない。

| 管理情報 | 記録先 |
|---|---|
| 登録名、テナントID、クライアントID、設定確認状態 | identity_profiles |
| コールバックURL、必要権限、管理者同意の確認状態 | identity_profiles |
| 認証設定ファイルの参照 | source_configs |
| 資格情報の方式、保護ファイルの保管参照、有効期限 | credentials |
| アプリ別認証方針、許可対象、未導入理由 | authentication |
| 実サインイン確認状態・タイムゾーン付き日時 | sign_in_status / verified_at |

テナントID・クライアントIDは識別情報として記録できる。クライアントシークレット、秘密鍵、アクセストークン、更新トークン、パスワードは台帳・ブラウザ・Git・チャットへ保存しない。必要な実値は実行ユーザーがアクセスできる保護済みのローカルファイル等で保持し、DevServerは保管参照を管理する。現行の保護ファイルを読み取る権限や配布範囲をこの手順で拡大しない。

認証がない場合はmode=noneとexception_reasonを記録する。共通認証入口の背後だけで使うAPIはmode=internalと理由を記録する。検討中はunreviewed。実確認前はsign_in_status=unverified、確認後のみverifiedとverified_atを記録する。Entraを使わないアプリも掲載・予約の義務は同じ。

Microsoftの[アプリ登録のセキュリティ推奨事項](https://learn.microsoft.com/en-us/entra/identity-platform/security-best-practices-for-app-registration)と[リダイレクトURIの制約](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)を参照する。認証用資格情報は実行環境に合った方式を選び、権限は業務に必要な範囲へ絞る。証明書の期限・同意・実サインインを継続して確認する担当者を各アプリの運用手順へ記録する。

## DevServerのアクセスと操作権限

社内の正規URLは `https://192.168.49.12:19000/`。社員のEntra IDサインインを必須とし、閲覧と操作を分ける。外部の操作担当者は設定時にサインインした本人だけを初期登録する。許可者のObject IDは保護済み `local/auth/entra.local.json` の `operator_object_ids` に保存し、台帳には保管参照と認証確認状態だけを記録する。任意の社員を自動で操作担当者へ追加しない。

127.0.0.1の管理画面には内部部品・ポート予約・認証参照・棚卸しを表示する。社内画面/APIには入口・システム概要・許可された操作だけを表示し、機械内パスや資格情報参照は渡さない。操作は各行に示されたシステム全体を対象とし、関連ポートを確認して実行する。登録済みタスク/所有プロセスを照合できない場合は操作を拒否する。

## 共通HTTPS証明書

2026-10-15ユーザー指定。HTTPS証明書は原則example-Dev-Serverを共用する。正本の[TLS-POLICY.md](TLS-POLICY.md)に従って共通参照・SAN・秘密鍵ACL・期限・更新を管理する。既存サービスの移行用指示文は[dev/https-migration-prompt.md](dev/https-migration-prompt.md)。制定だけで既存サービスや利用PCの信頼ストアを一括変更しない。
