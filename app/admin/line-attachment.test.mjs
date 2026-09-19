import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const org = '11111111-1111-4111-8111-111111111111', tenant = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333';
const file = (extra = {}) => ({ id, organization_id: org, tenant_account_id: tenant, repair_request_id: null,
  media_type: 'pdf', mime_type: 'application/pdf', storage_path: `${org}/line/${tenant}/${id}.pdf`, original_filename: '<script>test.pdf', file_size: 10, created_at: '2026-09-18T00:00:00Z', ...extra });
function load(path, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, AbortSignal, Response, URL, require: name => { if (name === 'server-only') return {}; if (name === 'react/jsx-runtime') return jsx; assert.ok(name in imports, name); return imports[name]; } });
  return exports;
}
function setup({ files = [file()], role = 'viewer', auth = true, failTable, failSign = false, bypass = false } = {}) {
  const calls = [], signs = [];
  const db = { from(table) {
    const q = { table, filters: [], orders: [] }; calls.push(q);
    const b = { select: columns => { q.columns = columns; return b; }, eq: (k, v) => { q.filters.push(['eq', k, v]); return b; }, is: (k, v) => { q.filters.push(['is', k, v]); return b; },
      in: (k, v) => { q.filters.push(['in', k, v]); return b; }, order: (...a) => { q.orders.push(a); return b; }, limit: n => { q.limit = n; return b; }, abortSignal: () => b, maybeSingle: () => { q.single = true; return b; },
      then(resolve, reject) {
        let rows = table === 'tenant_line_attachments' ? files : [{ id: tenant, organization_id: org, display_name: '入居者A' }];
        if (!bypass) rows = rows.filter(r => q.filters.every(([op, k, v]) => op === 'in' ? v.includes(r[k]) : r[k] === v));
        rows = [...rows].sort((a, c) => { for (const [k, { ascending }] of q.orders) if (a[k] !== c[k]) return (a[k] < c[k] ? -1 : 1) * (ascending ? 1 : -1); return 0; });
        if (q.limit) rows = rows.slice(0, q.limit);
        return Promise.resolve(table === failTable ? { error: { message: 'PRIVATE_DETAIL' }, data: null } : { data: q.single ? rows[0] ?? null : rows }).then(resolve, reject);
      } }; return b;
  }, storage: { from: name => ({ createSignedUrl: async (path, ttl) => { signs.push({ name, path, ttl }); return failSign ? { error: { message: 'PRIVATE_DETAIL' } } : { data: { signedUrl: 'https://private.example/signed' } }; } }) } };
  const imports = { '@/lib/repair-id': load('../../lib/repair-id.ts', {}), '@/lib/supabase-server': { createServerSupabaseClient: () => db }, '@/lib/supabase-auth/staff': { getStaffContext: async () => auth ? { ok: true, organizationId: org, canUpdate: role !== 'viewer' } : { ok: false, reason: 'unauthenticated' } },
    '@/lib/line-attachment-access': load('../../lib/line-attachment-access.ts', {}) };
  const route = load('../api/admin/line-attachments/[fileId]/open/route.ts', imports);
  return { calls, signs, list: () => load('./line-attachment-data.ts', imports).getUnassignedLineAttachments({ ok: true, organizationId: org, canUpdate: false }),
    open: (fileId = id) => route.GET(new Request('https://app.example/api/file'), { params: Promise.resolve({ fileId }) }) };
}
test('unassigned image/pdf list is organization-scoped, newest first, bounded and only returns UI fields', async () => {
  const s = setup({ files: [file(), file({ id: 'other', media_type: 'image', created_at: '2026-09-19T00:00:00Z' }), file({ organization_id: 'other' }), file({ repair_request_id: 1 })] });
  const rows = await s.list(); assert.equal(rows.length, 2); assert.equal(rows[0].media_type, 'image'); assert.equal(rows[0].tenant_name, '入居者A'); assert.equal(s.calls[0].limit, 50);
  for (const field of ['storage_path', 'organization_id', 'tenant_account_id', 'line_message_id']) assert.equal(JSON.stringify(rows).includes(field), false);
  assert.ok(s.calls[1].filters.some(f => f[1] === 'organization_id' && f[2] === org));
  const fifty = setup({ files: Array.from({ length: 60 }, (_, n) => file({ id: String(n) })) }); assert.equal((await fifty.list()).length, 50);
});
test('unexpected foreign list row is rejected; DB and tenant lookup failures are isolated', async () => {
  await assert.rejects(setup({ files: [file({ organization_id: 'other' })], bypass: true }).list());
  for (const failTable of ['tenant_line_attachments', 'tenant_accounts']) await assert.rejects(setup({ failTable }).list(), e => !e.message.includes('PRIVATE'));
});
for (const media of ['image', 'pdf']) test(`viewer can open ${media} after scoped reauthorization and path check`, async () => {
  const s = setup({ files: [file(media === 'image' ? { media_type: 'image', mime_type: 'image/png', storage_path: `${org}/line/${tenant}/${id}.png` } : {})] });
  const r = await s.open(); assert.equal(r.status, 303); assert.equal(r.headers.get('location'), 'https://private.example/signed'); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(s.signs[0].ttl, media === 'image' ? 300 : 120); assert.equal(s.signs[0].name, 'tenant-line-files');
});
test('foreign/missing file, wrong prefix, traversal, MIME mismatch and tenant mismatch never sign', async () => {
  for (const extra of [{ organization_id: 'other' }, { storage_path: `other/line/${tenant}/${id}.pdf` }, { storage_path: `${org}/line/${tenant}/../${id}.pdf` }, { mime_type: 'text/html' }, { tenant_account_id: 'other' }]) {
    const s = setup({ files: [file(extra)], bypass: true }); assert.ok((await s.open()).status >= 400); assert.equal(s.signs.length, 0);
  }
  const missing = setup({ files: [] }); assert.equal((await missing.open()).status, 404); assert.equal(missing.signs.length, 0);
  assert.equal((await setup().open('bad')).status, 404);
});
test('signing failure is a general error and leaves the list usable; unauthenticated redirects to login', async () => {
  const s = setup({ failSign: true }); const r = await s.open(); assert.equal(r.status, 503); assert.equal((await s.list()).length, 1); assert.equal((await r.text()).includes('PRIVATE'), false);
  const loggedOut = setup({ auth: false }); assert.equal((await loggedOut.open()).headers.get('location'), 'https://app.example/admin/login'); assert.equal(loggedOut.calls.length, 0);
});
test('cards show image/pdf, escaped filename, size and names; viewer has no assignment UI or signed URL text', () => {
  const Section = load('./line-attachment-section.tsx', { react: { useState: x => [x, () => {}] }, './line-attachment-assignment': { default: () => jsx.jsx('button', { children: '修理依頼に紐づける' }) } }).default;
  for (const canUpdate of [false, true]) {
    const attachments = [file(), file({ id: 'image', media_type: 'image' })].map(f => ({ id: f.id, media_type: f.media_type, original_filename: f.original_filename, file_size: f.file_size, created_at: f.created_at, tenant_name: '入居者A' }));
    const html = renderToStaticMarkup(jsx.jsx(Section, { attachments, unavailable: false, canUpdate }));
    assert.ok(html.includes('<img')); assert.ok(html.includes('PDFを開く')); assert.ok(html.includes('MiB')); assert.ok(html.includes('入居者A')); assert.equal(html.includes('<button'), canUpdate);
    assert.equal(html.includes('<script>'), false); assert.equal(html.includes('storage_path'), false); assert.equal(html.includes('private.example'), false);
  }
});

test('image onError affects only its card and renders a general fallback', () => {
  let failed = false;
  const Section = load('./line-attachment-section.tsx', { react: { useState: () => [failed, v => { failed = v; }] }, './line-attachment-assignment': {} }).default;
  const tree = Section({ attachments: [{ id, media_type: 'image', tenant_name: '入居者', created_at: '2026-09-18T00:00:00Z' }], unavailable: false, canUpdate: false });
  const imageElement = tree.props.children[2].props.children[0].props.children[2];
  const image = imageElement.type(imageElement.props);
  const img = Array.isArray(image.props.children) ? image.props.children.find(child => child?.type === 'img') : image.props.children;
  img.props.onError();
  const fallback = imageElement.type(imageElement.props);
  assert.equal(fallback.props.children, '画像を表示できません');
});
