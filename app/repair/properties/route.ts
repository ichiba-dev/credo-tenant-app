import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("properties")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw new Error("Property lookup failed");

    return Response.json(
      (data ?? []).map(({ id, name }) => ({ id, name })),
      { headers },
    );
  } catch {
    // SDKのエラーや環境変数をレスポンス・ログに含めない。
    return Response.json(
      { message: "物件一覧を取得できませんでした。時間をおいて画面を再読み込みしてください。" },
      { status: 503, headers },
    );
  }
}
