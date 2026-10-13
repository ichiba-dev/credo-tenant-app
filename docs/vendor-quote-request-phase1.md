# 業者見積依頼 Phase1

## 範囲と手順

本番未適用。DB・Storage・Auth・Vercelの設定変更はこの作業では行わない。

1. 業者手配タブの手配済みdispatchから「見積依頼リンクを発行」。URLは発行時だけ表示し、コピーしてアプリ外のメール・LINE等で手動共有する。自動送信は行わない。
2. 業者はログイン不要。物件・場所・カテゴリ・管理会社名・staffが共有した手配内容だけを確認する。入居者名、連絡先、申告本文、写真は返さない。写真共有はPhase1の対象外。
3. PDF（拡張子.pdf、application/pdf、最大15 MiB）と工事項目・数量・単位・税別単価・税率を入力。見積番号・有効期限・備考は任意。金額は明細から計算し、税率別に消費税を切り捨てる。
4. 既存の署名付きStorage direct uploadを利用。private `vendor-quotes`へ保存した後、サーバーがメタデータ・PDF先頭・全体SHA-256を検証する。
5. 新しいsubmit RPCは既存の`record_vendor_quote_revision`を再利用し、見積・明細・PDF参照・見積受領イベントの登録とrequestのsubmitted化を一括確定する。
6. 管理画面の見積タブ・業者手配タブは表示中に30秒ごとに再取得。見積タブでrevision・業者・金額・PDF・明細・提出経路・備考を確認する。
7. オーナー報告タブで保存済み見積を選択できる。PDFを開いて確認し、**オーナー向け公開金額を別途入力**、公開確認checkboxを有効にして報告を作成・転用する。下代明細は自動公開しない。

## Tokenと認可

- crypto.randomBytes(32)による256-bit token。DBはSHA-256のみ。
- URLは`/vendor/quotes/submit#token=...`。fragmentはHTTPリクエスト・通常のアクセスログへ送られない。画面読込時に履歴から除去し、tokenはメモリ内だけで保持。ページはnoindex・no-referrer、API応答はno-store。
- tokenをAPIのURLやDB監査本文へ入れない。POST bodyを記録する外部監視設定は使わないこと。
- 7日で失効。再発行時に同じdispatchの旧pending requestを失効。提出成功後は使用済み。管理会社が必要に応じて再発行する。
- 発行RPCはstaffのAuth由来organization/user IDを受け、DBでも有効な所属・dispatch/vendor/repairの関係を再検証。各新RPCはservice_roleのみ実行可能。ブラウザからの直接実行・request table閲覧や書込は禁止。
- 提出画面・APIにはSupabase Authを要求しない。scopeはtoken hashからDB側で確定する。clientのorganization/dispatch/vendor指定は使わない。
- upload ticketは既存HMAC方式を再利用し、依頼IDにも固定。ticket期限は既存と同じ10分、提出リンクは7日。10分を過ぎた準備は「最初からやり直す」で新operationにする。
- 発行operation IDは冪等。発行応答を失った再試行は新tokenを増やさず、URLは復元しない。URLが必要なら新規再発行。
- 同じ提出operationの同一内容は同じrevisionを返す。他の内容や二重提出は拒否。dispatch→requestのロック順を揃え、再発行・失効・確定の競合を直列化する。
- 業者提出の既存`recorded_by/uploaded_by/actor`は発行staffを責任主体として保持する。提出経路はrequestとquote_versionの関連から「業者提出」と表示する。発行staffの無効化・権限剥奪、業者の無効化、dispatch取消でもリンクを拒否。

## オーナー報告への転用

既存`owner_report_estimate_files`にnullableな`source_vendor_quote_id`と複合FK・重複防止indexを追加する。明示承認したPDFだけをprivate `owner-estimates`へコピーし、明示入力した公開金額を既存`owner_reports.estimated_amount`へ設定する。業者原価をdefault値にしない。既存のowner閲覧・承認フローは変更しない。

選択した業者PDFが原価を含む場合、公開checkboxの確認によってそのPDF全体を公開する。金額表示だけを変えてもPDF内の金額は変わらないため、staffは実際のPDFを必ず確認する。別のオーナー向けPDFを用意する場合は従来の見積書アップロードを使う。

報告作成と転用は別処理。転用失敗でも作成済み報告は残り、既存報告へ再試行できる。同じ報告・見積の転用は一度だけ。再試行で公開金額・PDFを上書きしない。転用時のRPC応答が不確実な場合はコピーを削除せず、登録状況の再確認を優先する。

## DB適用前後

前提：vendor dispatch Phase1、owner report/estimate tables、private `vendor-quotes`（PDF-only、15 MiB）、既存private `owner-estimates`、サーバーの既存`OUTBOUND_TOKEN_SECRET`が利用可能であること。

1. `vendor-quote-request-phase1.production-preflight.readonly.sql`を読み取り専用で確認。`organizations.name`、既存quote RPC、owner report金額・見積書列、Storage設定、追加名の未使用を確認する。
2. `vendor-quote-request-phase1.migration.sql`をレビューして適用する。本作業では適用しない。既存テーブル再作成やquote台帳変更はしない。
3. `vendor-quote-request-phase1.production-postcheck.readonly.sql`でRLS・ACL・RPC・index・関係整合を確認。
4. アプリ反映後、発行→業者提出→見積表示→明示承認したオーナー報告転用を本番E2Eで確認。migration未適用の間は追加UIを取得失敗として扱い、既存代理登録は維持する。

StorageとDBは別トランザクション。未確定vendor uploadは既存`vendor-quotes-orphan-cleanup.md`の手順で後から確認する。owner側の未参照コピーも、DBの登録・非登録を確定できるまで保持する。勝手な自動削除はしない。

## ローカル検証

対象node tests、typecheck、git diff --checkを実行する。SQL fixtureは一時ディレクトリの`@electric-sql/pglite@0.3.14`を使うin-memory PostgreSQLで、環境変数・本番接続・永続DBを使用しない。

```powershell
npm.cmd install --prefix "$env:TEMP/vendor-dispatch-sql-test" --no-audit --no-fund @electric-sql/pglite@0.3.14
node docs/test-fixtures/vendor-quote-request-phase1.local.mjs
node --test lib/vendor-quote-request.test.mjs lib/vendor-quote-upload.test.mjs lib/estimate-files.test.mjs app/admin/vendor-dispatch.test.mjs app/admin/vendor-dispatch-compose.test.mjs app/admin/vendor-quote-upload-form.test.mjs app/admin/owner-report-actions.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```
