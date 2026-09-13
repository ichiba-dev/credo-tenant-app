"use client";

import { useActionState, useState } from "react";

import { type ApprovalState, submitApproval } from "./actions";

const initialState: ApprovalState = { status: "idle", message: "" };

export function ApprovalForm({ repairId, reportId }: { repairId: string; reportId: string }) {
  const [isConsulting, setIsConsulting] = useState(false);
  const [state, action, isPending] = useActionState(
    submitApproval.bind(null, repairId, reportId), initialState,
  );
  const isLocked = state.status === "success" || state.status === "answered";

  return (
    <form action={action} className="space-y-4 border-t border-slate-100 pt-6" aria-label="修繕報告への回答">
      <fieldset disabled={isPending || isLocked} className="space-y-4">
        <legend className="sr-only">修繕報告への回答</legend>
        {isConsulting ? (
          <>
            <div className="rounded-2xl border border-[#dfcca4] bg-[#fffdf8] p-4">
              <label htmlFor="consultation-comment" className="block text-sm font-bold text-[#0b2e59]">相談内容</label>
              <p id="consultation-help" className="mt-2 text-xs text-slate-600">ご相談したい内容を2,000文字以内で入力してください。</p>
              <textarea
                id="consultation-comment"
                name="comment"
                required
                maxLength={2000}
                rows={5}
                autoFocus
                aria-describedby="consultation-help"
                className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-[#b99452] focus:ring-2 focus:ring-[#b99452]/20"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button type="submit" name="decision" value="consultation" className="rounded-xl bg-[#0b2e59] px-5 py-4 font-bold text-white shadow-sm disabled:opacity-60">相談内容を送信</button>
              <button type="button" onClick={() => setIsConsulting(false)} className="rounded-xl border-2 border-[#0b2e59] px-5 py-4 font-bold text-[#0b2e59] disabled:opacity-60">戻る</button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="submit" name="decision" value="approved" className="rounded-xl bg-[#0b2e59] px-5 py-4 text-base font-bold text-white shadow-sm disabled:opacity-60">承認する</button>
            <button type="button" onClick={() => setIsConsulting(true)} className="rounded-xl border-2 border-[#0b2e59] bg-white px-5 py-4 text-base font-bold text-[#0b2e59] disabled:opacity-60">相談したい</button>
          </div>
        )}
      </fieldset>
      {isPending && <p role="status" className="text-center text-sm text-[#0b2e59]">回答を送信しています…</p>}
      {state.message && (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "rounded-xl bg-red-50 p-4 text-sm text-red-700" : "rounded-xl bg-[#f5ecd9] p-4 text-sm text-[#806126]"}>
          {state.message}
        </p>
      )}
      <p className="text-center text-xs text-slate-500">送信後は回答を変更できません。</p>
    </form>
  );
}
