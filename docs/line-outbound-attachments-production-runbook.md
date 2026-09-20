# LINE添付送信 本番反映手順書

この文書は**後日、承認された作業枠で実行する手順**である。作成時点では本番DB・Storage・Vercelを変更していない。操作対象は毎回、Supabaseの本番projectとVercelの本番projectを別経路で照合する。テストには送信先を限定した実LINEアカウントと専用修理依頼を使い、実入居者には送らない。以下のコマンド中の環境変数にはシークレット管理システムから取得した値を実行時だけ設定し、コマンド履歴・作業記録に値を貼らない。

前提: ローカルではmigration適用、RPC 22件、Storage 20件、アプリ全テスト283件とtypecheck・lint・buildの検証を完了している。ただし本番schemaと設定の一致は手順6で再確認する。`docs/line-outbound-attachments.migration.sql`は`BEGIN`/`COMMIT`を含む**一回適用用**SQLである。二度目の実行や`supabase db push`による一括適用はしない。

## 1. 適用するmigrationを固定する

- **何をするか:** 正本を`docs/line-outbound-attachments.migration.sql`のみに固定し、レビュー済みreleaseのファイルハッシュを記録する。`proposal.sql`とlocal fixtureは本番に適用しない。
- **コマンド:** `Get-FileHash -Algorithm SHA256 docs/line-outbound-attachments.migration.sql`、`git diff -- docs/line-outbound-attachments.migration.sql`。
- **成功条件:** 承認されたmigrationのハッシュと一致し、差分・未承認編集がない。
- **停止条件:** ハッシュ不一致、migrationの二重適用の痕跡、レビューされていない変更。

## 2. bucket設定を確定する

- **何をするか:** 本番Storageに作る`staff-line-files`の設定を承認する。private (`public=false`)、`fileSizeLimit=15728640` bytes、`allowedMimeTypes=['image/jpeg','image/png','application/pdf']`。`storage.objects`に新しいpolicyは作らず、既存の広いpolicyがこのbucketを公開しないことを確認する。Storage全体の上限も15 MiB以上にする。
- **確認SQL（読み取り専用）:** `SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='staff-line-files';` および `SELECT policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects';`
- **成功条件:** 作成前なら同名bucketなし。既存なら設定が完全一致し、匿名・ログイン利用者にこのbucketのobjectを読ませるpolicyがない。
- **停止条件:** 同名bucketの設定違い、広い公開policy、Storage全体のサイズ上限不足。Storage schemaへの直接INSERT/UPDATEはしない。Storage操作は[Supabase Storage API/ダッシュボード](https://supabase.com/docs/guides/storage/buckets/creating-buckets)を使う（[schemaは読み取り専用](https://supabase.com/docs/guides/storage/schema/design)）。

## 3. 必要なVercel環境変数を棚卸しする

- **何をするか:** 本番環境に既存の`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`LINE_CHANNEL_ACCESS_TOKEN`と、新規の`OUTBOUND_PAYLOAD_KEY_V1`、`OUTBOUND_TOKEN_SECRET`、`OUTBOUND_PUBLIC_BASE_URL`が必要。前二者のみbrowser公開可。Service Role、LINE token、暗号鍵はserver-onlyで管理する。値の投入は手順9で行う。
- **コマンド:** `vercel env ls production`。Vercel project名とproduction scopeをVercel Dashboardでも照合する。
- **成功条件:** 既存変数の名前・scope・管理者が判明し、新規3変数の保管先が決まっている。Service Role等に`NEXT_PUBLIC_`接頭辞がない。
- **停止条件:** project取り違え、秘密値のbrowser露出、LINE channelまたはSupabase projectの対応不明。環境変数の追加・変更後は再デプロイが必要（[Vercel公式](https://vercel.com/docs/cli/env)）。

## 4. 暗号鍵を生成する

- **何をするか:** 安全な作業端末で独立した32-byte乱数を**2回**生成し、base64文字列を秘密管理庫に別々に保存する。1つ目がAES-256用`OUTBOUND_PAYLOAD_KEY_V1`、2つ目がHMAC用`OUTBOUND_TOKEN_SECRET`。両方を全サーバー・再デプロイ間で固定する。
- **コマンド（PowerShell、1回ずつ計2回）:** `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`。出力を共有ログ・チケット・Gitに残さず秘密管理庫へ移す。
- **成功条件:** 2値が異なり、各値のbase64デコード長が32 bytes。秘密管理庫のアクセス権が限定される。
- **停止条件:** 使い回し、出力の漏えい、長さ違い、既存のlive pushがある状態での無計画な鍵変更。鍵変更は凍結済みpayloadとPDF tokenの再利用を壊す。

## 5. 公開HTTPS originを設定する

- **何をするか:** `OUTBOUND_PUBLIC_BASE_URL`用に、本番CREDOの固定公開origin（例: `https://app.example.com`）を決める。path、query、末尾の用途別pathを入れない。LINEから認証なしでPDF token routeへ到達できること、VercelのURLアクセスログで`/api/line-outbound/pdf/<token>`の**生token部分を記録・転送しない**設定を確認する。画像はSupabaseの署名付きHTTPS URLをLINEが取得する。
- **コマンド:** `curl.exe -I https://<本番CREDOのホスト>/`。ログ設定はVercel Dashboardと接続済みログ転送先で確認する。token付きURLの実アクセス確認は手順11で行う。
- **成功条件:** 公開DNS/TLSが正常、originが本番アプリを指す、token URLのログ抑止が実証できる。
- **停止条件:** HTTP、localhost/private IP、path付き値、認証ゲート、tokenを含むURLのアクセスログ記録。tokenはURL上のbearer secretである。

## 6. deploy前チェック

- **何をするか:** 本番への変更前に対象project、schema、権限、Storage policy、検証済みreleaseを確認する。直前の本番deployment URLをrollback先として記録する。期限切れ添付・放置stagingの清掃手順、`unknown` pushの担当者と再試行期限も決める。現在の実装には自動retry workerがない。
- **コマンド:** `git status --short`、`node --test`、`npx tsc --noEmit`、`npm run lint`、`npm run build`、`vercel list --prod`。本番DBは**読み取り専用**で`psql "$env:PROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f docs/line-outbound-attachments.catalog-readonly.sql`を実行し、接続先host/project refを管理画面の本番値と照合する。続けて`SELECT to_regclass('public.staff_line_attachments'), to_regclass('public.staff_line_attachment_pushes'), to_regclass('public.staff_line_attachment_tokens');`を確認する。
- **成功条件:** テスト・typecheck・lint・build成功、既知lint warningのみ、migration未適用、親テーブル・列・unique/FKがmigrationの前提と一致、対象が本番と証明できる、前deploymentと担当者を記録済み。
- **停止条件:** チェック失敗、予期しないDB object、接続先不明、tokenログ抑止や清掃・`unknown`対応が未準備。`.env.local`の接続先を本番判断に使わない。

## 7. 本番migrationを適用する

- **何をするか:** 手順6で照合した本番DBだけに正本SQLを一回適用する。最初のSQLエラーで停止する。失敗時は原因を調査し、勝手に再実行・仕様変更しない。
- **コマンド:** `psql "$env:PROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f docs/line-outbound-attachments.migration.sql`。接続URLを画面共有や作業ログに出さない。成功後、以下を読み取り専用で確認する。
  ```sql
  SELECT relname, relrowsecurity FROM pg_class WHERE oid IN
    ('public.staff_line_attachments'::regclass,
     'public.staff_line_attachment_pushes'::regclass,
     'public.staff_line_attachment_tokens'::regclass);
  SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('reserve_staff_line_attachment','finalize_staff_line_attachment_upload',
      'issue_staff_line_attachment_pdf_token','prepare_staff_line_attachment_push',
      'claim_staff_line_attachment_push','finish_staff_line_attachment_push',
      'revoke_staff_line_attachment_pdf_token');
  SELECT proname, has_function_privilege('service_role',oid,'EXECUTE') AS service_role,
    has_function_privilege('anon',oid,'EXECUTE') AS anon,
    has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE '%staff_line_attachment%';
  ```
- **成功条件:** psql exit 0、3テーブルすべてRLS有効、7 RPCあり、service_roleのみEXECUTE可能、migration定義のFK/CHECK/index/triggerとtable ACLもcatalogで確認済み。
- **停止条件:** SQLエラー、予期しない権限・RLS/制約差、途中まで適用された疑い。migration内のtransactionによりSQLエラーは通常rollbackされるが、必ずcatalogで確認する。

## 8. 本番bucketを作成する

- **何をするか:** Supabase Dashboardの**確認済み本番project**でStorage → New bucketを使い、手順2の設定で`staff-line-files`を作る。Storage object policyは追加しない。APIで行う場合もStorage APIを使う。
- **操作/確認SQL:** Dashboardで`public=false`、15728640 bytes、JPEG/PNG/PDFを設定後、読み取り専用の`SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='staff-line-files';`で確認する。
- **成功条件:** 1 bucket、設定完全一致、policy追加なし。private objectの匿名取得は不可。
- **停止条件:** public bucket、サイズ/MIMEの違い、別projectへの作成、既存policyで匿名読み取り可能。間違ったbucketをSQLで直接削除しない。

## 9. Vercel deploy

- **何をするか:** 手順3～5で準備した値を**確認済み本番Vercel projectのproduction環境**に登録し、レビュー済みreleaseをデプロイする。既存envを更新する場合は値と影響を個別確認する。暗号鍵・Service Roleはbrowserに渡さない。
- **コマンド:** `vercel env add OUTBOUND_PAYLOAD_KEY_V1 production --sensitive`、`vercel env add OUTBOUND_TOKEN_SECRET production --sensitive`、`vercel env add OUTBOUND_PUBLIC_BASE_URL production`。既存値の更新が必要なら`vercel env update <NAME> production`を使う。`vercel --prod`、`vercel list --prod`。CLIの対話入力またはDashboardで秘密値を設定し、シェル引数に値を入れない（[Vercel環境変数](https://vercel.com/docs/cli/env)、[deploy](https://vercel.com/docs/cli/deploying-from-cli)）。
- **成功条件:** 本番deploymentがReady、期待するドメインが新deploymentを指す、管理画面・既存LINE受信とstaff text replyが正常。envのscopeと値の存在を確認できる。
- **停止条件:** build失敗、env欠落、別projectへのdeploy、既存機能の退行。直ちに手順14へ。

## 10. 実LINEで画像送信を確認する

- **何をするか:** 専用のactive tenantとLINEテストアカウントで、管理画面から小さいJPEG/PNGを1件送る。必要なら10 MiB以内で10,000,000 bytes超のsourceも別件で試す。送信済み画像を会話履歴とLINE受信側で確認する。
- **操作/確認SQL:** `/admin`の対象修理依頼 → 会話 → 画像選択 → 送信。対象IDだけを使い、`SELECT a.upload_state,a.mime_type,a.source_file_size,a.file_size,a.preview_file_size,p.status,p.attempt_count FROM public.staff_line_attachments a JOIN public.staff_line_attachment_pushes p ON p.attachment_id=a.id WHERE a.id='<確認済みテストattachment UUID>';`。秘密URL、userId、payloadを共有ログに貼らない。
- **成功条件:** ready、final画像≤10,000,000 bytes、preview≤1,000,000 bytes、push accepted、LINEで画像表示、会話履歴に表示。画像の署名URLは27時間、push直前に有効期限を確認する設計。
- **停止条件:** 画像が取得できない、二重受信、サイズ超過、scope違い、429/5xxが継続、既存会話機能の退行。

## 11. 実LINEでPDF送信・閲覧を確認する

- **何をするか:** 15 MiB以下のテストPDFを同じ専用アカウントへ送る。LINEにはPDF本体ではなくCREDOのtoken URL付きtextが届く。受信端末から開いて短期署名URLへredirectされることを確認する。
- **操作/確認SQL:** `/admin`の会話 → PDF選択 → 送信。`SELECT a.upload_state,a.media_type,a.file_size,p.status,t.expires_at,t.revoked_at,octet_length(t.token_hash) AS hash_bytes FROM public.staff_line_attachments a JOIN public.staff_line_attachment_pushes p ON p.attachment_id=a.id JOIN public.staff_line_attachment_tokens t ON t.attachment_id=a.id WHERE a.id='<確認済みテストattachment UUID>';`。
- **成功条件:** ready、media_type=pdf、accepted、hash_bytes=32、DBに生token保存なし、LINEのリンクで閲覧可能、PDF閲覧routeは有効tokenだけ通しprivate Storageの120秒署名URLへredirect、会話履歴にも表示。
- **停止条件:** tokenがログ/DBに平文で残る、他tenantで閲覧可、期限外で閲覧可、PDFがLINEへ直接送られる、署名URLの期限違い。

## 12. token revoke後の閲覧拒否を確認する

- **何をするか:** 手順11のテストPDF tokenを、送信者と同一scopeのservice-role server側から`revoke_staff_line_attachment_pdf_token` RPCで失効させ、**CREDO token URLへの新規アクセス**が拒否されることを確認する。ブラウザからService Roleを使わない。
- **操作/SQL:** 管理されたserver-side運用経路で次のRPCを実行する。値は対象テスト行から個別に照合し、browserからService Roleを使わない。`SELECT public.revoke_staff_line_attachment_pdf_token('<テストorganization UUID>'::uuid,'<テストattachment UUID>'::uuid,'<認可されたstaff auth UUID>'::uuid,'<テストtoken UUID>'::uuid);`、続いて`SELECT revoked_at FROM public.staff_line_attachment_tokens WHERE attachment_id='<確認済みテストattachment UUID>';`。その後同じtoken URLを新規プライベートウィンドウで開く。
- **成功条件:** `revoked_at`が入り、CREDO token URLが拒否される。失効前に発行済みのStorage署名URLは最大120秒残り得るため、完全失効はその期限後にも確認する。
- **停止条件:** 新しい署名URLが発行される、120秒経過後も旧署名URLが使える、異なるtokenまで失効、RPCのscope拒否。

## 13. `unknown` pushの再送を確認する

- **何をするか:** 本番テスト専用送信で`unknown`が発生した場合、**同じrequest_id・同じファイル・同じstaff/repair**で管理画面から再送する。故意に本番通信を切断したりDBのstatusを手で書き換えたりしない。通常の試験で`unknown`が起きなければ「未確認」と記録し、後日、制御された試験環境・運用手順で確認する。LINEの同一retry keyは受理済みの再送で409を返し得る（[LINE公式](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)）。
- **操作/確認SQL:** 元のrequest_idを保持して再送し、`SELECT id,status,attempt_count,first_attempt_at,retry_deadline,payload_expires_at FROM public.staff_line_attachment_pushes WHERE attachment_id='<確認済みテストattachment UUID>';`を前後で比較する。retry key・payloadの同一性は権限を限定したDBセッション内で比較し、値をログに出さない。
- **成功条件:** attachment/push IDと暗号化済みpayload・retry keyが不変、lease中は二重claimなし、acceptedは再送されない。retryは最初の試行から24時間未満かつpayload期限の2時間前まで。新規内容を同じrequest_idで上書きしない。
- **停止条件:** 異なるpayload/key・宛先で再送、重複LINE受信、期限後retry、`unknown`を成功と誤認。確認できなかった場合は本番受け入れ判定を保留する。

## 14. 問題発生時のrollback

- **何をするか:** 送信を止め、まず手順6で記録した直前の正常なVercel deploymentへ戻す。`unknown`行を調査し、同じretry keyでの再送可否を判定する。新3テーブルやbucketには送信履歴・URL期限の証跡が残るため、**自動でDROP/DELETEしない**。問題のPDFはscopeを確認してrevokeする。既存のLINE受信・text replyに使う共通資格情報は安易に変更しない。
- **コマンド:** `vercel rollback <直前の正常なproduction deployment URL>`、`vercel rollback status`（[Vercel公式](https://vercel.com/docs/cli/rollback)）。`SELECT status,count(*) FROM public.staff_line_attachment_pushes GROUP BY status;`で未解決行を把握する。
- **成功条件:** 元の管理画面・LINE受信・text replyが復旧し、新規添付送信が停止、未解決pushと有効tokenの担当者が決まる。DBは読み取り可能で証跡が残る。
- **停止条件:** rollback先不明、既存機能未復旧、token閲覧が止まらない、未解決pushを消す必要があるとの判断。DB schemaの逆migrationやbucket削除は、既存行/objectの保持、依存関係、復旧方法を別途レビューした場合に限る。Storage objectの削除はSQLではなくStorage APIで行う。
