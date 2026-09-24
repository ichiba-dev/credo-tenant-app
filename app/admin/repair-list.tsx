"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { AdminRepair } from "./types";
import { groupRepairs, matchesRepairFilter, matchesRepairSearch, repairListState, type RepairFilter } from "./repair-list-state";

const filters: {key: RepairFilter; label: string}[] = [
  {key:"attention",label:"要対応"}, {key:"arranging",label:"手配中"},
  {key:"estimate",label:"見積待ち"}, {key:"completed",label:"完了"}, {key:"all",label:"すべて"},
];
const dateFormat = new Intl.DateTimeFormat("ja-JP", {timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
export default function RepairList({repairs, renderDetail}: {repairs: AdminRepair[]; renderDetail: (repair: AdminRepair) => ReactNode}) {
  const [filter,setFilter] = useState<RepairFilter>("active");
  const [search,setSearch] = useState("");
  const [visited,setVisited] = useState<Set<number>>(() => new Set());
  const groups = useMemo(() => groupRepairs(repairs),[repairs]);
  const visible = (repair: AdminRepair) => matchesRepairFilter(repairListState(repair),filter) && matchesRepairSearch(repair,search);
  const visibleCount = repairs.filter(visible).length;
  const countLabel = filter === "active" ? "未完了" : filter === "all" ? "表示" : filters.find(item => item.key === filter)?.label;
  return <section className="mt-5" aria-label="修理案件一覧">
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {filters.map(item => <button key={item.key} type="button" aria-pressed={filter===item.key}
        onClick={() => setFilter(item.key)} className={`rounded-xl border p-3 text-left ${filter===item.key ? "border-[#0b2e59] bg-[#0b2e59] text-white" : "border-slate-200 bg-white text-[#0b2e59]"}`}>
        <span className="block text-xs">{item.label}</span><strong className="text-xl">{repairs.filter(r => matchesRepairFilter(repairListState(r),item.key)).length}</strong><span className="ml-1 text-xs">件</span>
      </button>)}
    </div>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 text-sm font-medium text-[#0b2e59]">案件を絞り込む
        <input type="search" value={search} onChange={event => setSearch(event.target.value)}
          placeholder="物件名・号室・入居者・カテゴリ・ステータス"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" />
      </label>
      <button type="button" aria-pressed={filter==="active"} onClick={() => {setFilter("active");setSearch("");}}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0b2e59]">未完了・要対応順に戻す</button>
    </div>
    <p role="status" className="mt-3 text-sm text-slate-600">{filter==="active" ? "未完了を要対応順に表示" : `${filters.find(f=>f.key===filter)?.label}を表示`} · {visibleCount} / {repairs.length}件</p>
    <p className="mt-1 text-xs text-slate-500">件数は全案件から集計（状態は重複あり）。最終更新は取得済みの受付・メッセージ・手配履歴・見積ファイルの最新日時です。見積待ちは明示されたステータスのみで判定します。</p>
    {visibleCount===0 && <p className="mt-5 rounded-xl bg-white p-5 text-sm text-slate-600">該当する案件はありません。「すべて」や検索条件を確認してください。</p>}
    <div className="mt-4 space-y-4">
      {groups.map(group => {
        const count = group.repairs.filter(visible).length;
        return <div key={group.property} hidden={count===0}>
          <details open className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer bg-[#0b2e59] px-4 py-3 text-sm font-bold text-white">{group.property}<span className="ml-3 font-normal">{countLabel}{count} / 全{group.repairs.length}{search.trim() && "（検索一致分）"}</span></summary>
            {group.repairs.map(repair => {
              const state = repairListState(repair);
              return <div key={repair.id} hidden={!visible(repair)} className="border-t border-slate-100">
                <details onToggle={event => {if(event.currentTarget.open) setVisited(previous => new Set(previous).add(repair.id));}}>
                  <summary className="cursor-pointer list-none px-4 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700">
                    <span className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_auto] md:items-center">
                      <span className="min-w-0"><span className="block font-bold text-[#0b2e59]">{repair.room_number || "号室未登録"}{repair.room_number && "号室"}</span><span className="block truncate text-xs text-slate-600">{repair.tenant_name || "入居者名未登録"}</span></span>
                      <span className="min-w-0"><span className="block text-sm font-medium">{repair.category || "カテゴリ未登録"}</span><span className="block truncate text-xs text-slate-600">{repair.description || "内容未登録"}</span></span>
                      <span><span className="block text-xs text-slate-600">{repair.status || "ステータス未登録"}</span><span className="mt-1 flex flex-wrap gap-1">{state.reasons.map(reason => <span key={reason} className={`rounded px-2 py-0.5 text-xs ${state.attention ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{reason}</span>)}</span></span>
                      <span className="text-xs text-slate-500"><span className="block">最終更新（確認可能分）</span>{state.updatedAt ? <time dateTime={new Date(state.updatedAt).toISOString()}>{dateFormat.format(state.updatedAt)}</time> : "日時不明"}<span className="mt-1 block text-[#0b2e59]">詳細を開閉 ↕</span></span>
                    </span>
                  </summary>
                  {/* Mount only after first opening; native details preserves unsaved child state when closed. */}
                  {visited.has(repair.id) && <div className="border-t bg-slate-50 p-4 sm:p-5">{renderDetail(repair)}</div>}
                </details>
              </div>;
            })}
          </details>
        </div>;
      })}
    </div>
  </section>;
}
