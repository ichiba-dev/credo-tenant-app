import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const org = '11111111-1111-4111-8111-111111111111', tenant = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333';
const file = (extra = {}) => ({ id, organization_id: org, tenant_account_id: tenant, repair_request_id: 23,
  media_type: 'pdf', mime_type: 'application/pdf', storage_path: `${org}/line/${tenant}/${id}.pdf`, original_filename: '<script>test.pdf', file_size: 10, created_at: '2026-09-18T00:00:00Z', ...extra });
function load(path, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, AbortSignal, Response, URL, require: name => { if (name === 'server-only') return {}; if (name === 'react/jsx-runtime') return jsx; assert.ok(name in imports, name); return imports[name]; } });
  return exports;
}
test('linked images and PDFs exclude unassigned, other repair and foreign organization rows', async () => {
  const s = setup({ files: [file(), file({ id: 'image', media_type: 'image' }), file({ repair_request_id: null }), file({ repair_request_id: 99 }), file({ organization_id: 'foreign' })] });
  const rows = (await s.list())[23];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sender_name, '入居者A');
  assert.deepEqual(Array.from(rows, row => row.attachment.media_type).sort(), ['image', 'pdf']);
  for (const secret of ['storage_path', 'organization_id', 'tenant_account_id', 'signedUrl']) assert.equal(JSON.stringify(rows).includes(secret), false);
  assert.ok(s.calls[0].filters.some(([op, key, value]) => op === 'eq' && key === 'organization_id' && value === org));
  assert.ok(s.calls[0].filters.some(([op, key, value]) => op === 'in' && key === 'repair_request_id' && value.length === 1 && value[0] === 23));
});

test('unexpected scope and database failures fail closed without details', async () => {
  for (const extra of [{ organization_id: 'foreign' }, { repair_request_id: 99 }, { repair_request_id: null }]) {
    await assert.rejects(setup({ files: [file(extra)], bypass: true }).list());
  }
  for (const failTable of ['tenant_line_attachments', 'tenant_accounts']) await assert.rejects(setup({ failTable }).list(), error => !error.message.includes('PRIVATE_DETAIL'));
});

test('attachments merge with web and LINE text by sent date with stable ties and created date fallback', async () => {
  const { mergeRepairMessages } = load('./linked-line-message-data.ts', { '@/lib/supabase-server': {} });
  const attachments = (await setup({ files: [file({ line_sent_at: '2026-09-17T00:00:00Z' }), file({ id: 'second', line_sent_at: 'invalid' })] }).list())[23];
  const web = { id: 'web', message: 'WEB', created_at: '2026-09-17T12:00:00Z' };
  const line = { id: 'line:text', channel: 'line', message: 'LINE本文', created_at: '2026-09-18T00:00:00Z' };
  const merged = mergeRepairMessages([web, line], attachments);
  assert.equal(merged[0].id, attachments[0].id);
  assert.equal(merged[1].message, 'WEB');
  assert.ok(merged.some(item => item.message === 'LINE本文'));
  assert.equal(attachments[1].created_at, '2026-09-18T00:00:00Z');
  assert.equal(JSON.stringify(mergeRepairMessages([line, web], [...attachments].reverse())), JSON.stringify(merged));
  assert.equal((await setup({ files: [file({ line_sent_at: null })] }).list())[23][0].created_at, file().created_at);
});

for (const role of ['admin', 'manager', 'staff', 'viewer']) for (const media of ['image', 'pdf']) test(`${role} opens linked ${media} after repair and organization authorization`, async () => {
  const s = setup({ role, files: [file(media === 'image' ? { media_type: 'image', mime_type: 'image/png', storage_path: `${org}/line/${tenant}/${id}.png` } : {})] });
  const response = await s.open();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://private.example/signed');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(s.signs[0].ttl, media === 'image' ? 300 : 120);
  assert.ok(s.calls.some(q => q.table === 'repair_requests'));
});

test('wrong repair, omitted/invalid/duplicate repair, foreign org, path mismatch and invalid repair rows never sign', async () => {
  for (const query of ['', '?repairId=99', '?repairId=0', '?repairId=bad', '?repairId=23&repairId=23']) {
    const s = setup(); assert.equal((await s.open(query)).status, 404); assert.equal(s.signs.length, 0);
  }
  for (const extra of [{ organization_id: 'foreign' }, { repair_request_id: 99 }, { repair_request_id: null }, { storage_path: `other/line/${tenant}/${id}.pdf` }]) {
    const s = setup({ files: [file(extra)], bypass: true }); assert.ok((await s.open()).status >= 400); assert.equal(s.signs.length, 0);
  }
  for (const repairs of [[], [{ id: 99, organization_id: org, tenant_account_id: tenant }], [{ id: 23, organization_id: 'foreign', tenant_account_id: tenant }], [{ id: 23, organization_id: org, tenant_account_id: 'other' }]]) {
    const s = setup({ repairs, bypass: true }); assert.equal((await s.open()).status, 404); assert.equal(s.signs.length, 0);
  }
  const loggedOut = setup({ auth: false }); assert.equal((await loggedOut.open()).headers.get('location'), 'https://app.example/admin/login'); assert.equal(loggedOut.calls.length, 0);
});

const hooks = { useState: value => [value, () => {}], useEffect() {}, useRef: () => ({ current: false }), useTransition: () => [false, () => {}] };
function sectionImports(react = hooks) {
  return { react, './message-attachment': { default: load('./message-attachment.tsx', { react }).default },
    'next/navigation': { useRouter: () => ({ refresh() {} }) }, './message-actions': {}, '@/lib/staff-reply-operation': {} };
}
test('conversation renders white image/PDF cards, labels, escaped filename and scoped links; viewer cannot reply', async () => {
  const Section = load('./message-section.tsx', sectionImports()).MessageSection;
  const messages = (await setup({ files: [file({ file_size: 5800000 }), file({ id: 'image', media_type: 'image' })] }).list())[23];
  for (const canUpdate of [false, true]) {
    const html = renderToStaticMarkup(jsx.jsx(Section, { repairId: 23, messages, canUpdate }));
    for (const value of ['入居者A', 'LINE</span>', '<img', '画像を拡大して開く', 'PDFを開く', '5.80 MB', '?repairId=23', 'mr-4 bg-white', '&lt;script&gt;']) assert.ok(html.includes(value), value);
    for (const secret of ['storage_path', 'private.example', 'line-attachment:', '<script>']) assert.equal(html.includes(secret), false);
    assert.equal(html.includes('返信する'), canUpdate);
  }
});

test('signing failure leaves data available and image error changes only that attachment', async () => {
  const s = setup({ failSign: true }); assert.equal((await s.open()).status, 503); assert.equal((await s.list())[23].length, 1);
  let failed = false;
  const Component = load('./message-attachment.tsx', { react: { useState: () => [failed, value => { failed = value; }] } }).default;
  const props = { attachment: { id, media_type: 'image' }, repairId: 23 };
  const tree = Component(props);
  tree.props.children.props.onError();
  assert.equal(Component(props).props.children, '画像を表示できません');
  assert.ok(renderToStaticMarkup(jsx.jsx(Component, { ...props, attachment: { id, media_type: 'pdf', file_size: 10 } })).includes('PDFを開く'));
});

test('page isolates attachment load failure and keeps repair and both text conversations', async () => {
  const Section = load('./message-section.tsx', sectionImports()).MessageSection;
  const { mergeRepairMessages } = load('./linked-line-message-data.ts', { '@/lib/supabase-server': {} });
  for (const fail of [false, true]) {
    const page = load('./page.tsx', {
      'next/navigation': {}, '@/lib/supabase-auth/staff': { getStaffContext: async () => ({ ok: true, organizationId: org, canUpdate: false }) },
      './data': { getAdminRepairs: async () => [{ id: 23 }] }, './estimate-data': { getAdminEstimateData: async () => ({}) },
      './message-data': { getAdminTenantMessages: async () => ({ 23: [{ id: 'web', message: '既存会話', created_at: file().created_at }] }) },
      './linked-line-message-data': { mergeRepairMessages, getLinkedLineMessages: async () => ({ 23: [{ id: 'line:text', message: 'LINE本文', channel: 'line', created_at: file().created_at }] }) },
      './linked-line-attachment-data': { getLinkedLineAttachments: async () => { if (fail) throw new Error('PRIVATE_DETAIL'); return setup().list(); } },
      './line-message-data': { getUnassignedLineMessages: async () => [] }, './line-message-section': { default: () => null },
      './line-attachment-data': { getUnassignedLineAttachments: async () => [] }, './line-attachment-section': { default: () => null },
      './admin-repairs': { default: ({ repairs }) => jsx.jsxs('main', { children: ['修理一覧', ...repairs.map(repair => jsx.jsx(Section, { repairId: repair.id, messages: repair.tenant_messages, canUpdate: false, attachmentsUnavailable: repair.line_attachments_unavailable }))] }) },
    }).default;
    const html = renderToStaticMarkup(await page());
    for (const text of ['修理一覧', '既存会話', 'LINE本文']) assert.ok(html.includes(text));
    assert.equal(html.includes('LINE添付を取得できませんでした'), fail);
    assert.equal(html.includes('PDFを開く'), !fail);
    assert.equal(html.includes('PRIVATE_DETAIL'), false);
  }
});
function setup({ files = [file()], role = 'viewer', auth = true, failTable, failSign = false, bypass = false, repairs = [{ id: 23, organization_id: org, tenant_account_id: tenant }] } = {}) {
  const calls = [], signs = [];
  const db = { from(table) {
    const q = { table, filters: [], orders: [] }; calls.push(q);
    const b = { select: columns => { q.columns = columns; return b; }, eq: (k, v) => { q.filters.push(['eq', k, v]); return b; }, is: (k, v) => { q.filters.push(['is', k, v]); return b; },
      in: (k, v) => { q.filters.push(['in', k, v]); return b; }, order: (...a) => { q.orders.push(a); return b; }, limit: n => { q.limit = n; return b; }, abortSignal: () => b, maybeSingle: () => { q.single = true; return b; },
      then(resolve, reject) {
        let rows = table === 'tenant_line_attachments' ? files : table === 'repair_requests' ? repairs : [{ id: tenant, organization_id: org, display_name: '入居者A' }];
        if (!bypass) rows = rows.filter(r => q.filters.every(([op, k, v]) => op === 'in' ? v.includes(r[k]) : r[k] === v));
        rows = [...rows].sort((a, c) => { for (const [k, { ascending }] of q.orders) if (a[k] !== c[k]) return (a[k] < c[k] ? -1 : 1) * (ascending ? 1 : -1); return 0; });
        if (q.limit) rows = rows.slice(0, q.limit);
        return Promise.resolve(table === failTable ? { error: { message: 'PRIVATE_DETAIL' }, data: null } : { data: q.single ? rows[0] ?? null : rows }).then(resolve, reject);
      } }; return b;
  }, storage: { from: name => ({ createSignedUrl: async (path, ttl) => { signs.push({ name, path, ttl }); return failSign ? { error: { message: 'PRIVATE_DETAIL' } } : { data: { signedUrl: 'https://private.example/signed' } }; } }) } };
  const imports = { '@/lib/repair-id': load('../../lib/repair-id.ts', {}), '@/lib/supabase-server': { createServerSupabaseClient: () => db }, '@/lib/supabase-auth/staff': { getStaffContext: async () => auth ? { ok: true, organizationId: org, canUpdate: role !== 'viewer' } : { ok: false, reason: 'unauthenticated' } },
    '@/lib/line-attachment-access': load('../../lib/line-attachment-access.ts', {}) };
  const route = load('../api/admin/line-attachments/[fileId]/open/route.ts', imports);
  return { calls, signs, list: () => load('./linked-line-attachment-data.ts', imports).getLinkedLineAttachments({ ok: true, organizationId: org, canUpdate: false }, [23]),
    open: (query = '?repairId=23', fileId = id) => route.GET(new Request('https://app.example/api/file' + query), { params: Promise.resolve({ fileId }) }) };
}
