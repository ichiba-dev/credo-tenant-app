import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function setup({ data = [], error = null, throws = false, rejects = false } = {}) {
  const queries = [];
  const logs = [];
  const exports = {};
  const builder = {
    select(value) { queries.push(["select", value]); return builder; },
    eq(...args) { queries.push(["eq", ...args]); return builder; },
    order(...args) { queries.push(["order", ...args]); return builder; },
    then(resolve, reject) {
      return (rejects ? Promise.reject(new Error("SECRET")) : Promise.resolve({ data, error })).then(resolve, reject);
    },
  };
  vm.runInNewContext(source, {
    exports, Response,
    console: { error: (...args) => logs.push(args) },
    require(name) {
      assert.equal(name, "@/lib/supabase-server");
      return { createServerSupabaseClient() {
        if (throws) throw new Error("SECRET");
        return { from(table) { queries.push(["from", table]); return builder; } };
      } };
    },
  });
  return { get: exports.GET, queries, logs };
}

test("public list selects active properties in name order and exposes only id/name", async () => {
  const s = setup({ data: [{ id: "a", name: "A", organization_id: "SECRET", is_active: true }] });
  const response = await s.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), [{ id: "a", name: "A" }]);
  assert.equal(JSON.stringify(s.queries), JSON.stringify([
    ["from", "properties"], ["select", "id, name"], ["eq", "is_active", true],
    ["order", "name", { ascending: true }],
  ]));
});

test("empty results produce an empty list", async () => {
  for (const data of [[], null]) {
    assert.deepEqual(await (await setup({ data }).get()).json(), []);
  }
});

test("DB errors, missing configuration and thrown requests return safe uncached errors", async () => {
  for (const options of [{ error: { message: "SECRET" } }, { throws: true }, { rejects: true }]) {
    const s = setup(options);
    const response = await s.get();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ["message"]);
    assert.equal(JSON.stringify([body, s.logs]).includes("SECRET"), false);
  }
});
