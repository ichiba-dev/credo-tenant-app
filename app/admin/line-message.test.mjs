import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function load(path, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, AbortSignal, require(name) {
    if (name === 'server-only') return {};
    if (name === 'react/jsx-runtime') return jsx;
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}
const row = (overrides = {}) => ({ id: 'internal-uuid', organization_id: 'org-a', tenant_account_id: 'tenant-a',
  repair_request_id: null, channel: 'line', sender_type: 'tenant', message: '本文', created_at: '2026-09-18T01:00:00Z', ...overrides });
const tenant = { id: 'tenant-a', organization_id: 'org-a', display_name: '入居者A' };
function setup({ messages = [row()], tenants = [tenant], failTable, bypassFilters = false } = {}) {
  const queries = [];
  const db = { from(table) {
    const q = { table, filters: [], orders: [] }; queries.push(q);
    const b = {
      select(value) { q.select = value; return b; },
      eq(...args) { q.filters.push(['eq', ...args]); return b; },
      is(...args) { q.filters.push(['is', ...args]); return b; },
      in(...args) { q.filters.push(['in', ...args]); return b; },
      order(...args) { q.orders.push(args); return b; },
      limit(value) { q.limit = value; return b; },
      abortSignal(value) { assert.ok(value instanceof AbortSignal); return b; },
      then(resolve, reject) {
        let data = table === 'tenant_line_messages' ? messages : tenants;
        if (!bypassFilters) {
          data = data.filter(item => q.filters.every(([op, col, value]) => op === 'in' ? value.includes(item[col]) : item[col] === value));
          data = [...data].sort((a, b) => {
            for (const [col, { ascending }] of q.orders) {
              if (a[col] !== b[col]) return (a[col] < b[col] ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          if (q.limit) data = data.slice(0, q.limit);
        }
        return Promise.resolve(table === failTable ? { data: null, error: { message: 'DB_SECRET' } } : { data, error: null }).then(resolve, reject);
      },
    }; return b;
  } };
  const get = load('./line-message-data.ts', { '@/lib/supabase-server': { createServerSupabaseClient: () => db } }).getUnassignedLineMessages;
  return { queries, get: () => get({ ok: true, organizationId: 'org-a', canUpdate: false }) };
}

test('LINE list filters organization, unassigned, channel and sender; returns names and newest first', async () => {
  const s = setup({ messages: [row({ id: 'old', created_at: '2026-09-17T01:00:00Z' }), row(),
    row({ organization_id: 'org-b' }), row({ repair_request_id: 1 }), row({ channel: 'web' }), row({ sender_type: 'staff' })] });
  const result = await s.get();
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'internal-uuid');
  assert.equal(result[0].tenant_name, '入居者A');
  assert.deepEqual(JSON.parse(JSON.stringify(s.queries[0].filters)), [
    ['eq', 'organization_id', 'org-a'], ['is', 'repair_request_id', null], ['eq', 'channel', 'line'], ['eq', 'sender_type', 'tenant'],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(s.queries[0].orders)), [['created_at', { ascending: false }], ['id', { ascending: false }]]);
  assert.equal(s.queries[0].limit, 50);
  assert.deepEqual(JSON.parse(JSON.stringify(s.queries[1].filters)), [['eq', 'organization_id', 'org-a'], ['in', 'id', ['tenant-a']]]);
  assert.equal(JSON.stringify(result).includes('organization_id'), false);
  assert.equal(s.queries[0].select.includes('line_message_id'), false);
});
test('LINE list caps results at 50 and avoids tenant lookup when empty', async () => {
  assert.equal((await setup({ messages: Array.from({ length: 70 }, (_, i) => row({ id: String(i) })) }).get()).length, 50);
  const empty = setup({ messages: [] });
  assert.equal((await empty.get()).length, 0);
  assert.equal(empty.queries.length, 1);
});
test('LINE list rejects unexpected scope even if the DB returns unfiltered rows', async () => {
  for (const overrides of [{ organization_id: 'org-b' }, { repair_request_id: 5 }, { channel: 'web' }, { sender_type: 'staff' }]) {
    await assert.rejects(setup({ messages: [row(overrides)], bypassFilters: true }).get());
  }
  for (const tenants of [[], [{ ...tenant, organization_id: 'org-b' }], [{ ...tenant, id: 'foreign' }]]) {
    await assert.rejects(setup({ tenants, bypassFilters: true }).get());
  }
});
test('LINE message and name lookup failures are generic', async () => {
  for (const failTable of ['tenant_line_messages', 'tenant_accounts']) {
    await assert.rejects(setup({ failTable }).get(), error => !error.message.includes('DB_SECRET'));
  }
});

const Section = load('./line-message-section.tsx', { './line-message-assignment': { default: () => jsx.jsx('button', { children: '修理依頼に紐づける' }) } }).default;
test('LINE cards render names, JST received time, badges and escaped text without internal IDs or actions', () => {
  const html = renderToStaticMarkup(jsx.jsx(Section, { unavailable: false, messages: [{ id: 'internal-uuid', tenant_name: '入居者A',
    message: '<script>alert(1)</script>\n本文', created_at: '2026-09-18T01:00:00Z' }] }));
  for (const label of ['入居者A', 'LINE', '未割当', '10:00:00', 'whitespace-pre-wrap', 'overflow-wrap:anywhere']) assert.ok(html.includes(label));
  assert.ok(html.includes('&lt;script&gt;'));
  for (const label of ['internal-uuid', '<script>', '<button', 'line_message_id']) assert.equal(html.includes(label), false);
});
test('LINE section renders empty and generic error states', () => {
  assert.ok(renderToStaticMarkup(jsx.jsx(Section, { messages: [], unavailable: false })).includes('未割当LINEメッセージはありません'));
  assert.ok(renderToStaticMarkup(jsx.jsx(Section, { messages: [], unavailable: true })).includes('LINEメッセージを取得できませんでした'));
});
function pageSetup({ authenticated = true, lineError = false, linkedError = false, attachmentError = false } = {}) {
  let lineCalls = 0; let repairCalls = 0;
  const context = authenticated ? { ok: true, organizationId: 'org-a', canUpdate: false } : { ok: false };
  const page = load('./page.tsx', {
    'next/navigation': { redirect(path) { throw new Error(`REDIRECT:${path}`); } },
    '@/lib/supabase-auth/staff': { getStaffContext: async () => context },
    './data': { getAdminRepairs: async () => { repairCalls++; return [{ id: 23 }]; } },
    './admin-repairs': { default: ({ children, canUpdate, repairs }) => jsx.jsxs('main', { children: [jsx.jsx('p', { children: canUpdate ? 'edit' : '修理一覧閲覧' }), ...repairs.flatMap(repair => repair.tenant_messages.map(item => jsx.jsx('p', { children: item.message }))), children] }) },
    './estimate-data': { getAdminEstimateData: async () => ({}) },
    './message-data': { getAdminTenantMessages: async () => ({ 23: [{ id: 'existing', message: '既存会話維持' }] }) },
    './linked-line-message-data': { getLinkedLineMessages: async () => { if (linkedError) throw new Error('DB_SECRET'); return {}; }, mergeRepairMessages: (existing) => existing },
    './line-message-data': { getUnassignedLineMessages: async (value) => { assert.equal(value, context); lineCalls++; if (lineError) throw new Error('DB_SECRET'); return [{ id: 'uuid', tenant_name: '入居者A', message: '本文', created_at: '2026-09-18T01:00:00Z' }]; } },
    './line-message-section': { default: Section },
    './linked-line-attachment-data': { getLinkedLineAttachments: async () => ({}) },
    './outbound-attachment-data': { getOutboundAttachments: async () => ({}) },
    './vendor-dispatch-data': { getVendorDispatchData: async () => ({ candidates: [], byRepair: { 23: [] } }) },
    './line-attachment-data': { getUnassignedLineAttachments: async () => { if (attachmentError) throw new Error('DB_SECRET'); return []; } },
    './line-attachment-section': { default: ({ unavailable }) => unavailable ? jsx.jsx('p', { children: 'LINE添付を取得できませんでした' }) : null },
  }).default;
  return { page, calls: () => ({ lineCalls, repairCalls }) };
}
test('viewer can read LINE messages using verified context', async () => {
  const s = pageSetup();
  const html = renderToStaticMarkup(await s.page());
  assert.ok(html.includes('本文')); assert.ok(html.includes('修理一覧閲覧'));
});
test('unauthenticated admin redirects before any data retrieval', async () => {
  const s = pageSetup({ authenticated: false });
  await assert.rejects(s.page(), /REDIRECT:\/admin\/login/);
  assert.deepEqual(s.calls(), { lineCalls: 0, repairCalls: 0 });
});
test('LINE failure leaves repair list renderable and never exposes DB details', async () => {
  const s = pageSetup({ lineError: true });
  const html = renderToStaticMarkup(await s.page());
  assert.ok(html.includes('修理一覧閲覧'));
  assert.ok(html.includes('LINEメッセージを取得できませんでした'));
  assert.equal(html.includes('DB_SECRET'), false);
  assert.equal(s.calls().repairCalls, 1);
});

test('linked LINE failure preserves repair list and existing repair messages', async () => {
  const s = pageSetup({ linkedError: true });
  const html = renderToStaticMarkup(await s.page());
  assert.ok(html.includes('修理一覧閲覧'));
  assert.ok(html.includes('既存会話維持'));
  assert.equal(html.includes('DB_SECRET'), false);
});

test('attachment failure preserves repair list, existing conversations and unassigned text', async () => {
  const html = renderToStaticMarkup(await pageSetup({ attachmentError: true }).page());
  for (const text of ['修理一覧閲覧', '既存会話維持', '本文', 'LINE添付を取得できませんでした']) assert.ok(html.includes(text));
  assert.equal(html.includes('DB_SECRET'), false);
});
