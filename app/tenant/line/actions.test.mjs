import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup({ context = { ok: true, tenant: { tenantId: "tenant-a", organizationId: "org-a" } }, activeLink = null } = {}) {
  const queries = [];
  const db = {
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      const builder = {
        select(value) { query.select = value; return builder; },
        eq(...args) { query.filters.push(["eq", ...args]); return builder; },
        is(...args) { query.filters.push(["is", ...args]); return builder; },
        gt(...args) { query.filters.push(["gt", ...args]); return builder; },
        neq(...args) { query.filters.push(["neq", ...args]); return builder; },
        update(value) { query.update = value; return builder; },
        insert(value) { query.insert = value; return builder; },
        maybeSingle() { return Promise.resolve({ data: activeLink, error: null }); },
        single() { return Promise.resolve({ data: { id: "token-row" }, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject); },
      };
      return builder;
    },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { exports, Buffer, URLSearchParams, require(name) {
    if (name === "node:crypto") return requireCrypto;
    if (name === "next/navigation") return { redirect(path) { throw Object.assign(new Error("REDIRECT"), { path }); } };
    if (name === "@/lib/supabase-server") return { createServerSupabaseClient: () => db };
    if (name === "@/lib/supabase-auth/tenant") return { getTenantContext: async () => context };
    throw new Error(name);
  } });
  return { start: exports.startTenantLineLink, queries };
}

const requireCrypto = await import("node:crypto");
async function redirected(action) {
  try { await action(); } catch (error) { if (error?.path) return error.path; throw error; }
  assert.fail("expected redirect");
}

test("unauthenticated and inactive tenants cannot issue a token", async () => {
  for (const [context, expected] of [[{ ok: false, reason: "unauthenticated" }, "/tenant/login?next=%2Ftenant"], [{ ok: false, reason: "forbidden" }, "/tenant?line=account"]]) {
    const s = setup({ context });
    assert.equal(await redirected(s.start), expected);
    assert.equal(s.queries.length, 0);
  }
});

test("an active LINE connection prevents token issuance", async () => {
  const s = setup({ activeLink: { id: "link-a", organization_id: "org-a", tenant_account_id: "tenant-a" } });
  assert.equal(await redirected(s.start), "/tenant?line=already-linked");
  assert.equal(s.queries.length, 1);
  assert.deepEqual(s.queries[0].filters, [["eq", "organization_id", "org-a"], ["eq", "tenant_account_id", "tenant-a"], ["eq", "is_active", true]]);
});

test("an out-of-scope active connection fails closed", async () => {
  const s = setup({ activeLink: { id: "link-a", organization_id: "org-b", tenant_account_id: "tenant-a" } });
  assert.equal(await redirected(s.start), "/tenant?line=error");
  assert.equal(s.queries.length, 1);
});

test("a 256-bit token is hashed, expires in ten minutes, and redirects without tenant identifiers", async () => {
  const s = setup();
  const before = Date.now();
  const path = await redirected(s.start);
  const after = Date.now();
  assert.match(path, /^\/tenant\/line\/link\?token=[A-Za-z0-9_-]{43}$/);
  assert.equal(path.includes("tenant-a"), false);
  assert.equal(path.includes("org-a"), false);

  const rawToken = new URLSearchParams(path.split("?")[1]).get("token");
  const inserted = s.queries.find((query) => query.insert)?.insert;
  assert.ok(inserted);
  assert.equal(inserted.organization_id, "org-a");
  assert.equal(inserted.tenant_account_id, "tenant-a");
  assert.equal(inserted.used_at, null);
  assert.equal(inserted.token_hash, `\\x${createHash("sha256").update(rawToken).digest("hex")}`);
  assert.equal(Object.values(inserted).includes(rawToken), false);
  const expiry = Date.parse(inserted.expires_at);
  assert.ok(expiry >= before + 600_000 && expiry <= after + 600_000);

  const expiryQueries = s.queries.filter((query) => query.update?.used_at);
  assert.equal(expiryQueries.length, 2);
  assert.ok(expiryQueries.every((query) => query.filters.some((filter) => filter[0] === "is" && filter[1] === "used_at" && filter[2] === null)));
});

test("the action accepts no tenant or organization input", () => {
  const s = setup();
  assert.equal(s.start.length, 0);
  const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  assert.equal(/type=["']hidden["']/.test(page), false);
});
