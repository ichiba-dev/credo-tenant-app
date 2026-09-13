import Link from "next/link";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/supabase-auth/tenant";
import { getTenantRepairs } from "./data";

const text = {
  received: "\u53d7\u4ed8", complete: "\u5b8c\u4e86", title: "\u4fee\u7406\u4f9d\u983c\u30de\u30a4\u30da\u30fc\u30b8",
  empty: "\u73fe\u5728\u3001\u4fee\u7406\u4f9d\u983c\u306f\u3042\u308a\u307e\u305b\u3093\u3002", detail: "\u8a73\u7d30\u3092\u898b\u308b",
  receivedAt: "\u53d7\u4ed8\u65e5", comment: "\u7ba1\u7406\u4f1a\u793e\u30b3\u30e1\u30f3\u30c8", yes: "\u3042\u308a", no: "\u306a\u3057",
  unavailable: "\u4fee\u7406\u4f9d\u983c\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u6642\u9593\u3092\u304a\u3044\u3066\u518d\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002",
  account: "\u5165\u5c45\u8005\u30a2\u30ab\u30a6\u30f3\u30c8\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002\u7ba1\u7406\u4f1a\u793e\u3078\u304a\u554f\u3044\u5408\u308f\u305b\u304f\u3060\u3055\u3044\u3002",
};
const date = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo" }).format(new Date(value));
const statusClass = (status: string) => status === text.received ? "bg-amber-100 text-amber-900" : status === text.complete ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800";
function Message({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">{children}</div>; }
function TenantShell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[#f3f5f7] text-slate-900"><header className="border-b-4 border-[#b99452] bg-[#0b2e59] px-5 py-7 text-white"><div className="mx-auto max-w-2xl"><p className="notranslate text-lg font-bold tracking-[0.24em]" translate="no">CREDO</p><h1 className="mt-3 text-xl font-bold">{text.title}</h1></div></header><div className="mx-auto max-w-2xl px-4 py-7">{children}</div></main>; }

export default async function TenantPage() {
  const context = await getTenantContext();
  if (!context.ok && context.reason === "unauthenticated") redirect("/tenant/login?next=%2Ftenant");
  if (!context.ok) return <TenantShell><Message>{text.account}</Message></TenantShell>;
  let repairs;
  try { repairs = await getTenantRepairs(context.tenant); } catch { return <TenantShell><Message>{text.unavailable}</Message></TenantShell>; }
  return <TenantShell><p className="mb-5 text-sm text-slate-600">{context.tenant.displayName}</p>{repairs.length === 0 ? <Message>{text.empty}</Message> : <div className="space-y-4">{repairs.map((repair) => <article key={repair.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-l-4 border-[#b99452] p-5">
    <div className="flex items-start justify-between gap-3"><h2 className="font-bold text-[#0b2e59]">{repair.property_name} {repair.room_number}</h2><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${statusClass(repair.status)}`}>{repair.status}</span></div>
    <p className="mt-4 text-sm font-bold text-slate-700">{repair.category}</p><p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{repair.description}</p>
    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs"><div><dt className="text-slate-400">{text.receivedAt}</dt><dd className="mt-1 font-medium text-slate-700">{date(repair.created_at)}</dd></div><div><dt className="text-slate-400">{text.comment}</dt><dd className="mt-1 font-medium text-slate-700">{repair.staff_comment?.trim() ? text.yes : text.no}</dd></div></dl>
    <Link href={`/tenant/repairs/${repair.id}`} className="mt-5 block rounded-xl bg-[#0b2e59] px-4 py-3 text-center text-sm font-bold text-white">{text.detail}</Link>
  </div></article>)}</div>}</TenantShell>;
}
