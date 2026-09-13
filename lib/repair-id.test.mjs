import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports={};
const source=ts.transpileModule(readFileSync(new URL("./repair-id.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText;
vm.runInNewContext(source,{exports,require(){throw new Error("unexpected import");}});

test("repair IDs accept only positive safe decimal bigint values",()=>{
  assert.equal(exports.parseRepairId("14"),14);
  assert.equal(exports.parseRepairId(String(Number.MAX_SAFE_INTEGER)),Number.MAX_SAFE_INTEGER);
  for(const value of ["0","-1","01","14.0","1e2","abc","9007199254740992"]) assert.equal(exports.parseRepairId(value),null);
});

test("owner login return paths cannot leave the owner repair route",()=>{
  assert.equal(exports.ownerRepairPath("/owner"),"/owner");
  assert.equal(exports.ownerRepairPath("/owner/repairs/27"),"/owner/repairs/27");
  for(const value of [undefined,"https://evil.example","//evil.example","/admin","/repair","/owner/repairs/27?x=1","/owner?next=https://evil.example"]) {
    assert.equal(exports.ownerRepairPath(value),"/owner");
  }
});

test("tenant login return paths cannot leave the tenant repair route",()=>{
  assert.equal(exports.tenantRepairPath("/tenant"),"/tenant");
  assert.equal(exports.tenantRepairPath("/tenant/repairs/23"),"/tenant/repairs/23");
  for(const value of [undefined,"https://evil.example","//evil.example","/admin","/owner","/repair","/tenant/repairs/0","/tenant/repairs/23?next=https://evil.example"]) {
    assert.equal(exports.tenantRepairPath(value),"/tenant");
  }
});
