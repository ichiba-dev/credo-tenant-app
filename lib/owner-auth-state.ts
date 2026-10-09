export type OwnerAuthStatus =
  | "linked"
  | "unlinked"
  | "email_mismatch"
  | "auth_user_missing"
  | "owner_inactive"
  | "review_required";

export type OwnerAuthStateInput = {
  isActive: boolean;
  ownerEmail: string | null;
  authUserId: string | null;
  authUserExists: boolean;
  authEmail: string | null;
  matchingAuthUserExists: boolean;
  duplicateOwnerEmail?: boolean;
  duplicateAuthEmail?: boolean;
  authUsedByAnotherOwner?: boolean;
  needsReview?: boolean;
};

export function normalizeOwnerAuthEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

export function getOwnerAuthStatus(input: OwnerAuthStateInput): OwnerAuthStatus {
  if (input.needsReview || input.duplicateOwnerEmail || input.duplicateAuthEmail || input.authUsedByAnotherOwner) {
    return "review_required";
  }
  if (!input.isActive) return "owner_inactive";

  const ownerEmail = normalizeOwnerAuthEmail(input.ownerEmail);
  if (!ownerEmail) return "review_required";
  if (!input.authUserId) return "unlinked";
  if (!input.authUserExists) return "auth_user_missing";

  const authEmail = normalizeOwnerAuthEmail(input.authEmail);
  if (!authEmail) return "review_required";
  return ownerEmail === authEmail ? "linked" : "email_mismatch";
}

export const ownerAuthStatusLabels: Record<OwnerAuthStatus, string> = {
  linked: "連携済み",
  unlinked: "未連携",
  email_mismatch: "メール不一致",
  auth_user_missing: "Authユーザー不存在",
  owner_inactive: "オーナー無効",
  review_required: "要確認",
};