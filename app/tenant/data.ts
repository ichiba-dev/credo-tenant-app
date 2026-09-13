import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { TenantContext } from "@/lib/supabase-auth/tenant";

export type TenantRepair = {
  id: number;
  property_name: string;
  room_number: string;
  tenant_name: string;
  category: string;
  description: string;
  created_at: string;
  status: string;
  history: string | null;
  staff_comment: string | null;
  storage_path: string | null;
  photo_url: string | null;
};

const repairColumns = "id, organization_id, tenant_account_id, property_name, room_number, tenant_name, category, description, created_at, status, history, staff_comment, storage_path, photo_url";

export async function getTenantRepairs(tenant: TenantContext): Promise<TenantRepair[]> {
  const { data, error } = await createServerSupabaseClient()
    .from("repair_requests")
    .select(repairColumns)
    .eq("tenant_account_id", tenant.tenantId)
    .eq("organization_id", tenant.organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error("TENANT_REPAIRS_UNAVAILABLE");
  const rows = data ?? [];
  if (rows.some((row) => row.tenant_account_id !== tenant.tenantId || row.organization_id !== tenant.organizationId)) {
    throw new Error("TENANT_REPAIR_SCOPE_MISMATCH");
  }
  return rows as TenantRepair[];
}

export async function getTenantRepair(tenant: TenantContext, repairId: number): Promise<TenantRepair | null> {
  const { data, error } = await createServerSupabaseClient()
    .from("repair_requests")
    .select(repairColumns)
    .eq("id", repairId)
    .eq("tenant_account_id", tenant.tenantId)
    .eq("organization_id", tenant.organizationId)
    .maybeSingle();

  if (error) throw new Error("TENANT_REPAIR_UNAVAILABLE");
  if (!data) return null;
  if (data.id !== repairId || data.tenant_account_id !== tenant.tenantId || data.organization_id !== tenant.organizationId) {
    throw new Error("TENANT_REPAIR_SCOPE_MISMATCH");
  }
  return data as TenantRepair;
}

export type TenantRepairPhoto = {
  storage_path: string | null;
  photo_url: string | null;
  sort_order: number | null;
};

export type TenantRepairMessage = {
  id: string;
  sender_type: "tenant" | "staff";
  message: string;
  created_at: string;
};

export async function getTenantRepairMessages(tenant: TenantContext, repairId: number): Promise<TenantRepairMessage[]> {
  const { data, error } = await createServerSupabaseClient()
    .from("repair_messages")
    .select("id, organization_id, repair_request_id, sender_type, tenant_account_id, staff_auth_user_id, message, created_at")
    .eq("organization_id", tenant.organizationId)
    .eq("repair_request_id", repairId)
    .in("sender_type", ["tenant", "staff"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error("TENANT_MESSAGES_UNAVAILABLE");
  const rows = data ?? [];
  if (rows.some((row) => row.organization_id !== tenant.organizationId || row.repair_request_id !== repairId || !["tenant", "staff"].includes(row.sender_type) || (row.sender_type === "tenant" ? row.tenant_account_id !== tenant.tenantId || row.staff_auth_user_id : row.tenant_account_id || !row.staff_auth_user_id))) {
    throw new Error("TENANT_MESSAGE_SCOPE_MISMATCH");
  }
  return rows.map(({ id, sender_type, message, created_at }) => ({ id, sender_type: sender_type as "tenant" | "staff", message, created_at }));
}

export async function getTenantRepairPhotos(tenant: TenantContext, repairId: number): Promise<TenantRepairPhoto[]> {
  const { data, error } = await createServerSupabaseClient()
    .from("repair_photos")
    .select("organization_id, repair_id, storage_path, photo_url, sort_order")
    .eq("repair_id", repairId)
    .eq("organization_id", tenant.organizationId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error("TENANT_PHOTOS_UNAVAILABLE");
  const rows = data ?? [];
  if (rows.some((row) => row.repair_id !== repairId || row.organization_id !== tenant.organizationId)) {
    throw new Error("TENANT_PHOTO_SCOPE_MISMATCH");
  }
  return rows as TenantRepairPhoto[];
}
