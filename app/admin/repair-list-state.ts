import type { AdminRepair } from "./types";

export type RepairFilter = "active" | "attention" | "arranging" | "estimate" | "completed" | "all";
const activeDispatchStatuses = ["dispatched", "acknowledged", "scheduling", "visit_scheduled"];
export function repairListState(repair: AdminRepair) {
  const completed = repair.status === "完了";
  const dispatches = repair.vendor_dispatches ?? [];
  const knownDispatches = !repair.vendor_dispatch_unavailable && repair.vendor_dispatches !== undefined;
  const candidate = knownDispatches && dispatches.some(d => d.status === "candidate");
  const requested = knownDispatches && dispatches.some(d => d.status === "dispatched");
  const arranging = !completed && (repair.status === "手配中" ||
    knownDispatches && dispatches.some(d => activeDispatchStatuses.includes(d.status)));
  // Missing estimate files are not evidence of a pending vendor quote.
  const estimate = !completed && repair.status === "見積待ち";
  const unassigned = knownDispatches && !dispatches.some(d => d.status !== "cancelled");
  const reasons = completed ? ["完了"] : [
    ...(repair.vendor_dispatch_unavailable || !knownDispatches ? ["手配情報未確認"] : []),
    ...(unassigned ? ["業者未手配"] : []), ...(candidate ? ["手配候補"] : []),
    ...(requested ? ["依頼済み"] : []), ...(estimate ? ["見積待ち"] : []),
  ];
  const attention = !completed && (repair.status === "受付" || !repair.status || unassigned || candidate || requested || estimate || !knownDispatches);
  if (!reasons.length) reasons.push(attention ? "要対応" : arranging ? "手配中" : "進捗確認");
  const timestamps = [repair.created_at,
    ...(repair.tenant_messages ?? []).map(m => m.created_at),
    ...dispatches.flatMap(d => [d.selectedAt, ...d.events.map(e => e.occurredAt), ...d.messages.map(m => m.sentAt)]),
    ...(repair.owner_report_estimates?.files ?? []).map(f => f.created_at),
  ].map(value => value ? Date.parse(value) : NaN).filter(Number.isFinite);
  return { completed, attention, arranging, estimate, reasons,
    updatedAt: timestamps.length ? Math.max(...timestamps) : 0 };
}
export function matchesRepairFilter(state: ReturnType<typeof repairListState>, filter: RepairFilter) {
  return filter === "all" || (filter === "active" ? !state.completed : state[filter]);
}
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja").trim();
export function matchesRepairSearch(repair: AdminRepair, search: string) {
  const text = normalize([repair.property_name, repair.room_number, repair.tenant_name,
    repair.category, repair.description, repair.status].join(" "));
  return normalize(search).split(/\s+/).every(word => text.includes(word));
}
export function groupRepairs(repairs: AdminRepair[]) {
  const rank = (r: AdminRepair) => { const s = repairListState(r); return s.completed ? 2 : s.attention ? 0 : 1; };
  const compare = (a: AdminRepair, b: AdminRepair) => rank(a) - rank(b) ||
    repairListState(b).updatedAt - repairListState(a).updatedAt || a.id - b.id;
  const groups = new Map<string, AdminRepair[]>();
  for (const repair of repairs) {
    const property = repair.property_name?.trim() || "物件名未登録";
    const rows = groups.get(property) ?? [];
    rows.push(repair); groups.set(property, rows);
  }
  return [...groups].map(([property, rows]) => ({property, repairs: rows.sort(compare)}))
    .sort((a,b) => compare(a.repairs[0],b.repairs[0]) || a.property.localeCompare(b.property,"ja"));
}
