import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup(result = { ok: true }, actorResult = { ok: true, actor: { kind: "anonymous" } }) {
  const calls = [];
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, URL, Response, Blob, Uint8Array,
    require(name) {
      if (name === "../upload-limits") return { MAX_REQUEST_BYTES: 1024 };
      if (name === "../tenant-submission") return { resolveRepairSubmissionActor: async () => actorResult };
      assert.equal(name, "../actions");
      return { submitRepair: async (form, actor) => { calls.push({ form, actor }); return result; } };
    },
  });
  return { post: exports.POST, calls };
}

test("multipart files reach the server registration and responses are not cached", async () => {
  const s = setup(); const form = new FormData();
  form.append("photos", new Blob(["file"], { type: "image/jpeg" }), "test.jpg");
  const response = await s.post(new Request("https://app.example/repair/submit", {
    method: "POST", body: form, headers: { origin: "https://app.example" },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await s.calls[0].form.get("photos").text(), "file");
  assert.equal(s.calls[0].actor.kind, "anonymous");
});

test("foreign origins, bad multipart and oversized bodies cannot create a request", async () => {
  for (const [headers, body, expected] of [
    [{ origin: "https://evil.example" }, "x", 403],
    [{ "content-type": "application/json" }, "{}", 415],
    [{ "content-type": "multipart/form-data; boundary=x", "content-length": "2000" }, "x", 413],
    [{ "content-type": "multipart/form-data; boundary=x" }, "x".repeat(1025), 413],
    [{ "content-type": "multipart/form-data; boundary=x" }, "invalid", 400],
  ]) {
    const s = setup();
    const response = await s.post(new Request("https://app.example/repair/submit", { method: "POST", headers, body }));
    assert.equal(response.status, expected); assert.equal(s.calls.length, 0);
    assert.equal((await response.json()).retrySafe, true);
  }
});

test("partial registration is an HTTP failure and cannot be reported as success", async () => {
  const s = setup({ ok: false, retrySafe: false, requestCreated: true });
  const response = await s.post(new Request("https://app.example/repair/submit", { method: "POST", body: new FormData() }));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).ok, false);
});

test("an authenticated account failure is rejected before registration", async () => {
  const s = setup({ ok: true }, { ok: false, message: "account unavailable" });
  const response = await s.post(new Request("https://app.example/repair/submit", { method: "POST", body: new FormData() }));
  assert.equal(response.status, 403); assert.equal(s.calls.length, 0);
});
