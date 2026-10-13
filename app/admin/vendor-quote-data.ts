import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import type { VendorQuoteView, VendorQuoteRequestView } from './types';
export async function getVendorQuoteData(organizationId: string, repairIds: number[]) {
  const result: Record<number, { quotes: VendorQuoteView[]; requests: VendorQuoteRequestView[] }> = Object.fromEntries(repairIds.map(id => [id, { quotes: [], requests: [] }]));
  if (!organizationId || repairIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('QUOTE_SCOPE_INVALID');
  if (!repairIds.length) return result;
  const db = createServerSupabaseClient();
  const ds = await db.from('repair_vendor_dispatches').select('id,organization_id,repair_request_id,vendor_id').eq('organization_id', organizationId).in('repair_request_id', repairIds);
  if (ds.error || !ds.data || ds.data.some(d => d.organization_id !== organizationId || !repairIds.includes(d.repair_request_id))) throw Error('QUOTE_SCOPE_INVALID');
  const dispatches = new Map(ds.data.map(d => [d.id, d]));
  if (!dispatches.size) return result;
  const ids = [...dispatches.keys()];
  const [qr, rr, vr] = await Promise.all([
    db.from('vendor_quote_versions').select('id,organization_id,dispatch_id,received_at,vendor_quote_number,valid_until,revision_no,amount_ex_tax,tax_amount,amount_inc_tax').eq('organization_id', organizationId).in('dispatch_id', ids).order('received_at', { ascending: false }),
    db.from('vendor_quote_requests').select('id,organization_id,repair_request_id,vendor_dispatch_id,vendor_id,status,expires_at,created_at,submitted_at,revoked_at,quote_version_id,notes').eq('organization_id', organizationId).in('vendor_dispatch_id', ids).order('created_at', { ascending: false }),
    db.from('repair_vendors').select('id,organization_id,company_name').eq('organization_id', organizationId).in('id', [...new Set(ds.data.map(d=>d.vendor_id))]),
  ]);
  if (qr.error || rr.error || vr.error || !qr.data || !rr.data || !vr.data ||
    qr.data.some(q=>q.organization_id!==organizationId || !dispatches.has(q.dispatch_id)) ||
    rr.data.some(r=>r.organization_id!==organizationId || dispatches.get(r.vendor_dispatch_id)?.repair_request_id!==r.repair_request_id || dispatches.get(r.vendor_dispatch_id)?.vendor_id!==r.vendor_id) ||
    vr.data.some(v=>v.organization_id!==organizationId)) throw Error('QUOTE_SCOPE_INVALID');
  const quoteIds = qr.data.map(q=>q.id);
  const [fl, ln] = quoteIds.length ? await Promise.all([
    db.from('vendor_quote_files').select('id,organization_id,quote_version_id,original_filename').eq('organization_id', organizationId).in('quote_version_id', quoteIds),
    db.from('vendor_quote_lines').select('id,organization_id,quote_version_id,description,quantity,unit,unit_price_ex_tax,tax_rate,line_amount_ex_tax').eq('organization_id', organizationId).in('quote_version_id', quoteIds).order('line_no'),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (fl.error || ln.error || !fl.data || !ln.data || [...fl.data, ...ln.data].some(row=>row.organization_id!==organizationId || !quoteIds.includes(row.quote_version_id))) throw Error('QUOTE_SCOPE_INVALID');
  const names = new Map(vr.data.map(v=>[v.id,v.company_name]));
  for (const q of qr.data) {
    const d = dispatches.get(q.dispatch_id)!;
    const request = rr.data.find(r=>r.quote_version_id===q.id && r.vendor_dispatch_id===q.dispatch_id && r.status==='submitted');
    result[d.repair_request_id].quotes.push({
      id:q.id,dispatch_id:q.dispatch_id,vendorName:names.get(d.vendor_id)??'業者',received_at:q.received_at,vendor_quote_number:q.vendor_quote_number,valid_until:q.valid_until,revision_no:q.revision_no,
      amount_ex_tax:Number(q.amount_ex_tax),tax_amount:Number(q.tax_amount),amount_inc_tax:Number(q.amount_inc_tax),submissionPath:request?'vendor':'staff',notes:request?.notes??null,
      files:fl.data.filter(f=>f.quote_version_id===q.id).map(f=>({id:f.id,original_filename:f.original_filename})),
      lines:ln.data.filter(l=>l.quote_version_id===q.id).map(l=>({id:l.id,description:l.description,quantity:Number(l.quantity),unit:l.unit,unit_price_ex_tax:Number(l.unit_price_ex_tax),tax_rate:Number(l.tax_rate),line_amount_ex_tax:Number(l.line_amount_ex_tax)})),
    });
  }
  for (const r of rr.data) result[r.repair_request_id].requests.push({ id:r.id,vendor_dispatch_id:r.vendor_dispatch_id,status:r.status,expires_at:r.expires_at,created_at:r.created_at,submitted_at:r.submitted_at,revoked_at:r.revoked_at });
  return result;
}
