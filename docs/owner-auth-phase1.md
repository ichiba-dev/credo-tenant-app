# オーナーAuthアカウント管理 Phase1

## Scope

`/admin/owners` は、認証済みの単一 organization に属する `admin` / `manager` 向けの一覧と操作画面。PCではテーブル、スマートフォンではカードを表示する。owner名・登録email・有効状態・現在のAuth連携有無・Auth側email・有効な所有物件・状態を確認する。

`staff` / `viewer` は一覧・mutationとも利用不可。organizationは毎回 `getStaffContext()` の認証済みmembershipから決定する。ブラウザーのorganization、owner、現在Auth ID、変更先Auth IDは信用せず、mutationごとにmembership・owner・Auth Admin API・所有利用状況を再検証する。

## Auth状態

|表示|判定|
|---|---|
|連携済み|active owner、owner.emailと実在Auth emailがtrim/lowercase後一致し、重複や要確認監査がない|
|未連携|`auth_user_id IS NULL` のactive owner。emailが空なら画面では要確認、操作不可|
|メール不一致|保存Auth userが実在し、emailがowner.emailと一致しない|
|Authユーザー不存在|保存された`auth_user_id`がAuth Admin APIに存在しない|
|オーナー無効|`is_active=false`|
|要確認|メール重複、Authの別owner利用、email欠落、未解決監査操作など|

照合時にAuth userが見つからない一覧取得障害は、Auth不存在として扱わず一覧全体を利用不可にする。例の`test-owner@example.com`と`ichiba@credoweb.co.jp`はメール不一致になる。

## Mutationと監査

- `auth_user_id IS NULL` のownerだけが「既存Authを連携」または「Auth招待」を実行可能。email一致、Auth email重複なし、同一organization owner email重複なし、全organizationでAuth未使用をサーバーが検証する。
- 一致Authが1件ならそのIDを連携する。一致AuthがなければSupabase Auth inviteを行う。メール空・無効ownerは操作不可。
- 既存Auth IDは自動上書きしない。メール不一致またはAuth不存在に対する訂正は、現在値・変更先を表示し確認checkboxを必須にする。実行時はorganization、owner.email、有効状態、target Auth実在・一致・一意・未使用、および画面表示時の旧Auth IDを再確認する。旧Auth userは削除しない。
- Auth APIとDBは同一transactionではない。`owner_auth_operations`にpassword/tokenを保存せずrequest ID、操作、email、旧/target ID、actor、status/error、時刻を記録する。request IDは全体でunique。監査identityの変更・削除、および初回設定後のtarget Auth ID変更は禁止。
- Auth成功後のowner更新失敗は`needs_review`でtarget Auth IDを保持する。自動削除・再招待はせず、同じ既知target IDだけを条件付き更新で再試行する。招待結果が不明でtarget IDを確定できない場合は手動監査が必要。
- 同じrequest IDのcompleted再送は成功済みとして返す。別payloadからのrequest ID再利用は拒否する。

## Database files

- `owner-auth-phase1.migration.sql`: nullable `owners.email`を追加（既存なら維持）し、監査テーブル・一意制約・不変trigger・service_role ACL/RLSを追加する。owner-repair Phase1 RPC/RLS、Storage、本番環境は変更しない。
- `owner-auth-phase1.production-preflight.readonly.sql`: migration前のowner schema、既存Auth用email重複、API role、planned table衝突を読み取り専用で検査する。email値は出力しない。
- `owner-auth-phase1.production-postcheck.readonly.sql`: migration後のemail column、監査schema、request ID制約、trigger、ACLを読み取り専用で検査する。
- `test-fixtures/owner-auth-phase1.local.mjs`: TEMP上のPGliteメモリDBだけを使い、pre/post check、migration、request ID、監査immutability、ACLを検証する。環境変数・ネットワーク・永続DBを使わない。

この実装作業から本番migration/preflight/postcheck、Storage、Vercelへ接続・適用してはならない。production preflightの実行結果が未確認ならGO判定にしない。

## Tests

対象: `node --test lib/owner-auth-state.test.mjs app/admin/owners/owner-auth.test.mjs app/admin/owners/owner-auth-data.test.mjs`、`node docs/test-fixtures/owner-auth-phase1.local.mjs`、`node_modules/.bin/tsc.cmd --noEmit --incremental false`、`git diff --check`。Node全体、production build、全体lintは対象外。

owner portalの`/owner`・`/owner/repairs/new`および既存owner-repair RPC/RLSは変更しない。