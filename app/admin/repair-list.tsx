"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import RepairTodos from "./repair-todos";
import { openRepairDetails } from "./repair-todo-state";
import type { AdminRepair } from "./types";
import { groupRepairs, matchesRepairFilter, matchesRepairSearch, repairListState, type RepairFilter } from "./repair-list-state";

const filters: {key: RepairFilter; label: string}[] = [
  {key:"attention",label:"要対応"}, {key:"arranging",label:"手配中"},
  {key:"estimate",label:"見積待ち"}, {key:"completed",label:"完了"}, {key:"all",label:"すべて"},
];
const dateFormat = new Intl.DateTimeFormat("ja-JP", {timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
export default function RepairList({repairs, renderDetail, calendarOverview, calendarWeek, listHeader}: {repairs: AdminRepair[]; calendarOverview?: ReactNode; calendarWeek?: ReactNode; listHeader?: ReactNode; renderDetail: (repair: AdminRepair, desktop?: boolean, active?: boolean) => ReactNode}) {
  const [filter,setFilter] = useState<RepairFilter>("active");
  const [search,setSearch] = useState("");
  const [visited,setVisited] = useState<Set<number>>(() => new Set());
  const [jumpId,setJumpId] = useState<number | null>(null);
  const [desktop,setDesktop] = useState(false);
  const [selectedId,setSelectedId] = useState<number | null>(null);
  const [calendarExpanded,setCalendarExpanded] = useState(false);
  useEffect(() => {
    const media=window.matchMedia('(min-width: 1280px)');
    const update=()=>setDesktop(media.matches);
    update();media.addEventListener('change',update);
    return()=>media.removeEventListener('change',update);
  },[]);
  function selectRepair(id:number) {
    setFilter("all");setSearch("");
    setVisited(previous=>new Set(previous).add(id));
    setSelectedId(id);setJumpId(id);
  }
  useEffect(() => {
    const followHash = () => {
      const match = /^#repair-detail-(\d+)$/.exec(window.location.hash);
      const id = match ? Number(match[1]) : 0;
      if (!repairs.some(repair => repair.id === id)) return;
      setFilter("all"); setSearch("");
      setVisited(previous => new Set(previous).add(id)); setJumpId(id);
      setSelectedId(id);
    };
    followHash();window.addEventListener("hashchange",followHash);
    return () => window.removeEventListener("hashchange",followHash);
  }, [repairs]);
  useEffect(() => {
    if (jumpId === null) return;
    if(desktop) {
      const row=document.getElementById(`repair-detail-${jumpId}`);
      const group=row?.parentElement?.closest('details');
      if(group)group.open=true;
      row?.scrollIntoView({block:'nearest'});
      const pane=document.getElementById('selected-repair-pane');
      if(pane){pane.scrollTop=0;pane.focus({preventScroll:true});}
    } else openRepairDetails(document, jumpId);
    setJumpId(null);
  }, [jumpId,desktop]);
  const groups = useMemo(() => groupRepairs(repairs),[repairs]);
  const visible = (repair: AdminRepair) => matchesRepairFilter(repairListState(repair),filter) && matchesRepairSearch(repair,search);
  const visibleCount = repairs.filter(visible).length;
  const countLabel = filter === "active" ? "未完了" : filter === "all" ? "表示" : filters.find(item => item.key === filter)?.label;
  const selected=repairs.find(repair=>repair.id===selectedId);
  return <div className={`grid min-w-0 grid-cols-1 items-start gap-4 xl:min-h-0 xl:flex-1 xl:items-stretch ${calendarExpanded?'xl:grid-cols-[minmax(0,30fr)_minmax(0,35fr)_minmax(0,35fr)]':'xl:grid-cols-[minmax(0,35fr)_minmax(0,40fr)_minmax(0,25fr)]'}`}>
    <aside aria-label="今日やること・予定" tabIndex={0} onClickCapture={event=>{
      if(!desktop||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const href=(event.target as HTMLElement).closest('a')?.getAttribute('href');
      const match=href&&/^\/admin#repair-detail-(\d+)$/.exec(href);
      if(match&&repairs.some(repair=>repair.id===Number(match[1]))){event.preventDefault();selectRepair(Number(match[1]));}
    }}
      className="min-w-0 xl:sticky xl:top-0 xl:col-start-3 xl:row-start-1 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
    <RepairTodos repairs={repairs} onSelect={selectRepair} />
    {calendarOverview}
    <div className="hidden xl:block">
      {calendarWeek}
      <button type="button" aria-expanded={calendarExpanded} onClick={()=>setCalendarExpanded(value=>!value)}
        className="my-2 rounded border bg-white px-3 py-2 text-sm text-[#0b2e59]">{calendarExpanded?'カレンダーを縮める':'カレンダーを広げる'}</button>
    </div>
    <a href="/admin/calendar" className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-[#0b2e59] underline">カレンダーを開く</a>
    </aside>
    <section className="min-w-0 xl:col-start-1 xl:row-start-1 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:pr-1" aria-label="修理案件一覧">
    {listHeader}
    <h2 className="mb-3 font-bold text-[#0b2e59]">修理依頼一覧</h2>
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-3">
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
                <details id={`repair-detail-${repair.id}`} onToggle={event => {if(event.currentTarget.open) setVisited(previous => new Set(previous).add(repair.id));}}>
                  <summary aria-current={desktop&&selectedId===repair.id?'true':undefined}
                    onClick={event=>{if(desktop){event.preventDefault();setVisited(previous=>new Set(previous).add(repair.id));setSelectedId(repair.id);setJumpId(repair.id);}}}
                    className={`cursor-pointer list-none px-4 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700 ${desktop&&selectedId===repair.id?'border-l-4 border-[#0b2e59] bg-blue-50':''}`}>
                    <span className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_auto] md:items-center xl:grid-cols-2">
                      <span className="min-w-0"><span className="block font-bold text-[#0b2e59]">{repair.room_number || "号室未登録"}{repair.room_number && "号室"}</span><span className="block truncate text-xs text-slate-600">{repair.tenant_name || "入居者名未登録"}</span></span>
                      <span className="min-w-0"><span className="block text-sm font-medium">{repair.category || "カテゴリ未登録"}</span><span className="block truncate text-xs text-slate-600">{repair.description || "内容未登録"}</span></span>
                      <span><span className="block text-xs text-slate-600">{repair.status || "ステータス未登録"}</span><span className="mt-1 flex flex-wrap gap-1">{state.reasons.map(reason => <span key={reason} className={`rounded px-2 py-0.5 text-xs ${state.attention ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{reason}</span>)}</span></span>
                      <span className="text-xs text-slate-500"><span className="block">最終更新（確認可能分）</span>{state.updatedAt ? <time dateTime={new Date(state.updatedAt).toISOString()}>{dateFormat.format(state.updatedAt)}</time> : "日時不明"}<span className="mt-1 block text-[#0b2e59]">{desktop?'詳細を表示 →':'詳細を開閉 ↕'}</span></span>
                    </span>
                  </summary>
                  {/* Mount only after first opening; native details preserves unsaved child state when closed. */}
                  {!desktop&&visited.has(repair.id) && <div className="border-t bg-slate-50 p-4 sm:p-5">{renderDetail(repair,false,true)}</div>}
                </details>
              </div>;
            })}
          </details>
        </div>;
      })}
    </div>
  </section>
  {desktop&&<section id="selected-repair-pane" aria-label="選択中の案件詳細" tabIndex={-1}
    className="min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-3 xl:col-start-2 xl:row-start-1">
    {!selected?<p className="p-4 text-sm text-slate-500">{repairs.length?'左の一覧から案件を選択してください。':'表示する案件はありません。'}</p>:
      <h2 className="mb-3 break-words font-bold text-[#0b2e59]">{selected.property_name} {selected.room_number}号室 · {selected.category}</h2>}
    {repairs.filter(repair=>visited.has(repair.id)).map(repair=><div key={repair.id} hidden={repair.id!==selectedId}>
      {renderDetail(repair,true,repair.id===selectedId)}
    </div>)}
  </section>}
  </div>;
}
