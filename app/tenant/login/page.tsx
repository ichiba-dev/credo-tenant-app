import { redirect } from "next/navigation";
import { tenantRepairPath } from "@/lib/repair-id";
import { getTenantContext } from "@/lib/supabase-auth/tenant";
import { TenantLoginForm } from "./login-form";

const text = { title: "\u5165\u5c45\u8005\u69d8\u30ed\u30b0\u30a4\u30f3", intro: "\u4fee\u7406\u4f9d\u983c\u306e\u72b6\u6cc1\u3092\u3054\u78ba\u8a8d\u3044\u305f\u3060\u3051\u307e\u3059\u3002", forbidden: "\u6709\u52b9\u306a\u5165\u5c45\u8005\u30a2\u30ab\u30a6\u30f3\u30c8\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002\u7ba1\u7406\u4f1a\u793e\u3078\u304a\u554f\u3044\u5408\u308f\u305b\u304f\u3060\u3055\u3044\u3002" };
export default async function TenantLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = tenantRepairPath((await searchParams).next); const context = await getTenantContext(); if (context.ok) redirect(nextPath);
  return <main className="flex min-h-screen items-center justify-center bg-[#f3f5f7] px-4 py-10 text-slate-900"><div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]"><header className="relative bg-[#0b2e59] px-7 py-8 text-white"><div className="absolute inset-y-0 left-0 w-1.5 bg-[#b99452]" /><p className="notranslate text-xl font-bold tracking-[0.24em]" translate="no">CREDO</p><h1 className="mt-6 text-2xl font-bold">{text.title}</h1><p className="mt-2 text-sm text-slate-300">{text.intro}</p></header><div className="px-7 pb-8 pt-1"><TenantLoginForm nextPath={nextPath} />{context.reason === "forbidden" && <p className="mt-5 text-center text-xs text-slate-500">{text.forbidden}</p>}</div></div></main>;
}
