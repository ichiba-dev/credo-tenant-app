import "server-only";
import { revalidatePath } from "next/cache";
import { parseRepairId } from "@/lib/repair-id";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { pushLineText } from "./line-push";

type LineStatus = "not_linked" | "accepted" | "sending" | "failed" | "expired" | "unknown";
export type StaffMessageResult = { ok: true; lineStatus: LineStatus } | { ok: false; message: string; loginRequired?: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function single(value: unknown) { return Array.isArray(value) ? value.length === 1 ? value[0] : null : value; }
const deadline = () => AbortSignal.timeout(8_000);

export async function saveStaffReply(repairIdValue: string, messageValue: string, requestId: string): Promise<StaffMessageResult> {
  let saved = false;
  try {
    const staff = await getStaffContext();
    if (!staff.ok) return { ok: false, loginRequired: staff.reason === "unauthenticated", message: "スタッフ認証を確認できません。" };
    if (!staff.canUpdate) return { ok: false, message: "閲覧専用ユーザーは返信できません。" };
    const repairId = typeof repairIdValue === "string" ? parseRepairId(repairIdValue) : null;
    const message = typeof messageValue === "string" ? messageValue.trim() : "";
    if (repairId === null || message.length < 1 || message.length > 2000 || typeof requestId !== "string" || !uuid.test(requestId))
      return { ok: false, message: "返信内容または送信操作を確認できません。返信を1〜2000文字で入力してください。" };
    const db = createServerSupabaseClient();
    const { data: repair, error } = await db.from("repair_requests").select("id, organization_id, tenant_account_id")
      .eq("id", repairId).eq("organization_id", staff.organizationId).abortSignal(deadline()).maybeSingle();
    if (error || !repair || repair.id !== repairId || repair.organization_id !== staff.organizationId || !repair.tenant_account_id)
      return { ok: false, message: "返信先の入居者案件を確認できません。" };
    const { data: tenant, error: tenantError } = await db.from("tenant_accounts").select("id, organization_id")
      .eq("id", repair.tenant_account_id).eq("organization_id", staff.organizationId).eq("is_active", true)
      .abortSignal(deadline()).maybeSingle();
    if (tenantError || !tenant || tenant.id !== repair.tenant_account_id || tenant.organization_id !== staff.organizationId)
      return { ok: false, message: "返信先の入居者を確認できません。" };
    const created = await db.rpc("create_staff_reply_with_line_push", {
      p_organization_id: staff.organizationId, p_repair_request_id: repairId, p_staff_auth_user_id: staff.userId,
      p_request_id: requestId, p_message: message,
    }).abortSignal(deadline());
    const result = single(created.data);
    if (created.error || !record(result))
      return { ok: false, message: "返信の保存結果を確認できませんでした。同じ返信操作で再確認してください。" };
    const { data: stored, error: storedError } = await db.from("repair_messages")
      .select("id, organization_id, repair_request_id, sender_type, staff_auth_user_id, staff_reply_request_id, message")
      .eq("organization_id", staff.organizationId).eq("repair_request_id", repairId).eq("sender_type", "staff")
      .eq("staff_auth_user_id", staff.userId).eq("staff_reply_request_id", requestId)
      .abortSignal(deadline()).maybeSingle();
    if (storedError || !stored || typeof stored.id !== "string" || !uuid.test(stored.id) || stored.organization_id !== staff.organizationId ||
      stored.repair_request_id !== repairId || stored.staff_auth_user_id !== staff.userId || stored.staff_reply_request_id !== requestId ||
      stored.sender_type !== "staff" || stored.message !== message)
      return { ok: false, message: "保存済み返信と送信操作が一致しません。同じ返信内容で再確認してください。" };
    saved = true;
    revalidatePath("/admin"); revalidatePath(`/tenant/repairs/${repairId}`);
    const status = result.line_status;
    if (["not_linked", "accepted", "sending", "failed", "expired"].includes(String(status)))
      return { ok: true, lineStatus: status as LineStatus };
    if ((status !== "pending" && status !== "unknown") || typeof result.line_push_id !== "string" || !uuid.test(result.line_push_id))
      return { ok: true, lineStatus: "unknown" };
    const { data: push, error: pushError } = await db.from("staff_line_pushes").select("id, organization_id, repair_message_id")
      .eq("id", result.line_push_id).eq("organization_id", staff.organizationId).eq("repair_message_id", stored.id)
      .abortSignal(deadline()).maybeSingle();
    if (pushError || push?.id !== result.line_push_id || push.organization_id !== staff.organizationId || push.repair_message_id !== stored.id)
      return { ok: true, lineStatus: "unknown" };
    const claimed = await db.rpc("claim_staff_line_push", { p_line_push_id: push.id }).abortSignal(deadline());
    if (claimed.error) return { ok: true, lineStatus: "unknown" };
    if (Array.isArray(claimed.data) && !claimed.data.length) return { ok: true, lineStatus: "sending" };
    const claim = single(claimed.data);
    if (!record(claim) || claim.line_push_id !== push.id || claim.repair_message_id !== stored.id ||
      typeof claim.recipient_line_user_id !== "string" || !claim.recipient_line_user_id.trim() ||
      typeof claim.retry_key !== "string" || !uuid.test(claim.retry_key) || claim.message !== stored.message)
      return { ok: true, lineStatus: "unknown" };
    const outcome = await pushLineText(claim.recipient_line_user_id, stored.message, claim.retry_key);
    const finished = await db.rpc("finish_staff_line_push", { p_line_push_id: push.id, p_result: outcome }).abortSignal(deadline());
    return { ok: true, lineStatus: finished.error ? "unknown" : outcome };
  } catch {
    return saved ? { ok: true, lineStatus: "unknown" } : { ok: false, message: "返信結果を確認できませんでした。同じ返信操作で再確認してください。" };
  }
}
