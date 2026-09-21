// LOCAL TEST ONLY. Uses only the credo-tenant-app Docker containers and 127.0.0.1:54321.
// It is not production DDL or a production verification script.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const db = 'supabase_db_credo-tenant-app';
const storageContainer = 'supabase_storage_credo-tenant-app';
const kong = 'supabase_kong_credo-tenant-app';
const endpoint = 'http://127.0.0.1:54321';
const org = '11111111-1111-4111-8111-111111111111';
const staff = '22222222-2222-4222-8222-222222222222';
const repair = '900000000001';
const vendor = 'aa000000-0000-4000-8000-000000000001';
const dispatch = 'aa000000-0000-4000-8000-000000000002';
const quote = 'aa000000-0000-4000-8000-000000000003';
const file = 'aa000000-0000-4000-8000-000000000004';
const bucket = 'vendor-quotes';
const uploaded = [];
let passed = 0;

function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function sql(query) {
  return docker(['exec', db, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', query]);
}
function pass(label) { passed++; process.stdout.write(`PASS ${label}\n`); }
function expectSqlFailure(query, label) {
  try { sql(query); } catch { pass(label); return; }
  throw new Error(`Expected SQL failure: ${label}`);
}
function asStaff(query) {
  return sql(`set role authenticated; set request.jwt.claim.sub='${staff}'; ${query}`)
    .split(/\r?\n/).at(-1);
}
function pdfBytes() {
  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(chunks.join('')));
    chunks.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xref = Buffer.byteLength(chunks.join(''));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.from(chunks.join(''));
}

const kongInfo = JSON.parse(docker(['inspect', kong]))[0];
const storageInfo = JSON.parse(docker(['inspect', storageContainer]))[0];
const dbInfo = JSON.parse(docker(['inspect', db]))[0];
for (const item of [kongInfo, storageInfo, dbInfo]) {
  if (item.Config.Labels['com.supabase.cli.project'] !== 'credo-tenant-app' ||
      item.Config.Labels['com.supabase.cli.workdir'].toLowerCase() !== process.cwd().toLowerCase()) {
    throw new Error('Local Supabase container identity mismatch');
  }
}
if (kongInfo.HostConfig.PortBindings['8000/tcp']?.[0]?.HostPort !== '54321') {
  throw new Error('Local Storage API port mismatch');
}
const serviceKey = storageInfo.Config.Env.find((x) => x.startsWith('SERVICE_KEY='))?.slice(12);
const anonKey = storageInfo.Config.Env.find((x) => x.startsWith('ANON_KEY='))?.slice(9);
if (!serviceKey || !anonKey) throw new Error('Local API key absent');
const client = createClient(endpoint, serviceKey, { auth: { persistSession: false } });
const storage = client.storage.from(bucket);
const browserStorage = createClient(endpoint, anonKey, { auth: { persistSession: false } }).storage.from(bucket);
const bytes = pdfBytes();
const hash = createHash('sha256').update(bytes).digest('hex');
const lines = '[{"description":"Repair","quantity":1,"unit":"job","unit_price_ex_tax":80000,"line_amount_ex_tax":80000,"tax_rate":0.1}]';

async function upload(path, mime = 'application/pdf') {
  const signed = await storage.createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data) throw signed.error ?? new Error('Signed upload unavailable');
  const { error } = await browserStorage.uploadToSignedUrl(path, signed.data.token,
    new Blob([bytes], { type: mime }), {
    contentType: mime, upsert: false, metadata: { sha256: hash },
  });
  if (error) throw error;
  uploaded.push(path);
}
function quoteCall(quoteId, fileId, requestId, size = bytes.length, sha = hash) {
  sql(`insert into public.vendor_quote_uploads(organization_id,request_id,
    repair_request_id,dispatch_id,actor_auth_user_id,quote_id,file_id,original_filename,
    file_size,content_sha256,received_at,issued_at,expires_at)
    values('${org}','${requestId}',${repair},'${dispatch}','${staff}',
      '${quoteId}','${fileId}','actual.pdf',${size},decode('${sha}','hex'),
      now()-interval '1 day',now(),now()+interval '10 minutes');`);
  const times=sql(`select issued_at::text||'|'||received_at::text from public.vendor_quote_uploads
    where organization_id='${org}' and request_id='${requestId}';`);
  const [issued,received]=times.split('|');
  return sql(`select (public.record_vendor_quote_revision(
    '${org}','${dispatch}','${quoteId}','${fileId}','${requestId}','${staff}',
    '${issued}','${received}',null,null,'floor','${lines}'::jsonb,'actual.pdf',${size},
    decode('${sha}','hex'))).revision_no;`);
}
function noQuoteRows(quoteId, requestId) {
  const result = sql(`select (select count(*) from public.vendor_quote_versions where id='${quoteId}')+
    (select count(*) from public.vendor_quote_lines where quote_version_id='${quoteId}')+
    (select count(*) from public.vendor_quote_files where quote_version_id='${quoteId}')+
    (select count(*) from public.repair_vendor_dispatch_events where request_id='${requestId}');`);
  if (result !== '0') throw new Error(`Partial DB rows remain for ${quoteId}: ${result}`);
  pass(`rollback_${requestId.slice(-2)}`);
}
async function rejectAtPath(index, path, size = bytes.length, sha = hash, place = true) {
  const quoteId = `aa000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const fileId = `bb000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const req = `cc000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  if (place) await upload(path ?? `${org}/${repair}/${dispatch}/${quoteId}/${fileId}.pdf`);
  try { quoteCall(quoteId,fileId,req,size,sha); }
  catch { pass(`rejected_${index}`); noQuoteRows(quoteId,req); return; }
  throw new Error(`Expected SQL failure: rejected_${index}`);
}

try {
  if (sql('select count(*) from public.repair_vendors;') !== '0' ||
      sql(`select count(*) from storage.objects where bucket_id='${bucket}';`) !== '0') {
    throw new Error('Local vendor test area is not empty; refusing cleanup risk');
  }
  if (sql(`select public,file_size_limit,allowed_mime_types::text from storage.buckets where id='${bucket}';`) !==
      'f|15728640|{application/pdf}') throw new Error('Private PDF bucket config mismatch');
  pass('local_endpoint_and_bucket');
  sql(`insert into public.repair_vendors(id,organization_id,company_name,contact_name)
    values ('${vendor}','${org}','Actual PDF test','Local');
    insert into public.repair_vendor_dispatches
    (id,organization_id,repair_request_id,vendor_id,assigned_by,request_id,instructions)
    values ('${dispatch}','${org}',${repair},'${vendor}','${staff}',
      'aa000000-0000-4000-8000-000000000005','Test actual PDF');`);
  asStaff(`select (public.transition_repair_vendor_dispatch('${org}','${dispatch}','dispatched',
    'aa000000-0000-4000-8000-000000000006')).status;`);
  const goodPath = `${org}/${repair}/${dispatch}/${quote}/${file}.pdf`;
  await upload(goodPath);
  const { data: downloaded, error: downloadError } = await storage.download(goodPath);
  if (downloadError || !downloaded) throw downloadError ?? new Error('Download empty');
  const actual = Buffer.from(await downloaded.arrayBuffer());
  if (!actual.equals(bytes) || createHash('sha256').update(actual).digest('hex') !== hash) {
    throw new Error('Storage API bytes/hash mismatch');
  }
  pass('actual_pdf_upload_download_sha256');
  if (quoteCall(quote, file, 'aa000000-0000-4000-8000-000000000007') !== '1') {
    throw new Error('Actual PDF quote registration failed');
  }
  pass('actual_pdf_quote_revision');
  const wrongMimePath = `${org}/${repair}/${dispatch}/wrong-mime.pdf`;
  const wrongMime = await storage.upload(wrongMimePath, bytes, {
    contentType: 'text/plain', metadata: { sha256: hash }, upsert: false,
  });
  if (!wrongMime.error) { uploaded.push(wrongMimePath); throw new Error('Storage accepted wrong MIME'); }
  pass('mime_rejected_by_storage_api');
  await rejectAtPath(11, null, bytes.length + 1);
  await rejectAtPath(12, null, bytes.length, '00'.repeat(32));
  await rejectAtPath(13, `${org}/${repair}/${dispatch}/wrong-path.pdf`);
  await rejectAtPath(14, null, bytes.length, hash, false);
  await rejectAtPath(15, `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${repair}/${dispatch}/wrong-org.pdf`);
  await rejectAtPath(16, `${org}/900000000002/${dispatch}/wrong-repair.pdf`);
  await rejectAtPath(17, `${org}/${repair}/aa000000-0000-4000-8000-000000000099/wrong-dispatch.pdf`);
  await rejectAtPath(18, `${org}/${repair}/${dispatch}/aa000000-0000-4000-8000-000000000099/wrong-quote.pdf`);
  for (const [table, column] of [
    ['vendor_quote_versions', 'vendor_quote_number'],
    ['vendor_quote_lines', 'description'],
    ['vendor_quote_files', 'original_filename'],
  ]) {
    const key = table === 'vendor_quote_versions' ? 'id' : 'quote_version_id';
    expectSqlFailure(`update public.${table} set ${column}='changed' where ${key}='${quote}';`,
      `${table}_update_denied`);
    expectSqlFailure(`delete from public.${table} where ${key}='${quote}';`,
      `${table}_delete_denied`);
  }
  process.stdout.write(`RESULT ${passed}/${passed}\n`);
} finally {
  if (uploaded.length) {
    const { error } = await storage.remove(uploaded);
    if (error) throw new Error(`Storage cleanup failed: ${error.message}`);
  }
  // These new local tables were empty before the test. TRUNCATE bypasses the
  // intentional append-only triggers solely to remove local test rows.
  sql(`do $cleanup$ begin
    if to_regclass('public.vendor_master_requests') is not null then
      execute 'truncate public.vendor_master_requests,public.vendor_quote_files,public.vendor_quote_lines,
        public.repair_vendor_dispatch_events,public.vendor_quote_versions,public.vendor_quote_uploads,
        public.repair_vendor_dispatches,public.repair_vendor_categories,
        public.repair_vendor_areas,public.repair_vendors';
    else
      execute 'truncate public.vendor_quote_files,public.vendor_quote_lines,
        public.repair_vendor_dispatch_events,public.vendor_quote_versions,public.vendor_quote_uploads,
        public.repair_vendor_dispatches,public.repair_vendor_categories,
        public.repair_vendor_areas,public.repair_vendors';
    end if;
  end $cleanup$;`);
  if (sql(`select count(*) from storage.objects where bucket_id='${bucket}';`) !== '0' ||
      sql('select count(*) from public.repair_vendors;') !== '0') {
    throw new Error('Local cleanup incomplete');
  }
}
