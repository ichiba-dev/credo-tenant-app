import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup(row) {
  const queries = [];
  const db = { from(table) { const query = { table, filters: [] }; queries.push(query); const builder = {
    select(value) { query.select = value; return builder; }, eq(...args) { query.filters.push(args); return builder; },
    maybeSingle() { return Promise.resolve({ data: row, error: null }); },
  }; return builder; } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("./data.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { exports, require(name) { if (name === "server-only") return {}; if (name === "@/lib/supabase-server") return { createServerSupabaseClient: () => db }; return {}; } });
  return { get: exports.getTenantLineConnection, queries };
}

const tenant = { tenantId: "tenant-a", organizationId: "org-a", displayName: "A" };

test("active LINE status is scoped to the authenticated tenant and organization", async () => {
  const s = setup({ organization_id: "org-a", tenant_account_id: "tenant-a", linked_at: "2026-09-14T00:00:00Z" });
  assert.deepEqual({ ...await s.get(tenant) }, { linkedAt: "2026-09-14T00:00:00Z" });
  assert.deepEqual(s.queries[0].filters, [["organization_id", "org-a"], ["tenant_account_id", "tenant-a"], ["is_active", true]]);
});

test("a cross-organization or cross-tenant row fails closed", async () => {
  for (const row of [{ organization_id: "org-b", tenant_account_id: "tenant-a", linked_at: "x" }, { organization_id: "org-a", tenant_account_id: "tenant-b", linked_at: "x" }]) {
    await assert.rejects(setup(row).get(tenant), /SCOPE_MISMATCH/);
  }
});
