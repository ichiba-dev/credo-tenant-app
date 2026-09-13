import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup(rows) {
  const queries = [];
  const service = { from(table) {
    const query = { table, filters: [] }; queries.push(query);
    const builder = {
      select(value) { query.select = value; return builder; },
      eq(...args) { query.filters.push(["eq", ...args]); return builder; },
      in(...args) { query.filters.push(["in", ...args]); return builder; },
      order() { return builder; },
      then(resolve, reject) { return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject); },
    }; return builder;
  } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("./data.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "server-only") return {};
    if (name === "@/lib/supabase-server") return { createServerSupabaseClient: () => service };
    throw new Error(name);
  } });
  return { get: exports.getOwnerRepairList, queries };
}

const baseRows = {
  owner_report_recipients: [
    { owner_id: "owner-a", owner_report_id: "report-new", organization_id: "org-a" },
    { owner_id: "owner-a", owner_report_id: "report-old", organization_id: "org-a" },
    { owner_id: "owner-a", owner_report_id: "report-23", organization_id: "org-b" },
  ],
  owner_reports: [
    { id: "report-new", organization_id: "org-a", repair_request_id: 14, created_at: "2026-03-03" },
    { id: "report-old", organization_id: "org-a", repair_request_id: 14, created_at: "2026-01-01" },
    { id: "report-23", organization_id: "org-b", repair_request_id: 23, created_at: "2026-02-02" },
  ],
  repair_requests: [
    { id: 14, organization_id: "org-a", property_name: "A", room_number: "201", category: "浴室", description: "水漏れ", created_at: "2026-03-01" },
    { id: 23, organization_id: "org-b", property_name: "B", room_number: "101", category: "鍵", description: "開かない", created_at: "2026-02-01" },
  ],
  owner_approvals: [
    { owner_id: "owner-a", owner_report_id: "report-new", organization_id: "org-a", decision: "approved" },
    { owner_id: "owner-a", owner_report_id: "report-23", organization_id: "org-b", decision: "consultation" },
  ],
};

test("list starts from owner recipients and keeps only the latest authorized report per repair", async () => {
  const s = setup(baseRows); const list = await s.get("owner-a");
  assert.equal(list.length, 2);
  assert.equal(list.find((item) => item.repairId === 14).decision, "approved");
  assert.equal(list.find((item) => item.repairId === 14).reportCreatedAt, "2026-03-03");
  assert.equal(JSON.stringify(s.queries[0].filters), JSON.stringify([["eq", "owner_id", "owner-a"]]));
  const reportQuery = s.queries.find((query) => query.table === "owner_reports");
  assert.ok(reportQuery.filters.some(([kind, key, ids]) => kind === "in" && key === "id" && ids.length === 3));
  const repairQuery = s.queries.find((query) => query.table === "repair_requests");
  assert.ok(repairQuery.filters.some(([kind, key, ids]) => kind === "in" && key === "id" && JSON.stringify(ids) === JSON.stringify([14, 23])));
});

test("no recipients returns empty without querying reports or repairs", async () => {
  const s = setup({ owner_report_recipients: [] });
  assert.equal((await s.get("owner-a")).length, 0);
  assert.equal(s.queries.length, 1);
});

test("foreign owner and cross-organization rows fail closed", async () => {
  const foreign = setup({ owner_report_recipients: [{ owner_id: "owner-b", owner_report_id: "x", organization_id: "org-a" }] });
  await assert.rejects(foreign.get("owner-a"));
  const mismatched = setup({ ...baseRows, repair_requests: [{ ...baseRows.repair_requests[0], organization_id: "org-x" }, baseRows.repair_requests[1]] });
  await assert.rejects(mismatched.get("owner-a"));
});
