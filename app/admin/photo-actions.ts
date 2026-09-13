"use server";

import { getStaffContext } from "@/lib/supabase-auth/staff";
import { getAdminRepairs } from "./data";

export async function refreshRepairPhotos(repairId: number) {
  try {
    if (!Number.isSafeInteger(repairId) || repairId <= 0) return { ok: false } as const;
    const context = await getStaffContext();
    if (!context.ok) return { ok: false } as const;
    const [repair] = await getAdminRepairs(context, repairId);
    // 写真が欠けたPDFや、拡大表示の写真番号ずれを成功扱いにしない。
    return repair && !repair.photos_unavailable ? { ok: true, repair } as const : { ok: false } as const;
  } catch {
    return { ok: false } as const;
  }
}
