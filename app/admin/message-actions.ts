"use server";

import { revalidatePath } from "next/cache";
import { parseRepairId } from "@/lib/repair-id";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export type StaffMessageResult = { ok: true } | { ok: false; message: string; loginRequired?: boolean };

export async function submitStaffMessage(repairIdValue: string, messageValue: string): Promise<StaffMessageResult> {
  const staff = await getStaffContext();
  if (!staff.ok) return { ok: false, loginRequired: staff.reason === "unauthenticated", message: "スタッフ認証を確認できません。" };
  if (!staff.canUpdate) return { ok: false, message: "閲覧専用ユーザーは返信できません。" };
  const repairId = parseRepairId(repairIdValue);
  const message = typeof messageValue === "string" ? messageValue.trim() : "";
  if (repairId === null || message.length < 1 || message.length > 2000) return { ok: false, message: "返信を1〜2000文字で入力してください。" };

  try {
    const supabase = createServerSupabaseClient();
    const { data: repair, error } = await supabase.from("repair_requests")
      .select("id, organization_id, tenant_account_id")
      .eq("id", repairId)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (error || !repair || repair.id !== repairId || repair.organization_id !== staff.organizationId || !repair.tenant_account_id) {
      return { ok: false, message: "返信先の入居者案件を確認できません。" };
    }

    const { data: inserted, error: insertError } = await supabase.from("repair_messages").insert({
      organization_id: staff.organizationId,
      repair_request_id: repair.id,
      sender_type: "staff",
      tenant_account_id: null,
      staff_auth_user_id: staff.userId,
      message,
    }).select("id").single();
    if (insertError || !inserted?.id) return { ok: false, message: "返信を送信できませんでした。" };
    revalidatePath("/admin");
    revalidatePath(`/tenant/repairs/${repair.id}`);
    return { ok: true };
  } catch {
    return { ok: false, message: "返信を送信できませんでした。時間をおいて再度お試しください。" };
  }
}
