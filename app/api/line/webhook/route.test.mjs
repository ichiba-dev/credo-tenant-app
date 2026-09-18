import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const SECRET = "test-channel-secret";

function setup(secret = SECRET, options = {}) {
  const logs = [];
  const calls = [];
  const inserts = [];
  const rows = new Map();
  const db = { from(table) {
    const call = { table, filters: [], columns: null };
    calls.push(call);
    const query = {
      select(columns) { call.columns = columns; return query; },
      eq(column, value) { call.filters.push([column, value]); return query; },
      is(column, value) { call.filters.push([column, value]); return query; },
      limit(value) { call.limit = value; return query; },
      abortSignal(signal) { assert.equal(signal instanceof AbortSignal, true); return query; },
      insert(row) { call.row = JSON.parse(JSON.stringify(row)); return query; },
      maybeSingle() { return query; },
      then(resolve, reject) {
        if (options.throwDb) return Promise.reject(new Error('secret U-sensitive private reply-token')).then(resolve, reject);
        let result;
        if (table === options.failTable) result = { data: null, error: { code: 'XX000', message: 'secret U-sensitive private reply-token' } };
        else if (table === 'tenant_line_accounts') result = { data: options.links ?? [{ tenant_account_id: 'tenant-1', organization_id: 'org-1' }], error: null };
        else if (table === 'tenant_accounts') result = { data: options.tenant === undefined ? { id: 'tenant-1', organization_id: 'org-1' } : options.tenant, error: null };
        else if (table === 'organizations') result = { data: options.organization === undefined ? { id: 'org-1' } : options.organization, error: null };
        else if (call.row) {
          inserts.push(call.row);
          if (options.insertError) result = { error: options.insertError };
          else if (rows.has(call.row.line_message_id)) result = { error: { code: '23505' } };
          else { rows.set(call.row.line_message_id, call.row); result = { error: null }; }
        } else result = { data: rows.has(call.filters[0][1]) ? { line_message_id: call.filters[0][1] } : null, error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return query;
  } };
  const helperExports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../../../lib/line-webhook.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports: helperExports, AbortSignal, Date, console: { info: (...args) => logs.push(args) },
    require(name) {
      if (name === 'server-only') return {};
      assert.equal(name, '@/lib/supabase-server');
      return { createServerSupabaseClient: () => db };
    },
  });
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
      if (name === '@/lib/line-webhook') return helperExports;
      assert.equal(name, "node:crypto");
      return { createHmac, timingSafeEqual };
    },
  });

  return { get: exports.GET, post: exports.POST, logs, calls, inserts, rows };
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
    events: [{ type: "message", source: { type: "user", userId: "U-sensitive" }, message: { id: 'message-1', type: "text", text: "private" } }],
  });
  const route = setup();
  const response = await route.post(signedRequest(payload));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(route.logs, ["LINE webhook received: 1 event"]);
  assert.equal(route.logs.join(" ").includes("U-sensitive"), false);
  assert.equal(route.rows.size, 1);
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

const textEvent = () => ({ type: 'message', timestamp: 1720000000123,
  source: { type: 'user', userId: 'U-sensitive' }, replyToken: 'reply-token',
  message: { type: 'text', id: 'message-1', text: ' private\n本文 ' } });
const eventRequest = (events) => signedRequest(JSON.stringify({ events }));

test('active linkage stores exact text and minimal metadata without repair or created_at', async () => {
  const route = setup();
  assert.equal((await route.post(eventRequest([textEvent()]))).status, 200);
  assert.deepEqual(route.inserts, [{ organization_id: 'org-1', tenant_account_id: 'tenant-1',
    repair_request_id: null, sender_type: 'tenant', message: ' private\n本文 ',
    line_message_id: 'message-1', channel: 'line', line_sent_at: new Date(1720000000123).toISOString() }]);
  assert.deepEqual(route.calls[0].filters, [['line_user_id', 'U-sensitive'], ['is_active', true], ['unlinked_at', null]]);
  assert.equal(route.calls[0].limit, 2);
  assert.deepEqual(route.calls[1].filters, [['id', 'tenant-1'], ['organization_id', 'org-1'], ['is_active', true]]);
  assert.deepEqual(route.calls[2].filters, [['id', 'org-1'], ['is_active', true]]);
  assert.equal(JSON.stringify(route.inserts).includes('U-sensitive'), false);
  assert.equal(JSON.stringify(route.inserts).includes('reply-token'), false);
});

test('body tampering fails before any database access', async () => {
  const body = JSON.stringify({ events: [textEvent()] });
  const route = setup();
  assert.equal((await route.post(signedRequest(body + ' ', createHmac('sha256', SECRET).update(body).digest('base64')))).status, 401);
  assert.equal(route.calls.length, 0);
});

test('unsupported event/message/source types never access the DB', async () => {
  const events = [null, [], ...['follow', 'unfollow'].map(type => ({ ...textEvent(), type })),
    ...['image', 'video', 'audio', 'sticker', 'location'].map(type => ({ ...textEvent(), message: { type } })),
    ...['group', 'room'].map(type => ({ ...textEvent(), source: { type, userId: 'U-sensitive' } }))];
  const route = setup();
  assert.equal((await route.post(eventRequest(events))).status, 200);
  assert.equal(route.calls.length, 0);
});

for (const [label, options] of [
  ['unlinked user', { links: [] }], ['multiple links', { links: [{ tenant_account_id: 'tenant-1', organization_id: 'org-1' }, { tenant_account_id: 'tenant-2', organization_id: 'org-2' }] }],
  ['inactive tenant', { tenant: null }], ['inactive organization', { organization: null }],
  ['tenant scope mismatch', { tenant: { id: 'tenant-1', organization_id: 'other' } }],
  ['tenant ID mismatch', { tenant: { id: 'other', organization_id: 'org-1' } }],
  ['organization ID mismatch', { organization: { id: 'other' } }],
]) test(`${label} is ignored without insertion`, async () => {
  const route = setup(SECRET, options);
  assert.equal((await route.post(eventRequest([textEvent()]))).status, 200);
  assert.equal(route.inserts.length, 0);
});

test('duplicate delivery and duplicate events in a batch return 200 without overwriting', async () => {
  const route = setup();
  assert.equal((await route.post(eventRequest([textEvent(), textEvent()]))).status, 200);
  assert.equal((await route.post(eventRequest([textEvent()]))).status, 200);
  assert.equal(route.rows.size, 1);
  assert.equal(route.calls.filter(call => call.columns === 'line_message_id').length, 2);
});

for (const failTable of ['tenant_line_accounts', 'tenant_accounts', 'organizations', 'tenant_line_messages'])
  test(`${failTable} DB failure returns generic 500 without sensitive logs`, async () => {
    const route = setup(SECRET, { failTable });
    const response = await route.post(eventRequest([textEvent()]));
    assert.equal(response.status, 500);
    const output = JSON.stringify([await response.json(), route.logs]);
    for (const sensitive of ['U-sensitive', 'private', 'reply-token', SECRET]) assert.equal(output.includes(sensitive), false);
  });

test('thrown DB errors are contained; unrelated unique violations fail', async () => {
  for (const options of [{ throwDb: true }, { insertError: { code: '23505', message: 'secret' } }]) {
    const route = setup(SECRET, options);
    assert.equal((await route.post(eventRequest([textEvent()]))).status, 500);
    assert.equal(route.logs.length, 0);
  }
});

test('partial batch failure can be retried without duplicating saved messages', async () => {
  const route = setup();
  assert.equal((await route.post(eventRequest([textEvent(), { ...textEvent(), message: { type: 'text' } }]))).status, 500);
  assert.equal(route.rows.size, 1);
  const next = { ...textEvent(), message: { ...textEvent().message, id: 'message-2' } };
  assert.equal((await route.post(eventRequest([textEvent(), next]))).status, 200);
  assert.equal(route.rows.size, 2);
});

test('invalid or missing timestamps store NULL; valid timestamps including epoch convert', async () => {
  for (const timestamp of [undefined, null, '1720000000123', -1, 1.5, 8640000000000001, 0]) {
    const route = setup();
    assert.equal((await route.post(eventRequest([{ ...textEvent(), timestamp }]))).status, 200);
    assert.equal(route.inserts[0].line_sent_at, timestamp === 0 ? '1970-01-01T00:00:00.000Z' : null);
  }
});

test('success logs omit all payload and credential fields', async () => {
  const route = setup();
  const event = { ...textEvent(), accessToken: 'access-token', signature: 'signature-full', secret: SECRET };
  assert.equal((await route.post(eventRequest([event]))).status, 200);
  const output = JSON.stringify(route.logs);
  for (const value of ['U-sensitive', 'private', '本文', 'reply-token', 'access-token', 'signature-full', SECRET]) assert.equal(output.includes(value), false);
});
