import { getStaffContext } from '@/lib/supabase-auth/staff';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { scopedVendorQuoteFile } from '@/lib/vendor-quote-file';
export async function GET(_request:Request,{params}:{params:Promise<{repairId:string;quoteId:string;fileId:string}>}) {
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
  const fail=(status:number)=>Response.json({message:'見積PDFを表示できません。'},{status,headers});
  try {
    const staff=await getStaffContext();if(!staff.ok)return fail(staff.reason==='unauthenticated'?401:403);
    const p=await params;
    const file=await scopedVendorQuoteFile(staff.organizationId,Number(p.repairId),p.quoteId,p.fileId);if(!file)return fail(404);
    const {data,error}=await createServerSupabaseClient().storage.from('vendor-quotes').createSignedUrl(file.storage_path,60);
    return error||!data?fail(503):new Response(null,{status:302,headers:{...headers,Location:data.signedUrl}});
  }catch{return fail(503);}
}
