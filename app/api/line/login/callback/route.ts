import type { NextRequest } from "next/server";
import { completeLogin, OAUTH_COOKIE, resultRedirect, safeEqual, unseal } from "@/lib/line-login";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  let success = false;
  try {
    const params = request.nextUrl.searchParams;
    const codes = params.getAll("code"), states = params.getAll("state");
    const cookies = request.cookies.getAll(OAUTH_COOKIE);
    if (!params.has("error") && codes.length === 1 && codes[0] && codes[0].length <= 4096 && states.length === 1 && cookies.length === 1) {
      const transaction = unseal(cookies[0].value);
      if (safeEqual(states[0], transaction.state)) success = await completeLogin(codes[0], transaction);
    }
  } catch { /* No secrets, provider errors, or user identifiers are logged. */ }
  return resultRedirect(success);
}
