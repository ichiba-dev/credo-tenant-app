import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import RepairImage from "@/app/components/repair-image";
import { parseRepairId } from "@/lib/repair-id";
import { PhotoUnavailableError, resolveRepairPhotoUrl } from "@/lib/repair-photo-urls";
import { getTenantContext } from "@/lib/supabase-auth/tenant";
import { getTenantRepair, getTenantRepairMessages, getTenantRepairPhotos } from "../../data";
import { TenantMessageForm } from "./message-form";

const text = {
  back: "\u2190 \u4fee\u7406\u4f9d\u983c\u4e00\u89a7\u3078\u623b\u308b", title: "\u4fee\u7406\u4f9d\u983c\u306e\u8a73\u7d30", current: "\u73fe\u5728\u306e\u30b9\u30c6\u30fc\u30bf\u30b9",
  property: "\u7269\u4ef6\u540d", room: "\u53f7\u5ba4", tenant: "\u5165\u5c45\u8005\u540d", category: "\u30ab\u30c6\u30b4\u30ea", description: "\u4e0d\u5177\u5408\u5185\u5bb9", date: "\u53d7\u4ed8\u65e5",
  history: "\u5bfe\u5fdc\u5c65\u6b74", comment: "\u7ba1\u7406\u4f1a\u793e\u30b3\u30e1\u30f3\u30c8", photos: "\u4fee\u7406\u5199\u771f", none: "\u307e\u3060\u767b\u9332\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002",
  photoError: "\u4e00\u90e8\u306e\u5199\u771f\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002", unavailable: "\u4fee\u7406\u4f9d\u983c\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002",
};
const formatDate = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo" }).format(new Date(value));
function Row({ label, value }: { label: string; value: string }) { return <div className="border-b border-slate-100 py-3 last:border-0"><dt className="text-xs font-bold text-slate-400">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value || text.none}</dd></div>; }

export default async function TenantRepairPage({ params }: { params: Promise<{ repairId: string }> }) {
  const rawId = (await params).repairId;
  const repairId = parseRepairId(rawId);
  if (repairId === null) notFound();
  const context = await getTenantContext();
  if (!context.ok && context.reason === "unauthenticated") redirect(`/tenant/login?next=${encodeURIComponent(`/tenant/repairs/${repairId}`)}`);
  if (!context.ok) notFound();

  let repair;
  try { repair = await getTenantRepair(context.tenant, repairId); } catch { return <ErrorPage />; }
  if (!repair) notFound();

  let photoSources = [] as Awaited<ReturnType<typeof getTenantRepairPhotos>>;
  let photosUnavailable = false;
  try { photoSources = await getTenantRepairPhotos(context.tenant, repairId); } catch { photosUnavailable = true; }
  if (photoSources.length === 0 && (repair.storage_path || repair.photo_url)) photoSources = [{ storage_path: repair.storage_path, photo_url: repair.photo_url, sort_order: 0 }];
  const photos: string[] = [];
  for (const source of photoSources) {
    try { const url = await resolveRepairPhotoUrl(source, context.tenant.organizationId, repairId); if (url) photos.push(url); }
    catch (error) { if (error instanceof PhotoUnavailableError) photosUnavailable = true; else notFound(); }
  }

  let messages: Awaited<ReturnType<typeof getTenantRepairMessages>> = [];
  let messagesUnavailable = false;
  try { messages = await getTenantRepairMessages(context.tenant, repairId); } catch { messagesUnavailable = true; }

  return <main className="min-h-screen bg-[#f3f5f7] pb-10 text-slate-900"><header className="border-b-4 border-[#b99452] bg-[#0b2e59] px-5 py-6 text-white"><div className="mx-auto max-w-2xl"><p className="notranslate text-lg font-bold tracking-[0.24em]" translate="no">CREDO</p><h1 className="mt-3 text-xl font-bold">{text.title}</h1></div></header><div className="mx-auto max-w-2xl px-4 py-6">
    <Link href="/tenant" className="text-sm font-bold text-[#0b2e59] underline underline-offset-4">{text.back}</Link>
    <section className="mt-5 rounded-2xl bg-[#0b2e59] p-5 text-white shadow-sm"><p className="text-xs text-slate-300">{text.current}</p><p className="mt-2 text-xl font-bold">{repair.status}</p></section>
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm"><dl><Row label={text.property} value={repair.property_name} /><Row label={text.room} value={repair.room_number} /><Row label={text.tenant} value={repair.tenant_name || context.tenant.displayName} /><Row label={text.category} value={repair.category} /><Row label={text.description} value={repair.description} /><Row label={text.date} value={formatDate(repair.created_at)} /></dl></section>
    <Section title={text.history}><p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{repair.history?.trim() || text.none}</p></Section>
    <Section title={text.comment}><p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{repair.staff_comment?.trim() || text.none}</p></Section>
    <Section title={text.photos}>{photosUnavailable && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{text.photoError}</p>}{photos.length === 0 ? <p className="text-sm text-slate-500">{text.none}</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{photos.map((url, index) => <RepairImage key={`${url}-${index}`} src={url} alt={`${text.photos} ${index + 1}`} className="h-56 w-full rounded-xl object-cover" />)}</div>}</Section>
    <Section title="管理会社とのメッセージ">{messagesUnavailable ? <p role="alert" className="text-sm text-red-700">メッセージ履歴を読み込めませんでした。</p> : messages.length === 0 ? <p className="text-sm text-slate-500">メッセージはありません。</p> : <ol className="space-y-3">{messages.map((item) => <li key={item.id} className={`rounded-xl p-3 ${item.sender_type === "staff" ? "ml-4 bg-[#0b2e59] text-white" : "mr-4 bg-slate-100 text-slate-700"}`}><div className={`flex flex-wrap justify-between gap-2 text-xs ${item.sender_type === "staff" ? "text-slate-300" : "text-slate-500"}`}><span>{item.sender_type === "staff" ? "管理会社" : "あなた"}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.message}</p></li>)}</ol>}</Section>
    <Section title="追加で伝える"><TenantMessageForm repairId={repairId} /></Section>
  </div></main>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm"><h2 className="border-l-4 border-[#b99452] pl-3 font-bold text-[#0b2e59]">{title}</h2><div className="mt-4">{children}</div></section>; }
function ErrorPage() { return <main className="flex min-h-screen items-center justify-center bg-[#f3f5f7] p-6"><div className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm">{text.unavailable}</div></main>; }
