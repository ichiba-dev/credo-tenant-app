import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const FILE_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "22222222-2222-4222-8222-222222222222";
const PATH = `org-a/14/${REPORT_ID}/${FILE_ID}.pdf`;

function setup({ user = { id: "user-a" }, owner = { id: "owner-a" }, file, recipient, report, repair, signError = null } = {}) {
  file ??= { id: FILE_ID, organization_id: "org-a", repair_request_id: 14, owner_report_id: REPORT_ID, storage_path: PATH };
  recipient ??= { owner_report_id: REPORT_ID, owner_id: "owner-a", organization_id: "org-a" };
  report ??= { id: REPORT_ID, repair_request_id: 14, organization_id: "org-a" };
  repair ??= { id: 14, organization_id: "org-a" };
  const rows = { owners: owner, owner_report_estimate_files: file, owner_report_recipients: recipient, owner_reports: report, repair_requests: repair };
  const queries = []; const signed = [];
  const service = {
    from(table) {
      const query = { table, filters: [] }; queries.push(query);
      const builder = {
        select() { return builder; }, eq(...args) { query.filters.push(["eq", ...args]); return builder; },
        is(...args) { query.filters.push(["is", ...args]); return builder; }, maybeSingle() { return builder; },
        then(resolve, reject) { return Promise.resolve({ data: rows[table], error: null }).then(resolve, reject); },
      };
      return builder;
    },
    storage: { from(bucket) { return { async createSignedUrl(path, ttl) {
      signed.push({ bucket, path, ttl });
      return signError ? { data: null, error: signError } : { data: { signedUrl: "https://storage.example/signed" }, error: null };
    } }; } },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("../api/owner/repairs/[repairId]/estimate-files/[fileId]/open/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, Response, require(name) {
    if (name === "@/lib/supabase-auth/server") return { createAuthServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) };
    if (name === "@/lib/supabase-server") return { createServerSupabaseClient: () => service };
    if (name === "@/lib/estimate-files") return {
      ESTIMATE_BUCKET: "owner-estimates",
      isExpectedEstimateStoragePath: (path, org, repairId, reportId) => path === `${org}/${repairId}/${reportId}/${FILE_ID}.pdf`,
    };
    if (name === "@/lib/repair-id") return { parseRepairId: value => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null };
    throw new Error(name);
  } });
  return { get: exports.GET, queries, signed };
}

const context = (repairId = "14", fileId = FILE_ID) => ({ params: Promise.resolve({ repairId, fileId }) });

test("authorized owner signs only the scoped DB path for 120 seconds", async () => {
  const s = setup();
  const response = await s.get(new Request("https://app.example"), context());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://storage.example/signed");
  assert.equal(JSON.stringify(s.signed), JSON.stringify([{ bucket: "owner-estimates", path: PATH, ttl: 120 }]));
  assert.ok(s.queries.find((query) => query.table === "owner_report_recipients").filters.some((entry) => entry[1] === "owner_id" && entry[2] === "owner-a"));
});

test("unauthenticated, non-owner, non-recipient and mismatched scope never sign", async () => {
  const cases = [
    { user: null }, { owner: false }, { recipient: false },
    { report: { id: REPORT_ID, repair_request_id: 15, organization_id: "org-a" } },
    { repair: { id: 14, organization_id: "org-b" } },
    { file: { id: FILE_ID, organization_id: "org-a", repair_request_id: 14, owner_report_id: REPORT_ID, storage_path: "org-b/14/bad.pdf" } },
  ];
  for (const options of cases) {
    const s = setup(options);
    const response = await s.get(new Request("https://app.example"), context());
    assert.notEqual(response.status, 303);
    assert.equal(s.signed.length, 0);
  }
});
