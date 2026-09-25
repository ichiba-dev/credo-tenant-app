"use client";
import { useState, type ReactNode } from "react";

export const DETAIL_TABS = [
  ["overview", "概要"], ["line", "入居者LINE"], ["files", "写真・PDF"], ["vendors", "業者手配"],
  ["estimates", "見積"], ["schedule", "予定"], ["history", "対応履歴"], ["owner", "オーナー報告"],
] as const;
type Tab = typeof DETAIL_TABS[number][0];
export default function RepairDetailTabs({ repairId, active, desktop, sections }: {
  repairId: number; active: boolean; desktop: boolean; sections: Record<Tab, ReactNode>;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [wasActive, setWasActive] = useState(active);
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["overview"]));
  // Reset navigation on case selection without discarding mounted form drafts.
  if (active !== wasActive) { setWasActive(active); if (active) setTab("overview"); }
  if (!desktop) return <div className="min-w-0 break-words">{DETAIL_TABS.map(([key, label]) =>
    <section key={key} aria-label={label}>{sections[key]}</section>)}</div>;
  const select = (key: Tab) => { setTab(key); setVisited(previous => new Set(previous).add(key)); };
  return <div className="min-w-0 break-words [&_input]:min-w-0 [&_input]:max-w-full [&_select]:max-w-full">
    <div data-detail-tabs role="tablist" aria-label="案件詳細" className="sticky top-0 z-10 flex flex-wrap gap-1 border-b bg-white pb-2">
      {DETAIL_TABS.map(([key, label], index) => <button key={key} type="button" role="tab"
        id={`repair-${repairId}-tab-${key}`} aria-controls={`repair-${repairId}-panel-${key}`}
        aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
        onClick={() => select(key)} onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % DETAIL_TABS.length : event.key === "ArrowLeft" ? (index + DETAIL_TABS.length - 1) % DETAIL_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? DETAIL_TABS.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); select(DETAIL_TABS[next][0]);
          document.getElementById(`repair-${repairId}-tab-${DETAIL_TABS[next][0]}`)?.focus();
        }} className={`rounded px-3 py-2 text-xs font-semibold ${tab === key ? "bg-[#0b2e59] text-white" : "bg-slate-100 text-[#0b2e59]"}`}>{label}</button>)}
    </div>
    {DETAIL_TABS.map(([key]) => visited.has(key) && <div data-repair-panel key={key} role="tabpanel"
      id={`repair-${repairId}-panel-${key}`} aria-labelledby={`repair-${repairId}-tab-${key}`}
      hidden={tab !== key} tabIndex={0} className="py-3">{sections[key]}</div>)}
  </div>;
}
