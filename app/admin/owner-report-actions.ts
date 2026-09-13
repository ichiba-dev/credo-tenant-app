"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext, staffAccessMessages } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type Result =
  | { ok: true; alreadyExists?: boolean }
  | { ok: false; message: string; loginRequired?: boolean };

function validRepairId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export async function createOwnerReport(input: unknown): Promise<Result> {
  try {
    const staff = await getStaffContext();
    if (!staff.ok) {
      return {
        ok: false,
        message: staffAccessMessages[staff.reason],
        loginRequired: staff.reason === "unauthenticated",
      };
    }
    if (!staff.canUpdate) return { ok: false, message: "閲覧専用ユーザーはオーナー報告を作成できません。" };
    if (!input || typeof input !== "object") return { ok: false, message: "入力内容が正しくありません。" };

    const { repairId, summary } = input as Record<string, unknown>;
    if (!validRepairId(repairId) || typeof summary !== "string" || summary.trim().length === 0 || summary.length > 5000) {
      return { ok: false, message: "報告内容を1〜5,000文字で入力してください。" };
    }

    const service = createServerSupabaseClient();
    const { data: repair, error: repairError } = await service.from("repair_requests")
      .select("id, organization_id, property_id")
      .eq("id", repairId)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (repairError || !repair || repair.organization_id !== staff.organizationId || !repair.property_id) {
      return { ok: false, message: "対象案件または物件を確認できません。" };
    }

    const { data: existing, error: existingError } = await service.from("owner_reports")
      .select("id")
      .eq("repair_request_id", repair.id)
      .eq("organization_id", staff.organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) return { ok: false, message: "既存のオーナー報告を確認できません。" };
    if (existing) {
      revalidatePath("/admin");
      return { ok: true, alreadyExists: true };
    }

    const { data: propertyOwners, error: ownersError } = await service.from("property_owners")
      .select("owner_id, organization_id, valid_from, valid_to")
      .eq("property_id", repair.property_id)
      .eq("organization_id", staff.organizationId)
      .eq("is_active", true);
    if (ownersError || !propertyOwners) return { ok: false, message: "物件オーナーを確認できません。" };

    const today = new Date().toISOString().slice(0, 10);
    const ownerIds = [...new Set(propertyOwners
      .filter((row) => row.organization_id === staff.organizationId &&
        (!row.valid_from || row.valid_from <= today) && (!row.valid_to || row.valid_to >= today))
      .map((row) => row.owner_id as string)
      .filter(Boolean))];
    if (ownerIds.length === 0) return { ok: false, message: "この物件に有効なオーナーが登録されていません。" };

    const { data: report, error: reportError } = await service.from("owner_reports").insert({
      organization_id: staff.organizationId,
      repair_request_id: repair.id,
      repair_summary: summary.trim(),
      approval_required: true,
      status: "draft",
      created_by: staff.userId,
    }).select("id").single();
    if (reportError || !report) return { ok: false, message: "オーナー報告を作成できませんでした。" };

    const cleanup = async () => {
      await service.from("owner_approvals").delete().eq("owner_report_id", report.id).eq("organization_id", staff.organizationId);
      await service.from("owner_report_recipients").delete().eq("owner_report_id", report.id).eq("organization_id", staff.organizationId);
      await service.from("owner_reports").delete().eq("id", report.id).eq("organization_id", staff.organizationId);
    };

    const recipients = ownerIds.map((ownerId) => ({
      organization_id: staff.organizationId,
      owner_report_id: report.id,
      owner_id: ownerId,
      is_approval_required: true,
    }));
    const { error: recipientError } = await service.from("owner_report_recipients").insert(recipients);
    if (recipientError) {
      await cleanup();
      return { ok: false, message: "報告先オーナーを登録できませんでした。再読み込みして状態をご確認ください。" };
    }

    const approvals = ownerIds.map((ownerId) => ({
      organization_id: staff.organizationId,
      owner_report_id: report.id,
      owner_id: ownerId,
      decision: "pending",
    }));
    const { error: approvalError } = await service.from("owner_approvals").insert(approvals);
    if (approvalError) {
      await cleanup();
      return { ok: false, message: "オーナー承認の準備に失敗しました。再読み込みして状態をご確認ください。" };
    }

    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, message: "オーナー報告の作成に失敗しました。再読み込みして状態をご確認ください。" };
  }
}
