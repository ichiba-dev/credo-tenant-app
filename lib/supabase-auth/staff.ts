import "server-only";

import { createAuthServerClient } from "./server";

// 将来の会社選択も、必ずこの認証済み所属一覧から決定する。
export async function getStaffContext() {
  const supabase = await createAuthServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { ok: false, reason: "unauthenticated" } as const;

  const { data: memberships, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .in("role", ["admin", "manager", "staff", "viewer"]);
  if (membershipError) return { ok: false, reason: "unavailable" } as const;
  const organizationIds = [...new Set((memberships ?? []).map((m) => m.organization_id as string))];
  if (!organizationIds.length || organizationIds.some((id) => !id)) {
    return { ok: false, reason: "forbidden" } as const;
  }
  // 複数所属時に先頭の会社を勝手に選択しない。会社選択UIは次フェーズ。
  if (organizationIds.length !== 1) return { ok: false, reason: "multiple" } as const;
  const canUpdate = (memberships ?? []).some((membership) =>
    membership.organization_id === organizationIds[0] &&
    ["admin", "manager", "staff"].includes(membership.role)
  );
  return { ok: true, supabase, organizationId: organizationIds[0], userId: user.id, canUpdate } as const;
}

export const staffAccessMessages = {
  unauthenticated: "ログインの有効期限が切れています。ログインし直してください。",
  unavailable: "スタッフ所属を確認できませんでした。時間をおいて再試行してください。",
  forbidden: "有効なスタッフ所属がありません。管理者にお問い合わせください。",
  multiple: "複数社に所属しています。会社選択にはまだ対応していないため、管理者にお問い合わせください。",
};
