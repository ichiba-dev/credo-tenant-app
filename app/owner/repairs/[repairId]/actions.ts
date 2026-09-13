"use server";

import { revalidatePath } from "next/cache";

import { createAuthServerClient } from "@/lib/supabase-auth/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { parseRepairId } from "@/lib/repair-id";

export type ApprovalState = {
  status: "idle" | "error" | "success" | "answered";
  message: string;
};

export async function submitApproval(
  rawRepairId: string,
  reportId: string,
  _previousState: ApprovalState,
  formData: FormData,
): Promise<ApprovalState> {
  const failure = (message: string): ApprovalState => ({ status: "error", message });
  let result: ApprovalState;

  try {
    const auth = await createAuthServerClient();
    const { data: { user }, error: authError } = await auth.auth.getUser();
    if (authError || !user) {
      return failure("ログインの有効期限が切れています。ログインし直してください。");
    }

    const decision = formData.get("decision");
    const rawComment = formData.get("comment");
    const comment = typeof rawComment === "string" ? rawComment.trim() : "";
    const repairId = typeof rawRepairId === "string" ? parseRepairId(rawRepairId) : null;
    if (repairId === null || typeof reportId !== "string" || !reportId || reportId.length > 128 ||
        (decision !== "approved" && decision !== "consultation")) {
      return failure("回答内容が正しくありません。画面を再読み込みしてください。");
    }
    if (decision === "consultation" && (!comment || comment.length > 2000)) {
      return failure("相談内容を1〜2,000文字で入力してください。空白だけでは送信できません。");
    }

    const supabase = createServerSupabaseClient();
    // owner_id・decided_byはクライアントの値を使わず、検証済みユーザーから決定する。
    const { data: owner, error: ownerError } = await supabase
      .from("owners")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (ownerError || !owner) return failure("この報告に回答する権限がありません。");

    const { data: recipient, error: recipientError } = await supabase
      .from("owner_report_recipients")
      .select("owner_report_id, owner_id, organization_id")
      .eq("owner_report_id", reportId)
      .eq("owner_id", owner.id)
      .maybeSingle();
    if (recipientError || !recipient) return failure("この報告に回答する権限がありません。");

    const { data: report, error: reportError } = await supabase
      .from("owner_reports")
      .select("id, repair_request_id, organization_id")
      .eq("id", reportId)
      .eq("repair_request_id", repairId)
      .maybeSingle();
    if (reportError || !report) return failure("この報告に回答する権限がありません。");
    if (recipient.owner_report_id !== report.id || recipient.owner_id !== owner.id || recipient.organization_id !== report.organization_id) {
      return failure("この報告に回答する権限がありません。");
    }

    const { data: repair, error: repairError } = await supabase
      .from("repair_requests")
      .select("id, organization_id")
      .eq("id", repairId)
      .eq("organization_id", report.organization_id)
      .maybeSingle();
    if (repairError || !repair || repair.id !== report.repair_request_id || repair.organization_id !== report.organization_id) {
      return failure("この報告に回答する権限がありません。");
    }

    const { data: approval, error: approvalError } = await supabase
      .from("owner_approvals")
      .select("decision")
      .eq("owner_report_id", report.id)
      .eq("owner_id", owner.id)
      .eq("organization_id", report.organization_id)
      .maybeSingle();
    if (approvalError) return failure("回答状況を確認できませんでした。時間をおいて再試行してください。");
    if (!approval) return failure("回答の受付準備ができていません。管理会社へお問い合わせください。");

    if (approval.decision !== "pending") {
      result = { status: "answered", message: "この報告は回答済みです。回答状況をご確認ください。" };
    } else {
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await supabase
        .from("owner_approvals")
        .update({
          decision,
          ...(decision === "consultation" ? { comment } : {}),
          decided_by: user.id,
          decided_at: now,
          updated_at: now,
        })
        .eq("owner_report_id", report.id)
        .eq("owner_id", owner.id)
        .eq("organization_id", report.organization_id)
        // SELECT後に別タブから回答されても、DB側で上書きを防ぐ。
        .eq("decision", "pending")
        .select("decision")
        .maybeSingle();

      if (updateError) return failure("回答を保存できませんでした。画面を再読み込みして回答状況をご確認ください。");
      result = updated
        ? { status: "success", message: decision === "approved" ? "承認しました。" : "相談内容を送信しました。" }
        : { status: "answered", message: "回答状況が変更されています。最新の表示をご確認ください。" };
    }
  } catch {
    return failure("通信に失敗しました。画面を再読み込みして回答状況をご確認ください。");
  }

  revalidatePath(`/owner/repairs/${rawRepairId}`);
  return result;
}
