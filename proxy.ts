import type { NextRequest } from "next/server";

import { updateAuthSession } from "@/lib/supabase-auth/proxy";

export async function proxy(request: NextRequest) {
  return updateAuthSession(request);
}

export const config = {
  matcher: ["/owner/:path*", "/admin/:path*", "/tenant/:path*"],
};
