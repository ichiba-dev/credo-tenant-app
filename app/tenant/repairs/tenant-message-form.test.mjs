import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const source=readFileSync(new URL("./[repairId]/message-form.tsx",import.meta.url),"utf8");
test("tenant form has a 2000 character limit and two independent submit locks",()=>{assert.match(source,/maxLength=\{2000\}/);assert.match(source,/busy\.current \|\| pending/);assert.match(source,/disabled=\{pending \|\| !message\.trim\(\)\}/);});
