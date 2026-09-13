import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = ts.transpileModule(readFileSync(new URL("./estimate-files.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(source, { exports, require(name) { if (name === "server-only") return {}; throw new Error(name); } });

test("estimate MIME and magic bytes must agree", () => {
  assert.equal(exports.hasMatchingEstimateMagic(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf"), true);
  assert.equal(exports.hasMatchingEstimateMagic(Uint8Array.from([0xff, 0xd8, 0xff]), "image/jpeg"), true);
  assert.equal(exports.hasMatchingEstimateMagic(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"), true);
  assert.equal(exports.hasMatchingEstimateMagic(Uint8Array.from([0xff, 0xd8, 0xff]), "application/pdf"), false);
  assert.equal(exports.isAllowedEstimateMime("text/html"), false);
});

test("storage path is server-shaped and scoped", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const reportId = "22222222-2222-4222-8222-222222222222";
  const fileId = "33333333-3333-4333-8333-333333333333";
  const path = exports.createEstimateStoragePath(organizationId, 14, reportId, fileId, "application/pdf");
  assert.equal(path, `${organizationId}/14/${reportId}/${fileId}.pdf`);
  assert.equal(exports.isExpectedEstimateStoragePath(path, organizationId, 14, reportId), true);
  assert.equal(exports.isExpectedEstimateStoragePath(path, organizationId, 15, reportId), false);
  assert.equal(exports.isExpectedEstimateStoragePath(`other/14/${reportId}/${fileId}.pdf`, organizationId, 14, reportId), false);
  assert.equal(exports.isExpectedEstimateStoragePath(`${organizationId}/14/${reportId}/original-name.pdf`, organizationId, 14, reportId), false);
});

test("filename validation rejects empty, oversized and control-character names", () => {
  assert.equal(exports.validateOriginalFilename("estimate.pdf"), true);
  assert.equal(exports.validateOriginalFilename(""), false);
  assert.equal(exports.validateOriginalFilename("a".repeat(256)), false);
  assert.equal(exports.validateOriginalFilename("bad\nname.pdf"), false);
});
