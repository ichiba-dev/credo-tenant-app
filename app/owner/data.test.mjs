import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup(rows, bypassFilters = false) {
  const queries = [];
  const service = { from(table) {
    const query = { table, filters: [] }; queries.push(query);
    const builder = {
      select(value) { query.select = value; return builder; },
      eq(...args) { query.filters.push(["eq", ...args]); return builder; },
      in(...args) { query.filters.push(["in", ...args]); return builder; },
      order() { return builder; },
      then(resolve, reject) {
        const data = (rows[table] ?? []).filter(row => bypassFilters || query.filters.every(([kind, key, value]) => kind === 'eq' ? row[key] === value : value.includes(row[key])));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
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
  return { get: id => exports.getOwnerRepairList(id, 'org-a'), queries };
}

const baseRows = {
  owner_report_recipients: [
    { owner_id: "owner-a", owner_report_id: "report-new", organization_id: "org-a" },
    { owner_id: "owner-a", owner_report_id: "report-old", organization_id: "org-a" },
    { owner_id: "owner-a", owner_report_id: "report-23", organization_id: "org-a" },
  ],
  owner_reports: [
    { id: "report-new", organization_id: "org-a", repair_request_id: 14, created_at: "2026-03-03" },
    { id: "report-old", organization_id: "org-a", repair_request_id: 14, created_at: "2026-01-01" },
    { id: "report-23", organization_id: "org-a", repair_request_id: 23, created_at: "2026-02-02" },
  ],
  repair_requests: [
    { id: 14, organization_id: "org-a", property_name: "A", room_number: "201", category: "浴室", description: "水漏れ", created_at: "2026-03-01" },
    { id: 23, organization_id: "org-a", property_name: "B", room_number: "101", category: "鍵", description: "開かない", created_at: "2026-02-01" },
  ],
  owner_approvals: [
    { owner_id: "owner-a", owner_report_id: "report-new", organization_id: "org-a", decision: "approved" },
    { owner_id: "owner-a", owner_report_id: "report-23", organization_id: "org-a", decision: "consultation" },
  ],
};

test("list starts from owner recipients and keeps only the latest authorized report per repair", async () => {
  const s = setup(baseRows); const list = await s.get("owner-a");
  assert.equal(list.length, 2);
  assert.equal(list.find((item) => item.repairId === 14).decision, "approved");
  assert.equal(list.find((item) => item.repairId === 14).reportCreatedAt, "2026-03-03");
  assert.equal(JSON.stringify(s.queries.find(q => q.table === 'owner_report_recipients').filters), JSON.stringify([["eq", "owner_id", "owner-a"], ["eq", "organization_id", "org-a"]]));
  const reportQuery = s.queries.find((query) => query.table === "owner_reports");
  assert.ok(reportQuery.filters.some(([kind, key, ids]) => kind === "in" && key === "id" && ids.length === 3));
  const repairQuery = s.queries.find((query) => query.table === "repair_requests" && query.filters.some(([kind]) => kind === 'in'));
  assert.ok(repairQuery.filters.some(([kind, key, ids]) => kind === "in" && key === "id" && JSON.stringify(ids) === JSON.stringify([14, 23])));
});

test("no recipients or own requests returns empty without querying reports", async () => {
  const s = setup({ owner_report_recipients: [] });
  assert.equal((await s.get("owner-a")).length, 0);
  assert.equal(s.queries.length, 2);
  assert.ok(!s.queries.some(q => q.table === 'owner_reports'));
});

test("foreign owner and cross-organization rows fail closed", async () => {
  const foreign = setup({ owner_report_recipients: [{ owner_id: "owner-b", owner_report_id: "x", organization_id: "org-a" }] });
  assert.equal((await foreign.get("owner-a")).length, 0);
  const mismatched = setup({ ...baseRows, repair_requests: [{ ...baseRows.repair_requests[0], organization_id: "org-x" }, baseRows.repair_requests[1]] });
  await assert.rejects(mismatched.get("owner-a"));
});

const ownRepair = { ...baseRows.repair_requests[0], id: 27, source_type: 'owner', source_owner_id: 'owner-a', status: '受付' };
for (const status of ['受付', '手配中', '完了']) test(`reportless own request is listed with ${status}`, async () => {
  const s = setup({ repair_requests: [{ ...ownRepair, status }] });
  const list = await s.get('owner-a');
  assert.equal(list.length, 1);
  assert.equal(list[0].repairId, 27);
  assert.equal(list[0].status, status);
  assert.equal(list[0].isOwnRequest, true);
  assert.equal(list[0].reportCreatedAt, null);
  assert.equal(list[0].decision, null);
  assert.equal(JSON.stringify(s.queries[0].filters), JSON.stringify([
    ['eq', 'organization_id', 'org-a'], ['eq', 'source_type', 'owner'], ['eq', 'source_owner_id', 'owner-a'],
  ]));
});

test('foreign owner, foreign organization and tenant without reports are excluded', async () => {
  const s = setup({ repair_requests: [
    { ...ownRepair, source_owner_id: 'owner-b' },
    { ...ownRepair, id: 28, organization_id: 'org-b' },
    { ...ownRepair, id: 29, source_type: 'tenant', source_owner_id: null },
  ] });
  assert.equal((await s.get('owner-a')).length, 0);
});

test('unexpected foreign rows fail closed even if the database returns them despite filters', async () => {
  for (const repair of [
    { ...ownRepair, source_owner_id: 'owner-b' },
    { ...ownRepair, organization_id: 'org-b' },
    { ...ownRepair, source_type: 'tenant' },
  ]) await assert.rejects(setup({ repair_requests: [repair] }, true).get('owner-a'), /SCOPE_INVALID/);
  for (const recipient of [
    { owner_id: 'owner-b', owner_report_id: 'r', organization_id: 'org-a' },
    { owner_id: 'owner-a', owner_report_id: 'r', organization_id: 'org-b' },
  ]) await assert.rejects(setup({ owner_report_recipients: [recipient] }, true).get('owner-a'), /SCOPE_INVALID/);
});

test('own request with reports is one item retaining latest report and approval', async () => {
  const s = setup({ ...baseRows, repair_requests: [{ ...baseRows.repair_requests[0], source_type: 'owner', source_owner_id: 'owner-a', status: '完了' }, baseRows.repair_requests[1]] });
  const list = await s.get('owner-a');
  assert.equal(list.length, 2);
  const own = list.filter(item => item.repairId === 14);
  assert.equal(own.length, 1);
  assert.equal(own[0].isOwnRequest, true);
  assert.equal(own[0].status, '完了');
  assert.equal(own[0].decision, 'approved');
  assert.equal(own[0].reportCreatedAt, '2026-03-03');
});
