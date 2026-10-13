'use server';
import { createHash, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getStaffContext } from '@/lib/supabase-auth/staff';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { scopedVendorQuoteFile } from '@/lib/vendor-quote-file';
import { ESTIMATE_BUCKET, createEstimateStoragePath, hasMatchingEstimateMagic } from '@/lib/estimate-files';
import { isUuid } from '@/lib/vendor-quote-upload';
export async function publishVendorQuoteToOwner(input:{repairId:number;quoteId:string;ownerAmount:number;confirmPdf:boolean}) {
  const fail=()=>({ok:false as const,message:'転用できませんでした。報告・公開金額・PDFの確認内容を見直してください。'});
  try {
    const staff=await getStaffContext();
    if(!staff.ok||!staff.canUpdate||!input||input.confirmPdf!==true||!Number.isSafeInteger(input.ownerAmount)||input.ownerAmount<0||!isUuid(input.quoteId))return fail();
    const file=await scopedVendorQuoteFile(staff.organizationId,input.repairId,input.quoteId);if(!file)return fail();
    const db=createServerSupabaseClient();
    const report=await db.from('owner_reports').select('id,organization_id,repair_request_id').eq('organization_id',staff.organizationId).eq('repair_request_id',input.repairId).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(report.error||!report.data||report.data.organization_id!==staff.organizationId||report.data.repair_request_id!==input.repairId)return fail();
    const previous=await db.from('owner_report_estimate_files').select('id').eq('organization_id',staff.organizationId).eq('owner_report_id',report.data.id).eq('source_vendor_quote_id',input.quoteId).is('deleted_at',null).maybeSingle();
    if(previous.error)return fail();
    if(previous.data)return {ok:true as const,message:'この見積は転用済みです。既存の公開金額・PDFを保持しました。'};
    const download=await db.storage.from('vendor-quotes').download(file.storage_path);
    if(download.error||!download.data)return fail();
    const bytes=new Uint8Array(await download.data.arrayBuffer());
    if(bytes.length!==Number(file.file_size)||!hasMatchingEstimateMagic(bytes,'application/pdf')||file.content_sha256!==`\\x${createHash('sha256').update(bytes).digest('hex')}`)return fail();
    const id=randomUUID(),path=createEstimateStoragePath(staff.organizationId,input.repairId,report.data.id,id,'application/pdf');
    const storage=db.storage.from(ESTIMATE_BUCKET);
    const uploaded=await storage.upload(path,bytes,{contentType:'application/pdf',upsert:false});if(uploaded.error)return fail();
    const saved=await db.rpc('publish_vendor_quote_to_owner',{
      p_org:staff.organizationId,p_repair:input.repairId,p_report:report.data.id,p_quote:input.quoteId,p_actor:staff.userId,
      p_amount:input.ownerAmount,p_file:id,p_path:path,p_name:file.original_filename,p_size:bytes.length,p_confirm:true,
    });
    // A transport failure may hide a committed transaction. Retain the copy for retry/reconciliation.
    if(saved.error||!saved.data)return fail();
    if(saved.data!==id)await storage.remove([path]);
    revalidatePath('/admin');revalidatePath('/owner');return {ok:true as const,message:'明示確認したPDFと公開金額をオーナー報告へ登録しました。'};
  }catch{return fail();}
}
