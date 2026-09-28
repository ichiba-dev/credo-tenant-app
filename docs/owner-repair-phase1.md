# オーナー起点の修理依頼 Phase1

本番DB migration適用済み。ユーザー確認済みの本番post-checkは12行、11/11 `all_match=true`、`overall_ready=true`、`failed_sections=[]`。アプリ公開のためのcommit/push対象を以下の実装manifestに限定する。本番DB・Storageの追加変更は行わず、migrationを再実行しない。

## 確認した既存schemaと制限

2026-09-26、既存アプリとSupabase OpenAPIのGETで対象テーブルの列情報のみ確認。案件行・認証情報は出力していない。

|対象|確認結果|
|---|---|
|repair_requests|必須列はid(bigint PK)、created_at(timestamptz / now())、organization_id(uuid / organizations FK)。property_id(uuid / properties FK)、room_number、tenant_name、tenant_account_idはNULL許容。status既定値は受付。|
|tenant受付|propertiesのid/name/organizationをサーバー取得し、部屋番号・入居者名・category/description・tenant_account_id（未認証ならNULL）を登録。写真はrepair_photos。既存入力・認証・登録処理を変更しない。|
|owners|既存UUID PK、auth_user_id、name、organization_id、is_active。必須はid/name/is_active/created_at/updated_at/organization_id。|
|property_owners|既存owner_id/property_id FK、organization_id、is_active、valid_from/valid_to。必須はid/property_id/owner_id/role/is_active/created_at/updated_at/organization_id。|
|properties|既存UUID PK、name、organization_id、is_active。必須はid/property_code/name/is_active/created_at/updated_at/organization_id。|
|units|公開OpenAPIに存在せず、既存受付にもunit参照なし。部屋番号は選択物件内の自由入力。unit_idを導入・推測しない。migrationはpublic.unitsが存在したら中止する。|
|repair_photos|id(bigint PK)/created_at/organization_idが必須。repair_id、storage_path、photo_urlはNULL許容。GET bucket metadataでrepair-images.public=falseを確認。既存private path署名処理を再利用。|
|owner portal/report|auth.getUser→owners.auth_user_id。報告閲覧はowner_report_recipients→owner_reports→同organizationのrepair_requests。依頼作成を報告公開権限として扱わない。|

**OpenAPIではCHECK、全複合FK、RLS、trigger、id generator等の完全なカタログを確定できない。** ローカルDockerは停止していた。SQL fixtureは確認できた列に基づく独立DBで、本番DDLのコピーではない。
適用前の制約確認には `owner-repair-phase1.production-preflight.readonly.sql` を使用する。SQLは単一のread-only SELECTで、11セクションの`all_match`/`details`＋`overall_ready`の計12行を返す。列・全制約・RLS・実効ACLとgrants・triggers・件数/NULL・所有関係整合性・Storage公開設定を保持し、全RPC overloadと予定20オブジェクト（UNIQUEの暗黙indexを含む）の衝突も確認する。適用済みの本番では `owner-repair-phase1.production-postcheck.readonly.sql` を使用し、上記の全項目PASSを確認済み。

判定は保守的。未知のpolicy、有効なrepair/photo trigger、repair/photo CHECKやMATCH FULL FKは要レビューとしてfalse。policyの自動一致対象は既存organization helperを使った明示的なstaff/viewer範囲のみで、任意のhelperの内部動作まで証明するものではない。`units`が存在すれば、RPCが参照しなくてもmigration自体が中止するためfalse。RLSによる件数の過少集計を避けるためpostgres等のsuperuser/BYPASSRLSで実行する。既存必須テーブル自体が欠落した環境は対象外（SQLエラー時もNO-GO）。

## 変更設計

- 別案件テーブル／新owner masterを作らず、repair_requestsへ登録。
- source_type/source_channelは拡張可能なtext（空値不可、最大64文字）。tenant/owner/staff/vendor/other、web/line/email/phone/manual/other等を想定し固定enumにしない。
- 既存案件はtenant/legacy。legacyは過去の受付経路が未記録という意味。以後のtenant受付は既定値tenant/web、owner受付はRPC固定のowner/web。AI取込は将来channel等で追加できる。
- source_owner_idは既存ownersへのorganization複合FK。source_labelは送信時owner.nameのスナップショット。contact_notesは任意でNULLを許可し、非NULLは最大2000文字、空文字はNULL保存。
- location_type=common_areaならroom_number=NULL。roomなら必須文字列。tenant名・tenant accountはowner案件に埋めない。既存tenant受付の必須入力は維持。
- owner/propertyのorganization複合FK追加前に既存不整合を検査。migrationはtransaction内で既存データを保持し、矛盾・既存列衝突・未知のunitモデルで停止。冒頭の `SET LOCAL lock_timeout='10s'` でロック待ちを制限。既存RLS policyを維持し、対象5テーブルのanon/authenticated直接GRANTを既存アプリ契約に限定する。
- provenance用triggerはanon/authenticatedによる出所の直接偽装・書き換えを拒否。新RPCだけが検証済みownerの出所を作成する。既存staffによるstatus/comment更新は対象外。

## フロー・権限

`/owner` →「修理を依頼する」→ `/owner/repairs/new` → 物件・部屋/共用部・category・内容・写真・連絡事項 → 受付番号表示。

フォームの物件一覧とPOSTで、検証済みauth.uidに対応するactive owner→同organizationの有効期間内property_owners→active propertiesを再確認。ブラウザ指定のorganization/owner/source/案件ID/unit ID等は拒否。POSTは同origin、認証、実受信サイズ、画像の内容とサイズを検証する。

DB RPC `create_owner_repair` はauth.uidからownerを再取得し、同organization・有効所有関係を行ロックして作成。propertyが正ならその物件全体のownerとして部屋番号を入力できる。unit masterが確認できないため部屋実在性を保証するunit検証は行わず、unit紐付けも作らない。

送信時にowner reportやrecipientは作成しない。既存の報告公開／閲覧範囲と自動通知は変わらない。作成直後の依頼は管理画面で扱い、オーナートップの既存報告一覧には管理側の報告作成後に表示される。

## 写真・管理画面・業者手配

- repair-imagesの既存private構成、`organization/repair/randomUUID.jpg|png`を再利用。作成済み案件のowner/org/propertyを再確認後、serverのみでuploadしrepair_photosへ紐付ける。public化・public URL生成なし。
- repair_photosにもsource_type/source_channelを保存。管理一覧・写真タブ・業者写真選択・送信履歴で出所を表示。署名URLは既存の再認可/300秒署名を利用。
- 写真失敗時は登録済み案件を消さず、受付番号と再送禁止案内を表示。RPC結果が不明な場合も盲目的な再送を止める。アップロード成功後DB写真登録が失敗したオブジェクトの削除は自動実施しない。
- 同じ3ペインにsource badge、受付元、オーナー申告、連絡事項を表示。共用部を架空の号室にしない。
- vendor選択/手配/RPC/予定/見積/完了フローは既存のまま。本文の申告ラベルだけsourceで切替、管理会社依頼とは分離。sourceを理由にtodo判定を分岐しない。

## 検証対象

新規owner-request.test.mjs、owner-source-ui.test.mjsと既存の受付・owner・admin権限・一覧/概要・3ペイン・vendor関連テスト。typecheck、git diff --check。

`node docs/test-fixtures/owner-repair-phase1.local.mjs` は既存のTEMP内PGliteを使う完全に独立したメモリDB。環境変数・本番接続先を読まない。migrationとread-only preflight SQL、owner作成・共用部・他owner/org拒否・inactive/期間外拒否・既存行保持・FK・source偽装拒否・staff/viewer・既存RLS維持を検証する。

公開前の最終検証はowner-repair関連テスト、専用SQL fixture、typecheck、git diff --check、production build 1回。Node全体・lint全体は実行しない。

preflight最終強化の専用検証: `node docs/test-fixtures/owner-repair-preflight.local.mjs`。migrationを適用せずメモリDBで単一結果セット・READ ONLY実行、migrationとのobject一覧一致、正常系all_match/overall_ready=true、各衝突・scope/NULL/期間重複・RLS/ACL・helper/generator・Storage・unitsの不一致でfalseを確認する。

2026-09-26 検証結果: 関連21ファイルの150テストPASS、migration専用PGlite SQL PASS、`tsc --noEmit --incremental false` PASS、`git diff --check` PASS。
本番でfunction bodyのCRLF/LF差によるハッシュ不一致を確認し、post-checkの比較のみCRLF→LFに正規化した。本文の実処理1文字変更は引き続きfalseとなることを両関数で検証済み。function ACL patchは本番未適用で今回の公開対象から除外する。

## 変更ファイル

- owner受付・既存報告の共用部表示: `app/owner/{page.tsx,data.ts}`、`app/owner/repairs/[repairId]/page.tsx`、`app/owner/repairs/new/{page.tsx,request-form.tsx,data.ts,submission.ts,submit/route.ts,owner-request.test.mjs}`
- 共通表示・ログイン戻り先: `lib/repair-source.ts`、`lib/repair-id.ts`、`lib/repair-id.test.mjs`
- admin: `app/admin/{types.ts,data.ts,admin-repairs.tsx,repair-list.tsx,repair-overview.tsx,repair-todos.tsx,vendor-dispatch-compose.ts,vendor-dispatch-section.tsx,vendor-dispatch-data.ts}`
- 関連テスト: `app/admin/{access.test.mjs,admin-workspace.test.mjs,repair-list.test.mjs,repair-overview.test.mjs,vendor-dispatch-compose.test.mjs,vendor-dispatch.test.mjs,owner-source-ui.test.mjs}`
- DB/検証: 本書、`docs/owner-repair-phase1.migration.sql`、`docs/owner-repair-phase1.production-preflight.readonly.sql`、`docs/owner-repair-phase1.production-postcheck.readonly.sql`、`docs/test-fixtures/owner-repair-phase1.local.mjs`、`docs/test-fixtures/owner-repair-preflight.local.mjs`、`docs/test-fixtures/owner-repair-postcheck.build.mjs`、`docs/test-fixtures/owner-repair-postcheck.local.mjs`
- fixture依存: `docs/owner-repair-phase1.acl-diagnostic.readonly.sql` はpreflight専用fixtureが読み込むため保持する。
- 公開対象外: 未使用function ACL patchと専用fixture、function診断、schema調査スクリプト、ACL調査メモ、無関係なLINE/Storage調査ファイル。
