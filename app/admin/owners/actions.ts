"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeOwnerAuthEmail } from "@/lib/owner-auth-state";

type ActionResult = { ok: true; status: string } | { ok: false; message: string; loginRequired?: boolean };
type Intent = "link_or_invite" | "correct_link";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getMutationContext() {
  const staff = await getStaffContext();
  if (!staff.ok) return { ok: false as const, message: "ログイン情報を確認できません。", loginRequired: staff.reason === "unauthenticated" };
  const { data: membership, error } = await staff.supabase.from("organization_members")
    .select("role").eq("organization_id", staff.organizationId).eq("auth_user_id", staff.userId)
    .eq("is_active", true).in("role", ["admin", "manager"]).maybeSingle();
  if (error || !membership || !["admin", "manager"].includes(membership.role)) {
    return { ok: false as const, message: "オーナーAuthを変更する権限がありません。" };
  }
  return { ok: true as const, staff };
}

function validInput(input: unknown): input is {
  intent: Intent;
  ownerId: string;
  requestId: string;
  targetAuthUserId?: string;
  expectedAuthUserId?: string | null;
  confirmed?: boolean;
} {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  if (!(value.intent === "link_or_invite" || value.intent === "correct_link") ||
    typeof value.ownerId !== "string" || !uuidPattern.test(value.ownerId) ||
    typeof value.requestId !== "string" || !uuidPattern.test(value.requestId)) return false;
  if (value.targetAuthUserId !== undefined && (typeof value.targetAuthUserId !== "string" || !uuidPattern.test(value.targetAuthUserId))) return false;
  if (value.expectedAuthUserId !== undefined && value.expectedAuthUserId !== null &&
    (typeof value.expectedAuthUserId !== "string" || !uuidPattern.test(value.expectedAuthUserId))) return false;
  return value.intent !== "correct_link" || (value.confirmed === true &&
    typeof value.expectedAuthUserId === "string" && value.targetAuthUserId !== undefined);
}

async function recordOperation(service: ReturnType<typeof createServerSupabaseClient>, organizationId: string,
  requestId: string, changes: Record<string, unknown>) {
  return service.from("owner_auth_operations").update(changes)
    .eq("organization_id", organizationId).eq("request_id", requestId).select("request_id,status").maybeSingle();
}

async function saveOwnerLink(service: ReturnType<typeof createServerSupabaseClient>, organizationId: string,
  ownerId: string, expectedEmail: string, previousAuthUserId: string | null, targetAuthUserId: string) {
  let query = service.from("owners").update({ auth_user_id: targetAuthUserId })
    .eq("organization_id", organizationId).eq("id", ownerId).eq("email", expectedEmail).eq("is_active", true);
  query = previousAuthUserId === null ? query.is("auth_user_id", null) : query.eq("auth_user_id", previousAuthUserId);
  return query.select("id,auth_user_id").maybeSingle();
}

async function verifyTarget(service: ReturnType<typeof createServerSupabaseClient>, organizationId: string,
  ownerId: string, ownerEmail: string, targetAuthUserId: string) {
  const { data: target, error: targetError } = await service.auth.admin.getUserById(targetAuthUserId);
  if (targetError || !target?.user || target.user.id !== targetAuthUserId) return { ok: false as const, code: "AUTH_USER_NOT_FOUND" };
  if (normalizeOwnerAuthEmail(target.user.email) !== ownerEmail) return { ok: false as const, code: "EMAIL_MISMATCH" };
  const { data: sameEmail, error: emailError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (emailError || !sameEmail) return { ok: false as const, code: "AUTH_USER_SCAN_FAILED" };
  let matchingUsers = sameEmail.users.filter((user) => normalizeOwnerAuthEmail(user.email) === ownerEmail);
  for (let page = 2; matchingUsers.length < 2; page++) {
    if (sameEmail.users.length < 1000 || page > 100) break;
    const next = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (next.error) return { ok: false as const, code: "AUTH_USER_SCAN_FAILED" };
    matchingUsers = matchingUsers.concat(next.data.users.filter((user) => normalizeOwnerAuthEmail(user.email) === ownerEmail));
    if (next.data.users.length < 1000) break;
  }
  if (matchingUsers.length !== 1 || matchingUsers[0].id !== targetAuthUserId) return { ok: false as const, code: "DUPLICATE_AUTH_EMAIL" };
  const { data: usages, error: usageError } = await service.from("owners").select("id,organization_id")
    .eq("auth_user_id", targetAuthUserId);
  if (usageError || !usages) return { ok: false as const, code: "OWNER_USAGE_CHECK_FAILED" };
  if (usages.some((owner) => owner.id !== ownerId)) return { ok: false as const, code: "AUTH_USED_BY_ANOTHER_OWNER" };
  const { data: scopedOwner, error: ownerError } = await service.from("owners").select("id,organization_id")
    .eq("id", ownerId).eq("organization_id", organizationId).maybeSingle();
  if (ownerError || !scopedOwner || scopedOwner.organization_id !== organizationId) return { ok: false as const, code: "OWNER_SCOPE_CHANGED" };
  return { ok: true as const, user: target.user };
}

export async function linkOrInviteOwner(input: unknown): Promise<ActionResult> {
  try {
    if (!validInput(input) || input.intent !== "link_or_invite") return { ok: false, message: "入力内容を確認してください。" };
    const context = await getMutationContext();
    if (!context.ok) return { ok: false, message: context.message, loginRequired: context.loginRequired };
    const { staff } = context;
    const service = createServerSupabaseClient();
    const { data: existingOperation } = await service.from("owner_auth_operations").select("request_id,owner_id,operation_type,requested_email,status,target_auth_user_id")
      .eq("organization_id", staff.organizationId).eq("request_id", input.requestId).maybeSingle();
    const { data: owner, error: ownerError } = await service.from("owners").select("id,name,email,is_active,auth_user_id,organization_id")
      .eq("organization_id", staff.organizationId).eq("id", input.ownerId).maybeSingle();
    if (ownerError || !owner || owner.organization_id !== staff.organizationId) return { ok: false, message: "対象オーナーを確認できません。" };
    if (!owner.is_active) return { ok: false, message: "無効なオーナーは操作できません。" };
    const email = normalizeOwnerAuthEmail(owner.email);
    if (!email) return { ok: false, message: "登録メールが空のため操作できません。" };
    if (existingOperation) {
      if (existingOperation.owner_id !== owner.id || existingOperation.operation_type !== "link_existing" && existingOperation.operation_type !== "invite" ||
        normalizeOwnerAuthEmail(existingOperation.requested_email) !== email) {
        return { ok: false, message: "このrequest_idは別のAuth操作で使用済みです。" };
      }
      if (existingOperation.status === "completed") {
        return owner.auth_user_id === existingOperation.target_auth_user_id
          ? { ok: true, status: "already_completed" }
          : { ok: false, message: "記録済み操作後にAuth連携が変更されています。現在状態を確認してください。" };
      }
      if (existingOperation.status === "needs_review" && existingOperation.target_auth_user_id) {
        return retryOwnerAuthOperation(input.requestId);
      }
      return { ok: false, message: "このrequest_idの操作が進行中です。新しいAuthを作成せず監査状態を確認してください。" };
    }

    const { data: peerOwners, error: peerError } = await service.from("owners").select("id,email")
      .eq("organization_id", staff.organizationId);
    if (peerError || !peerOwners || peerOwners.some((peer) => peer.id !== owner.id && normalizeOwnerAuthEmail(peer.email) === email)) {
      return { ok: false, message: "同一組織に同じ登録メールがあります。重複を解消してから操作してください。" };
    }
    const { data: operations, error: operationError } = await service.from("owner_auth_operations").select("status")
      .eq("organization_id", staff.organizationId).eq("owner_id", owner.id);
    if (operationError || !operations) return { ok: false, message: "監査状態を確認できません。" };
    if (operations.some((operation) => ["started", "auth_created_db_pending", "needs_review"].includes(operation.status))) {
      return { ok: false, message: "未解決のAuth操作があります。既知のAuthユーザーIDで再試行してください。" };
    }
    if (owner.auth_user_id) return { ok: false, message: "既存のAuth連携は自動変更できません。明示的な訂正操作を使用してください。" };
    if (input.targetAuthUserId || input.expectedAuthUserId || input.confirmed) return { ok: false, message: "未連携操作の入力が不正です。" };

    const { data: allUsers, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError || !allUsers) return { ok: false, message: "Authユーザーを確認できません。" };
    let matches = allUsers.users.filter((user) => normalizeOwnerAuthEmail(user.email) === email);
    for (let page = 2; allUsers.users.length === 1000 && matches.length < 2 && page <= 100; page++) {
      const next = await service.auth.admin.listUsers({ page, perPage: 1000 });
      if (next.error) return { ok: false, message: "Authユーザーを確認できません。" };
      matches = matches.concat(next.data.users.filter((user) => normalizeOwnerAuthEmail(user.email) === email));
      if (next.data.users.length < 1000) break;
    }
    if (matches.length > 1) return { ok: false, message: "Authに同じメールが複数あります。" };
    const existing = matches[0] ?? null;
    const { data: used, error: usedError } = existing
      ? await service.from("owners").select("id").eq("auth_user_id", existing.id)
      : { data: [], error: null };
    if (usedError || !used || used.some((row) => row.id !== owner.id)) return { ok: false, message: "一致するAuthユーザーは別オーナーで使用中です。" };

    const operationType = existing ? "link_existing" : "invite";
    const { error: insertError } = await service.from("owner_auth_operations").insert({
      organization_id: staff.organizationId,
      owner_id: owner.id,
      request_id: input.requestId,
      operation_type: operationType,
      requested_email: owner.email,
      previous_auth_user_id: null,
      target_auth_user_id: existing?.id ?? null,
      status: "started",
      actor_auth_user_id: staff.userId,
    });
    if (insertError) return { ok: false, message: "操作を監査記録できません。" };

    let target = existing;
    if (!target) {
      const { data: invite, error: inviteError } = await service.auth.admin.inviteUserByEmail(owner.email);
      if (inviteError || !invite.user || normalizeOwnerAuthEmail(invite.user.email) !== email) {
        await recordOperation(service, staff.organizationId, input.requestId, { status: "needs_review", error_code: "AUTH_INVITE_OUTCOME_UNKNOWN" });
        return { ok: false, message: "Auth招待結果を確定できません。再招待せず、監査状態を確認してください。" };
      }
      target = invite.user;
    }

    const { data: pendingOperation, error: pendingError } = await recordOperation(service, staff.organizationId, input.requestId, {
      target_auth_user_id: target.id,
      status: "auth_created_db_pending",
      error_code: null,
    });
    if (pendingError || !pendingOperation) {
      await recordOperation(service, staff.organizationId, input.requestId, {
        target_auth_user_id: target.id, status: "needs_review", error_code: "AUDIT_TARGET_PERSIST_FAILED",
      });
      return { ok: false, message: "Authユーザーは作成済みですが監査targetを確定できません。DB連携せず要確認として保持しました。" };
    }
    const verify = await verifyTarget(service, staff.organizationId, owner.id, email, target.id);
    if (!verify.ok) {
      await recordOperation(service, staff.organizationId, input.requestId, { status: "needs_review", error_code: verify.code });
      return { ok: false, message: "Authユーザーの再検証に失敗しました。要確認として保持しました。" };
    }
    const { data: linked, error: linkError } = await saveOwnerLink(service, staff.organizationId, owner.id, owner.email, null, target.id);
    if (linkError || !linked || linked.auth_user_id !== target.id) {
      await recordOperation(service, staff.organizationId, input.requestId, { status: "needs_review", error_code: "OWNER_LINK_UPDATE_FAILED" });
      return { ok: false, message: "Authは確認済みですがDB連携に失敗しました。Authを削除せず要確認として保持しました。" };
    }
    const { data: completedOperation, error: completeError } = await recordOperation(service, staff.organizationId, input.requestId, {
      status: "completed", completed_at: new Date().toISOString(), error_code: null,
    });
    if (completeError || !completedOperation) {
      await recordOperation(service, staff.organizationId, input.requestId, { status: "needs_review", error_code: "AUDIT_COMPLETION_FAILED" });
      return { ok: false, message: "連携は反映済みですが監査完了を記録できません。再読み込みして監査状態をご確認ください。" };
    }
    revalidatePath("/admin/owners");
    return { ok: true, status: existing ? "linked" : "invited" };
  } catch {
    return { ok: false, message: "Auth操作を完了できませんでした。監査状態を確認してください。" };
  }
}

export async function correctOwnerAuthLink(input: unknown): Promise<ActionResult> {
  try {
    if (!validInput(input) || input.intent !== "correct_link" || !input.confirmed || !input.targetAuthUserId || !input.expectedAuthUserId) {
      return { ok: false, message: "訂正確認が不足しています。" };
    }
    const context = await getMutationContext();
    if (!context.ok) return { ok: false, message: context.message, loginRequired: context.loginRequired };
    const { staff } = context;
    const service = createServerSupabaseClient();
    const { data: owner, error } = await service.from("owners").select("id,email,is_active,auth_user_id,organization_id")
      .eq("organization_id", staff.organizationId).eq("id", input.ownerId).maybeSingle();
    if (error || !owner || owner.organization_id !== staff.organizationId) {
      return { ok: false, message: "対象オーナーを確認できません。再読み込みしてください。" };
    }
    if (!owner.is_active) return { ok: false, message: "無効なオーナーは訂正できません。" };
    const email = normalizeOwnerAuthEmail(owner.email);
    if (!email) return { ok: false, message: "登録メールが空のため訂正できません。" };
    const { data: existingOperation } = await service.from("owner_auth_operations").select("owner_id,operation_type,requested_email,status,target_auth_user_id")
      .eq("organization_id", staff.organizationId).eq("request_id", input.requestId).maybeSingle();
    if (existingOperation) {
      if (existingOperation.owner_id === owner.id && existingOperation.operation_type === "correct_link" &&
        normalizeOwnerAuthEmail(existingOperation.requested_email) === email &&
        existingOperation.target_auth_user_id === input.targetAuthUserId && existingOperation.status === "completed") {
        return owner.auth_user_id === input.targetAuthUserId
          ? { ok: true, status: "already_completed" }
          : { ok: false, message: "記録済み訂正後にAuth連携が変更されています。現在状態を確認してください。" };
      }
      return { ok: false, message: "このrequest_idは別のAuth操作で使用済みです。" };
    }
    if (owner.auth_user_id !== input.expectedAuthUserId) {
      return { ok: false, message: "画面表示後にAuth連携が変わりました。再読み込みしてください。" };
    }
    const { data: peerOwners, error: peerError } = await service.from("owners").select("id,email")
      .eq("organization_id", staff.organizationId);
    if (peerError || !peerOwners || peerOwners.some((peer) => peer.id !== owner.id && normalizeOwnerAuthEmail(peer.email) === email)) {
      return { ok: false, message: "同一組織に同じ登録メールがあります。" };
    }
    const { data: operations } = await service.from("owner_auth_operations").select("status")
      .eq("organization_id", staff.organizationId).eq("owner_id", owner.id);
    if (operations?.some((operation) => ["started", "auth_created_db_pending", "needs_review"].includes(operation.status))) {
      return { ok: false, message: "未解決のAuth操作があるため訂正できません。" };
    }
    if (input.targetAuthUserId === owner.auth_user_id) return { ok: false, message: "変更先は現在のAuthユーザーと同じです。" };
    const verify = await verifyTarget(service, staff.organizationId, owner.id, email, input.targetAuthUserId);
    if (!verify.ok) return { ok: false, message: "変更先Authの存在・メール・利用状況を再確認できません。" };

    const { error: insertError } = await service.from("owner_auth_operations").insert({
      organization_id: staff.organizationId,
      owner_id: owner.id,
      request_id: input.requestId,
      operation_type: "correct_link",
      requested_email: owner.email,
      previous_auth_user_id: owner.auth_user_id,
      target_auth_user_id: input.targetAuthUserId,
      status: "auth_created_db_pending",
      actor_auth_user_id: staff.userId,
    });
    if (insertError) return { ok: false, message: "訂正操作を監査記録できません。" };
    const { data: linked, error: linkError } = await saveOwnerLink(service, staff.organizationId,
      owner.id, owner.email, input.expectedAuthUserId, input.targetAuthUserId);
    if (linkError || !linked || linked.auth_user_id !== input.targetAuthUserId) {
      await recordOperation(service, staff.organizationId, input.requestId, { status: "needs_review", error_code: "OWNER_LINK_UPDATE_FAILED" });
      return { ok: false, message: "DB連携に失敗しました。旧Authを削除せず要確認として保持しました。" };
    }
    const { data: completedOperation, error: completeError } = await recordOperation(service, staff.organizationId, input.requestId, {
      status: "completed", completed_at: new Date().toISOString(), error_code: null,
    });
    if (completeError || !completedOperation) {
      await recordOperation(service, staff.organizationId, input.requestId, { status: "needs_review", error_code: "AUDIT_COMPLETION_FAILED" });
      return { ok: false, message: "訂正は反映済みですが監査完了を記録できません。状態を確認してください。" };
    }
    revalidatePath("/admin/owners");
    return { ok: true, status: "corrected" };
  } catch {
    return { ok: false, message: "Auth連携を訂正できませんでした。監査状態を確認してください。" };
  }
}

export async function retryOwnerAuthOperation(requestId: string): Promise<ActionResult> {
  try {
    if (typeof requestId !== "string" || !uuidPattern.test(requestId)) return { ok: false, message: "request_idが正しくありません。" };
    const context = await getMutationContext();
    if (!context.ok) return { ok: false, message: context.message, loginRequired: context.loginRequired };
    const { staff } = context;
    const service = createServerSupabaseClient();
    const { data: operation, error } = await service.from("owner_auth_operations").select("*")
      .eq("organization_id", staff.organizationId).eq("request_id", requestId).maybeSingle();
    if (error || !operation) {
      return { ok: false, message: "既知のAuthユーザーIDを持つ再試行可能な操作がありません。" };
    }
    if (operation.status !== "completed" && (operation.status !== "needs_review" || !operation.target_auth_user_id)) {
      return { ok: false, message: "既知のAuthユーザーIDを持つ再試行可能な操作がありません。" };
    }
    const { data: owner, error: ownerError } = await service.from("owners").select("id,email,is_active,auth_user_id,organization_id")
      .eq("organization_id", staff.organizationId).eq("id", operation.owner_id).maybeSingle();
    if (ownerError || !owner || !owner.is_active || owner.organization_id !== staff.organizationId) {
      return { ok: false, message: "再試行前のowner/Auth状態が変わりました。自動上書きせず要確認にしています。" };
    }
    if (operation.status === "completed") {
      return owner.auth_user_id === operation.target_auth_user_id
        ? { ok: true, status: "already_completed" }
        : { ok: false, message: "記録済み操作後にAuth連携が変更されています。現在状態を確認してください。" };
    }
    if (owner.auth_user_id !== operation.previous_auth_user_id && owner.auth_user_id !== operation.target_auth_user_id) {
      return { ok: false, message: "再試行前のowner/Auth状態が変わりました。自動上書きせず要確認にしています。" };
    }
    const email = normalizeOwnerAuthEmail(owner.email);
    if (!email || email !== normalizeOwnerAuthEmail(operation.requested_email)) return { ok: false, message: "owner.emailが操作時から変わっています。" };
    const verify = await verifyTarget(service, staff.organizationId, owner.id, email, operation.target_auth_user_id);
    if (!verify.ok) return { ok: false, message: "既知の変更先Authを再検証できません。" };
    if (owner.auth_user_id !== operation.target_auth_user_id) {
      const { data: linked, error: linkError } = await saveOwnerLink(service, staff.organizationId,
        owner.id, owner.email, operation.previous_auth_user_id, operation.target_auth_user_id);
      if (linkError || !linked || linked.auth_user_id !== operation.target_auth_user_id) {
        await recordOperation(service, staff.organizationId, requestId, { error_code: "OWNER_LINK_RETRY_FAILED" });
        return { ok: false, message: "既知のAuth IDへの再試行に失敗しました。別Authは作成していません。" };
      }
    }
    const { data: completedOperation, error: completeError } = await recordOperation(service, staff.organizationId, requestId, {
      status: "completed", completed_at: new Date().toISOString(), error_code: null,
    });
    if (completeError || !completedOperation) return { ok: false, message: "連携は反映済みですが監査完了を記録できません。" };
    revalidatePath("/admin/owners");
    return { ok: true, status: "retried" };
  } catch {
    return { ok: false, message: "既知Authへの再試行に失敗しました。新規Authは作成していません。" };
  }
}