import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const requestId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';
const pushId = '33333333-3333-4333-8333-333333333333';
const retryKey = '44444444-4444-4444-8444-444444444444';
function load(path, imports, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, AbortSignal, ...globals, require(name) {
    if (name === 'server-only') return {};
    assert.ok(name in imports, name); return imports[name];
  } }); return exports;
}
function setup(options = {}) {
  const calls = []; const fetches = []; const logs = []; const rows = new Map(); const finishes = [];
  let status = options.status ?? 'pending';
  const staff = options.staff ?? { ok: true, organizationId: 'org-a', userId: 'staff-a', canUpdate: true };
  const repair = options.repair === undefined ? { id: 23, organization_id: 'org-a', tenant_account_id: 'tenant-a' } : options.repair;
  const tenant = options.tenant === undefined ? { id: 'tenant-a', organization_id: 'org-a' } : options.tenant;
  const query = (answer) => {
    const b = { select() { return b; }, eq() { return b; }, abortSignal() { return b; }, maybeSingle() { return b; },
      then(resolve, reject) { return Promise.resolve().then(answer).then(resolve, reject); } }; return b;
  };
  const db = {
    from(table) {
      calls.push({ table });
      return query(() => {
        if (options.failTable === table) return { data: null, error: { message: 'SECRET U-private reply-text' } };
        const data = table === 'repair_requests' ? repair : table === 'tenant_accounts' ? tenant :
          table === 'repair_messages' ? { ...rows.get(requestId), ...options.storedOverride } :
          { id: pushId, organization_id: 'org-a', repair_message_id: messageId, ...options.pushOverride };
        return { data, error: null };
      });
    },
    rpc(name, args) {
      calls.push({ rpc: name, args: JSON.parse(JSON.stringify(args)) });
      return query(() => {
        if (options.failRpc === name) return { data: null, error: { message: 'SECRET U-private reply-text' } };
        if (name === 'create_staff_reply_with_line_push') {
          if (!rows.has(args.p_request_id)) rows.set(args.p_request_id, { id: messageId, organization_id: args.p_organization_id,
            repair_request_id: args.p_repair_request_id, sender_type: 'staff', staff_auth_user_id: args.p_staff_auth_user_id,
            staff_reply_request_id: args.p_request_id, message: args.p_message });
          return { data: [{ repair_message_id: messageId, line_push_id: pushId, line_status: status }], error: null };
        }
        if (name === 'claim_staff_line_push') {
          if (options.noClaim) return { data: [], error: null };
          return { data: [{ line_push_id: pushId, repair_message_id: messageId, recipient_line_user_id: 'U-private',
            retry_key: retryKey, message: rows.get(requestId).message, ...options.claimOverride }], error: null };
        }
        finishes.push(args.p_result); status = args.p_result;
        return { data: null, error: null };
      });
    },
  };
  const push = load('../../lib/line-push.ts', {}, {
    process: { env: options.noToken ? {} : { LINE_CHANNEL_ACCESS_TOKEN: 'SECRET' } },
    console: { log: (...a) => logs.push(a), error: (...a) => logs.push(a), info: (...a) => logs.push(a) },
    fetch: async (url, init) => {
      fetches.push({ url, init });
      if (options.network) throw new Error('SECRET U-private reply-text');
      const code = options.httpStatus ?? 200;
      return { ok: code >= 200 && code < 300, status: code,
        headers: new Headers(options.acceptedHeader ? { 'x-line-accepted-request-id': 'confirmed' } : {}),
        json() { throw new Error('response body must never be read'); } };
    },
  });
  const reply = load('../../lib/staff-line-reply.ts', {
    'next/cache': { revalidatePath() {} }, '@/lib/repair-id': load('../../lib/repair-id.ts', {}),
    '@/lib/supabase-auth/staff': { getStaffContext: async () => staff },
    '@/lib/supabase-server': { createServerSupabaseClient: () => db }, './line-push': push,
  }, { console: { log: (...a) => logs.push(a), error: (...a) => logs.push(a) } });
  const action = load('./message-actions.ts', { '@/lib/staff-line-reply': reply });
  return { submit: (body = ' reply-text ', id = '23', req = requestId) => action.submitStaffMessage(id, body, req), calls, fetches, rows, finishes, logs };
}
for (const role of ['admin', 'manager', 'staff']) test(`${role} saves reply and pushes LINE with server-owned identity`, async () => {
  const s = setup({ staff: { ok: true, organizationId: 'org-a', userId: `${role}-a`, canUpdate: true } });
  const result = await s.submit(); assert.equal(result.ok, true); assert.equal(result.lineStatus, 'accepted');
  assert.equal(s.rows.size, 1); assert.equal(s.fetches.length, 1);
  const create = s.calls.find(c => c.rpc === 'create_staff_reply_with_line_push');
  assert.equal(create.args.p_staff_auth_user_id, `${role}-a`);
  assert.equal(create.args.p_message, 'reply-text'); assert.equal(create.args.p_request_id, requestId);
  const { url, init } = s.fetches[0];
  assert.equal(url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(init.headers.Authorization, 'Bearer SECRET'); assert.equal(init.headers['X-Line-Retry-Key'], retryKey);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(init.body), { to: 'U-private', messages: [{ type: 'text', text: 'reply-text' }] });
  assert.equal(s.logs.length, 0); assert.equal(JSON.stringify(result).includes('U-private'), false);
});
test('viewer and unauthenticated users cannot reach DB or LINE', async () => {
  for (const staff of [{ ok: true, canUpdate: false }, { ok: false, reason: 'unauthenticated' }]) {
    const s = setup({ staff }); const r = await s.submit(); assert.equal(r.ok, false);
    if (!staff.ok) assert.equal(r.loginRequired, true);
    assert.equal(s.calls.length, 0); assert.equal(s.fetches.length, 0);
  }
});
test('foreign organization, NULL tenant and inactive/mismatched tenant are rejected before RPC', async () => {
  for (const options of [{ repair: null }, { repair: { id: 23, organization_id: 'org-b', tenant_account_id: 'tenant-a' } },
    { repair: { id: 23, organization_id: 'org-a', tenant_account_id: null } }, { tenant: null },
    { tenant: { id: 'tenant-a', organization_id: 'org-b' } }]) {
    const s = setup(options); assert.equal((await s.submit()).ok, false); assert.equal(s.calls.some(c => c.rpc), false);
  }
});
test('blank, over 2000 characters, invalid repair/request IDs are rejected; 2000 chars allowed', async () => {
  for (const [body, id, req] of [['   ', '23', requestId], ['x'.repeat(2001), '23', requestId], ['reply', 'x', requestId], ['reply', '23', 'bad']]) {
    const s = setup(); assert.equal((await s.submit(body, id, req)).ok, false); assert.equal(s.calls.length, 0);
  }
  assert.equal((await setup().submit('x'.repeat(2000))).ok, true);
});
for (const status of ['not_linked', 'accepted', 'sending', 'failed', 'expired']) test(`${status} does not claim or send`, async () => {
  const s = setup({ status }); assert.equal((await s.submit()).lineStatus, status);
  assert.equal(s.fetches.length, 0); assert.equal(s.calls.some(c => c.rpc === 'claim_staff_line_push'), false);
});
test('claim zero rows never sends', async () => {
  const s = setup({ noClaim: true }); assert.equal((await s.submit()).lineStatus, 'sending'); assert.equal(s.fetches.length, 0);
});
for (const [httpStatus, outcome] of [[200, 'accepted'], [202, 'accepted'], [400, 'failed'], [401, 'failed'], [403, 'failed'], [429, 'unknown'], [500, 'unknown'], [503, 'unknown']])
  test(`LINE ${httpStatus} finishes ${outcome} and preserves saved reply`, async () => {
    const s = setup({ httpStatus }); assert.equal((await s.submit()).lineStatus, outcome);
    assert.deepEqual(s.finishes, [outcome]); assert.equal(s.rows.size, 1); assert.equal(s.logs.length, 0);
  });
test('409 confirms accepted only with LINE accepted header', async () => {
  assert.equal((await setup({ httpStatus: 409, acceptedHeader: true }).submit()).lineStatus, 'accepted');
  assert.equal((await setup({ httpStatus: 409 }).submit()).lineStatus, 'failed');
});
for (const network of ['timeout', 'network error']) test(`${network} preserves DB reply and finishes unknown`, async () => {
  const s = setup({ network }); assert.equal((await s.submit()).lineStatus, 'unknown');
  assert.deepEqual(s.finishes, ['unknown']); assert.equal(s.rows.size, 1); assert.equal(s.logs.length, 0);
});
test('same operation neither duplicates DB reply nor resends accepted push', async () => {
  const s = setup(); await s.submit(); await s.submit(); assert.equal(s.rows.size, 1); assert.equal(s.fetches.length, 1);
});
test('unknown retries reuse the identical recipient/body/retry key', async () => {
  const s = setup({ status: 'unknown', httpStatus: 500 }); await s.submit(); await s.submit();
  assert.equal(s.rows.size, 1); assert.equal(s.fetches.length, 2);
  assert.equal(s.fetches[0].init.body, s.fetches[1].init.body);
  assert.equal(s.fetches[0].init.headers['X-Line-Retry-Key'], s.fetches[1].init.headers['X-Line-Retry-Key']);
});
test('stored reply or claim mismatch never sends', async () => {
  for (const options of [{ storedOverride: { message: 'other' } }, { storedOverride: { organization_id: 'org-b' } },
    { pushOverride: { organization_id: 'org-b' } }, { claimOverride: { repair_message_id: 'other' } }, { claimOverride: { message: 'other' } }]) {
    const s = setup(options); await s.submit(); assert.equal(s.fetches.length, 0);
  }
});
test('RPC failures are generic and finish failure keeps request retryable', async () => {
  for (const failRpc of ['create_staff_reply_with_line_push', 'claim_staff_line_push', 'finish_staff_line_push']) {
    const s = setup({ failRpc }); const r = await s.submit();
    assert.equal(JSON.stringify(r).includes('SECRET'), false); assert.equal(s.logs.length, 0);
    if (failRpc !== 'create_staff_reply_with_line_push') { assert.equal(r.lineStatus, 'unknown'); assert.equal(s.rows.size, 1); }
  }
});
test('missing access token never sends and marks failed', async () => {
  const s = setup({ noToken: true }); assert.equal((await s.submit()).lineStatus, 'failed'); assert.equal(s.fetches.length, 0);
});
