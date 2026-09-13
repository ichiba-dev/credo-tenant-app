import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./message-section.tsx", import.meta.url), "utf8");
test("reply UI is viewer-gated and protected against double submission", () => {
  assert.match(source, /if \(busy\.current \|\| pending \|\| !canUpdate\) return/);
  assert.match(source, /canUpdate \? <div/);
  assert.match(source, /maxLength=\{2000\}/);
});

test("conversation renders sender type as ordinary React text", () => {
  assert.match(source, /item\.sender_type === "staff"/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});
