import { redirect } from "next/navigation";
import { getStaffContext, staffAccessMessages } from "@/lib/supabase-auth/staff";
import StaffLoginForm from "./login-form";

export default async function StaffLoginPage() {
  const context = await getStaffContext();
  if (context.ok) redirect("/admin");
  return <main className="min-h-screen bg-gray-100 p-6 text-slate-900">
    <div className="mx-auto max-w-md rounded-xl bg-white p-6 shadow">
      <h1 className="text-2xl font-bold">スタッフログイン</h1>
      {!context.ok && context.reason !== "unauthenticated" && <p role="alert" className="mt-4 text-red-700">{staffAccessMessages[context.reason]}</p>}
      <StaffLoginForm />
    </div>
  </main>;
}
