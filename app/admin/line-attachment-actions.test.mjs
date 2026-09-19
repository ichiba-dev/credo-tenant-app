import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const id = '11111111-1111-4111-8111-111111111111';
const message = () => ({ id, organization_id: 'org-a', tenant_account_id: 'tenant-a', repair_request_id: null, media_type: 'pdf', original_filename: 'test.pdf', file_size: 10, created_at: '2026-09-18T00:00:00Z' });
const repair = () => ({ id: 23, organization_id: 'org-a', tenant_account_id: 'tenant-a', property_name: '物件', room_number: '101', category: '水道', description: '内容', created_at: '2026-09-18T00:00:00Z', status: '受付' });
function load(path, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, AbortSignal, require(name) {
    if (name === 'server-only') return {};
    if (name === 'react/jsx-runtime') return jsx;
    assert.ok(name in imports, name); return imports[name];
  } }); return exports;
}
function setup({ role = 'admin', authenticated = true, messages = [message()], repairs = [repair()], race = false, failTable, bypass = false } = {}) {
  const queries = []; const refreshed = []; let authCalls = 0;
  const db = { from(table) {
    const q = { table, filters: [] }; queries.push(q);
    const b = {
      select(value) { q.select = value; return b; }, eq(...args) { q.filters.push(['eq', ...args]); return b; },
      is(...args) { q.filters.push(['is', ...args]); return b; }, in(...args) { q.filters.push(['in', ...args]); return b; },
      order(...args) { (q.orders ??= []).push(args); return b; },
      update(value) { q.update = value; return b; }, maybeSingle() { q.single = true; return b; },
      abortSignal() { return b; }, limit() { return b; },
      then(resolve, reject) {
        if (race && q.update) messages[0].repair_request_id = 99;
        let rows = table === 'tenant_line_attachments' ? messages : table === 'repair_requests' ? repairs : [{ id: 'tenant-a', organization_id: 'org-a', display_name: '入居者' }];
        rows = rows.filter(row => bypass || q.filters.every(([op, col, value]) => op === 'in' ? value.includes(row[col]) : row[col] === value));
        if (q.update && !failTable) rows.forEach(row => Object.assign(row, q.update));
        return Promise.resolve(table === failTable ? { data: null, error: { message: 'DB_SECRET' } } : { data: q.single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      },
    }; return b;
  } };
  const imports = { '@/lib/supabase-server': { createServerSupabaseClient: () => db },
    '@/lib/supabase-auth/staff': { getStaffContext: async () => { authCalls++; return authenticated ? { ok: true, organizationId: 'org-a', canUpdate: ['admin', 'manager', 'staff'].includes(role) } : { ok: false, reason: 'unauthenticated' }; } },
    '@/lib/repair-id': load('../../lib/repair-id.ts', {}), 'next/cache': { revalidatePath: path => refreshed.push(path) } };
  return { ...load('./line-attachment-actions.ts', imports),
    list: () => load('./line-attachment-data.ts', imports).getUnassignedLineAttachments({ ok: true, organizationId: 'org-a' }),
    messages, queries, refreshed, authCalls: () => authCalls };
}
for (const role of ['admin', 'manager', 'staff']) test(`${role} assigns same-tenant repair and message disappears from unassigned list`, async () => {
  const s = setup({ role });
  assert.equal((await s.list()).length, 1);
  assert.equal((await s.assignLineAttachment(id, '23')).ok, true);
  assert.equal(s.messages[0].repair_request_id, 23);
  assert.equal((await s.list()).length, 0);
  assert.deepEqual(s.refreshed, ['/admin']);
  const q = s.queries.find(q => q.update);
  assert.deepEqual(JSON.parse(JSON.stringify(q.update)), { repair_request_id: 23 });
  for (const filter of [['eq', 'organization_id', 'org-a'], ['eq', 'tenant_account_id', 'tenant-a'], ['is', 'repair_request_id', null]])
    assert.ok(JSON.stringify(q.filters).includes(JSON.stringify(filter)));
});
test('viewer and unauthenticated direct actions are rejected before data access', async () => {
  for (const options of [{ role: 'viewer' }, { authenticated: false }]) {
    const s = setup(options);
    for (const result of [await s.getLineAttachmentRepairCandidates(id), await s.assignLineAttachment(id, '23')]) {
      assert.equal(result.ok, false);
      if (options.authenticated === false) assert.equal(result.loginRequired, true);
    }
    assert.equal(s.queries.length, 0); assert.equal(s.authCalls(), 2);
  }
});
for (const [label, options] of [
  ['foreign organization repair', { repairs: [{ ...repair(), organization_id: 'org-b' }] }],
  ['foreign tenant repair', { repairs: [{ ...repair(), tenant_account_id: 'tenant-b' }] }],
  ['NULL tenant repair', { repairs: [{ ...repair(), tenant_account_id: null }] }],
  ['foreign organization message', { messages: [{ ...message(), organization_id: 'org-b' }] }],
  ['already assigned message', { messages: [{ ...message(), repair_request_id: 99 }] }],
  ['missing message', { messages: [] }], ['missing repair', { repairs: [] }],
]) test(`${label} cannot update`, async () => {
  const s = setup(options); assert.equal((await s.assignLineAttachment(id, '23')).ok, false);
  assert.equal(s.queries.some(q => q.update), false);
});
test('unexpected foreign rows are rejected even when DB filters are bypassed', async () => {
  for (const options of [{ messages: [{ ...message(), organization_id: 'org-b' }] },
    { repairs: [{ ...repair(), organization_id: 'org-b' }] }, { repairs: [{ ...repair(), tenant_account_id: 'tenant-b' }] }]) {
    const s = setup({ ...options, bypass: true }); assert.equal((await s.assignLineAttachment(id, '23')).ok, false);
    assert.equal(s.queries.some(q => q.update), false);
  }
});
test('concurrent assignment is never overwritten', async () => {
  const s = setup({ race: true }); const result = await s.assignLineAttachment(id, '23');
  assert.equal(result.ok, false); assert.ok(result.message.includes('すでに紐づけ済み'));
  assert.equal(s.messages[0].repair_request_id, 99); assert.equal(s.refreshed.length, 0);
});
test('candidates contain only same-organization same-tenant repairs and minimal display data', async () => {
  const s = setup({ repairs: [repair(), { ...repair(), id: 24, tenant_account_id: 'tenant-b' },
    { ...repair(), id: 25, organization_id: 'org-b' }, { ...repair(), id: 26, tenant_account_id: null }] });
  const result = await s.getLineAttachmentRepairCandidates(id);
  assert.equal(result.ok, true); assert.equal(result.repairs.length, 1);
  for (const field of ['property_name', 'room_number', 'category', 'description', 'created_at', 'status']) assert.ok(field in result.repairs[0]);
  assert.equal('tenant_account_id' in result.repairs[0], false);
  assert.equal(JSON.stringify(s.queries[1].orders).includes('"ascending":false'), true);
});
test('invalid IDs and DB errors never succeed or expose details', async () => {
  for (const repairId of ['0', '-1', '9007199254740992', {}, 'bad']) {
    assert.equal((await setup().assignLineAttachment(id, repairId)).ok, false);
  }
  assert.equal((await setup().assignLineAttachment('bad', '23')).ok, false);
  for (const failTable of ['tenant_line_attachments', 'repair_requests']) {
    const result = await setup({ failTable }).assignLineAttachment(id, '23');
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('DB_SECRET'), false);
  }
});
