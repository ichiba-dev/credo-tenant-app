import { createBrowserClient } from "@supabase/ssr";

export const INVALID_LINK =
  "再設定リンクが無効、期限切れ、または使用済みです。管理者に新しい再設定メールを依頼し、メール内のリンクから開き直してください。";

export async function verifyRecoveryLink() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  // URL中の認証情報は検証の成否にかかわらず履歴から取り除く。
  window.history.replaceState(window.history.state, "", url.pathname);
  if (url.searchParams.has("error") || hash.has("error")) {
    throw new Error(INVALID_LINK);
  }

  const code = url.searchParams.get("code");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (!code && !(hash.get("type") === "recovery" && accessToken && refreshToken)) {
    throw new Error(INVALID_LINK);
  }

  // この画面だけ手動でリンクを処理する。既存ログイン用singletonには影響させない。
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { isSingleton: false, auth: { detectSessionInUrl: false, autoRefreshToken: false } },
  );

  let recoveryEvent = false;
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") recoveryEvent = true;
  });

  try {
    let token: string;
    if (code) {
      const flowId = url.searchParams.get("sb_flow_id");
      const { data, error } = await supabase.auth.exchangeCodeForSession(
        code, flowId ? { flowId } : undefined,
      );
      // PKCEのRecovery種別はSDKが保持するverifierから確認する。
      if (error || !data.session || !recoveryEvent) throw new Error(INVALID_LINK);
      token = data.session.access_token;
    } else {
      // Dashboardからのメールはimplicit形式。setSessionの自動更新に先立ち
      // リンク自体のaccess tokenをAuthサーバーで検証し、期限切れを拒否する。
      const { data, error } = await supabase.auth.getUser(accessToken!);
      if (error || !data.user) throw new Error(INVALID_LINK);
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken!, refresh_token: refreshToken!,
      });
      if (sessionError || !sessionData.session) throw new Error(INVALID_LINK);
      token = sessionData.session.access_token;
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new Error(INVALID_LINK);
    // メモリ内でこのリンクのセッションに固定する。通常ログインで代用しない。
    return { supabase, token, userId: data.user.id };
  } finally {
    subscription.unsubscribe();
  }
}
