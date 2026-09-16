import type { NextRequest } from "next/server";
import { authorizationRedirect, resultRedirect, validLinkToken } from "@/lib/line-login";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const tokens = request.nextUrl.searchParams.getAll("token");
    if (tokens.length === 1 && await validLinkToken(tokens[0])) return authorizationRedirect(tokens[0]);
  } catch { /* Fail closed without exposing credentials or database details. */ }
  return resultRedirect(false);
}
