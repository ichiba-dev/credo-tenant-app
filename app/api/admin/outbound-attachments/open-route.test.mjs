import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const tenant = '33333333-3333-4333-8333-333333333333';
const fileId = '44444444-4444-4444-8444-444444444444';
const file = { id: fileId, organization_id: org, tenant_account_id: tenant, repair_request_id: 23,
  media_type: 'pdf', mime_type: 'application/pdf', upload_state: 'ready',
  storage_path: `${org}/line-outbound/23/${fileId}.pdf` };

function setup({ role = 'viewer', organizationId = org, attachment = file, accepted = true, repair = true, authenticated = true } = {}) {
  const signs = [];
  const rows = {
    staff_line_attachments: [attachment],
    repair_requests: repair ? [{ id: attachment.repair_request_id, organization_id: attachment.organization_id, tenant_account_id: attachment.tenant_account_id }] : [],
    staff_line_attachment_pushes: accepted ? [{ id: 'push', organization_id: attachment.organization_id, tenant_account_id: attachment.tenant_account_id,
      attachment_id: attachment.id, status: 'accepted' }] : [],
  };
  const db = { from(table) {
    const filters = [];
    const query = { select: () => query, eq: (key, value) => { filters.push([key, value]); return query; },
      maybeSingle: async () => ({ data: rows[table].find(row => filters.every(([key, value]) => row[key] === value)) ?? null, error: null }) };
    return query;
  }, storage: { from: () => ({ createSignedUrl: async (path, ttl) => {
    signs.push({ path, ttl }); return { data: { signedUrl: 'https://private.example/signed' } };
  } }) } };
  const imports = {
    '@/lib/supabase-auth/staff': { getStaffContext: async () => authenticated ? { ok: true, organizationId, canUpdate: role !== 'viewer' } : { ok: false } },
    '@/lib/supabase-server': { createServerSupabaseClient: () => db },
    '@/lib/outbound-media': { OUTBOUND_BUCKET: 'staff-line-files' },
    '@/lib/repair-id': { parseRepairId: value => /^[1-9]\d*$/.test(value) ? Number(value) : null },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./[fileId]/open/route.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { exports, Response, URL, require: name => { assert.ok(name in imports, name); return imports[name]; } });
  return { signs, open: (repairId = '23') => exports.GET(new Request(`https://app.example/api/admin/outbound-attachments/${fileId}/open?repairId=${repairId}`),
    { params: Promise.resolve({ fileId }) }) };
}

test('viewer can open an accepted outbound PDF through the staff-scoped route', async () => {
  const s = setup();
  const response = await s.open();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://private.example/signed');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(s.signs[0].ttl, 120);
});

test('outbound PDF route denies unauthenticated, other organization and other repair access', async () => {
  for (const options of [{ authenticated: false }, { organizationId: otherOrg }, { accepted: false }, { repair: false }]) {
    const s = setup(options);
    assert.equal((await s.open()).status, 404);
    assert.equal(s.signs.length, 0);
  }
  for (const repairId of ['24', '', 'bad']) {
    const s = setup();
    assert.equal((await s.open(repairId)).status, 404);
    assert.equal(s.signs.length, 0);
  }
});
