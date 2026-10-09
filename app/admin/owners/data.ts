import "server-only";

import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getOwnerAuthStatus, normalizeOwnerAuthEmail, type OwnerAuthStatus } from "@/lib/owner-auth-state";

export type OwnerAuthRow = {
  id: string;
  name: string;
  email: string | null;
  is_active: boolean;
  auth_user_id: string | null;
  auth_email: string | null;
  status: OwnerAuthStatus;
  properties: string[];
  candidate_auth: { id: string; email: string } | null;
  operation: { request_id: string; status: string; error_code: string | null; can_retry: boolean } | null;
};

export async function getOwnerAuthAdminPage() {
  const staff = await getStaffContext();
  if (!staff.ok) return { ok: false as const, reason: staff.reason };
  const { data: membership, error: roleError } = await staff.supabase.from("organization_members")
    .select("role")
    .eq("organization_id", staff.organizationId)
    .eq("auth_user_id", staff.userId)
    .eq("is_active", true)
    .in("role", ["admin", "manager"])
    .maybeSingle();
  if (roleError || !membership || !["admin", "manager"].includes(membership.role)) {
    return { ok: false as const, reason: "forbidden" as const };
  }

  const service = createServerSupabaseClient();
  const [ownersResult, operationsResult] = await Promise.all([
    service.from("owners").select("id,name,email,is_active,auth_user_id,organization_id")
      .eq("organization_id", staff.organizationId).order("name"),
    service.from("owner_auth_operations").select("owner_id,request_id,status,error_code,created_at,target_auth_user_id")
      .eq("organization_id", staff.organizationId).order("created_at", { ascending: false }),
  ]);
  if (ownersResult.error || operationsResult.error || !ownersResult.data || !operationsResult.data) {
    return { ok: false as const, reason: "unavailable" as const };
  }
  const owners = ownersResult.data;
  const ownerIds = owners.map((owner) => owner.id as string);
  const authIds = [...new Set(owners.map((owner) => owner.auth_user_id).filter((id): id is string => Boolean(id)))];
  const [linksResult, usersResult] = await Promise.all([
    ownerIds.length
      ? service.from("property_owners").select("owner_id,property_id,organization_id,is_active,valid_from,valid_to")
        .eq("organization_id", staff.organizationId).eq("is_active", true).in("owner_id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    listAuthUsers(service),
  ]);
  if (linksResult.error || usersResult.error || !linksResult.data || !usersResult.data) {
    return { ok: false as const, reason: "unavailable" as const };
  }
  const authUsers = usersResult.data;
  const ownerEmails = new Set(owners.map((owner) => normalizeOwnerAuthEmail(owner.email)).filter((email): email is string => Boolean(email)));
  const candidateAuthIds = authUsers.filter((user) => {
    const email = normalizeOwnerAuthEmail(user.email);
    return Boolean(email && ownerEmails.has(email));
  }).map((user) => user.id);
  const relatedAuthIds = [...new Set([...authIds, ...candidateAuthIds])];
  const ownerUseResults = await Promise.all(Array.from({ length: Math.ceil(relatedAuthIds.length / 100) }, (_, index) =>
    service.from("owners").select("id,auth_user_id,organization_id")
      .in("auth_user_id", relatedAuthIds.slice(index * 100, (index + 1) * 100))));
  if (ownerUseResults.some((result) => result.error || !result.data)) return { ok: false as const, reason: "unavailable" as const };
  const linkedOwners = ownerUseResults.flatMap((result) => result.data ?? []);
  const propertyIds = [...new Set(linksResult.data.map((link) => link.property_id as string).filter(Boolean))];
  const propertiesResult = propertyIds.length
    ? await service.from("properties").select("id,name,organization_id,is_active")
      .eq("organization_id", staff.organizationId).eq("is_active", true).in("id", propertyIds)
    : { data: [], error: null };
  if (propertiesResult.error || !propertiesResult.data) return { ok: false as const, reason: "unavailable" as const };

  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const usersByEmail = new Map<string, typeof authUsers>();
  for (const user of authUsers) {
    const email = normalizeOwnerAuthEmail(user.email);
    if (email) usersByEmail.set(email, [...(usersByEmail.get(email) ?? []), user]);
  }
  const ownerCounts = new Map<string, number>();
  for (const owner of owners) {
    const email = normalizeOwnerAuthEmail(owner.email);
    if (email) ownerCounts.set(email, (ownerCounts.get(email) ?? 0) + 1);
  }
  const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
  const propertyNames = new Map(propertiesResult.data.map((property) => [property.id, property.name as string]));
  const linkMap = new Map<string, string[]>();
  const today = new Date().toISOString().slice(0, 10);
  for (const link of linksResult.data) {
    if (link.organization_id !== staff.organizationId || !ownerById.has(link.owner_id) || !link.is_active ||
      (link.valid_from && link.valid_from > today) || (link.valid_to && link.valid_to < today)) continue;
    const name = propertyNames.get(link.property_id);
    if (name) linkMap.set(link.owner_id, [...(linkMap.get(link.owner_id) ?? []), name]);
  }
  const usesByAuthId = new Map<string, Set<string>>();
  for (const owner of linkedOwners) {
    if (!owner.auth_user_id) continue;
    usesByAuthId.set(owner.auth_user_id, new Set([...(usesByAuthId.get(owner.auth_user_id) ?? []), owner.id]));
  }
  const latestOperation = new Map<string, (typeof operationsResult.data)[number]>();
  for (const operation of operationsResult.data) {
    if (!latestOperation.has(operation.owner_id)) latestOperation.set(operation.owner_id, operation);
  }

  const rows: OwnerAuthRow[] = owners.map((owner) => {
    const email = normalizeOwnerAuthEmail(owner.email);
    const authUser = owner.auth_user_id ? authById.get(owner.auth_user_id) : null;
    const matchingUsers = email ? usersByEmail.get(email) ?? [] : [];
    const usedByOwners = owner.auth_user_id ? usesByAuthId.get(owner.auth_user_id) : null;
    const otherUse = Boolean(usedByOwners && [...usedByOwners].some((id) => id !== owner.id));
    const duplicateOwnerEmail = Boolean(email && ownerCounts.get(email)! > 1);
    const operation = latestOperation.get(owner.id);
    const needsReview = Boolean(operation && ["needs_review", "auth_created_db_pending", "started"].includes(operation.status));
    const targetOwnerCount = authUser ? (usesByAuthId.get(authUser.id)?.size ?? 0) : 0;
    const authEmail = authUser?.email ?? null;
    const matching = email ? matchingUsers.filter((user) => !usesByAuthId.has(user.id) || usesByAuthId.get(user.id)!.size === 0) : [];
    const matchingUsedElsewhere = matchingUsers.some((user) => usesByAuthId.has(user.id) &&
      [...usesByAuthId.get(user.id)!].some((id) => id !== owner.id));
    return {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      is_active: owner.is_active,
      auth_user_id: owner.auth_user_id,
      auth_email: authEmail,
      status: getOwnerAuthStatus({
        isActive: owner.is_active,
        ownerEmail: owner.email,
        authUserId: owner.auth_user_id,
        authUserExists: Boolean(authUser),
        authEmail,
        matchingAuthUserExists: matching.length > 0,
        duplicateOwnerEmail,
        duplicateAuthEmail: matchingUsers.length > 1,
        authUsedByAnotherOwner: otherUse || (targetOwnerCount > 1) || matchingUsedElsewhere,
        needsReview,
      }),
      properties: [...new Set(linkMap.get(owner.id) ?? [])],
      candidate_auth: matching.length === 1 ? { id: matching[0].id, email: matching[0].email! } : null,
      operation: operation ? { request_id: operation.request_id, status: operation.status,
        error_code: operation.error_code, can_retry: Boolean(operation.target_auth_user_id) } : null,
    };
  });
  return { ok: true as const, rows };
}

async function listAuthUsers(service: ReturnType<typeof import("@/lib/supabase-server").createServerSupabaseClient>) {
  const users: { id: string; email: string | null }[] = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { data: null, error };
    users.push(...data.users.map((user) => ({ id: user.id, email: user.email ?? null })));
    if (data.users.length < 1000) return { data: users, error: null };
  }
  return { data: null, error: new Error("AUTH_USER_SCAN_LIMIT") };
}