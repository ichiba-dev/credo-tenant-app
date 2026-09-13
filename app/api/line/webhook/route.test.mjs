import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const SECRET = "test-channel-secret";

function setup(secret = SECRET) {
  const logs = [];
  const exports = {};
  const source = ts.transpileModule(
    readFileSync(new URL("./route.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;

  vm.runInNewContext(source, {
    Buffer,
    Request,
    Response,
    exports,
    process: { env: secret === null ? {} : { LINE_CHANNEL_SECRET: secret } },
    console: { info: (message) => logs.push(message) },
    require(name) {
      assert.equal(name, "node:crypto");
      return { createHmac, timingSafeEqual };
    },
  });

  return { get: exports.GET, post: exports.POST, summarize: exports.summarizeLineEvent, logs };
}

function signedRequest(body, signature = createHmac("sha256", SECRET).update(body).digest("base64")) {
  return new Request("https://example.com/api/line/webhook", {
    method: "POST",
    headers: { "x-line-signature": signature, "content-type": "application/json" },
    body,
  });
}

test("a correctly signed message event returns 200 and logs no user ID", async () => {
  const payload = JSON.stringify({
    events: [{ type: "message", source: { type: "user", userId: "U-sensitive" }, message: { type: "text", text: "private" } }],
  });
  const route = setup();
  const response = await route.post(signedRequest(payload));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(route.logs, ["LINE webhook received: 1 event"]);
  assert.equal(route.logs.join(" ").includes("U-sensitive"), false);
  assert.deepEqual(
    { ...route.summarize({ type: "message", source: { type: "user", userId: "U1" }, message: { type: "text" } }) },
    { type: "message", sourceType: "user", hasSourceUserId: true, messageType: "text" },
  );
});

test("an empty events array returns 200", async () => {
  const route = setup();
  const response = await route.post(signedRequest('{"events":[]}'));
  assert.equal(response.status, 200);
  assert.deepEqual(route.logs, ["LINE webhook received: 0 events"]);
});

test("an invalid or non-base64 signature returns 401", async () => {
  for (const signature of [Buffer.alloc(32, 1).toString("base64"), "not-base64***"]) {
    const response = await setup().post(signedRequest('{"events":[]}', signature));
    assert.equal(response.status, 401);
  }
});

test("a missing signature returns 401", async () => {
  const response = await setup().post(new Request("https://example.com/api/line/webhook", {
    method: "POST",
    body: '{"events":[]}',
  }));
  assert.equal(response.status, 401);
});

test("a missing channel secret returns 500", async () => {
  const response = await setup(null).post(signedRequest('{"events":[]}'));
  assert.equal(response.status, 500);
});

test("signed malformed JSON returns 400 after signature verification", async () => {
  const body = "{invalid";
  const response = await setup().post(signedRequest(body));
  assert.equal(response.status, 400);
});

test("a signed body without an events array returns 400", async () => {
  const body = '{}';
  const response = await setup().post(signedRequest(body));
  assert.equal(response.status, 400);
});

test("GET is rejected with the allowed method", async () => {
  const response = setup().get();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});
