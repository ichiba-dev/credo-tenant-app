"use client";

import { useEffect, useState } from "react";
import type { AdminRepair } from "./types";
import { repairTodos, TODO_RULES, type TodoKey } from "./repair-todo-state";

const dateFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export default function RepairTodos({ repairs, onSelect }: { repairs: AdminRepair[]; onSelect: (id: number) => void }) {
  const [filter, setFilter] = useState<TodoKey | "all">("all");
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const todos = repairTodos(repairs, now);
  const visible = todos.filter(todo => filter === "all" || todo.reasons.some(r => r.key === filter));
  return <section aria-labelledby="repair-todos-heading" className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
    <h2 id="repair-todos-heading" className="font-bold text-[#0b2e59]">今日やること <span className="ml-2">{todos.length}件</span></h2>
    <div className="mt-3 flex flex-wrap gap-2">
      {[{ key: "all", label: "すべて" }, ...TODO_RULES].map(rule => <button key={rule.key} type="button"
        aria-pressed={filter === rule.key} onClick={() => setFilter(rule.key as TodoKey | "all")}
        className={`rounded-lg border px-3 py-2 text-xs ${filter === rule.key ? "bg-[#0b2e59] text-white" : "border-slate-200 text-[#0b2e59]"}`}>
        {rule.label} {rule.key === "all" ? todos.length : todos.filter(t => t.reasons.some(r => r.key === rule.key)).length}
      </button>)}
    </div>
    <p className="mt-2 text-xs text-slate-500">条件別件数は重複を含みます。更新日時は取得済み履歴の最新日時です。期限や本日の予定を示すものではありません。</p>
    {visible.length === 0 ? <p className="mt-3 text-sm text-slate-600">{todos.length === 0 ? "現在、判定できるやることはありません。" : "この条件に該当する案件はありません。"}</p> :
      <ul className="mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto">{visible.map(todo => <li key={todo.repair.id}>
        <button type="button" onClick={() => onSelect(todo.repair.id)} className="grid w-full gap-1 rounded px-2 py-3 text-left hover:bg-slate-50 focus-visible:outline-blue-700 sm:grid-cols-[1fr_1fr_auto]">
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#0b2e59]">{todo.repair.property_name || "物件名未登録"} {todo.repair.room_number ? `${todo.repair.room_number}号室` : "号室未登録"}</span><span className="text-xs text-slate-600">{todo.repair.category || "カテゴリ未登録"}</span></span>
          <span className="min-w-0"><span className="block truncate text-sm">{todo.repair.description || "内容未登録"}</span><span className="text-xs font-medium text-[#0b2e59]">{(filter === "all" ? todo.primary : todo.reasons.find(r => r.key === filter))?.action}</span></span>
          <span className="text-xs text-slate-500">最終更新（確認可能分）<br />{todo.updatedAt ? dateFormat.format(todo.updatedAt) : "日時不明"}</span>
        </button>
      </li>)}</ul>}
  </section>;
}
