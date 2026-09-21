import "server-only";
import type { getStaffContext } from "@/lib/supabase-auth/staff";

type StaffContext = Extract<Awaited<ReturnType<typeof getStaffContext>>, { ok: true }>;
export type VendorMaster = {
  id: string; companyName: string; contactName: string; phone: string | null;
  email: string | null; isActive: boolean; updatedAt: string;
  categories: string[]; areas: { areaCode: string; areaLabel: string }[];
};

export async function getVendorMasters(context: StaffContext): Promise<VendorMaster[]> {
  const { supabase, organizationId } = context;
  const [vendorsResult, categoriesResult, areasResult] = await Promise.all([
    supabase.from("repair_vendors").select("id,organization_id,company_name,contact_name,phone,email,is_active,updated_at")
      .eq("organization_id", organizationId).order("company_name"),
    supabase.from("repair_vendor_categories").select("organization_id,vendor_id,category")
      .eq("organization_id", organizationId).order("category"),
    supabase.from("repair_vendor_areas").select("organization_id,vendor_id,area_code,area_label")
      .eq("organization_id", organizationId).order("area_label"),
  ]);
  if (vendorsResult.error || categoriesResult.error || areasResult.error) throw new Error("VENDOR_MASTER_UNAVAILABLE");
  const vendors = vendorsResult.data ?? [];
  const categories = categoriesResult.data ?? [];
  const areas = areasResult.data ?? [];
  const ids = new Set(vendors.map((vendor) => vendor.id));
  if (vendors.some((vendor) => vendor.organization_id !== organizationId) ||
      categories.some((row) => row.organization_id !== organizationId || !ids.has(row.vendor_id)) ||
      areas.some((row) => row.organization_id !== organizationId || !ids.has(row.vendor_id))) {
    throw new Error("VENDOR_MASTER_SCOPE_MISMATCH");
  }
  return vendors.map((vendor) => ({
    id: vendor.id, companyName: vendor.company_name, contactName: vendor.contact_name,
    phone: vendor.phone, email: vendor.email, isActive: vendor.is_active, updatedAt: vendor.updated_at,
    categories: categories.filter((row) => row.vendor_id === vendor.id).map((row) => row.category),
    areas: areas.filter((row) => row.vendor_id === vendor.id)
      .map((row) => ({ areaCode: row.area_code, areaLabel: row.area_label })),
  }));
}
