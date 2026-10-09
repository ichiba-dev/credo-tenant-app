import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = ts.transpileModule(readFileSync(new URL("./owner-auth-state.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(source, { exports });

const base = {
  isActive: true,
  ownerEmail: "test-owner@example.com",
  authUserId: "auth-a",
  authUserExists: true,
  authEmail: "TEST-OWNER@example.com ",
  matchingAuthUserExists: true,
};

test("owner Auth state distinguishes every requested status", () => {
  const cases = [
    [base, "linked"],
    [{ ...base, authUserId: null }, "unlinked"],
    [{ ...base, authUserId: null, matchingAuthUserExists: false }, "unlinked"],
    [{ ...base, authEmail: "ichiba@credoweb.co.jp" }, "email_mismatch"],
    [{ ...base, authUserExists: false }, "auth_user_missing"],
    [{ ...base, isActive: false }, "owner_inactive"],
    [{ ...base, authUsedByAnotherOwner: true }, "review_required"],
    [{ ...base, ownerEmail: " " }, "review_required"],
  ];
  for (const [input, expected] of cases) assert.equal(exports.getOwnerAuthStatus(input), expected);
});

test("email comparison trims whitespace and ignores case", () => {
  assert.equal(exports.normalizeOwnerAuthEmail(" Test-Owner@Example.com "), "test-owner@example.com");
  assert.equal(exports.normalizeOwnerAuthEmail("  "), null);
});