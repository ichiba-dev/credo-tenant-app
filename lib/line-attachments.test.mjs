import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';

const org = '11111111-1111-4111-8111-111111111111';
const tenant = '22222222-2222-4222-8222-222222222222';
const jpeg = Uint8Array.from([255, 216, 255, 1]);
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const pdf = new TextEncoder().encode('%PDF-1.7');
const event = (changes = {}) => ({ type: 'message', timestamp: 1700000000000, source: { type: 'user', userId: 'SECRET_USER' }, message: { type: 'image', id: 'message-1' }, ...changes });
function load(file, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Buffer, AbortSignal, Date, ...globals, require: name => { if (name === 'server-only') return {}; if (!(name in dependencies)) throw Error(name); return dependencies[name]; } });
  return exports;
}
function setup(options = {}) {
  const calls = [], fetches = [], uploads = [], removals = [], logs = [], rows = new Map();
  let reads = 0;
  if (options.duplicate) rows.set('message-1', { id: randomUUID(), storage_path: 'existing', organization_id: org, tenant_account_id: tenant });
  const db = {
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const q = { select: () => q, eq: (k, v) => { call.filters.push([k, v]); return q; }, is: (k, v) => { call.filters.push([k, v]); return q; }, limit: () => q,
        abortSignal: signal => { assert.ok(signal instanceof AbortSignal); return q; }, maybeSingle: () => q, insert: row => { call.row = row; return q; },
        then(resolve, reject) {
          let result;
          if (table === 'tenant_line_accounts') result = { data: options.links ?? [{ organization_id: org, tenant_account_id: tenant }] };
          else if (table === 'tenant_accounts') result = { data: options.inactiveTenant ? null : { id: tenant, organization_id: options.foreignTenant ? 'other' : org } };
          else if (table === 'organizations') result = { data: options.inactiveOrg ? null : { id: org } };
          else if (call.row) {
            if (options.dbError) result = { error: { code: '23514', message: 'SECRET' } };
            else if (options.uncertain) {
              if (options.persistUncertain) rows.set(call.row.line_message_id, call.row);
              return Promise.reject(Error('SECRET')).then(resolve, reject);
            } else if (rows.has(call.row.line_message_id)) result = { error: { code: '23505' } };
            else { rows.set(call.row.line_message_id, call.row); result = {}; }
          } else {
            reads++;
            result = options.lookupFail || (options.recheckFail && reads > 1) ? { error: { message: 'SECRET' } } : { data: rows.get(call.filters.find(x => x[0] === 'line_message_id')[1]) ?? null };
          }
          return Promise.resolve(result).then(resolve, reject);
        } };
      return q;
    }, storage: { from(name) {
      assert.equal(name, 'tenant-line-files');
      return { upload: async (path, bytes, config) => { uploads.push({ path, bytes, config }); return options.storageError ? { error: { message: 'SECRET' } } : { data: { path } }; },
        remove: async paths => { removals.push(paths); if (options.cleanupThrow) throw Error('SECRET'); return options.cleanupError ? { error: { message: 'SECRET' } } : {}; } };
    } },
  };
  const globals = { console: Object.fromEntries(['log', 'error', 'info', 'warn'].map(k => [k, (...args) => logs.push(args)])), process: { env: options.noToken ? {} : { LINE_CHANNEL_ACCESS_TOKEN: 'SECRET_TOKEN' } },
    fetch: async (url, init) => {
      fetches.push({ url, init }); assert.ok(init.signal instanceof AbortSignal);
      if (options.network) throw new DOMException('SECRET', options.network === 'timeout' ? 'TimeoutError' : 'NetworkError');
      const headers = { 'Content-Type': options.mime ?? 'image/jpeg', ...(options.length === undefined ? {} : { 'Content-Length': options.length }) };
      const body = options.streamError ? new ReadableStream({ pull(controller) { controller.error(Error('SECRET_BINARY')); } }) :
        options.chunks ? new ReadableStream({
          start(controller) { for (const chunk of options.chunks) controller.enqueue(chunk); controller.close(); },
          cancel() { options.onCancel?.(); },
        }) : options.bytes ?? jpeg;
      return new Response(body, { status: options.status ?? 200, headers });
    } };
  const tenantModule = load('./line-tenant.ts', {});
  const magic = load('./estimate-files.ts', {});
  const mod = load('./line-attachments.ts', { 'node:crypto': { randomUUID }, './supabase-server': { createServerSupabaseClient: () => db }, './line-tenant': tenantModule, './estimate-files': magic }, globals);
  const route = load('../app/api/line/webhook/route.ts', { 'node:crypto': { createHmac, timingSafeEqual }, '@/lib/line-webhook': { saveLineTextMessages: async () => {} }, '@/lib/line-attachments': mod }, { ...globals, Response, process: { env: { LINE_CHANNEL_SECRET: 'secret' } } });
  async function post(events = [event()]) {
    const body = JSON.stringify({ events });
    return route.POST(new Request('https://example.com', { method: 'POST', body, headers: { 'x-line-signature': createHmac('sha256', 'secret').update(body).digest('base64') } }));
  }
  return { ...mod, save: (events = [event()]) => mod.saveLineAttachments(events), post, calls, fetches, uploads, removals, logs, rows };
}

for (const [mime, bytes, type, ext] of [['image/jpeg', jpeg, 'image', 'jpg'], ['image/png', png, 'image', 'png'], ['application/pdf', pdf, 'file', 'pdf']])
  test(`${mime} saves exact bytes, scoped path and minimal metadata`, async () => {
    const s = setup({ mime, bytes }); assert.equal((await s.post([event({ message: { type, id: 'message-1', fileName: 'test.pdf' } })])).status, 200);
    const row = s.rows.get('message-1'); assert.equal(row.repair_request_id, null); assert.equal(row.file_size, bytes.length); assert.equal(row.mime_type, mime);
    assert.equal(row.storage_path, `${org}/line/${tenant}/${row.id}.${ext}`); assert.equal(row.line_sent_at, '2023-11-14T22:13:20.000Z');
    assert.equal('created_at' in row, false); assert.equal('line_user_id' in row, false); assert.equal('replyToken' in row, false);
    assert.equal(s.uploads[0].config.upsert, false); assert.equal(s.uploads[0].config.contentType, mime);
    assert.equal(s.fetches[0].init.headers.Authorization, 'Bearer SECRET_TOKEN'); assert.equal(s.fetches[0].init.redirect, 'error');
    assert.equal(s.fetches[0].url, 'https://api-data.line.me/v2/bot/message/message-1/content');
    assert.equal(s.logs.length, 1); assert.equal(JSON.stringify(s.logs).includes('SECRET'), false);
    assert.ok(s.calls.find(x => x.table === 'tenant_line_accounts').filters.some(x => x[0] === 'unlinked_at' && x[1] === null));
  });
for (const mime of ['image/jpeg', 'image/png', 'application/pdf']) test(`${mime} rejects magic spoofing`, async () => {
  const s = setup({ mime, bytes: new TextEncoder().encode('<html>') }); await s.save([event({ message: { type: mime === 'application/pdf' ? 'file' : 'image', id: 'message-1' } })]); assert.equal(s.uploads.length, 0);
});
for (const mime of ['application/octet-stream', 'image/svg+xml', 'text/html']) test(`${mime} ignored`, async () => { const s = setup({ mime }); assert.equal((await s.post()).status, 200); assert.equal(s.uploads.length, 0); });
for (const [mime, size, type] of [['image/jpeg', 10 * 1024 * 1024, 'image'], ['application/pdf', 15 * 1024 * 1024, 'file']]) test(`${mime} enforces actual streamed size even with false header`, async () => {
  const s = setup({ mime, bytes: new Uint8Array(size + 1), length: '1' }); await s.save([event({ message: { type, id: 'message-1' } })]); assert.equal(s.uploads.length, 0);
});
test('missing/false Content-Length does not determine stored size; excessive header stops read', async () => {
  for (const length of [undefined, '1', '999', 'invalid']) { const s = setup({ length }); await s.save(); assert.equal(s.rows.get('message-1').file_size, jpeg.length); }
  const s = setup({ length: '999999999' }); await s.save(); assert.equal(s.uploads.length, 0);
});
test('filename sanitization removes controls, traversal, separators and caps Unicode length', async () => {
  const s = setup({ mime: 'application/pdf', bytes: pdf });
  await s.save([event({ message: { type: 'file', id: 'message-1', fileName: '../\\bad\u0000\n.pdf' } })]);
  assert.equal(/[\u0000-\u001f/\\]/.test(s.rows.get('message-1').original_filename), false);
  assert.equal(s.rows.get('message-1').original_filename.includes('..'), false);
  assert.equal(Array.from(s.safeLineFilename('長'.repeat(300))).length, 255);
  assert.equal(s.safeLineFilename(null), null); assert.equal(s.logs.length, 0);
});
test('duplicate precheck skips API/upload and concurrent duplicate removes only losing object', async () => {
  const duplicate = setup({ duplicate: true }); await duplicate.save(); assert.equal(duplicate.fetches.length, 0);
  const s = setup(); await Promise.all([s.save(), s.save()]); assert.equal(s.rows.size, 1); assert.equal(s.uploads.length, 2); assert.equal(s.removals.length, 1);
  assert.notEqual(s.removals[0][0], s.rows.get('message-1').storage_path);
});
for (const cleanup of [{}, { cleanupError: true }, { cleanupThrow: true }]) test(`definite DB failure attempts own cleanup without leaking details ${JSON.stringify(cleanup)}`, async () => {
  const s = setup({ dbError: true, ...cleanup }); assert.equal((await s.post()).status, 500); assert.deepEqual(JSON.parse(JSON.stringify(s.removals)), [[s.uploads[0].path]]); assert.equal(s.logs.length, 0);
});
test('storage failure returns 500 without DB insert', async () => { const s = setup({ storageError: true }); assert.equal((await s.post()).status, 500); assert.equal(s.calls.some(x => x.row), false); });
test('uncertain DB insert retains committed object; confirmed absence cleans; unknown lookup never deletes', async () => {
  const saved = setup({ uncertain: true, persistUncertain: true }); assert.equal((await saved.post()).status, 200); assert.equal(saved.removals.length, 0);
  const absent = setup({ uncertain: true }); assert.equal((await absent.post()).status, 500); assert.equal(absent.removals.length, 1);
  const unknown = setup({ uncertain: true, recheckFail: true }); assert.equal((await unknown.post()).status, 500); assert.equal(unknown.removals.length, 0);
});
for (const status of [200, 201, 404, 401, 403, 429, 500, 503]) test(`content API ${status} classification`, async () => {
  const s = setup({ status }); assert.equal((await s.post()).status, status < 300 || status === 404 ? 200 : 500); assert.equal(s.uploads.length, status < 300 ? 1 : 0);
});
for (const network of ['timeout', 'network']) test(`${network} returns generic 500 and logs no secret`, async () => { const s = setup({ network }); const r = await s.post(); assert.equal(r.status, 500); assert.equal(JSON.stringify(await r.json()).includes('SECRET'), false); assert.equal(s.logs.length, 0); });
for (const options of [{ links: [] }, { links: [{}, {}] }, { inactiveTenant: true }, { inactiveOrg: true }, { foreignTenant: true }]) test(`unlinked/inactive/inconsistent tenant ignored ${JSON.stringify(options)}`, async () => { const s = setup(options); assert.equal((await s.post()).status, 200); assert.equal(s.fetches.length, 0); });
test('group/room, external/malformed provider and nonmedia never touch DB', async () => {
  const s = setup(); await s.save([event({ source: { type: 'group' } }), event({ source: { type: 'room' } }), event({ message: { type: 'text' } }), event({ message: { type: 'image', contentProvider: { type: 'external', originalContentUrl: 'http://internal' } } }), event({ message: { type: 'image', contentProvider: null } })]); assert.equal(s.calls.length, 0);
});
test('lookup failure and missing token return retryable 500; invalid timestamp becomes null', async () => {
  for (const options of [{ lookupFail: true }, { noToken: true }]) assert.equal((await setup(options).post()).status, 500);
  const s = setup(); await s.save([event({ timestamp: 'bad' })]); assert.equal(s.rows.get('message-1').line_sent_at, null);
});

test('image/PDF event type must match MIME and empty content is ignored', async () => {
  const image = setup({ mime: 'application/pdf', bytes: pdf }); await image.save(); assert.equal(image.uploads.length, 0);
  const file = setup(); await file.save([event({ message: { type: 'file', id: 'message-1' } })]); assert.equal(file.uploads.length, 0);
  const empty = setup({ bytes: new Uint8Array() }); await empty.save(); assert.equal(empty.uploads.length, 0);
});

test('multiple stream chunks are counted and overflow cancels before upload', async () => {
  const valid = setup({ chunks: [jpeg.slice(0, 2), jpeg.slice(2)] }); await valid.save(); assert.equal(valid.rows.get('message-1').file_size, jpeg.length);
  let cancelled = false;
  const s = setup({ chunks: [jpeg, new Uint8Array(10 * 1024 * 1024), jpeg], onCancel: () => { cancelled = true; } });
  await s.save(); assert.equal(s.uploads.length, 0); assert.equal(cancelled, true);
  const interrupted = setup({ streamError: true }); assert.equal((await interrupted.post()).status, 500); assert.equal(interrupted.uploads.length, 0); assert.equal(interrupted.logs.length, 0);
});

for (const [mime, header, size, type] of [['image/jpeg', jpeg, 10 * 1024 * 1024, 'image'], ['application/pdf', pdf, 15 * 1024 * 1024, 'file']])
  test(`${mime} accepts exact byte limit`, async () => {
    const bytes = new Uint8Array(size); bytes.set(header);
    const s = setup({ mime, bytes }); await s.save([event({ message: { type, id: 'message-1' } })]); assert.equal(s.rows.get('message-1').file_size, size);
  });
