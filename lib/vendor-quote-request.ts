import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export function newQuoteToken() { return randomBytes(32).toString('base64url'); }
export function quoteTokenHash(token: unknown): string | null {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? createHash('sha256').update(token).digest('hex') : null;
}
export type QuoteRequestScope = { id: string; organization_id: string; repair_request_id: number; vendor_dispatch_id: string; vendor_id: string; created_by_auth_user_id: string; status: string; expires_at: string };
export async function inspectQuoteRequest(token: unknown, allowSubmitted = false): Promise<QuoteRequestScope | null> {
  const hash = quoteTokenHash(token);
  if (!hash) return null;
  const { data, error } = await createServerSupabaseClient().rpc('inspect_vendor_quote_request', { p_hash: hash, p_allow_submitted: allowSubmitted });
  if (error || !data || !Number.isSafeInteger(data.repair_request_id) || data.repair_request_id <= 0 ||
    !data.organization_id || !data.vendor_dispatch_id || !data.vendor_id || !data.created_by_auth_user_id ||
    !['pending', ...(allowSubmitted ? ['submitted'] : [])].includes(data.status) ||
    !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) return null;
  return data;
}
export async function quoteRequestContext(token: unknown) {
  const scope = await inspectQuoteRequest(token);
  if (!scope) return null;
  const db = createServerSupabaseClient();
  const [repair, dispatch, organization] = await Promise.all([
    db.from('repair_requests').select('id,organization_id,property_name,room_number,location_type,category').eq('id', scope.repair_request_id).eq('organization_id', scope.organization_id).maybeSingle(),
    db.from('repair_vendor_dispatches').select('id,organization_id,repair_request_id,vendor_id,status,instructions').eq('id', scope.vendor_dispatch_id).eq('organization_id', scope.organization_id).maybeSingle(),
    db.from('organizations').select('id,name').eq('id', scope.organization_id).maybeSingle(),
  ]);
  if (repair.error || dispatch.error || organization.error || !repair.data || !dispatch.data || !organization.data ||
    repair.data.id !== scope.repair_request_id || repair.data.organization_id !== scope.organization_id ||
    dispatch.data.id !== scope.vendor_dispatch_id || dispatch.data.organization_id !== scope.organization_id ||
    dispatch.data.repair_request_id !== scope.repair_request_id || dispatch.data.vendor_id !== scope.vendor_id ||
    ['candidate', 'cancelled'].includes(dispatch.data.status) || organization.data.id !== scope.organization_id) return null;
  // No tenant name, contact details, repair description, or unshared photos.
  return { companyName: organization.data.name, propertyName: repair.data.property_name, roomNumber: repair.data.room_number,
    locationType: repair.data.location_type, category: repair.data.category, instructions: dispatch.data.instructions, expiresAt: scope.expires_at };
}
