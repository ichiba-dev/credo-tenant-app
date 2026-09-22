"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmManualVendorDispatch, selectRepairVendor } from "./vendor-dispatch-actions";
import type { VendorCandidate, VendorDispatchHistory } from "./types";

const statusLabels: Record<string, string> = {
  candidate: "手配候補",
  dispatched: "依頼済み",
  acknowledged: "業者確認済み",
  scheduling: "日程調整中",
  visit_scheduled: "現調予定",
  completed: "完了",
  cancelled: "取消",
};
const eventLabels: Record<string, string> = {
  selected: "業者を選択",
  status_changed: "ステータス変更",
  quote_received: "見積受領",
};
const formatDate = (value: string) => new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

function manualMessageDraft(dispatch: VendorDispatchHistory, repair: {
  propertyName: string;
  roomNumber: string;
  category: string;
  description: string;
  managementCompanyName: string;
}) {
  return `${dispatch.vendorName}\n${dispatch.vendorContactName}様\n\nいつもお世話になっております。\n${repair.managementCompanyName}です。\n\n下記修繕についてご対応をお願いいたします。\n\n物件：${repair.propertyName}\n号室：${repair.roomNumber}号室\n修繕カテゴリ：${repair.category}\n\n修繕内容：\n${repair.description}\n\n手配内容：\n${dispatch.instructions}\n\nよろしくお願いいたします。`;
}

export function VendorDispatchSection({ repairId, candidates, dispatches, canUpdate,
  unavailable, suggestedInstructions, propertyName, roomNumber, repairCategory,
  repairDescription, photoCount, managementCompanyName }: {
  repairId: number;
  candidates: VendorCandidate[];
  dispatches: VendorDispatchHistory[];
  canUpdate: boolean;
  unavailable?: boolean;
  suggestedInstructions: string;
  propertyName: string;
  roomNumber: string;
  repairCategory: string;
  repairDescription: string;
  photoCount: number;
  managementCompanyName: string;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [requestId, setRequestId] = useState("");
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [manualDispatchId, setManualDispatchId] = useState("");
  const [manualRequestId, setManualRequestId] = useState("");
  const [manualBody, setManualBody] = useState("");
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [manualPending, setManualPending] = useState(false);
  const [manualFeedback, setManualFeedback] = useState("");
  const categories = useMemo(() => [...new Set(candidates.flatMap((vendor) => vendor.categories))].sort(), [candidates]);
  const areas = useMemo(() => [...new Map(candidates.flatMap((vendor) => vendor.areas)
    .map((item) => [item.areaCode, item])).values()].sort((a, b) => a.areaLabel.localeCompare(b.areaLabel, "ja")), [candidates]);
  const filtered = useMemo(() => candidates.filter((vendor) =>
    (!query.trim() || vendor.companyName.toLocaleLowerCase("ja-JP").includes(query.trim().toLocaleLowerCase("ja-JP"))) &&
    (!category || vendor.categories.includes(category)) &&
    (!area || vendor.areas.some((item) => item.areaCode === area))), [area, candidates, category, query]);
  const selected = candidates.find((vendor) => vendor.id === vendorId);

  function begin() {
    setRequestId(crypto.randomUUID());
    setInstructions(suggestedInstructions.slice(0, 5000));
    setVendorId("");
    setConfirmDuplicate(false);
    setMessage("");
    setOpen(true);
  }
  function close() {
    if (pending) return;
    setOpen(false);
    setRequestId("");
    setMessage("");
  }
  async function submit() {
    if (busy.current || !requestId || !vendorId || !instructions.trim() || instructions.trim().length > 5000) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      const result = await selectRepairVendor({ repairId, vendorId, requestId, instructions, confirmDuplicate });
      if (!result.ok) {
        setMessage(result.message);
        if (result.loginRequired) window.location.assign("/admin/login");
        return;
      }
      setOpen(false);
      setRequestId("");
      router.refresh();
    } catch {
      setMessage("通信に失敗しました。同じ画面のまま再試行するか、再読み込みして保存状況を確認してください。");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function beginManual(dispatch: VendorDispatchHistory) {
    setManualDispatchId(dispatch.id);
    setManualRequestId(crypto.randomUUID());
    setManualBody(manualMessageDraft(dispatch, { propertyName, roomNumber, category: repairCategory,
      description: repairDescription, managementCompanyName }));
    setManualConfirmed(false);
    setManualFeedback("");
  }
  function closeManual() {
    if (manualPending) return;
    setManualDispatchId("");
    setManualRequestId("");
    setManualBody("");
    setManualConfirmed(false);
    setManualFeedback("");
  }
  async function copyManualBody() {
    try {
      await navigator.clipboard.writeText(manualBody);
      setManualFeedback("本文をコピーしました。外部で送信後、手配済みにしてください。");
    } catch {
      setManualFeedback("コピーできませんでした。本文を選択してコピーしてください。");
    }
  }
  async function confirmManual() {
    if (manualPending || !manualDispatchId || !manualRequestId || !manualBody.trim() || !manualConfirmed) return;
    setManualPending(true);
    setManualFeedback("");
    try {
      const result = await confirmManualVendorDispatch({ repairId, dispatchId: manualDispatchId,
        requestId: manualRequestId, messageBody: manualBody, externalDeliveryConfirmed: true });
      if (!result.ok) {
        setManualFeedback(result.message);
        if (result.loginRequired) window.location.assign("/admin/login");
        return;
      }
      setManualDispatchId("");
      setManualRequestId("");
      setManualBody("");
      setManualConfirmed(false);
      router.refresh();
    } catch {
      setManualFeedback("記録に失敗しました。同じ受付番号のまま再試行してください。");
    } finally {
      setManualPending(false);
    }
  }

  return <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-bold text-[#0b1f3a]">業者手配</h3>
        <p className="text-xs text-slate-500">選択した業者と手配内容を時系列で確認できます。</p></div>
      {!unavailable && canUpdate && !open && <button type="button" onClick={begin}
        className="rounded-lg bg-[#0b1f3a] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#15365f]">
        業者を追加手配</button>}
    </div>
    {unavailable && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
      業者手配情報を取得できませんでした。時間をおいて再読み込みしてください。</p>}
    {!unavailable && dispatches.length === 0 && !open && <p className="mt-3 text-sm text-slate-500">
      まだ業者は選択されていません。</p>}
    {!unavailable && dispatches.length > 0 && <p className="mt-3 text-xs font-bold text-slate-500">
      手配履歴 {dispatches.length}件（新しい順）</p>}
    {!unavailable && dispatches.map((dispatch) => <article key={dispatch.id}
      className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-bold text-slate-900">{dispatch.vendorName}</p>
          <p className="text-sm text-slate-600">担当者：{dispatch.vendorContactName}</p></div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-900">
          {statusLabels[dispatch.status] ?? dispatch.status}</span>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-bold text-slate-500">選択日時</dt><dd>{formatDate(dispatch.selectedAt)}</dd></div>
        <div><dt className="text-xs font-bold text-slate-500">担当スタッフ</dt><dd>{dispatch.assignedByName}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-bold text-slate-500">手配内容</dt>
          <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{dispatch.instructions}</dd></div>
      </dl>
      {dispatch.messages.length > 0 && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-xs font-bold text-emerald-900">送信記録</p>
        {dispatch.messages.map((item) => <div key={item.id} className="mt-2 text-sm text-emerald-950">
          <p className="font-bold">手配済み ・ {item.channel === "manual" ? "手動送信" : item.channel}</p>
          <p className="text-xs">{item.sentAt ? formatDate(item.sentAt) : "日時未確定"} ・ 担当：{item.sentByName}</p>
          <p className="text-xs">送信記録：{item.deliveryStatus === "manual_confirmed" ? "スタッフ確認済み" : item.deliveryStatus}</p>
        </div>)}
      </div>}
      {canUpdate && dispatch.status === "candidate" && manualDispatchId !== dispatch.id && <button
        type="button" onClick={() => beginManual(dispatch)}
        className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">
        業者へ手配</button>}
      {manualDispatchId === dispatch.id && <div className="mt-4 rounded-xl border-2 border-emerald-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3"><div>
          <h4 className="font-bold text-[#0b1f3a]">送信内容の確認</h4>
          <p className="text-xs font-bold text-amber-800">送信方法：手動（この画面から外部送信は行いません）</p>
        </div><button type="button" onClick={closeManual} disabled={manualPending}
          className="text-sm text-slate-600 underline">閉じる</button></div>
        <dl className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-bold text-slate-500">業者</dt><dd>{dispatch.vendorName} / {dispatch.vendorContactName}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">連絡先</dt><dd>{[dispatch.vendorPhone, dispatch.vendorEmail].filter(Boolean).join(" / ") || "未登録"}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">物件・号室</dt><dd>{propertyName} {roomNumber}号室</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">修繕カテゴリ</dt><dd>{repairCategory}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs font-bold text-slate-500">修繕内容</dt><dd>{repairDescription}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs font-bold text-slate-500">手配内容</dt><dd>{dispatch.instructions}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">写真枚数</dt><dd>{photoCount}枚</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">管理会社名</dt><dd>{managementCompanyName}</dd></div>
        </dl>
        <label className="mt-3 block text-sm font-bold text-slate-700">送信用本文
          <textarea value={manualBody} onChange={(event) => setManualBody(event.target.value)}
            maxLength={10000} rows={12} className="mt-1 w-full rounded-lg border p-3 font-normal" /></label>
        <p className="text-right text-xs text-slate-500">{manualBody.length} / 10000</p>
        <button type="button" onClick={copyManualBody}
          className="mt-2 rounded-lg border border-[#0b1f3a] px-4 py-2 text-sm font-bold text-[#0b1f3a]">
          本文をコピー</button>
        <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <input type="checkbox" checked={manualConfirmed} onChange={(event) => setManualConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4" />
          <span>アプリ外の電話・LINE・メール等で連絡済みです。手動送信として記録します。</span>
        </label>
        {manualFeedback && <p role="status" className="mt-2 text-sm">{manualFeedback}</p>}
        <button type="button" onClick={confirmManual}
          disabled={manualPending || !manualConfirmed || !manualBody.trim()}
          className="mt-3 w-full rounded-lg bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">
          {manualPending ? "記録中…" : "手配済みにする"}</button>
      </div>}
      {dispatch.events.length > 0 && <ol className="mt-4 border-l-2 border-slate-200 pl-4">
        {dispatch.events.map((event) => <li key={event.id} className="relative pb-3 text-sm last:pb-0">
          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-[#0b1f3a]" />
          <p className="font-medium">{eventLabels[event.eventType] ?? event.eventType}
            {event.toStatus ? `：${statusLabels[event.toStatus] ?? event.toStatus}` : ""}</p>
          <p className="text-xs text-slate-500">{formatDate(event.occurredAt)} ・ 担当：{event.actorName}</p>
          {event.note && <p className="mt-1 whitespace-pre-wrap text-slate-600">{event.note}</p>}
        </li>)}</ol>}
    </article>)}
    {open && <div className="mt-4 rounded-xl border border-slate-300 bg-white p-4">
      <div className="flex items-center justify-between"><h4 className="font-bold text-[#0b1f3a]">手配する業者を選択</h4>
        <button type="button" onClick={close} disabled={pending} className="text-sm text-slate-600 underline">閉じる</button></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-bold text-slate-600">会社名検索
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="会社名を入力"
            className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" /></label>
        <label className="text-xs font-bold text-slate-600">カテゴリ
          <select value={category} onChange={(event) => setCategory(event.target.value)}
            className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal"><option value="">すべて</option>
            {categories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-600">対応エリア
          <select value={area} onChange={(event) => setArea(event.target.value)}
            className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal"><option value="">すべて</option>
            {areas.map((value) => <option key={value.areaCode} value={value.areaCode}>{value.areaLabel}</option>)}</select></label>
      </div>
      <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
        {filtered.map((vendor) => { const priorCount = dispatches.filter((item) => item.vendorId === vendor.id).length; return <button type="button" key={vendor.id}
          onClick={() => { setVendorId(vendor.id); setConfirmDuplicate(false); }}
          className={`rounded-lg border p-3 text-left ${vendorId === vendor.id ? "border-[#0b1f3a] bg-blue-50 ring-1 ring-[#0b1f3a]" : "border-slate-200 hover:bg-slate-50"}`}>
          <span className="block font-bold">{vendor.companyName}</span>
          <span className="block text-sm text-slate-600">担当：{vendor.contactName}</span>
          <span className="block text-sm text-slate-600">電話：{vendor.phone || "未登録"}</span>
          <span className="mt-2 block text-xs">カテゴリ：{vendor.categories.join("・") || "未登録"}</span>
          <span className="block text-xs">対応エリア：{vendor.areas.map((item) => item.areaLabel).join("・") || "未登録"}</span>
          {priorCount > 0 && <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">
            この案件で手配履歴 {priorCount}件</span>}
        </button>})}
        {filtered.length === 0 && <p className="text-sm text-slate-500">条件に合う有効な業者がありません。</p>}
      </div>
      {selected && <div className="mt-4">
        <label className="text-sm font-bold text-slate-700">手配内容 <span className="text-red-700">必須</span>
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={5000}
            rows={6} placeholder="現地確認や見積依頼の内容を入力してください。"
            className="mt-1 w-full rounded-lg border p-3 font-normal" /></label>
        <p className="text-right text-xs text-slate-500">{instructions.length} / 5000</p>
        {dispatches.some((item) => item.vendorId === selected.id) && <label
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <input type="checkbox" checked={confirmDuplicate} onChange={(event) => setConfirmDuplicate(event.target.checked)}
            className="mt-0.5 h-4 w-4" />
          <span>同じ業者の既存手配を確認しました。この業者を追加で手配します。</span>
        </label>}
        {message && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{message}</p>}
        <button type="button" onClick={submit} disabled={pending || !instructions.trim() ||
          (dispatches.some((item) => item.vendorId === selected.id) && !confirmDuplicate)}
          className="mt-3 w-full rounded-lg bg-[#0b1f3a] px-4 py-3 font-bold text-white disabled:opacity-50">
          {pending ? "保存中…" : `${selected.companyName}を手配候補にする`}</button>
      </div>}
    </div>}
  </section>;
}
