"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveVendorMaster } from "./actions";
import type { VendorMaster } from "./data";

const categoryExamples = ["水道","電気","エアコン","内装","原状回復","鍵","設備","清掃","建築","その他"];
const areaExamples = ["西宮市","尼崎市","神戸市","芦屋市","宝塚市","大阪市"];
type Draft = Omit<VendorMaster,"updatedAt"> & { updatedAt: string | null };
const split = (value: string) => [...new Set(value.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean))];
const emptyDraft = (): Draft => ({ id: crypto.randomUUID(), companyName:"", contactName:"", phone:null,
  email:null, isActive:true, updatedAt:null, categories:[], areas:[] });

function Chips({ values }: { values: string[] }) {
  return <div className="flex flex-wrap gap-1">{values.length ? values.map((value) =>
    <span key={value} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{value}</span>) :
    <span className="text-sm text-slate-400">未設定</span>}</div>;
}

export default function VendorMasterScreen({ vendors, canUpdate }: { vendors: VendorMaster[]; canUpdate: boolean }) {
  const router = useRouter();
  const [search,setSearch] = useState("");
  const [category,setCategory] = useState("");
  const [area,setArea] = useState("");
  const [activeOnly,setActiveOnly] = useState(true);
  const [draft,setDraft] = useState<Draft|null>(null);
  const [message,setMessage] = useState("");
  const [pending,startTransition] = useTransition();
  const requestId = useRef<string|null>(null);
  const categories = useMemo(() => [...new Set([...categoryExamples,...vendors.flatMap((v) => v.categories)])].sort(),[vendors]);
  const areas = useMemo(() => [...new Set([...areaExamples,...vendors.flatMap((v) => v.areas.map((a) => a.areaLabel))])].sort(),[vendors]);
  const visible = useMemo(() => vendors.filter((vendor) =>
    (!search.trim() || vendor.companyName.toLocaleLowerCase("ja-JP").includes(search.trim().toLocaleLowerCase("ja-JP"))) &&
    (!category || vendor.categories.includes(category)) && (!area || vendor.areas.some((item) => item.areaLabel===area)) &&
    (!activeOnly || vendor.isActive)),[vendors,search,category,area,activeOnly]);
  const change = (values: Partial<Draft>) => { requestId.current=null; setDraft((current) => current ? {...current,...values} : current); };
  const edit = (vendor: VendorMaster) => { requestId.current=null; setMessage(""); setDraft({...vendor}); };
  const create = () => { requestId.current=null; setMessage(""); setDraft(emptyDraft()); };
  function submit() {
    if (!draft || pending) return;
    requestId.current ??= crypto.randomUUID();
    const submittedRequest = requestId.current;
    startTransition(async () => {
      try {
        const result = await saveVendorMaster({ vendorId:draft.id,requestId:submittedRequest,
          expectedUpdatedAt:draft.updatedAt,companyName:draft.companyName,contactName:draft.contactName,
          phone:draft.phone ?? "",email:draft.email ?? "",isActive:draft.isActive,
          categories:draft.categories,areas:draft.areas });
        if (!result.ok) {
          setMessage(result.message);
          if (result.loginRequired) window.location.assign("/admin/login");
          if (result.conflict) requestId.current=null;
          return;
        }
        requestId.current=null; setDraft(null); setMessage("保存しました。"); router.refresh();
      } catch {
        setMessage("通信に失敗しました。同じ内容で再試行してください。");
      }
    });
  }
  return <main className="min-h-screen bg-slate-100 text-slate-900">
    <header className="bg-[#0b1f3a] text-white shadow-lg"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
      <div><p className="text-xs font-semibold tracking-[.2em] text-blue-200">CREDO 管理画面</p><h1 className="mt-1 text-2xl font-bold">業者マスタ</h1></div>
      <div className="flex items-center gap-2"><Link href="/admin" className="rounded-lg border border-white/30 px-4 py-2 text-sm hover:bg-white/10">修繕一覧へ</Link>
      {canUpdate && <button onClick={create} className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-[#0b1f3a] hover:bg-blue-50">＋ 新規登録</button>}</div>
    </div></header>
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      {!canUpdate && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">閲覧権限です。業者情報の登録・編集はできません。</p>}
      {message && <p role="status" className="mb-4 rounded-lg bg-white p-3 text-sm shadow-sm">{message}</p>}
      <section aria-label="業者の絞り込み" className="grid gap-3 rounded-xl bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm font-medium lg:col-span-2">会社名検索<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="会社名を入力" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm font-medium">カテゴリ<select value={category} onChange={(e)=>setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">すべて</option>{categories.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label className="text-sm font-medium">対応エリア<select value={area} onChange={(e)=>setArea(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">すべて</option>{areas.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label className="flex items-end gap-2 pb-2 text-sm font-medium"><input type="checkbox" checked={activeOnly} onChange={(e)=>setActiveOnly(e.target.checked)} className="h-4 w-4" />有効業者のみ</label>
      </section>
      <p className="my-4 text-sm text-slate-600">{visible.length}件</p>
      <div className="hidden overflow-x-auto rounded-xl bg-white shadow-sm md:block"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["会社名","担当者名","電話番号","メール","カテゴリ","対応エリア","状態","更新日時",""] .map((v)=><th key={v} className="px-4 py-3 font-semibold">{v}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{visible.map((vendor)=><tr key={vendor.id} className="hover:bg-blue-50/50"><td className="px-4 py-4 font-bold text-[#0b1f3a]">{vendor.companyName}</td><td className="px-4 py-4">{vendor.contactName}</td><td className="px-4 py-4">{vendor.phone ?? "—"}</td><td className="px-4 py-4">{vendor.email ?? "—"}</td><td className="px-4 py-4"><Chips values={vendor.categories}/></td><td className="px-4 py-4"><Chips values={vendor.areas.map((a)=>a.areaLabel)}/></td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-xs font-bold ${vendor.isActive?"bg-emerald-100 text-emerald-800":"bg-slate-200 text-slate-600"}`}>{vendor.isActive?"有効":"無効"}</span></td><td className="px-4 py-4 whitespace-nowrap">{new Date(vendor.updatedAt).toLocaleString("ja-JP")}</td><td className="px-4 py-4">{canUpdate&&<button onClick={()=>edit(vendor)} className="rounded-lg bg-[#0b1f3a] px-3 py-2 font-bold text-white">編集</button>}</td></tr>)}</tbody></table></div>
      <div className="grid gap-3 md:hidden">{visible.map((vendor)=><article key={vendor.id} className="rounded-xl bg-white p-4 shadow-sm"><div className="flex justify-between gap-3"><div><h2 className="font-bold text-[#0b1f3a]">{vendor.companyName}</h2><p className="text-sm text-slate-600">{vendor.contactName}</p></div><span className={`h-fit rounded-full px-2 py-1 text-xs font-bold ${vendor.isActive?"bg-emerald-100 text-emerald-800":"bg-slate-200 text-slate-600"}`}>{vendor.isActive?"有効":"無効"}</span></div><div className="mt-3 text-sm"><p>{vendor.phone ?? "電話未設定"}</p><p>{vendor.email ?? "メール未設定"}</p></div><div className="mt-3"><Chips values={[...vendor.categories,...vendor.areas.map((a)=>a.areaLabel)]}/></div>{canUpdate&&<button onClick={()=>edit(vendor)} className="mt-4 w-full rounded-lg bg-[#0b1f3a] px-4 py-2 font-bold text-white">編集</button>}</article>)}</div>
      {!visible.length && <p className="rounded-xl bg-white p-8 text-center text-slate-500 shadow-sm">条件に一致する業者はありません。</p>}
    </div>
    {draft && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50" role="dialog" aria-modal="true" aria-label={draft.updatedAt?"業者を編集":"業者を新規登録"}><div className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl sm:p-7">
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-[#0b1f3a]">{draft.updatedAt?"業者を編集":"業者を新規登録"}</h2><button onClick={()=>setDraft(null)} className="rounded-lg border px-3 py-2" aria-label="閉じる">閉じる</button></div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium sm:col-span-2">会社名 <span className="text-red-600">必須</span><input required maxLength={200} value={draft.companyName} onChange={(e)=>change({companyName:e.target.value})} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm font-medium sm:col-span-2">担当者名 <span className="text-red-600">必須</span><input required maxLength={200} value={draft.contactName} onChange={(e)=>change({contactName:e.target.value})} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm font-medium">電話番号<input maxLength={40} value={draft.phone??""} onChange={(e)=>change({phone:e.target.value})} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm font-medium">メール<input type="email" maxLength={254} value={draft.email??""} onChange={(e)=>change({email:e.target.value})} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
        <label className="text-sm font-medium sm:col-span-2">カテゴリ（読点・カンマ区切り）<input value={draft.categories.join("、")} onChange={(e)=>change({categories:split(e.target.value)})} placeholder="水道、設備" className="mt-1 w-full rounded-lg border px-3 py-2" /><span className="mt-2 flex flex-wrap gap-1">{categoryExamples.map((v)=><button type="button" key={v} onClick={()=>change({categories:[...new Set([...draft.categories,v])]})} className="rounded-full bg-slate-100 px-2 py-1 text-xs">＋{v}</button>)}</span></label>
        <label className="text-sm font-medium sm:col-span-2">対応エリア（読点・カンマ区切り）<input value={draft.areas.map((v)=>v.areaLabel).join("、")} onChange={(e)=>change({areas:split(e.target.value).map((label)=>draft.areas.find((a)=>a.areaLabel===label)??{areaCode:"",areaLabel:label})})} placeholder="西宮市、尼崎市" className="mt-1 w-full rounded-lg border px-3 py-2" /><span className="mt-2 flex flex-wrap gap-1">{areaExamples.map((v)=><button type="button" key={v} onClick={()=>change({areas:draft.areas.some((a)=>a.areaLabel===v)?draft.areas:[...draft.areas,{areaCode:"",areaLabel:v}]})} className="rounded-full bg-slate-100 px-2 py-1 text-xs">＋{v}</button>)}</span><span className="mt-1 block text-xs text-slate-500">内部ではarea_codeとarea_labelを分けて保存します。</span></label>
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" checked={draft.isActive} onChange={(e)=>change({isActive:e.target.checked})} className="h-4 w-4" />有効な業者として利用する</label></div>
      {message && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{message}</p>}
      <div className="mt-7 flex gap-3"><button disabled={pending||!draft.companyName.trim()||!draft.contactName.trim()} onClick={submit} className="flex-1 rounded-lg bg-[#0b1f3a] px-4 py-3 font-bold text-white disabled:opacity-50">{pending?"保存中…":"保存"}</button><button disabled={pending} onClick={()=>setDraft(null)} className="rounded-lg border px-4 py-3">キャンセル</button></div>
      {draft.updatedAt&&<p className="mt-5 text-xs text-slate-500">業者は削除せず、利用停止は「有効」のチェックを外して管理します。</p>}
    </div></div>}
  </main>;
}
