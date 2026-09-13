import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type PhotoSource = { storage_path?: string | null; photo_url?: string | null };

// 認可エラーとは区別し、表示側が写真単位の取得不能として扱えるエラー。
export class PhotoUnavailableError extends Error {}

// 呼び出し元で認証・案件と写真の会社／閲覧権限を確認したDB行だけを渡す。
// クライアントからpathを受け付けるAPIとして公開しない。
export async function resolveRepairPhotoUrl(source: PhotoSource, organizationId: string, repairId: number): Promise<string | null> {
  if (!organizationId || !Number.isSafeInteger(repairId) || repairId <= 0) {
    throw new Error("写真の閲覧権限を確認できませんでした。");
  }
  const path = source.storage_path;
  if (path == null || path === "") return source.photo_url || null;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  const parts = path.split("/");
  // 階層付きpathは必ず認可済みの会社・案件と一致させる。不一致は回復可能な画像エラーにしない。
  if (parts.length !== 1 && (parts.length !== 3 || parts[0] !== organizationId || parts[1] !== String(repairId))) {
    throw new Error("写真の閲覧権限を確認できませんでした。");
  }
  // 旧ルート直下キーの帰属は認可済みDB行で保証する。UUIDやファイル名から推測しない。
  // キーをdecode・正規化せず、そのままStorage SDKへ渡す。
  if (path.length > 1024 || !path.trim() || path === "." || path === ".." ||
      /[:\\\u0000-\u001f\u007f]/.test(path) ||
      (parts.length === 3 && !new RegExp(`^${uuid}\\.(jpg|png)$`, "i").test(parts[2]))) {
    throw new PhotoUnavailableError("写真の保存先を確認できませんでした。");
  }
  try {
    const { data, error } = await createServerSupabaseClient().storage
      .from("repair-images").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) throw new Error("Signing failed");
    return data.signedUrl;
  } catch {
    // pathがある場合、署名失敗をpublic URLへフォールバックさせない。
    throw new PhotoUnavailableError("写真を取得できませんでした。再読み込みしてください。");
  }
}
