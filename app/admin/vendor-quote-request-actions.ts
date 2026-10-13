'use server';
import { revalidatePath } from 'next/cache';
import { getStaffContext } from '@/lib/supabase-auth/staff';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { newQuoteToken, quoteTokenHash } from '@/lib/vendor-quote-request';
import { isUuid } from '@/lib/vendor-quote-upload';

export async function issueVendorQuoteRequest(input: { repairId: number; dispatchId: string; requestId: string }) {
  try {
    const staff = await getStaffContext();
    if (!staff.ok || !staff.canUpdate || !input || !Number.isSafeInteger(input.repairId) || input.repairId <= 0 || !isUuid(input.dispatchId) || !isUuid(input.requestId)) return { ok: false as const };
    const token = newQuoteToken(), hash = quoteTokenHash(token);
    const { data, error } = await createServerSupabaseClient().rpc('issue_vendor_quote_request', {
      p_org: staff.organizationId, p_repair: input.repairId, p_dispatch: input.dispatchId, p_actor: staff.userId, p_id: input.requestId, p_hash: hash,
    });
    if (error || !data || data.id !== input.requestId || data.organization_id !== staff.organizationId || data.vendor_dispatch_id !== input.dispatchId || data.repair_request_id !== input.repairId || data.created_by_auth_user_id !== staff.userId) return { ok: false as const };
    revalidatePath('/admin');
    return { ok: true as const, url: data.token_hash === hash && data.status === 'pending' ? `/vendor/quotes/submit#token=${token}` : null, expiresAt: data.expires_at as string };
  } catch { return { ok: false as const }; }
}
export async function revokeVendorQuoteRequest(input: { dispatchId: string; requestId: string }) {
  try {
    const staff = await getStaffContext();
    if (!staff.ok || !staff.canUpdate || !input || !isUuid(input.dispatchId) || !isUuid(input.requestId)) return { ok: false };
    const { error } = await createServerSupabaseClient().rpc('revoke_vendor_quote_request', { p_org: staff.organizationId, p_dispatch: input.dispatchId, p_actor: staff.userId, p_id: input.requestId });
    if (error) return { ok: false };
    revalidatePath('/admin'); return { ok: true };
  } catch { return { ok: false }; }
}
