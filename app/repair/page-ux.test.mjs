import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("tenant-linked success replaces the form with an in-page tenant link", () => {
  assert.match(source, /if \(result\.tenantLinked === true\)\s*{\s*setTenantSubmissionComplete\(true\)/);
  assert.match(source, /if \(tenantSubmissionComplete\)/);
  assert.match(source, /href="\/tenant"/);
  assert.match(source, /修理依頼を受け付けました/);
  assert.match(source, /マイページで進捗を確認できます。/);
});

test("anonymous success retains the existing alert branch", () => {
  assert.match(source, /else\s*{\s*alert\("修理・不具合の報告を送信しました！"\)/);
});
