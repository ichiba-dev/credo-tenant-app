import "server-only";

import { randomUUID } from "node:crypto";
import { MAX_PHOTOS, MAX_PHOTO_BYTES, MAX_TOTAL_PHOTO_BYTES, PHOTO_TYPES } from "./upload-limits";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { RepairSubmissionActor } from "./tenant-submission";

type Stage = "validation" | "property" | "request_insert" | "request_lookup" | "storage_upload" | "photos_insert" | "fallback_update";
type Result = { ok: true; tenantLinked: boolean } | {
  ok: false;
  stage: Stage;
  requestCreated: boolean;
  retrySafe: boolean;
  message: string;
};

const categories = new Set(["エアコン", "給湯器", "キッチン", "浴室", "トイレ", "洗面所", "玄関・鍵", "共用部", "その他"]);
const validText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

// 公開受付。既存案件ID・会社ID・URL・状態は入力として採用しない。
// 写真のDB登録もこの呼び出しで作成した案件にのみ許可する。
export async function submitRepair(input: FormData, actor: RepairSubmissionActor = { kind: "anonymous" }): Promise<Result> {
  let stage: Stage = "validation";
  let requestCreated = false;
  let requestId: string | number | null = null;
  let uploadedCount = 0;
  const fail = (): Result => {
    // SDKのエラー本体や入力、環境変数はログ・レスポンスに出さない。
    console.error("repair_submission_failed", { stage, requestCreated, requestId, uploadedCount });
    return {
      ok: false, stage, requestCreated,
      retrySafe: stage === "validation" || stage === "property",
      message: requestCreated
        ? `修理依頼は登録されましたが、写真情報の処理に失敗しました（案件${requestId}・${stage}・アップロード完了${uploadedCount}枚）。重複登録を避けるため、再送せず管理会社へお問い合わせください。`
        : stage === "validation" || stage === "property"
          ? "入力内容・物件・写真を確認できませんでした。写真はJPEG・PNG、最大20枚、1枚5MiB・合計20MiBまでです。"
          : "登録完了を確認できませんでした。重複登録を避けるため、再送前に管理会社へお問い合わせください。",
    };
  };

  try {
    if (!(input instanceof FormData)) return fail();
    // 旧path受付を廃止。会社・案件・保存先をクライアントから指定させない。
    const fields = ["propertyId", "roomNumber", "tenantName", "category", "description"];
    if ([...input.keys()].some((key) => !fields.includes(key) && key !== "photos") ||
        fields.some((key) => input.getAll(key).length !== 1)) return fail();
    const [propertyId, roomNumber, tenantName, category, description] = fields.map((key) => input.get(key));
    const files = input.getAll("photos");
    if (!validText(propertyId, 128) || !validText(roomNumber, 100) ||
        !validText(tenantName, 200) || !validText(category, 30) || !categories.has(category) ||
        !validText(description, 10000) || files.length > MAX_PHOTOS) return fail();
    let total = 0;
    const validated: { file: File; ext: string }[] = [];
    for (const file of files) {
      if (typeof file === "string" || !PHOTO_TYPES.includes(file.type) ||
          file.size === 0 || file.size > MAX_PHOTO_BYTES) return fail();
      total += file.size;
      if (total > MAX_TOTAL_PHOTO_BYTES) return fail();
      const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const png = [137, 80, 78, 71, 13, 10, 26, 10];
      if (file.type === "image/png"
        ? !png.every((byte, index) => header[index] === byte)
        : !(header[0] === 255 && header[1] === 216 && header[2] === 255)) return fail();
      validated.push({ file, ext: file.type === "image/png" ? "png" : "jpg" });
    }

    stage = "property";
    const supabase = createServerSupabaseClient();
    const { data: property, error: propertyError } = await supabase.from("properties")
      .select("id, name, organization_id").eq("id", propertyId).eq("is_active", true).maybeSingle();
    if (propertyError || !property?.organization_id) return fail();

    if (actor.kind === "tenant" && actor.organizationId !== property.organization_id) {
      return { ok: false, stage: "property", requestCreated: false, retrySafe: true,
        message: "\u5165\u5c45\u8005\u30a2\u30ab\u30a6\u30f3\u30c8\u3068\u9078\u629e\u3057\u305f\u7269\u4ef6\u306e\u7ba1\u7406\u4f1a\u793e\u304c\u4e00\u81f4\u3057\u307e\u305b\u3093\u3002" };
    }

    stage = "request_insert";
    const { data: created, error: insertError } = await supabase.from("repair_requests").insert({
      organization_id: property.organization_id,
      tenant_account_id: actor.kind === "tenant" ? actor.tenantId : null,
      property_id: property.id,
      property_name: property.name,
      room_number: roomNumber.trim(), tenant_name: tenantName.trim(),
      category, description: description.trim(), photo_url: "", storage_path: null, status: "受付",
    }).select("id").single();
    if (insertError || !created) return fail();
    requestCreated = true;
    requestId = created.id;

    if (validated.length > 0) {
      stage = "request_lookup";
      const { data: repair, error: lookupError } = await supabase.from("repair_requests")
        .select("id, organization_id").eq("id", created.id)
        .eq("organization_id", property.organization_id).single();
      if (lookupError || !repair?.organization_id) return fail();

      const photos = [];
      for (const [index, { file, ext }] of validated.entries()) {
        stage = "storage_upload";
        const path = `${property.organization_id}/${created.id}/${randomUUID()}.${ext}`;
        const storage = supabase.storage.from("repair-images");
        const { data: uploaded, error: uploadError } = await storage.upload(path, file, {
          contentType: file.type, upsert: false,
        });
        if (uploadError || uploaded?.path !== path) return fail();
        uploadedCount++;
        photos.push({
          repair_id: repair.id, organization_id: repair.organization_id,
          storage_path: uploaded.path,
          photo_url: storage.getPublicUrl(uploaded.path).data.publicUrl,
          sort_order: index + 1,
        });
      }
      stage = "photos_insert";
      const { error: photosError } = await supabase.from("repair_photos").insert(photos);
      if (photosError) return fail();

      stage = "fallback_update";
      const { data: updated, error: updateError } = await supabase.from("repair_requests")
        .update({ photo_url: photos[0].photo_url, storage_path: photos[0].storage_path }).eq("id", repair.id)
        .eq("organization_id", repair.organization_id).select("id").single();
      if (updateError || !updated) return fail();
    }
    return { ok: true, tenantLinked: actor.kind === "tenant" };
  } catch {
    return fail();
  }
}
