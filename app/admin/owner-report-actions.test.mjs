import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadAction({ staff, responses = [] }) {
  const queries = [];
  const service = {
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      const response = responses.shift() ?? { data: null, error: null };
      const builder = {
        select(value) { query.select = value; return builder; },
        eq(...args) { query.filters.push(["eq", ...args]); return builder; },
        order() { return builder; }, limit() { return builder; }, maybeSingle() { return builder; }, single() { return builder; },
        insert(value) { query.insert = value; return builder; }, delete() { query.delete = true; return builder; },
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
      return builder;
    },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("./owner-report-actions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "@/lib/supabase-auth/staff") return {
      getStaffContext: async () => staff,
      staffAccessMessages: { unauthenticated: "login", unavailable: "unavailable", forbidden: "forbidden", multiple: "multiple" },
    };
    if (name === "@/lib/supabase-server") return { createServerSupabaseClient: () => service };
    if (name === "next/cache") return { revalidatePath() {} };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { action: exports.createOwnerReport, queries };
}

const ok = (data) => ({ data, error: null });
const activeStaff = { ok: true, organizationId: "org-a", userId: "user-a", canUpdate: true };

test("creates report, all active recipients and pending approvals from server scope", async () => {
  const s = loadAction({ staff: activeStaff, responses: [
    ok({ id: 14, organization_id: "org-a", property_id: "property-a" }), ok(null),
    ok([
      { owner_id: "owner-a", organization_id: "org-a", valid_from: null, valid_to: null },
      { owner_id: "owner-b", organization_id: "org-a", valid_from: "2020-01-01", valid_to: "2099-01-01" },
    ]), ok({ id: "report-a" }), ok(null), ok(null),
  ] });
  assert.equal(JSON.stringify(await s.action({ repairId: 14, summary: "  repair summary  ", organization_id: "org-b" })), JSON.stringify({ ok: true }));
  const report = s.queries.find((q) => q.table === "owner_reports" && q.insert);
  assert.equal(report.insert.organization_id, "org-a");
  assert.equal(report.insert.created_by, "user-a");
  assert.equal(report.insert.repair_summary, "repair summary");
  assert.equal(report.insert.status, "draft");
  const recipients = s.queries.find((q) => q.table === "owner_report_recipients" && q.insert).insert;
  assert.equal(JSON.stringify(recipients.map((row) => row.owner_id)), JSON.stringify(["owner-a", "owner-b"]));
  const approvals = s.queries.find((q) => q.table === "owner_approvals" && q.insert).insert;
  assert.ok(approvals.every((row) => row.decision === "pending" && row.organization_id === "org-a"));
});

test("viewer and foreign or missing repair cannot create a report", async () => {
  const viewer = loadAction({ staff: { ...activeStaff, canUpdate: false } });
  assert.equal((await viewer.action({ repairId: 14, summary: "summary" })).ok, false);
  assert.equal(viewer.queries.length, 0);
  const missing = loadAction({ staff: activeStaff, responses: [ok(null)] });
  assert.equal((await missing.action({ repairId: 14, summary: "summary" })).ok, false);
  assert.ok(missing.queries.every((query) => !query.insert));
});

test("existing report is reused and prevents duplicate inserts", async () => {
  const s = loadAction({ staff: activeStaff, responses: [
    ok({ id: 14, organization_id: "org-a", property_id: "property-a" }), ok({ id: "existing" }),
  ] });
  assert.equal(JSON.stringify(await s.action({ repairId: 14, summary: "summary" })), JSON.stringify({ ok: true, alreadyExists: true }));
  assert.ok(s.queries.every((query) => !query.insert));
});

test("recipient failure attempts compensating cleanup", async () => {
  const s = loadAction({ staff: activeStaff, responses: [
    ok({ id: 14, organization_id: "org-a", property_id: "property-a" }), ok(null),
    ok([{ owner_id: "owner-a", organization_id: "org-a", valid_from: null, valid_to: null }]),
    ok({ id: "report-a" }), { data: null, error: { message: "secret" } }, ok(null), ok(null), ok(null),
  ] });
  const result = await s.action({ repairId: 14, summary: "summary" });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(s.queries.filter((query) => query.delete).length, 3);
});
