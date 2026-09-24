import "server-only";

import { getStaffContext } from "@/lib/supabase-auth/staff";
import type { AdminRepair, RepairPhoto } from "./types";
import { PhotoUnavailableError, resolveRepairPhotoUrl } from "@/lib/repair-photo-urls";

export async function getAdminRepairs(context: Extract<Awaited<ReturnType<typeof getStaffContext>>, { ok: true }>, repairId?: number): Promise<AdminRepair[]> {
  const { supabase, organizationId } = context;
  let query = supabase.from("repair_requests")
    .select("id, organization_id, property_name, room_number, tenant_name, category, description, status, history, staff_comment, created_at, photo_url, storage_path")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (repairId !== undefined) query = query.eq("id", repairId);
  const { data, error } = await query;
  if (error || !data) throw new Error("案件を取得できませんでした。");
  if (!data.length) return [];
  if (data.some((repair) => repair.organization_id !== organizationId || (repairId !== undefined && repair.id !== repairId))) {
    throw new Error("案件の閲覧権限を確認できませんでした。");
  }
  const { data: photos, error: photoError } = await supabase.from("repair_photos")
    .select("id::text, repair_id, organization_id, photo_url, storage_path, sort_order")
    .eq("organization_id", organizationId)
    .in("repair_id", data.map((repair) => repair.id))
    .order("sort_order", { ascending: true });
  if (photoError || !photos) throw new Error("写真情報を取得できませんでした。");
  if (photos.some((photo) => photo.organization_id !== organizationId || !data.some((repair) => repair.id === photo.repair_id))) {
    throw new Error("写真の閲覧権限を確認できませんでした。");
  }
  const grouped: Record<number, RepairPhoto[]> = {};
  const unavailable = new Set<number>();
  const withPhotos = new Set<number>();
  for (const photo of photos) {
    if (photo.storage_path || photo.photo_url) withPhotos.add(photo.repair_id);
    try {
      const url = await resolveRepairPhotoUrl(photo, organizationId, photo.repair_id);
      if (url) (grouped[photo.repair_id] ??= []).push({ id: photo.id, repair_id: photo.repair_id, photo_url: url, sort_order: photo.sort_order });
    } catch (error) {
      if (!(error instanceof PhotoUnavailableError)) throw error;
      unavailable.add(photo.repair_id);
    }
  }
  return Promise.all(data.map(async ({ storage_path, organization_id, ...repair }) => {
    let url: string | null = null;
    if (!withPhotos.has(repair.id)) {
      try {
        url = await resolveRepairPhotoUrl({ storage_path, photo_url: repair.photo_url }, organization_id, repair.id);
      } catch (error) {
        if (!(error instanceof PhotoUnavailableError)) throw error;
        unavailable.add(repair.id);
      }
    }
    return { ...repair, photo_url: url, repair_photos: grouped[repair.id] ?? [], photos_unavailable: unavailable.has(repair.id), owner_report_estimates: null };
  }));
}
