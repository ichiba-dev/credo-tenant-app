# 完成migration 実行前レビュー

正本: `line-outbound-attachments.migration.sql`。BEGIN～COMMITを含む一回適用用のSQLで、RPC本体の省略・TODO・ROLLBACKはない。**今回SQLは実行していない。本番・ローカルともDBへの適用はしていない。bucket作成、アプリ実装、commit/pushも未実施。**

## 1. 確認済みの既存制約

ユーザー提供の実DB確認結果を採用する。

- `tenant_accounts(organization_id,id)`のUNIQUEあり。追加しない。実行時に有効な参照用UNIQUEがなければmigrationを中断する。
- `repair_requests_org_id_unique`とtenant通常indexは既存。必要な3列`(organization_id,tenant_account_id,id)`のUNIQUEは未確認。
- `tenant_line_accounts_active_line_uidx`、`tenant_line_accounts_active_tenant_uidx`、`tenant_line_accounts_tenant_history_idx`は既存。必要な3列UNIQUEは未確認。部分UNIQUEは今回のFKの参照先に使わない。
- migration内でpg_index/pg_attributeを確認し、**有効・即時・非部分・非式の同等UNIQUEがない場合だけ**repair/LINE連携に3列UNIQUEを追加。列順が異なる同等UNIQUEやINCLUDE列付きindexも再利用する。
- 同名indexが別定義で存在すればCREATEが失敗し、transaction全体をrollbackする。誤ったindexを黙って再利用しない。

## 2. DBオブジェクト

テーブルは3つ。

| テーブル | 内容 |
| --- | --- |
| staff_line_attachments | request ID、送信者、scope/宛先snapshot、source/final/previewのサイズ・hash・path、upload状態 |
| staff_line_attachment_pushes | 添付ごとに一つのoutbox、固定retry key/暗号化payload、期限、claim lease、送信状態 |
| staff_line_attachment_tokens | PDF限定のtoken hash・発行request ID・期限・失効履歴。生tokenを保存しない |

各PK/UNIQUE、scope複合FK、会話検索index、push状態index、token検索index、添付あたり未失効token一つの部分UNIQUE、RLS、権限設定、immutable trigger 3つを含む。期限切れtokenも再発行時に失効済みへ移してから新規発行する。

既存textテーブル/RPCは変更しない。scope変更・親削除をFKで制限し、履歴削除はtriggerで拒否する。既存repairのtenant付替え、staff所属の物理削除、LINE連携行の物理削除に影響するので、退会はis_active/unlinked_atによる論理無効化が前提。

## 3. RPC一覧・順序

全RPCの先頭引数は`p_organization_id,p_attachment_id,p_staff_auth_user_id`（reserveだけrepair ID）。staff IDはブラウザ入力をそのまま渡さず、サーバーでauth.getUser()した結果を使う。

| RPC | 動作・戻り値 |
| --- | --- |
| reserve_staff_line_attachment | org、repair、staff、request ID、媒体/filename/MIME/sourceサイズ/hashで予約。添付行を返す。同操作・同内容は同じ行、内容違いは拒否 |
| finalize_staff_line_attachment_upload | サーバーが実測したsource hash、finalサイズ/hash、previewサイズ/hashで保存確定。同じ検証結果での再実行は同じ行を返す |
| issue_staff_line_attachment_pdf_token | readyなPDFだけ。発行request ID/hash/期限を固定しtoken行を返す。画像への発行は拒否 |
| prepare_staff_line_attachment_push | 暗号化payload・鍵version・payload hash・期限・PDF token IDを固定してoutboxを一度だけ作る。既存outboxの内容変更は拒否 |
| claim_staff_line_attachment_push | 送信可能なら新lease付きoutboxを1行返す。accepted/failed/expired、未満了lease、期限切れは0行。期限切れはexpiredを記録 |
| finish_staff_line_attachment_push | 有効leaseでaccepted/failed/unknownを記録。staleなleaseは`stale`を返して更新しない。accepted済みは`accepted`のまま |
| revoke_staff_line_attachment_pdf_token | tokenを冪等に失効。送信履歴・accepted状態は変更しない |

画像: reserve → 限定staging upload → サーバー検証/変換/final保存 → finalize → 固定署名URL/payload作成 → prepare → claim → LINE → finish。

PDF: reserve → upload/検証/final保存 → finalize → token発行 → tokenリンク入りpayload作成 → prepare → claim → LINE → finish。

finalizeとprepareを分けることで「PDF tokenにはreadyなPDFが必要」「payloadにはPDF tokenが必要」という循環を避けた。token RPCへ渡すrequest ID・token hash・expires_atも初回前にサーバーで保持し、通信断後に作り直さず同じ値で再試行する。

戻り値はservice_role向けで宛先・暗号化payloadを含む。ブラウザへはID/状態/安全な表示情報だけのDTOを作り、DB行をそのまま返さない。claimが0行ならSELECTで状態を調べ、成功と推測しない。

## 4. 権限と認可

- 全7 RPCと3内部関数はSECURITY DEFINER、`search_path=''`。参照tableはschema修飾。
- PUBLIC/anon/authenticatedからEXECUTEをrevoke。7 RPCだけservice_roleへEXECUTE。内部scope/object/trigger関数はservice_roleからも直接実行不可。
- 3テーブルのRLSを有効化し、anon/authenticatedのpolicyは作らない。PUBLIC/anon/authenticated/service_roleの既定table権限を一旦除去し、service_roleにはSELECTだけ。INSERT/UPDATE/DELETEはRPC所有者の権限で行う。
- migrationはSupabaseの管理用migration ownerで適用する。service_roleでDDLする想定ではない。
- 送信系・token発行はactive organization、active staff membershipとadmin/manager/staff、repairのorg/tenant、active tenant、activeかつunlinked_at IS NULLのLINE連携を確認。候補が一つでなければ拒否。予約時の宛先snapshotと現行連携も一致必須。
- reserve/finalize/prepare/claim/finishは操作を開始したstaffに固定。別staffへ同じ送信操作を引き継がせない。token発行・失効は同じorgの権限あるstaffで可能。
- **失効RPCだけは安全上の例外:** tenant/LINEが無効化された後もリンクを止められるよう、active staff membership・送信可能role・添付org・PDF/token一致を確認し、active tenant/LINEは要求しない。これによって閲覧権限が増えることはない。
- finishの前にstaff/tenant/LINEが無効化された場合はfinishも拒否し、受理結果を確定できない場合がある。権限回復後も新keyで送らず、同じkeyの期限内確認または運用調査へ回す。

## 5. 冪等性・排他・状態

- `(org,staff,request_id)`のUNIQUEとtransaction advisory lockで同時reserveを直列化。
- 添付行のFOR UPDATEを入口にし、全操作を添付単位で直列化。scopeの親行はFOR SHAREで確認する。
- source filename/MIME/hash/サイズ、scope/宛先、final/preview hash、payload/key/期限は固定。ready後は添付内容変更不可。送信terminal状態から後退不可。テーブル直接DMLも付与しない。
- claim leaseは60秒。LINE timeoutはアプリで8秒を想定。期限切れleaseは同じpayload/keyで再claim可能。古いleaseのfinishは状態を変更しない。
- 初回claimをretry期間の起点とし、上限は23時間59分。claimは期限まで60秒を切ると終了するため、LINEへ到着する時間にも余裕を持たせる。アプリは返されたlease/deadlineを送信直前に確認し、実行が停止・遅延したworkerから送らない。
- 2xxと受理済みheader付き409はaccepted。400/401/403はfailed。timeout/network/429/5xxはunknownとして同じkeyで扱う。HTTP判定はアプリ責務で、SQLへは3値のみ渡す。
- DBの排他だけで外部HTTP処理を完全に停止できない。期限を越えて再開した古いworkerの送信禁止はアプリ側にも必須。SQL単体で「exactly once delivery」を保証するものではない。

## 6. 画像サイズ・URLの確定方針

入力sourceは10MiB（10,485,760 bytes）まで。**10,000,001～10,485,760 bytesも受け入れてサーバーで縮小・再圧縮する。** finalは10,000,000 bytes以下、previewはJPEGで1,000,000 bytes以下。ファイルの切り詰めは禁止。decoder検証やサイズ達成に失敗したらfinalize/送信せず、入力し直しを案内する。finalのMIMEはsourceと同じJPEG/PNGを維持する。

| 方式 | 利点 | 制約 | 結論 |
| --- | --- | --- | --- |
| A: Supabase signed URLをpayloadに固定 | LINEに実画像のHTTPS URLを直接渡せる。アプリRoute障害・redirect互換性に依存しない | 初回前に十分な期限が必要。発行後の個別即時失効は困難 | 今回のLINE imageで採用 |
| B: CREDO token URL → 短期署名へredirect | LINEに渡すURLを固定したまま署名更新・失効を制御できる | LINE画像取得時のredirect互換性は実機未確認。画像専用token/閲覧Routeが別途必要。PDF専用token tableへ混在させない | 現段階では採用しない |

Aは両URLを初回prepare直前に**27時間有効**で発行し、短い方の実際のexpiryをpayload_expires_atへ渡す。prepareは26時間以上・28時間以下、初回claimは残り26時間以上を要求。再試行は初回から約24時間以内なので、画像URLには少なくとも2時間の取得余裕が残る。初回送信が遅れて残り26時間未満なら未送信のままexpiredにし、期限切れURLで送らない。**24時間を超えたretryや新keyへの自動切替はしない。**

同じrequest IDでは署名URLも暗号化payloadも再生成しない。AES-GCMのnonceを含む完成済みciphertextを保存・再利用し、鍵versionとAADにscopeを含める。payloadの実際のURL/宛先/期限とDB引数の一致は暗号化を担当する信頼済みbackendが保証する。SQLは暗号文内のURLやbinary内容を検査できない。

この方式は公式の24時間retry窓をカバーする。数日後のLINE端末による画像再取得を保証するものではなく、実機で遅延取得・再表示を検証する。

## 7. PDF token運用

PDFはCREDO token URLを採用。256-bitランダムtokenのSHA-256 hashのみDB保存。本文URLのtokenはfragmentに置き、専用ページから明示操作で同一origin POST。Routeでtoken hash、file/org/repair/tenant/LINEの一致・active状態・ready PDF・期限・失効を確認後、120秒のStorage署名へredirectする。Supabase Authログインは不要だが所持者認証であり、リンク転送先を本人と区別できない。

- 発行はready PDFのみ。画像はRPCで拒否。
- 発行期限は最大7日。同じ発行request IDでは同じhash/期限/添付のみ許可し、失効や期限切れを復活させない。
- 再発行は新request ID/new tokenを使い、旧未失効tokenを同一transactionで失効。pending/sending/unknownが残る間は再発行禁止。
- 期限だけのUPDATE/延長は禁止。延長したい場合は再発行する。旧LINEメッセージ中のリンクは置換されないため、新リンクの案内は別の明示的な送信操作にする。
- 失効は繰返しても同じ失効日時。送信中でも閲覧を止められる。すでにclaim済みのworkerがリンクを送る可能性はあるが、閲覧Routeが失効を検証して拒否する。
- 既発行の120秒Storage署名は期限まで使用可能。失効が発行済み署名を即時無効化するとは扱わない。
- token/hash/署名/payload/宛先をログへ出さない。POST body、redirect Location、エラー監視の自動captureも対象。

## 8. Bucket/path

`staff-line-files`: private、15,728,640 bytes、`image/jpeg`,`image/png`,`application/pdf`。bucket作成は別作業で今回は未実施。anon/authenticated直接policyなし。既存の広範なstorage.objects policyが適用されないことを必ず確認する。

- staging: `{organization_id}/line-outbound-staging/{repair_request_id}/{attachment_id}.{jpg|png|pdf}`
- final: `{organization_id}/line-outbound/{repair_request_id}/{attachment_id}.{jpg|png|pdf}`
- preview: `{organization_id}/line-outbound/{repair_request_id}/{attachment_id}.preview.jpg`

各pathはSQLでも完全一致のCHECK。元filenameを使わない。ブラウザはstagingへの限定signed uploadのみ。final/previewはサーバーが検証したbyteからupsert:falseで作り、上書き権限をブラウザへ渡さない。

finalizeはStorage metadataのpath/size/MIMEとprivate bucketを確認するが、magic/decoder/実測SHA-256をSQLで算出しているわけではない。それらはサーバー検証必須。未確定uploadの自動cleanupは今回作らない。finalizeと競合する削除を行わず、確定済み/unknown履歴は保持する。

## 9. 実行前の確認事項・検証範囲

1. SQLは静的確認のみ。ユーザー指示に従いDB実行・ローカル適用試験はしていない。後日許可された検証DBで全RPCの成功/拒否、2接続での並行reserve/claim、stale finish、deadline、ACL、immutable triggerを実行検証してから本番へ適用する。
2. schemaに同名の新table/functionが未作成であること、既存の親PK/UNIQUE/列型が確認結果どおりであること。途中まで作成済みなら本SQLをそのまま再適用しない。
3. 実行者がpublicのDDLおよびstorage.buckets/objects参照に必要な権限を持つこと。関数ownerはブラウザ/service_roleではない管理用role。
4. 必要index追加とFK作成のlock・親データ量。lock_timeout=10秒で失敗時は全体rollback。実行はトラフィックの少ない時間帯。
5. bucketは別途作成しpolicy監査。Storage metadataのsize/mimetypeが実際のuploadで記録されること。bucketなしでもDDL作成は可能だがfinalizeは拒否する。
6. backendの認証→RPC引数、AES-GCM鍵/ローテーション、署名expiry、ファイル検証、固定payload、ログ抑止、古いworkerの送信禁止、PDF閲覧Routeは今後のアプリ実装責務。
7. LINE実機での画像取得・27時間期限の運用、PDF fragment/POST、Vercel直接upload・画像処理負荷を確認する。migration単独では送信機能は有効にならない。

資料: [LINE retry](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)、[LINE image](https://developers.line.biz/en/reference/messaging-api/nojs/#image-message)、[PostgreSQL pg_index](https://www.postgresql.org/docs/18/catalog-pg-index.html)。
