import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { getVendorMasters } from "./data";
import VendorMasterScreen from "./vendor-master-screen";

export default async function VendorMasterPage() {
  const context = await getStaffContext();
  if (!context.ok) redirect("/admin/login");
  let vendors;
  try {
    vendors = await getVendorMasters(context);
  } catch {
    return <main className="min-h-screen bg-slate-100 p-6 text-slate-900"><div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold">業者マスタ</h1>
      <p role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-red-800">業者情報を取得できませんでした。時間をおいて再読み込みしてください。</p>
    </div></main>;
  }
  return <VendorMasterScreen vendors={vendors} canUpdate={context.canUpdate} />;
}
