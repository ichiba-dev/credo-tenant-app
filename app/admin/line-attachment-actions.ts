"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { parseRepairId } from "@/lib/repair-id";
import type { LineRepairCandidate } from "./types";

type Failure = { ok: false; message: string; loginRequired?: boolean };
const invalid: Failure = { ok: false, message: "対象を確認できませんでした。再読み込みしてください。" };
const assigned: Failure = { ok: false, message: "すでに紐づけ済みです。再読み込みしてください。" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorizedAttachment(messageId: unknown) {
  const context = await getStaffContext();
  if (!context.ok) return { failure: { ok: false, message: "スタッフ認証を確認できませんでした。", loginRequired: context.reason === "unauthenticated" } as Failure };
  if (!context.canUpdate) return { failure: { ok: false, message: "閲覧専用のため紐づけできません。" } as Failure };
  if (typeof messageId !== "string" || !uuid.test(messageId)) return { failure: invalid };
  const db = createServerSupabaseClient();
  const signal = AbortSignal.timeout(8_000);
  const { data: message, error } = await db.from("tenant_line_attachments")
    .select("id, organization_id, tenant_account_id, repair_request_id, media_type")
    .eq("id", messageId).eq("organization_id", context.organizationId).abortSignal(signal).maybeSingle();
  if (error || !message || message.id !== messageId || message.organization_id !== context.organizationId ||
    !message.tenant_account_id || !["image", "pdf"].includes(message.media_type)) return { failure: invalid };
  if (message.repair_request_id !== null) return { failure: assigned };
  return { context, db, signal, message };
}

export async function getLineAttachmentRepairCandidates(messageId: unknown): Promise<Failure | { ok: true; repairs: LineRepairCandidate[] }> {
  try {
    const scope = await authorizedAttachment(messageId);
    if (scope.failure) return scope.failure;
    const { context, db, signal, message } = scope;
    const { data, error } = await db.from("repair_requests")
      .select("id, organization_id, tenant_account_id, property_name, room_number, category, description, created_at, status")
      .eq("organization_id", context.organizationId).eq("tenant_account_id", message.tenant_account_id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).abortSignal(signal);
    if (error || !data || data.some(repair => repair.organization_id !== context.organizationId ||
      repair.tenant_account_id !== message.tenant_account_id || parseRepairId(String(repair.id)) === null)) return invalid;
    return { ok: true, repairs: data.map(repair => ({ id: repair.id, property_name: repair.property_name,
      room_number: repair.room_number, category: repair.category, description: (repair.description || "").slice(0, 120),
      created_at: repair.created_at, status: repair.status })) };
  } catch { return invalid; }
}

export async function assignLineAttachment(messageId: unknown, repairIdValue: unknown): Promise<Failure | { ok: true }> {
  try {
    const scope = await authorizedAttachment(messageId);
    if (scope.failure) return scope.failure;
    const repairId = typeof repairIdValue === "string" ? parseRepairId(repairIdValue) : null;
    if (repairId === null) return invalid;
    const { context, db, signal, message } = scope;
    const { data: repair, error } = await db.from("repair_requests")
      .select("id, organization_id, tenant_account_id").eq("id", repairId)
      .eq("organization_id", context.organizationId).eq("tenant_account_id", message.tenant_account_id)
      .abortSignal(signal).maybeSingle();
    if (error || !repair || repair.id !== repairId || repair.organization_id !== context.organizationId ||
      repair.tenant_account_id !== message.tenant_account_id) return invalid;
    const { data: updated, error: updateError } = await db.from("tenant_line_attachments")
      .update({ repair_request_id: repairId }).eq("id", message.id)
      .eq("organization_id", context.organizationId).eq("tenant_account_id", message.tenant_account_id)
      .is("repair_request_id", null)
      .select("id").abortSignal(signal).maybeSingle();
    if (updateError) return invalid;
    if (!updated) return assigned;
    revalidatePath("/admin");
    return { ok: true };
  } catch { return invalid; }
}
