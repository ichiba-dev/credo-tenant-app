import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup(fail = false) {
  const calls = []; const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("./repair-photo-urls.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "server-only") return {};
    assert.equal(name, "@/lib/supabase-server");
    return { createServerSupabaseClient: () => ({ storage: { from(bucket) {
      assert.equal(bucket, "repair-images");
      return { createSignedUrl: async (path, ttl) => {
        calls.push({ path, ttl });
        if (fail) throw new Error("SECRET");
        return { data: { signedUrl: "signed" }, error: null };
      } };
    } } }) };
  } });
  return { resolve: exports.resolveRepairPhotoUrl, calls, PhotoUnavailableError: exports.PhotoUnavailableError };
}
const uuid = "12345678-1234-4234-8234-123456789012";
test("300 second signing takes precedence; legacy root paths remain supported", async () => {
  for (const path of [`org-a/17/${uuid}.jpg`, `${uuid}-photo.jpg`, "xxxxxxxx-xxxx.jpg", "12345.png", "写真 01.jpg", "photo%25.jpg"]) {
    const s = setup(); assert.equal(await s.resolve({ storage_path: path, photo_url: "public" }, "org-a", 17), "signed");
    assert.equal(s.calls[0].ttl, 300);
    assert.equal(s.calls[0].path, path);
  }
});

test("authorization mismatch and unavailable image are distinguishable",async()=>{
  const s=setup();
  await assert.rejects(s.resolve({storage_path:`org-b/17/${uuid}.jpg`},"org-a",17),error=>!(error instanceof s.PhotoUnavailableError));
  for(const path of [".","..","bad\\name.jpg","bad\n.jpg",`org-a/17/not-uuid.jpg`]){
    await assert.rejects(s.resolve({storage_path:path,photo_url:"public"},"org-a",17),error=>error instanceof s.PhotoUnavailableError);
  }
  assert.equal(s.calls.length,0);
});
test("only pathless rows fall back; empty rows are absent", async () => {
  const s=setup();
  assert.equal(await s.resolve({photo_url:"public"}, "org-a", 17), "public");
  assert.equal(await s.resolve({}, "org-a", 17), null);
  assert.equal(s.calls.length,0);
});
test("foreign organization/request and invalid paths are rejected before signing", async () => {
  for (const path of [`org-b/17/${uuid}.jpg`, `org-a/18/${uuid}.jpg`, "../x", "https://evil/x", `${uuid}-x\n`]) {
    const s=setup(); await assert.rejects(s.resolve({storage_path:path,photo_url:"public"},"org-a",17));
    assert.equal(s.calls.length,0);
  }
});
test("signing failure never returns public URL or SDK error", async () => {
  const s=setup(true);
  await assert.rejects(s.resolve({storage_path:`org-a/17/${uuid}.jpg`,photo_url:"public"},"org-a",17), error => !error.message.includes("SECRET"));
});
