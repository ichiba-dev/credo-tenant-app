import 'server-only';
import { createAuthServerClient } from '@/lib/supabase-auth/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function getOwnerPortalContext() {
  try {
    const auth = await createAuthServerClient();
    const { data: { user }, error } = await auth.auth.getUser();
    if (error || !user) return { status: 'unauthenticated' as const };
    const service = createServerSupabaseClient();
    const { data: owner, error: ownerError } = await service.from('owners')
      .select('id,name,auth_user_id,organization_id,is_active')
      .eq('auth_user_id', user.id).maybeSingle();
    if (ownerError) return { status: 'unavailable' as const };
    if (!owner || owner.auth_user_id !== user.id || !owner.organization_id || owner.is_active !== true) {
      return { status: 'forbidden' as const };
    }
    return { status: 'valid' as const, owner };
  } catch {
    return { status: 'unavailable' as const };
  }
}

export function ownerContextMessage(status: 'forbidden' | 'unavailable') {
  return status === 'forbidden'
    ? 'このアカウントには有効なオーナー登録がありません。管理会社へお問い合わせいただくか、別のアカウントでログインしてください。'
    : 'オーナー情報を確認できませんでした。時間をおいて再読み込みしてください。';
}
