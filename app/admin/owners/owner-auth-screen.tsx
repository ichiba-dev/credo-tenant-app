"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { correctOwnerAuthLink, linkOrInviteOwner, retryOwnerAuthOperation } from "./actions";
import type { OwnerAuthRow } from "./data";
import { ownerAuthStatusLabels } from "@/lib/owner-auth-state";

function operationId() {
  return crypto.randomUUID();
}

export default function OwnerAuthScreen({ rows }: { rows: OwnerAuthRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [correction, setCorrection] = useState<OwnerAuthRow | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function run(owner: OwnerAuthRow, operation: () => Promise<{ ok: boolean; message?: string }>) {
    if (busyId) return;
    setBusyId(owner.id);
    setMessage("");
    try {
      const result = await operation();
      setMessage(result.ok ? "操作を記録しました。状態を更新します。" : result.message ?? "操作に失敗しました。");
      if (result.ok) router.refresh();
    } catch {
      setMessage("通信結果を確認できません。監査状態を確認してください。");
    } finally {
      setBusyId(null);
    }
  }

  function actions(row: OwnerAuthRow) {
    if (!row.is_active || !row.email?.trim()) return <span className="text-sm text-slate-500">操作不可</span>;
    if (row.operation && ["needs_review", "auth_created_db_pending", "started"].includes(row.operation.status)) {
      return row.operation.can_retry ? <button disabled={busyId !== null} onClick={() => void run(row, () => retryOwnerAuthOperation(row.operation!.request_id))}
        className="rounded border border-amber-700 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">既知Authへ再試行</button>
        : <span className="text-sm text-amber-900">監査確認後に手動解決</span>;
    }
    if (row.auth_user_id) {
      return ["email_mismatch", "auth_user_missing"].includes(row.status) && row.candidate_auth ? <button disabled={busyId !== null}
        onClick={() => { setCorrection(row); setConfirmed(false); }}
        className="rounded bg-red-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Auth連携を訂正</button>
        : <span className="text-sm text-slate-500">自動変更なし</span>;
    }
    if (row.status !== "unlinked") return <span className="text-sm text-slate-500">操作不可</span>;
    return <button disabled={busyId !== null} onClick={() => void run(row, () => linkOrInviteOwner({
      intent: "link_or_invite", ownerId: row.id, requestId: operationId(),
    }))} className="rounded bg-[#174f45] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
      {row.candidate_auth ? "既存Authを連携" : "Auth招待を送信"}
    </button>;
  }

  function status(row: OwnerAuthRow) {
    const palette: Record<string, string> = {
      linked: "bg-emerald-100 text-emerald-900",
      unlinked: "bg-sky-100 text-sky-900",
      email_mismatch: "bg-red-100 text-red-900",
      auth_user_missing: "bg-orange-100 text-orange-900",
      owner_inactive: "bg-slate-200 text-slate-700",
      review_required: "bg-amber-100 text-amber-950",
    };
    return <span className={`inline-flex rounded px-2 py-1 text-xs font-bold ${palette[row.status]}`}>
      {ownerAuthStatusLabels[row.status]}
    </span>;
  }

  return <main className="min-h-screen bg-[#f3f4ed] px-4 py-6 text-[#172c2a] sm:px-7">
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[#c7d0c8] pb-4">
        <div><p className="text-xs font-bold uppercase text-[#55716a]">CREDO / 管理画面</p><h1 className="mt-1 text-2xl font-bold">オーナーAuth管理</h1></div>
        <a href="/admin" className="rounded border border-[#aabbb1] px-3 py-2 text-sm font-semibold">修理管理へ戻る</a>
      </header>
      <p role="status" aria-live="polite" className="mb-4 min-h-6 text-sm">{busyId ? "Auth状態を検証中…" : message}</p>
      {rows.length === 0 ? <p className="border-y border-[#c7d0c8] py-8 text-center text-sm text-slate-600">オーナーが登録されていません。</p> : <>
        <div className="hidden overflow-x-auto border-y border-[#c7d0c8] md:block">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[#e6e9df] text-xs uppercase text-[#4c625b]"><tr>
              <th className="px-3 py-3">オーナー</th><th className="px-3 py-3">登録メール</th><th className="px-3 py-3">有効</th>
              <th className="px-3 py-3">所有物件</th><th className="px-3 py-3">Auth連携</th><th className="px-3 py-3">Auth側email</th><th className="px-3 py-3">状態 / 操作</th>
            </tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-[#d9ded6] align-top">
              <td className="px-3 py-4 font-semibold">{row.name}</td><td className="px-3 py-4">{row.email || "未登録"}</td>
              <td className="px-3 py-4">{row.is_active ? "有効" : "無効"}</td>
              <td className="px-3 py-4">{row.properties.length ? row.properties.join("、") : "なし"}</td>
              <td className="px-3 py-4">{row.auth_user_id ? "あり" : "なし"}</td><td className="px-3 py-4">{row.auth_email ?? "なし"}</td>
              <td className="min-w-52 px-3 py-4">{status(row)}<div className="mt-2">{actions(row)}</div>
                {row.candidate_auth && row.auth_user_id && ["email_mismatch", "auth_user_missing"].includes(row.status) && <p className="mt-2 text-xs">変更候補: {row.candidate_auth.email}</p>}
                {row.operation && <p className="mt-2 text-xs text-slate-600">監査: {row.operation.status} / {row.operation.error_code ?? row.operation.request_id}</p>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>
        <ul className="space-y-3 md:hidden">{rows.map((row) => <li key={row.id} className="border-y border-[#c7d0c8] bg-white/70 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{row.name}</h2>{status(row)}</div>
          <dl className="mt-4 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-500">登録メール</dt><dd className="break-all">{row.email || "未登録"}</dd>
            <dt className="text-slate-500">有効</dt><dd>{row.is_active ? "有効" : "無効"}</dd>
            <dt className="text-slate-500">所有物件</dt><dd>{row.properties.length ? row.properties.join("、") : "なし"}</dd>
            <dt className="text-slate-500">Auth連携</dt><dd>{row.auth_user_id ? "あり" : "なし"}</dd>
            <dt className="text-slate-500">Auth側email</dt><dd className="break-all">{row.auth_email ?? "なし"}</dd>
            {row.candidate_auth && row.auth_user_id && ["email_mismatch", "auth_user_missing"].includes(row.status) && <><dt className="text-slate-500">訂正候補</dt><dd className="break-all">{row.candidate_auth.email}</dd></>}
          </dl>
          <div className="mt-4">{actions(row)}</div>
          {row.operation && <p className="mt-2 break-all text-xs text-slate-600">監査: {row.operation.status} / {row.operation.error_code ?? row.operation.request_id}</p>}
        </li>)}</ul>
      </>}
      {correction && correction.candidate_auth && <div role="presentation" className="fixed inset-0 z-20 grid place-items-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCorrection(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="correction-title" className="w-full max-w-lg border border-[#8c9d93] bg-[#fbfcf7] p-5 shadow-xl">
          <h2 id="correction-title" className="text-lg font-bold">Auth連携を訂正</h2>
          <dl className="mt-4 grid grid-cols-[6rem_1fr] gap-3 text-sm"><dt>オーナー</dt><dd>{correction.name}</dd><dt>現在</dt><dd className="break-all">{correction.auth_email ?? "Authユーザー不存在"}</dd><dt>変更先</dt><dd className="break-all">{correction.candidate_auth.email}</dd></dl>
          <label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4 accent-[#174f45]" />現在のAuth連携を上書きし、表示中の変更先へ訂正することを確認します。</label>
          <div className="mt-6 flex justify-end gap-3"><button onClick={() => setCorrection(null)} className="rounded border border-[#aabbb1] px-3 py-2 text-sm">キャンセル</button>
            <button disabled={!confirmed || busyId !== null} onClick={() => void run(correction, async () => {
              const result = await correctOwnerAuthLink({ intent: "correct_link", ownerId: correction.id,
                requestId: operationId(), expectedAuthUserId: correction.auth_user_id,
                targetAuthUserId: correction.candidate_auth!.id, confirmed });
              if (result.ok) { setCorrection(null); setConfirmed(false); }
              return result;
            })} className="rounded bg-red-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">訂正を実行</button>
          </div>
        </section>
      </div>}
    </div>
  </main>;
}