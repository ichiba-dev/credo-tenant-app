import "server-only";
import { createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const CALLBACK_URL = "https://credo-tenant-app.vercel.app/api/line/login/callback";
export const OAUTH_COOKIE = "credo_line_oauth";
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
type Transaction = { state: string; nonce: string; verifier: string; token: string; expires: number };
const cookieOptions = () => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/api/line/login/callback", maxAge: 600 });

export function config() {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  const secret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  if (!clientId || !secret) throw new Error("LINE_LOGIN_UNAVAILABLE");
  return { clientId, secret };
}
export function hashToken(token: string) { return `\\x${createHash("sha256").update(token).digest("hex")}`; }
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function cookieKey() {
  const secret = process.env.LINE_LOGIN_COOKIE_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new Error("LINE_LOGIN_COOKIE_UNAVAILABLE");
  return createHash("sha256").update(`credo-line-oauth-v1:${secret}`).digest();
}
export function seal(transaction: Transaction) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cookieKey(), iv);
  cipher.setAAD(Buffer.from(OAUTH_COOKIE));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(transaction), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
export function unseal(value: string): Transaction {
  if (value.length > 2048) throw new Error("INVALID_TRANSACTION");
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", cookieKey(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(OAUTH_COOKIE));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const t = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  if (![t.state, t.nonce, t.verifier, t.token].every(v => typeof v === "string" && TOKEN_PATTERN.test(v)) || !Number.isFinite(t.expires) || t.expires <= Date.now()) throw new Error("INVALID_TRANSACTION");
  return t;
}
export function resultRedirect(success: boolean) {
  const response = NextResponse.redirect(new URL(success ? "/tenant?lineLinked=1" : "/tenant?lineError=1", CALLBACK_URL), 303);
  response.cookies.set(OAUTH_COOKIE, "", { ...cookieOptions(), maxAge: 0, expires: new Date(0) });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
export async function validLinkToken(token: string) {
  if (!TOKEN_PATTERN.test(token)) return false;
  const db = createServerSupabaseClient();
  const now = new Date().toISOString();
  const { data: link, error } = await db.from("tenant_line_link_tokens")
    .select("tenant_account_id, organization_id, used_at, expires_at")
    .eq("token_hash", hashToken(token)).is("used_at", null).gt("expires_at", now).maybeSingle();
  if (error || !link || link.used_at !== null || !(Date.parse(link.expires_at) > Date.parse(now)) || !link.tenant_account_id || !link.organization_id) return false;
  const { data: tenant, error: tenantError } = await db.from("tenant_accounts").select("id")
    .eq("id", link.tenant_account_id).eq("organization_id", link.organization_id).eq("is_active", true).maybeSingle();
  if (tenantError || tenant?.id !== link.tenant_account_id) return false;
  const { data: organization, error: orgError } = await db.from("organizations").select("id")
    .eq("id", link.organization_id).eq("is_active", true).maybeSingle();
  if (orgError || organization?.id !== link.organization_id) return false;
  const { data: active, error: activeError } = await db.from("tenant_line_accounts").select("id")
    .eq("tenant_account_id", link.tenant_account_id).eq("is_active", true).maybeSingle();
  return !activeError && !active;
}
export function authorizationRedirect(token: string) {
  const { clientId } = config();
  const t: Transaction = { state: randomBytes(32).toString("base64url"), nonce: randomBytes(32).toString("base64url"), verifier: randomBytes(32).toString("base64url"), token, expires: Date.now() + 600_000 };
  const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK_URL, scope: "openid profile", state: t.state, nonce: t.nonce, code_challenge: createHash("sha256").update(t.verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(OAUTH_COOKIE, seal(t), cookieOptions());
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
async function linePost(endpoint: string, body: Record<string, string>) {
  const response = await fetch(`https://api.line.me/oauth2/v2.1/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("LINE_LOGIN_FAILED");
  return response.json();
}
export async function completeLogin(code: string, t: Transaction) {
  const { clientId, secret } = config();
  const tokens = await linePost("token", { grant_type: "authorization_code", code, redirect_uri: CALLBACK_URL, client_id: clientId, client_secret: secret, code_verifier: t.verifier });
  if (typeof tokens.id_token !== "string" || !tokens.id_token) return false;
  // LINE's verification endpoint validates the JWT signature; never decode an unverified JWT for its sub.
  const verified = await linePost("verify", { id_token: tokens.id_token, client_id: clientId, nonce: t.nonce });
  if (verified.iss !== "https://access.line.me" || verified.aud !== clientId || !Number.isFinite(verified.exp) || verified.exp <= Date.now() / 1000 || typeof verified.nonce !== "string" || !safeEqual(verified.nonce, t.nonce) || typeof verified.sub !== "string" || !verified.sub.trim() || Date.now() >= t.expires) return false;
  const { data, error } = await createServerSupabaseClient().rpc("complete_tenant_line_link", { p_token_hash: hashToken(t.token), p_line_user_id: verified.sub });
  return !error && data === true;
}
