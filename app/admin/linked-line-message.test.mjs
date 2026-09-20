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
    assert.ok(name in imports, name); return imports[name];
  } }); return exports;
}
const line = (extra = {}) => ({ id: 'uuid', organization_id: 'org-a', tenant_account_id: 'tenant-a', repair_request_id: 23,
  sender_type: 'tenant', channel: 'line', message: 'LINE本文', line_sent_at: '2026-09-18T01:00:00Z', created_at: '2026-09-18T03:00:00Z', ...extra });
function setup({ messages = [line()], tenants = [{ id: 'tenant-a', organization_id: 'org-a', display_name: '入居者A' }], failTable, bypass = false } = {}) {
  const queries = [];
  const db = { from(table) {
    const q = { table, filters: [] }; queries.push(q);
    const b = { select(value) { q.select = value; return b; }, eq(...a) { q.filters.push(['eq', ...a]); return b; },
      in(...a) { q.filters.push(['in', ...a]); return b; }, order() { return b; }, abortSignal() { return b; },
      then(resolve, reject) {
        const rows = (table === 'tenant_line_messages' ? messages : tenants).filter(item => bypass ||
          q.filters.every(([op, col, value]) => op === 'in' ? value.includes(item[col]) : item[col] === value));
        return Promise.resolve(table === failTable ? { data: null, error: { message: 'DB_SECRET' } } : { data: rows, error: null }).then(resolve, reject);
      } }; return b;
  } };
  const loaded = load('./linked-line-message-data.ts', { '@/lib/supabase-server': { createServerSupabaseClient: () => db } });
  return { ...loaded, queries, get: () => loaded.getLinkedLineMessages({ ok: true, organizationId: 'org-a', canUpdate: false }, [23]) };
}
test('linked LINE messages exclude unassigned, foreign repair, organization and wrong channel/sender', async () => {
  const s = setup({ messages: [line(), line({ repair_request_id: null }), line({ repair_request_id: 99 }),
    line({ organization_id: 'org-b' }), line({ channel: 'web' }), line({ sender_type: 'staff' })] });
  const result = await s.get();
  assert.equal(result[23].length, 1); assert.equal(result[23][0].sender_name, '入居者A');
  assert.equal(result[23][0].created_at, '2026-09-18T01:00:00Z');
  assert.equal(result[23][0].channel, 'line');
  assert.equal(s.queries[0].select.includes('line_message_id'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(s.queries[0].filters)), [['eq', 'organization_id', 'org-a'], ['in', 'repair_request_id', [23]], ['eq', 'sender_type', 'tenant'], ['eq', 'channel', 'line']]);
  assert.ok(JSON.stringify(s.queries[1].filters).includes('org-a'));
});
test('unexpected rows and lookup failures reject without leaking DB details', async () => {
  for (const extra of [{ organization_id: 'org-b' }, { repair_request_id: null }, { repair_request_id: 99 }, { channel: 'web' }, { sender_type: 'staff' }])
    await assert.rejects(setup({ messages: [line(extra)], bypass: true }).get());
  for (const tenants of [[], [{ id: 'tenant-a', organization_id: 'org-b', display_name: 'foreign' }]])
    await assert.rejects(setup({ tenants, bypass: true }).get());
  for (const failTable of ['tenant_line_messages', 'tenant_accounts'])
    await assert.rejects(setup({ failTable }).get(), error => !error.message.includes('DB_SECRET'));
});
test('LINE dates fall back to created_at; merged conversations sort chronologically and stably', async () => {
  for (const line_sent_at of [null, 'invalid']) assert.equal((await setup({ messages: [line({ line_sent_at })] }).get())[23][0].created_at, '2026-09-18T03:00:00Z');
  const s = setup(); const linked = (await s.get())[23];
  const existing = [{ id: 'uuid', sender_type: 'tenant', sender_name: '入居者', message: '既存', created_at: linked[0].created_at },
    { id: 'staff', sender_type: 'staff', sender_name: '担当', message: '返信', created_at: '2026-09-18T02:00:00Z' }];
  const merged = s.mergeRepairMessages(existing, linked);
  assert.deepEqual(Array.from(merged, item => item.message), ['LINE本文', '既存', '返信']);
  assert.notEqual(merged[0].id, merged[1].id);
  assert.equal(existing.length, 2);
  assert.equal(JSON.stringify(s.mergeRepairMessages([...existing].reverse(), linked)), JSON.stringify(merged));
});
test('viewer sees LINE badge, name and escaped body without IDs; staff reply UI remains', async () => {
  const MessageSection = load('./message-section.tsx', {
    react: { useEffect() {}, useRef: () => ({ current: false }), useState: value => [value, () => {}], useTransition: () => [false, () => {}] },
    '@/lib/staff-reply-operation': {}, './message-attachment': { default: () => null },
    './outbound-attachment-form': { OutboundAttachmentForm: () => null },
    'next/navigation': { useRouter: () => ({ refresh() {} }) }, './message-actions': { submitStaffMessage() {} },
  }).MessageSection;
  const messages = (await setup({ messages: [line({ message: '<script>本文</script>' })] }).get())[23];
  for (const canUpdate of [false, true]) {
    const html = renderToStaticMarkup(jsx.jsx(MessageSection, { repairId: 23, messages, canUpdate, lineUnavailable: true }));
    assert.ok(html.includes('LINE</span>')); assert.ok(html.includes('入居者A')); assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('LINEメッセージを取得できませんでした'));
    for (const secret of ['line:uuid', 'tenant-a', 'org-a', 'line_message_id', '<script>']) assert.equal(html.includes(secret), false);
    assert.equal(html.includes('返信する'), canUpdate);
  }
});
