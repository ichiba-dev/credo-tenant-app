"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext, staffAccessMessages } from "@/lib/supabase-auth/staff";

type Result = { ok: true } | { ok: false; message: string; loginRequired?: boolean };

export async function updateRepair(input: unknown): Promise<Result> {
  try {
    const context = await getStaffContext();
    if (!context.ok) return { ok: false, message: staffAccessMessages[context.reason], loginRequired: context.reason === "unauthenticated" };
    if (!context.canUpdate) return { ok: false, message: "閲覧専用のため更新できません。" };
    if (!input || typeof input !== "object") return { ok: false, message: "入力内容が不正です。" };
    const { id, kind, value } = input as Record<string, unknown>;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || typeof value !== "string" ||
        (kind !== "status" && kind !== "comment") ||
        (kind === "status" && !["受付", "手配中", "完了"].includes(value)) ||
        (kind === "comment" && value.length > 10000)) return { ok: false, message: "入力内容が不正です。" };

    const { supabase, organizationId } = context;
    let oldHistory: string | null = null;
    let changes: { status?: string; history?: string; staff_comment?: string };
    if (kind === "status") {
      const { data, error } = await supabase.from("repair_requests").select("history")
        .eq("organization_id", organizationId).eq("id", id).maybeSingle();
      if (error || !data) return { ok: false, message: "更新対象を確認できませんでした。" };
      oldHistory = data.history;
      changes = { status: value, history: (oldHistory ?? "") + `${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}　${value}\n` };
    } else {
      changes = { staff_comment: value };
    }
    let query = supabase.from("repair_requests").update(changes)
      .eq("organization_id", organizationId).eq("id", id);
    // 同時更新による履歴の消失を防ぐ。競合時も0件として再読み込みを案内する。
    if (kind === "status") query = oldHistory === null ? query.is("history", null) : query.eq("history", oldHistory);
    const { data: updated, error: updateError } = await query.select("id").maybeSingle();
    if (updateError || !updated) return { ok: false, message: "更新できませんでした。権限または更新競合を確認し、画面を再読み込みしてください。" };
    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, message: "処理に失敗しました。画面を再読み込みして保存状況をご確認ください。" };
  }
}
