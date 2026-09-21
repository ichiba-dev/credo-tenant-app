"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { parseVendorMasterInput } from "@/lib/vendor-master";

export type SaveVendorResult = { ok: true } | { ok: false; message: string; loginRequired?: boolean; conflict?: boolean };

export async function saveVendorMaster(input: unknown): Promise<SaveVendorResult> {
  try {
    const context = await getStaffContext();
    if (!context.ok) return { ok: false, message: "ログイン情報を確認できません。", loginRequired: context.reason === "unauthenticated" };
    if (!context.canUpdate) return { ok: false, message: "閲覧権限では業者情報を変更できません。" };
    const parsed = parseVendorMasterInput(input);
    if (!parsed) return { ok: false, message: "入力内容を確認してください。" };
    const { data, error } = await createServerSupabaseClient().rpc("save_repair_vendor_master", {
      p_org: context.organizationId, p_actor: context.userId,
      p_request_id: parsed.requestId, p_vendor_id: parsed.vendorId,
      p_expected_updated_at: parsed.expectedUpdatedAt,
      p_company_name: parsed.companyName, p_contact_name: parsed.contactName,
      p_phone: parsed.phone, p_email: parsed.email, p_is_active: parsed.isActive,
      p_categories: parsed.categories,
      p_areas: parsed.areas.map((area) => ({ area_code: area.areaCode, area_label: area.areaLabel })),
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || row.organization_id !== context.organizationId || row.id !== parsed.vendorId) {
      const conflict = error?.message?.includes("VENDOR_MASTER_CONFLICT") || error?.message?.includes("VENDOR_MASTER_REQUEST_CONFLICT");
      return { ok: false, conflict, message: conflict ? "別の更新が反映されています。再読み込みして確認してください。" : "業者情報を保存できませんでした。" };
    }
    revalidatePath("/admin/vendors");
    return { ok: true };
  } catch {
    return { ok: false, message: "業者情報を保存できませんでした。時間をおいて再試行してください。" };
  }
}
