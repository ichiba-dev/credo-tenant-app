import 'server-only';
import { createAuthServerClient } from '@/lib/supabase-auth/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function getOwnerRequestContext() {
  const auth = await createAuthServerClient();
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user) throw new Error('OWNER_UNAUTHENTICATED');
  const service = createServerSupabaseClient();
  const { data: owner, error: ownerError } = await service.from('owners')
    .select('id,organization_id,name,auth_user_id,is_active').eq('auth_user_id', user.id).eq('is_active', true).maybeSingle();
  if (ownerError || !owner || owner.auth_user_id !== user.id || !owner.is_active || !owner.organization_id) throw new Error('OWNER_FORBIDDEN');
  return { auth, service, owner };
}

export async function getOwnerRequestProperties(context: Awaited<ReturnType<typeof getOwnerRequestContext>>) {
  const { service, owner } = context;
  const { data: links, error } = await service.from('property_owners')
    .select('owner_id,property_id,organization_id,is_active,valid_from,valid_to')
    .eq('owner_id', owner.id).eq('organization_id', owner.organization_id).eq('is_active', true);
  if (error || !links || links.some(row => row.owner_id !== owner.id || row.organization_id !== owner.organization_id || !row.is_active)) throw new Error('OWNER_PROPERTIES_UNAVAILABLE');
  const today = new Date().toISOString().slice(0, 10);
  const ids = [...new Set(links.filter(row => (!row.valid_from || row.valid_from <= today) && (!row.valid_to || row.valid_to >= today)).map(row => row.property_id))];
  if (!ids.length) return [];
  const { data: properties, error: propertyError } = await service.from('properties')
    .select('id,name,organization_id,is_active').eq('organization_id', owner.organization_id).eq('is_active', true).in('id', ids).order('name');
  if (propertyError || !properties || properties.some(row => row.organization_id !== owner.organization_id || !row.is_active || !ids.includes(row.id))) throw new Error('OWNER_PROPERTIES_UNAVAILABLE');
  return properties.map(row => ({ id: row.id as string, name: row.name as string }));
}
