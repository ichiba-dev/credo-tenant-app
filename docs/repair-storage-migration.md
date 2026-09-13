# repair-images private化の調査・実装準備

調査日: 2026-09-11。今回はこの設計書のみ追加し、稼働コード・DB・RLS・bucket設定・既存画像を変更しない。以下のAPI、SQL、切替手順は未実装・未実行。

## 現状と影響

| 箇所 | 現在の処理 | private化／匿名INSERT削除の影響 |
| --- | --- | --- |
| `app/repair/page.tsx:83` | ブラウザでUUID＋元ファイル名を作り、`supabase.storage.from('repair-images').upload()`。最大20枚。path配列をsubmitRepairへ送る | 匿名INSERT削除で写真付き送信がアップロード時に止まる |
| `app/repair/actions.ts:37` | クライアントのphotoPathsを形式検証。ファイルの存在・所有関係は検証していない | UUID形式を知るだけで他の画像pathを参照できる構造。新方式でpath入力を廃止する |
| `app/repair/actions.ts:69` | `getPublicUrl(path)` をrepair_photos.photo_urlへ保存。1枚目をrepair_requests.photo_urlにも保存 | getPublicUrlはprivate閲覧権限を付けない。URLの生成・DB保存自体が成功しても閲覧不能になる |
| `app/admin/data.ts:9` | 認証済みスタッフのorganizationで案件を限定。写真もorganizationと可視repair_id配列で絞る。photo_urlをクライアントへ渡す | DB取得は成功しても画像取得が失敗 |
| `app/admin/admin-repairs.tsx:18` | repair_photos優先、なければrepair_requests.photo_url。サムネイル・拡大表示にURLを使う | 両方とも画像が表示できなくなる |
| `app/admin/admin-repairs.tsx:274`、`app/pdf/RepairReport.tsx:271` | 現行PDFはクライアントのPDFDownloadLink＋React PDF。写真配列優先、旧1枚URLへフォールバック。Image srcで取得 | PDF内の画像取得失敗。欠落／生成エラーの具体的な見え方はブラウザ確認が必要 |
| `app/admin/admin-repairs.tsx:71` | 別のcreatePdf関数もphoto_urlをfetchするが、現行画面からの呼び出しは検索で見つからない | 将来再利用する場合も対応が必要 |
| `app/owner/repairs/14/page.tsx:36` | ログイン→owners→報告先recipient→対象報告の関係を確認後、Service Roleで写真を取得。img srcはphoto_url | owner画像も取得不能。写真SELECTにはrepair_idのみでorganization条件がない |
| `app/admin/page_backup.tsx` | 旧実装にURLのfetch・img・URLログが残る | 現行pageルートではない。再利用時に同じ移行が必要。今回は変更しない |

アプリで永続化しているのはURLのみ。pathはブラウザ／サーバー処理中に存在するが、storage_path列の使用は見つからない。実DBの列定義・制約・トリガー・Storageポリシー・オブジェクト一覧は未確認であり、DBに列が存在しないとまでは断定しない。

public属性は読み取りの公開設定であり、アップロード許可とは別。privateへ変更するだけでは既存の匿名INSERTポリシーはなくならない。[Supabase bucket仕様](https://supabase.com/docs/guides/storage/buckets/fundamentals)

## 推奨する実装単位

### 1. サーバー受付・アップロード

- `POST /repair/submit` のRoute Handlerを追加し、フォーム項目と画像ファイルをmultipartで受ける案。公開受付なのでスタッフログインは要求しない。クライアントのorganization、repair ID、storage path、public URL、ファイル名を保存先決定に使わない。
- 入力と有効なpropertyを検証し、propertyからorganizationを取得。案件を作成して得たIDを使い、サーバーで `organizationId/repairId/randomUUID.ext` を生成する。拡張子・Content-Typeは検証済み画像内容に基づく。元ファイル名はpathに含めない。upsertはfalse。
- アップロードと署名に使うService Roleクライアントは `lib/supabase-server.ts` のみ。Service RoleはRLSを迂回するため、アプリの認可チェックを省略できない。[Supabase access control](https://supabase.com/docs/guides/storage/security/access-control)
- 案件・写真登録の既存検証ロジックはserver-onlyの内部関数へ移す。移行完了時には、現在の `submitRepair(photoPaths)` という外部から呼べるServer Actionを残さない。UIだけを切り替えても旧Actionが任意pathを受けるなら不十分。
- 最大20枚を維持。ファイル数・1枚容量・合計容量・実データ形式をサーバーで検証し、空ファイル・偽装MIME・非対応画像を拒否する。具体的な容量と対応形式は既存画像、PDF対応、ホスティング上限の実測後に確定する。現在はaccept=image/*のみであり、対応形式の制限には利用者への案内が必要。
- Next.js同梱ガイドではServer Actionsの既定body上限は1MB。設定値だけ大きくして20枚を一括送信する変更は避ける。Route Handlerでもホスティングのbody上限・メモリ・実行時間制限は残る。実行環境が一括送信に対応しなければ、サーバー発行の期限付きアップロードセッションと1枚ずつのサーバー転送方式に分ける。セッションはサーバー保存でproperty／organization／案件／枚数へ束縛し、クライアント任意path方式へ戻さない。この場合は追加DB設計が必要。
- 公開サーバー受付には容量上限に加えて回数制限を設ける。Originチェックだけでは自動投稿を防げない。Service Role key、入力内容、signed URL、SDKエラー全文をログへ出さない。

### 2. 失敗・再試行の扱い

- StorageとDBは単一トランザクションにならない。入力不正は案件作成前に止める。案件作成後のアップロード失敗は「案件作成済み／写真未完了」と明示して重複送信を促さない。
- 写真INSERT後の通信切断は登録失敗と決めつけない。DBの参照有無を照合し、未参照と確認できた今回の新規オブジェクトだけを補償削除対象にする。既存pathや所属不明pathは削除しない。
- 二重送信は現在のクライアントのrefだけでは不十分。案件作成の冪等性キーをDBで一意に管理する設計を次の実装時に追加する。公開リクエストから既存案件IDだけを指定して再開・画像追加させない。
- 写真登録済みなのに先頭画像更新だけ失敗した場合は写真を削除しない。管理画面はrepair_photosを優先して表示する。

### 3. 認可してから署名する

- signed URL発行はサーバー専用。公開の「pathを受けて署名する」APIは作らない。クライアント入力は案件IDと必要なら写真IDのみ。DBで対象を確認してpathを取り出す。
- admin: getStaffContextで認証・有効所属を確認→organizationと案件IDで案件取得→同じorganizationとrepair_idで写真取得→署名。viewerの閲覧権限は維持。
- owner: 現行のuser→owner→recipient→report→repairの認可を毎回実行。案件からorganizationを取得して写真もorganization＋repair_idで限定する。organization_id単独ではownerの閲覧権限にならない。関連テーブルの会社情報がある場合は整合も検証。現在固定の案件14をこのPhaseで無関係に汎用化しない。
- pathはサーバーで取得したDB行由来でも検証する。新規pathはorganization／repairのprefixと一致すること。旧ルート直下pathは下記の移行監査を通過したものだけを許す。prefixだけを認可の代用にしない。
- 有効期限は初期案300秒。DBにはsigned URLを保存しない。レスポンスに必要なURL・expiresAt・表示順のみを返し、Cache-Control: private, no-storeとする。会社やユーザーをまたぐ共有キャッシュは禁止。
- 初期表示時の短期URLを画面に永久保持しない。画像拡大時・期限到来時に認証付きで再取得し、401/403は再署名しない。通信失敗時は画像だけに再試行案内を出す。無限再試行を避ける。
- signed URLは期限内に知っている人が使える資格情報。ログアウトや所属変更だけで発行済みURLが即失効する前提を置かない。キャッシュ・取得済みファイルの回収もできない。

### 4. PDFと互換性

- 表示用DTOのphoto_urlへ一時的にsigned URLを入れれば、既存画像コンポーネントとRepairReportのレイアウトは保てる。DBのphoto_urlと一時表示URLは型・変数名で区別する。
- PDFDownloadLinkはクリック前から生成することがあり、一覧取得時のURLだけに依存させない。PDF生成開始時に認可し直して全画像のURLを更新し、期限内に画像bytesを取得してから生成する構造へ変更する。画像bytesをBlob/data URIとして固定する案なら生成中の期限切れを避けやすいが、20枚時のメモリ検証が必要。
- 画像取得失敗を無視して画像欠落PDFを成功扱いにしない。再取得・再生成を案内する。旧1枚フォールバックも署名対象に含める。
- ダウンロード済みPDFの埋め込み画像はsigned URL期限に依存しない。既存PDFを更新する必要はない。

## DB案（未実行）

private化だけなら既存public URLから厳密にpathを解決する互換層で可能。ただしURLから独立して保存する希望設計には明示的な列追加を推奨する。実スキーマ確認後、以下をレビューする。migrationディレクトリには置かず、この文書内だけのSQL案とする。

```sql
-- 提案のみ。列の既存有無・型・制約を確認してから別Phaseで適用する。
BEGIN;
ALTER TABLE public.repair_photos
  ADD COLUMN IF NOT EXISTS storage_path text;
-- repair_photosがない旧1枚画像を失わないための互換列。
ALTER TABLE public.repair_requests
  ADD COLUMN IF NOT EXISTS storage_path text;
COMMIT;
```

repair_photos.storage_pathは各写真、repair_requests.storage_pathは先頭画像の互換参照。既存photo_url列は削除・上書きしない。既存データがあるためNOT NULLは付けない。新方式のphoto_urlをNULLにできるかは現行制約を確認する。NOT NULLなら制約変更案を追加レビューするか、互換期間はpublic URLを併記する。最終的には新規画像についてpathだけを正とし、public URLを生成しない。

冪等性キー／アップロードセッションのDDLは、既存の主キー型・一意制約・公開受付の再開仕様・実行環境上限を確認後に別途確定する。上記2列だけで冪等性や分割転送まで実装済みとは扱わない。

## 既存データの移行

1. 実DBの列、NULL制約、主キー、外部キー、organization整合、既存Storageポリシーとbucket制限を読み取りで確認。写真件数・URL種類・欠損数を集計する。SQLの一括文字列置換はしない。
2. 互換readerはstorage_path優先、未移行ならDBのphoto_urlを解析。設定済みSupabase originと `/storage/v1/object/public/repair-images/` に厳密一致するものだけを候補とする。別origin／別bucket／署名済みURL／不明形式は自動採用しない。元画像がURLしか残っていない外部URLは個別確認してから扱う。
3. URIエンコードされた日本語・空白・%・#・?を含む既存名を考慮。過剰なdecodeやURL正規化で別キーへ変換しない。Storage上の正確なobject keyとの一致を確認できなければ隔離する。path traversal、空path、制御文字などは拒否する。
4. オブジェクトの存在とDBの案件・会社の一致を確認する。現行photoPathsはクライアント入力由来なのでDBにURLがあるだけでは所有の証明にならない。別会社／複数案件による同一path参照を検出し、ルート直下の旧画像について帰属を個別監査する。不明データを自動署名しない。
5. 確認済み対応表を使い、storage_pathがNULLで元URLが監査時と一致する行のみを段階的にbackfillする。オブジェクトの移動・リネーム・削除は不要。新規画像だけ会社／案件階層へ保存する。
6. repair_photosなし・repair_requests.photo_urlのみの案件も必ず対象に含める。両方ある場合は既存の写真順序・優先順位を維持する。
7. 件数一致、未解決URL、欠損画像、所属不明参照を確認し、未解決の必要画像があればprivate化を延期する。移行スクリプトはdry-runと件数報告を先に作り、署名URLを監査ログへ出さない。

## 切替順序とSupabase設定

1. ステージングで実スキーマ・ホスティングの上限を確認し、バックアップと画像対応表を準備。
2. 別Phaseでレビュー済み列追加を適用。publicのまま互換reader・権限検証・signed URL・PDF更新をデプロイし、新旧画像を確認。
3. サーバー転送＋path保存をデプロイし、旧photoPaths Actionを廃止。すでに開いている古い/repairには更新が必要であることを案内する。
4. backfill／所属監査を完了し、匿名Storageアップロードがなくても新規登録できることを確認。その後、repair-imagesに対する匿名INSERT等の不要なStorageポリシーを別途見直す。実ポリシー名は未取得なので削除SQLは推測で作らない。
5. admin・owner・PDFでpublic URLへのネットワーク依存がなくなったことを確認してから、bucketをprivateへ変更。広いSELECTポリシーが残るとprivateでも意図しないアクセスを許す可能性があるため、storage.objectsの既存SELECTも確認する。サーバー署名方式のために新しいpublic/anonymous SELECTを追加しない。
6. bucketの許可MIMEとサイズ上限をサーバー仕様に合わせる。これは今回未変更。
7. private化後の復旧は認可・署名処理の修正を基本とする。古いpublic URL依存コードへ単純に戻すと閲覧不能になる。bucketをpublicへ戻す操作は再公開を伴うため、自動ロールバックに含めない。既存列・オブジェクトは安定確認まで保持する。

## 手動テスト・次実装の受入条件

- 今回: 写真0枚／複数枚で受付→adminのサムネイル・拡大→PDFを確認。旧1枚のみ案件とowner/repairs/14の既存画像を確認。今回は設定・動作とも変更しない。
- 次実装: 新旧・日本語名・空白名・20枚・容量超過・偽装MIME・0byte・途中切断・二重送信・DB失敗をテスト。未参照ファイルと案件の状態を確認。
- NetworkでブラウザからStorageへのuploadがなく、署名キーやService Roleがクライアント／レスポンスにないことを確認。
- 未ログイン、別会社スタッフ、非報告先owner、無効所属、存在しない案件、別案件写真ID、偽のorganization/pathを使って署名が発行されないことを確認。認可失敗時にStorage APIを呼ばないテストを追加する。
- 5分を越えて画面を開き、画像拡大・PDF作成時に再認可と再取得が働くことを確認。失敗時もフォーム・一覧全体を壊さず案内する。
- ステージングで匿名INSERT削除後の受付、private化後の新旧画像・PDFを確認。旧public URLで新規取得できないこと、未認可ユーザーが新しいsigned URLを得られないことを確認。

## 検証範囲と未確認事項

このPhaseは設計書だけを追加する。実環境のDB／Storage設定、オブジェクト帰属、実ブラウザ／PDF出力は未確認。現行テストはSDKモックであり、private bucketの結合テストではない。既存のpublic読み取り・匿名アップロード・クライアントpath受付リスクはまだ残っている。

実行結果: TypeScript（tsc --noEmit）成功。調査対象9ファイルのESLintはエラー0、既存警告5（未使用createPdf、img推奨、React PDF Imageのalt指摘）。既存テスト3ファイル計18件成功。buildは初回Google Fontsの接続制限で失敗したが、権限確認付き再実行で成功。設計書のみの追加なので新規コードテストは追加していない。

参照したNext.js同梱ガイド: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`、`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`。
