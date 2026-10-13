import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { isUuid, MAX_VENDOR_QUOTE_PDF_BYTES } from '@/lib/vendor-quote-upload';
export async function scopedVendorQuoteFile(organizationId:string,repairId:number,quoteId:string,fileId?:string) {
  if(!organizationId||!Number.isSafeInteger(repairId)||repairId<=0||!isUuid(quoteId)||(fileId!==undefined&&!isUuid(fileId)))return null;
  const db=createServerSupabaseClient();
  const q=await db.from('vendor_quote_versions').select('id,organization_id,dispatch_id').eq('id',quoteId).eq('organization_id',organizationId).maybeSingle();
  if(q.error||!q.data||q.data.id!==quoteId||q.data.organization_id!==organizationId)return null;
  const d=await db.from('repair_vendor_dispatches').select('id,organization_id,repair_request_id').eq('id',q.data.dispatch_id).eq('organization_id',organizationId).eq('repair_request_id',repairId).maybeSingle();
  if(d.error||!d.data||d.data.id!==q.data.dispatch_id||d.data.organization_id!==organizationId||d.data.repair_request_id!==repairId)return null;
  let query=db.from('vendor_quote_files').select('id,organization_id,quote_version_id,bucket_id,storage_path,original_filename,mime_type,file_size,content_sha256').eq('quote_version_id',quoteId).eq('organization_id',organizationId);
  if(fileId)query=query.eq('id',fileId);
  const f=await query.maybeSingle();
  if(f.error||!f.data||f.data.organization_id!==organizationId||f.data.quote_version_id!==quoteId||!isUuid(f.data.id)||(fileId&&f.data.id!==fileId)||
    f.data.bucket_id!=='vendor-quotes'||f.data.mime_type!=='application/pdf'||!Number.isSafeInteger(Number(f.data.file_size))||Number(f.data.file_size)<1||Number(f.data.file_size)>MAX_VENDOR_QUOTE_PDF_BYTES||
    f.data.storage_path!==`${organizationId}/${repairId}/${d.data.id}/${quoteId}/${f.data.id}.pdf`)return null;
  return f.data;
}
