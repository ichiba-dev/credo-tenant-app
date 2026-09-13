"use server";

import { revalidatePath } from "next/cache";
import { parseRepairId } from "@/lib/repair-id";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTenantContext } from "@/lib/supabase-auth/tenant";

export type TenantMessageResult = { ok: true } | { ok: false; message: string; loginRequired?: boolean };

export async function submitTenantMessage(repairIdValue: string, messageValue: string): Promise<TenantMessageResult> {
  const tenantContext = await getTenantContext();
  if (!tenantContext.ok) return {
    ok: false,
    loginRequired: tenantContext.reason === "unauthenticated",
    message: tenantContext.reason === "unauthenticated" ? "ログインし直してください。" : "入居者アカウントを確認できません。",
  };

  const repairId = parseRepairId(repairIdValue);
  const message = typeof messageValue === "string" ? messageValue.trim() : "";
  if (repairId === null || message.length < 1 || message.length > 2000) {
    return { ok: false, message: "メッセージを1〜2000文字で入力してください。" };
  }

  try {
    const { tenantId, organizationId } = tenantContext.tenant;
    const supabase = createServerSupabaseClient();
    const { data: repair, error: repairError } = await supabase.from("repair_requests")
      .select("id, organization_id, tenant_account_id")
      .eq("id", repairId)
      .eq("tenant_account_id", tenantId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (repairError || !repair || repair.id !== repairId || repair.organization_id !== organizationId || repair.tenant_account_id !== tenantId) {
      return { ok: false, message: "対象の修理依頼を確認できません。" };
    }

    const { data: inserted, error: insertError } = await supabase.from("repair_messages").insert({
      organization_id: organizationId,
      repair_request_id: repair.id,
      sender_type: "tenant",
      tenant_account_id: tenantId,
      staff_auth_user_id: null,
      message,
    }).select("id").single();
    if (insertError || !inserted?.id) return { ok: false, message: "メッセージを送信できませんでした。" };

    revalidatePath(`/tenant/repairs/${repair.id}`);
    return { ok: true };
  } catch {
    return { ok: false, message: "メッセージを送信できませんでした。時間をおいて再度お試しください。" };
  }
}
