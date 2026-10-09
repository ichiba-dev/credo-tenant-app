import { redirect } from "next/navigation";
import { getOwnerAuthAdminPage } from "./data";
import OwnerAuthScreen from "./owner-auth-screen";

export const dynamic = "force-dynamic";

export default async function AdminOwnersPage() {
  const result = await getOwnerAuthAdminPage();
  if (!result.ok) redirect("/admin/login");
  return <OwnerAuthScreen rows={result.rows} />;
}