import type { AdminRepair } from "./types";
import { repairListState } from "./repair-list-state";

export const STALE_REPAIR_DAYS = 3;
export const TODO_RULES = [
  { key: "unassigned", label: "業者未手配", action: "業者未手配" },
  { key: "candidate", label: "手配候補", action: "業者を手配してください" },
  // No per-dispatch quote registration state is available in the list payload.
  { key: "estimate", label: "見積待ち", action: "見積待ち" },
  { key: "stale", label: `${STALE_REPAIR_DAYS}日以上更新なし`, action: `${STALE_REPAIR_DAYS}日以上更新なし` },
] as const;
export type TodoKey = typeof TODO_RULES[number]["key"];
export function repairTodos(repairs: AdminRepair[], now: number) {
  return repairs.flatMap(repair => {
    const state = repairListState(repair);
    if (state.completed) return [];
    const known = !repair.vendor_dispatch_unavailable && repair.vendor_dispatches !== undefined;
    const matches: Record<TodoKey, boolean> = {
      unassigned: known && repair.vendor_dispatches!.length === 0,
      candidate: known && repair.vendor_dispatches!.some(d => d.status === "candidate"),
      estimate: state.estimate,
      stale: state.updatedAt > 0 && now - state.updatedAt >= STALE_REPAIR_DAYS * 86400000,
    };
    const reasons = TODO_RULES.filter(rule => matches[rule.key]);
    return reasons.length ? [{ repair, reasons, primary: reasons[0], updatedAt: state.updatedAt }] : [];
  }).sort((a,b) => TODO_RULES.indexOf(a.primary) - TODO_RULES.indexOf(b.primary) ||
    a.updatedAt - b.updatedAt || a.repair.id - b.repair.id);
}

export function openRepairDetails(root: Pick<Document, "getElementById">, id: number) {
  const detail = root.getElementById(`repair-detail-${id}`) as HTMLDetailsElement | null;
  if (!detail) return;
  const group = detail.parentElement?.closest("details");
  if (group) group.open = true;
  detail.open = true;
  detail.querySelector("summary")?.focus({ preventScroll: true });
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}
