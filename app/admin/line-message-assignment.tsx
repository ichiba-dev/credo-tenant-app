"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignLineMessage, getLineRepairCandidates } from "./line-message-actions";
import type { LineRepairCandidate } from "./types";

export default function LineMessageAssignment({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [repairs, setRepairs] = useState<LineRepairCandidate[]>([]);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  function run(confirm: boolean) {
    if (busy.current || pending || (confirm && !selected)) return;
    busy.current = true;
    setNotice("");
    startTransition(async () => {
      try {
        if (confirm) {
          const result = await assignLineMessage(messageId, selected);
          if (!result.ok) { setNotice(result.message); if (result.loginRequired) window.location.assign("/admin/login"); return; }
          setDone(true); router.refresh();
        } else {
          const result = await getLineRepairCandidates(messageId);
          if (!result.ok) { setNotice(result.message); if (result.loginRequired) window.location.assign("/admin/login"); return; }
          setRepairs(result.repairs); setSelected(""); setOpen(true);
        }
      } catch { setNotice("通信に失敗しました。再読み込みしてください。"); }
      finally { busy.current = false; }
    });
  }
  if (done) return <p role="status" className="mt-3 text-sm text-emerald-700">修理依頼に紐づけました。</p>;
  return <div className="mt-4 border-t border-gray-200 pt-3">
    {!open ? <button type="button" disabled={pending} onClick={() => run(false)} className="rounded-lg bg-[#0b2e59] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{pending ? "確認中…" : "修理依頼に紐づける"}</button>
      : <div>
        {!repairs.length ? <p className="text-sm text-gray-500">この入居者の修理依頼はありません。</p>
          : <fieldset disabled={pending}><legend className="text-sm font-bold text-gray-700">紐づけ先の修理依頼を選択</legend>
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{repairs.map(repair => <label key={repair.id} className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
              <input type="radio" name={`line-repair-${messageId}`} value={String(repair.id)} checked={selected === String(repair.id)} onChange={event => setSelected(event.target.value)} />
              <span className="min-w-0"><span className="block font-bold">{repair.property_name || "物件名未登録"} / {repair.room_number || "号室未登録"}</span>
                <span className="block">{repair.category || "カテゴリ未登録"} ・ {repair.status || "ステータス未登録"}</span>
                <span className="mt-1 block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{repair.description}</span>
                <span className="mt-1 block text-xs text-gray-500">受付日：{new Date(repair.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span></span>
            </label>)}</div>
            <button type="button" onClick={() => run(true)} disabled={!selected || pending} className="mt-3 rounded-lg bg-[#0b2e59] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{pending ? "保存中…" : "選択した修理依頼に確定"}</button>
          </fieldset>}
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setNotice(""); }} className="mt-3 ml-3 text-sm text-gray-600">キャンセル</button>
      </div>}
    {notice && <p role="alert" className="mt-2 text-sm text-red-700">{notice}</p>}
  </div>;
}
