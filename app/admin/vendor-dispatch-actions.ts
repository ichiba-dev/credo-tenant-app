"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { parseConfirmManualDispatchInput, parseSelectVendorInput } from "@/lib/vendor-dispatch";

export type SelectVendorResult = {
  ok: true;
  dispatchId: string;
} | {
  ok: false;
  message: string;
  loginRequired?: boolean;
  conflict?: boolean;
  duplicate?: boolean;
};

export async function selectRepairVendor(input: unknown): Promise<SelectVendorResult> {
  try {
    const context = await getStaffContext();
    if (!context.ok) return { ok: false, message: "ログイン情報を確認できません。",
      loginRequired: context.reason === "unauthenticated" };
    if (!context.canUpdate) return { ok: false, message: "閲覧権限では業者を手配できません。" };
    const parsed = parseSelectVendorInput(input);
    if (!parsed) return { ok: false, message: "業者と手配内容を確認してください。" };

    const [repairResult, vendorResult] = await Promise.all([
      context.supabase.from("repair_requests").select("id,organization_id")
        .eq("id", parsed.repairId).eq("organization_id", context.organizationId).maybeSingle(),
      context.supabase.from("repair_vendors").select("id,organization_id,is_active")
        .eq("id", parsed.vendorId).eq("organization_id", context.organizationId)
        .eq("is_active", true).maybeSingle(),
    ]);
    const repair = repairResult.data;
    const vendor = vendorResult.data;
    if (repairResult.error || vendorResult.error || !repair || !vendor ||
        repair.organization_id !== context.organizationId ||
        vendor.organization_id !== context.organizationId || vendor.is_active !== true) {
      return { ok: false, message: "対象の案件または業者を確認できません。再読み込みしてください。" };
    }

    const { data: existing, error: existingError } = await context.supabase
      .from("repair_vendor_dispatches").select("id,status,selected_at")
      .eq("organization_id", context.organizationId).eq("repair_request_id", parsed.repairId)
      .eq("vendor_id", parsed.vendorId).order("selected_at", { ascending: false }).limit(1).maybeSingle();
    if (existingError) return { ok: false, message: "既存の手配履歴を確認できませんでした。再読み込みしてください。" };
    if (existing && !parsed.confirmDuplicate) return { ok: false, duplicate: true,
      message: "この案件には同じ業者の手配履歴があります。履歴を確認してから追加手配を確定してください。" };

    const { data, error } = await context.supabase.rpc("select_repair_vendor", {
      p_org: context.organizationId,
      p_repair: parsed.repairId,
      p_vendor: parsed.vendorId,
      p_instructions: parsed.instructions,
      p_request_id: parsed.requestId,
    });
    const row = Array.isArray(data) ? data[0] : data;
    const conflict = error?.message?.includes("VENDOR_REQUEST_CONFLICT") ?? false;
    if (error || !row || row.organization_id !== context.organizationId ||
        row.repair_request_id !== parsed.repairId || row.vendor_id !== parsed.vendorId ||
        row.assigned_by !== context.userId || row.request_id !== parsed.requestId ||
        row.instructions !== parsed.instructions || row.status !== "candidate" || typeof row.id !== "string") {
      return { ok: false, conflict, message: conflict
        ? "同じ受付番号で異なる手配内容が送信されました。画面を閉じてやり直してください。"
        : "業者を手配できませんでした。再読み込みして保存状況を確認してください。" };
    }
    revalidatePath("/admin");
    return { ok: true, dispatchId: row.id };
  } catch {
    return { ok: false, message: "業者を手配できませんでした。時間をおいて再試行してください。" };
  }
}

export type ConfirmManualDispatchResult = {
  ok: true;
  messageId: string;
} | {
  ok: false;
  message: string;
  loginRequired?: boolean;
  conflict?: boolean;
};

export async function confirmManualVendorDispatch(input: unknown): Promise<ConfirmManualDispatchResult> {
  try {
    const context = await getStaffContext();
    if (!context.ok) return { ok: false, message: "ログイン情報を確認できません。",
      loginRequired: context.reason === "unauthenticated" };
    if (!context.canUpdate) return { ok: false, message: "閲覧権限では業者への手配を確定できません。" };
    const parsed = parseConfirmManualDispatchInput(input);
    if (!parsed) return { ok: false, message: "送信内容と外部連絡済みの確認を見直してください。" };

    const { data: dispatch, error: dispatchError } = await context.supabase
      .from("repair_vendor_dispatches")
      .select("id,organization_id,repair_request_id,vendor_id,status")
      .eq("organization_id", context.organizationId).eq("repair_request_id", parsed.repairId)
      .eq("id", parsed.dispatchId).maybeSingle();
    if (dispatchError || !dispatch || dispatch.organization_id !== context.organizationId ||
        dispatch.repair_request_id !== parsed.repairId ||
        !["candidate", "dispatched"].includes(dispatch.status)) {
      return { ok: false, message: "対象の手配候補を確認できません。再読み込みしてください。" };
    }
    const { data: vendor, error: vendorError } = await context.supabase.from("repair_vendors")
      .select("id,organization_id,company_name,contact_name,phone,email")
      .eq("organization_id", context.organizationId).eq("id", dispatch.vendor_id).maybeSingle();
    if (vendorError || !vendor || vendor.organization_id !== context.organizationId ||
        vendor.id !== dispatch.vendor_id) {
      return { ok: false, message: "送信先の業者情報を確認できません。再読み込みしてください。" };
    }
    const recipientLabel = `${vendor.company_name} ${vendor.contact_name}`.trim();
    const recipientAddress = [vendor.phone, vendor.email].filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0).join(" / ") || null;
    const { data, error } = await createServerSupabaseClient().rpc("confirm_vendor_dispatch_manual", {
      p_org: context.organizationId,
      p_dispatch: parsed.dispatchId,
      p_actor: context.userId,
      p_request_id: parsed.requestId,
      p_message_body: parsed.messageBody,
      p_recipient_label: recipientLabel,
      p_recipient_address: recipientAddress,
    });
    const row = Array.isArray(data) ? data[0] : data;
    const conflict = error?.message?.includes("VENDOR_DISPATCH_MESSAGE_REQUEST_CONFLICT") ||
      error?.message?.includes("VENDOR_DISPATCH_MESSAGE_STATUS_CONFLICT");
    if (error || !row || row.organization_id !== context.organizationId ||
        row.dispatch_id !== parsed.dispatchId || row.request_id !== parsed.requestId ||
        row.sent_by !== context.userId || row.channel !== "manual" ||
        row.delivery_status !== "manual_confirmed" || typeof row.id !== "string") {
      return { ok: false, conflict, message: conflict
        ? "手配状態または同じ受付番号の内容が更新されています。再読み込みして確認してください。"
        : "手配済みとして記録できませんでした。送信履歴を確認してから再試行してください。" };
    }
    revalidatePath("/admin");
    return { ok: true, messageId: row.id };
  } catch {
    return { ok: false, message: "手配済みとして記録できませんでした。時間をおいて再試行してください。" };
  }
}
