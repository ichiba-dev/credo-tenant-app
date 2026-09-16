import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const token = "a".repeat(43);
const origin = "https://credo-tenant-app.vercel.app";
const cookieSecret = crypto.randomBytes(32).toString("base64url");
function setup(options = {}) {
  const calls = [], queries = [], logs = [];
  const rows = { tenant_line_link_tokens: { tenant_account_id: "tenant", organization_id: "org", used_at: null, expires_at: new Date(Date.now() + 600000).toISOString() }, tenant_accounts: { id: "tenant" }, organizations: { id: "org" }, tenant_line_accounts: null, ...options.rows };
  const db = { from(table) {
    const q = { table, filters: [] }; queries.push(q);
    const b = { select() { return b; }, eq(...args) { q.filters.push(["eq", ...args]); return b; }, is(...args) { q.filters.push(["is", ...args]); return b; }, gt(...args) { q.filters.push(["gt", ...args]); return b; }, async maybeSingle() { return { data: rows[table], error: options.dbError ?? null }; } }; return b;
  }, async rpc(name, args) { calls.push({ name, args }); if (options.rpcThrow) throw new Error("sensitive"); return { data: options.rpc ?? true, error: options.rpcError ?? null }; } };
  class NextResponse extends Response {
    constructor(...args) { super(...args); this.values = []; this.cookies = { set: (name, value, attrs) => this.values.push({ name, value, ...attrs }) }; }
    static redirect(url, status) { return new NextResponse(null, { status, headers: { location: String(url) } }); }
  }
  const modules = {};
  function load(path) {
    const exports = {};
    const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(source, { exports, Buffer, URL, URLSearchParams, AbortSignal, process: { env: { NODE_ENV: options.environment ?? "production", LINE_LOGIN_CHANNEL_ID: "channel", LINE_LOGIN_CHANNEL_SECRET: "secret", LINE_LOGIN_COOKIE_SECRET: cookieSecret, ...options.env } }, console: Object.fromEntries(["log", "warn", "error", "info", "debug"].map(k => [k, (...args) => logs.push(args)])), fetch: async (url, init) => {
      calls.push({ url, init });
      if (options.fetchThrow) throw new Error("sensitive");
      if (url.endsWith("/token")) return Response.json(options.noIdToken ? {} : { id_token: "sensitive-id-token", access_token: "sensitive-access-token" }, { status: options.exchangeFail ? 400 : 200 });
      return Response.json({ iss: "https://access.line.me", aud: "channel", exp: Date.now() / 1000 + 600, nonce: new URLSearchParams(init.body).get("nonce"), sub: "verified-line-user", ...options.claims }, { status: options.verifyFail ? 400 : 200 });
    }, require(name) { if (name === "server-only") return {}; if (name === "node:crypto") return crypto; if (name === "next/server") return { NextResponse }; if (name === "@/lib/supabase-server") return { createServerSupabaseClient: () => db }; if (name === "@/lib/line-login") return modules.login; throw new Error(name); } });
    return exports;
  }
  modules.login = load("./line-login.ts");
  const start = load("../app/tenant/line/link/route.ts").GET;
  const callback = load("../app/api/line/login/callback/route.ts").GET;
  const request = (path, values = []) => ({ nextUrl: new URL(path, origin), cookies: { getAll: () => values } });
  return { ...modules.login, start, callback, request, calls, queries, logs };
}
async function begin(s) {
  const response = await s.start(s.request(`/tenant/line/link?token=${token}`));
  const cookie = response.values[0];
  const url = new URL(response.headers.get("location"));
  return { response, cookie, url, transaction: s.unseal(cookie.value) };
}
test("invalid, missing, duplicate, expired, used tokens and inactive accounts fail before OAuth", async () => {
  for (const path of ["/tenant/line/link", "/tenant/line/link?token=bad", `/tenant/line/link?token=${token}&token=${token}`]) {
    const s = setup(); const response = await s.start(s.request(path));
    assert.equal(response.headers.get("location"), `${origin}/tenant?lineError=1`);
    assert.equal(s.queries.length, 0);
  }
  for (const rows of [ { tenant_line_link_tokens: null }, { tenant_line_link_tokens: { tenant_account_id: "tenant", organization_id: "org", used_at: "used", expires_at: new Date(Date.now()+600000).toISOString() } }, { tenant_line_link_tokens: { tenant_account_id: "tenant", organization_id: "org", used_at: null, expires_at: new Date(0).toISOString() } }, { tenant_accounts: null }, { organizations: null }, { tenant_line_accounts: { id: "active" } } ]) {
    const s = setup({ rows }); const response = await s.start(s.request(`/tenant/line/link?token=${token}`));
    assert.equal(response.headers.get("location"), `${origin}/tenant?lineError=1`);
    assert.equal(s.calls.length, 0);
  }
});
test("Service Role validation scopes hash, unused token, expiry and active accounts", async () => {
  const s = setup(); await begin(s);
  assert.deepEqual(s.queries[0].filters.slice(0, 2), [["eq", "token_hash", s.hashToken(token)], ["is", "used_at", null]]);
  assert.equal(s.queries[0].filters[2][0], "gt");
  assert.deepEqual(s.queries[1].filters, [["eq", "id", "tenant"], ["eq", "organization_id", "org"], ["eq", "is_active", true]]);
  assert.deepEqual(s.queries[2].filters, [["eq", "id", "org"], ["eq", "is_active", true]]);
  assert.deepEqual(s.queries[3].filters, [["eq", "tenant_account_id", "tenant"], ["eq", "is_active", true]]);
});
test("encrypted authenticated cookie, random state/nonce and PKCE S256", async () => {
  const s = setup(); const { response, cookie, url, transaction: t } = await begin(s);
  assert.equal(url.origin, "https://access.line.me");
  assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.equal(url.searchParams.get("redirect_uri"), s.CALLBACK_URL);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), crypto.createHash("sha256").update(t.verifier).digest("base64url"));
  assert.equal(url.searchParams.get("state"), t.state); assert.equal(url.searchParams.get("nonce"), t.nonce);
  assert.equal(new Set([t.state, t.nonce, t.verifier]).size, 3);
  assert.equal(t.token, token); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, "lax"); assert.equal(cookie.secure, true); assert.equal(cookie.maxAge, 600);
  assert.equal(cookie.path, "/api/line/login/callback");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(url.toString().includes(token), false); assert.equal(cookie.value.includes(token), false);
  const bytes = Buffer.from(cookie.value, "base64url"); bytes[30] ^= 1;
  assert.throws(() => s.unseal(bytes.toString("base64url")));
  assert.throws(() => s.unseal(s.seal({ ...t, expires: 0 })));
  assert.equal((await begin(setup({ environment: "development" }))).cookie.secure, false);
});
test("dedicated cookie key works across instances independently of the channel secret with fresh IVs", async () => {
  const s = setup(); const { cookie, transaction: t } = await begin(s);
  const other = setup({ env: { LINE_LOGIN_CHANNEL_SECRET: "different-channel-secret" } });
  assert.deepEqual({ ...other.unseal(cookie.value) }, { ...t });
  const noChannel = setup({ env: { LINE_LOGIN_CHANNEL_SECRET: undefined } });
  assert.deepEqual({ ...noChannel.unseal(cookie.value) }, { ...t });
  const changed = setup({ env: { LINE_LOGIN_COOKIE_SECRET: crypto.randomBytes(32).toString("base64url") } });
  assert.throws(() => changed.unseal(cookie.value));
  const second = s.seal(t);
  assert.notEqual(second, cookie.value);
  assert.notDeepEqual(Buffer.from(second, "base64url").subarray(0, 12), Buffer.from(cookie.value, "base64url").subarray(0, 12));
  const response = await other.callback(other.request(`/api/line/login/callback?code=code&state=${t.state}`, [cookie]));
  assert.equal(response.headers.get("location"), `${origin}/tenant?lineLinked=1`);
  assert.equal(new URLSearchParams(other.calls[0].init.body).get("client_secret"), "different-channel-secret");
  assert.ok(other.calls.filter(c => c.url).every(c => !String(c.init.body).includes(cookieSecret)));
  assert.deepEqual(other.logs, []);
});
test("missing, empty and short cookie secrets fail closed without channel fallback or logs", async () => {
  const issued = await begin(setup());
  for (const secret of [undefined, "", "short", "a".repeat(31)]) {
    const s = setup({ env: { LINE_LOGIN_COOKIE_SECRET: secret } });
    assert.throws(() => s.seal(issued.transaction), /LINE_LOGIN_COOKIE_UNAVAILABLE/);
    assert.throws(() => s.unseal(issued.cookie.value), /LINE_LOGIN_COOKIE_UNAVAILABLE/);
    const start = await s.start(s.request(`/tenant/line/link?token=${token}`));
    assert.equal(start.headers.get("location"), `${origin}/tenant?lineError=1`);
    const callback = await s.callback(s.request(`/api/line/login/callback?code=code&state=${issued.transaction.state}`, [issued.cookie]));
    assert.equal(callback.headers.get("location"), `${origin}/tenant?lineError=1`);
    assert.equal(callback.values[0].maxAge, 0);
    assert.equal(s.calls.length, 0); assert.deepEqual(s.logs, []);
  }
});
test("cookie secret module is server-only and reads a private environment variable", () => {
  const source = readFileSync(new URL("./line-login.ts", import.meta.url), "utf8");
  assert.ok(source.startsWith('import "server-only";'));
  assert.ok(source.includes("process.env.LINE_LOGIN_COOKIE_SECRET"));
  assert.equal(source.includes("NEXT_PUBLIC_LINE_LOGIN_COOKIE_SECRET"), false);
});
test("callback rejects state mismatch, errors, missing/duplicate data and tampered cookie; always deletes cookie", async () => {
  const s = setup(); const { cookie, transaction: t } = await begin(s);
  for (const [path, cookies] of [ [`?code=code&state=wrong`, [cookie]], [`?error=denied&code=code&state=${t.state}`, [cookie]], [`?code=code&state=${t.state}`, []], [`?state=${t.state}`, [cookie]], [`?code=code&state=${t.state}&state=${t.state}`, [cookie]], [`?code=code&state=${t.state}`, [cookie, cookie]], [`?code=code&state=${t.state}`, [{ ...cookie, value: "tampered" }]] ]) {
    const response = await s.callback(s.request(`/api/line/login/callback${path}`, cookies));
    assert.equal(response.headers.get("location"), `${origin}/tenant?lineError=1`);
    assert.equal(response.values[0].maxAge, 0); assert.equal(response.values[0].value, ""); assert.equal(response.values[0].path, cookie.path);
  }
  assert.equal(s.calls.length, 0); assert.deepEqual(s.logs, []);
});
test("invalid nonce, aud, exp, issuer, sub and signature rejection prevent RPC", async () => {
  for (const options of [{ claims: { nonce: "wrong" } }, { claims: { aud: "wrong" } }, { claims: { exp: 0 } }, { claims: { iss: "https://evil.example" } }, { claims: { sub: "" } }, { verifyFail: true }, { exchangeFail: true }, { noIdToken: true }, { fetchThrow: true }]) {
    const s = setup(options); const { cookie, transaction: t } = await begin(s);
    const response = await s.callback(s.request(`/api/line/login/callback?code=secret-code&state=${t.state}`, [cookie]));
    assert.equal(response.headers.get("location"), `${origin}/tenant?lineError=1`);
    assert.equal(response.values[0].maxAge, 0);
    assert.equal(s.calls.filter(c => c.name).length, 0); assert.deepEqual(s.logs, []);
  }
});
test("RPC runs exactly once with verified sub and bytea hash; safe success and failure URLs", async () => {
  for (const options of [{ rpc: true }, { rpc: false }, { rpcError: "sensitive" }, { rpcThrow: true }]) {
    const s = setup(options); const { cookie, transaction: t } = await begin(s);
    const response = await s.callback(s.request(`/api/line/login/callback?code=secret-code&state=${t.state}&sub=attacker&token=attacker`, [cookie]));
    const rpcs = s.calls.filter(c => c.name);
    assert.equal(rpcs.length, 1);
    assert.deepEqual({ ...rpcs[0].args }, { p_token_hash: s.hashToken(token), p_line_user_id: "verified-line-user" });
    assert.equal(rpcs[0].name, "complete_tenant_line_link");
    const exchange = new URLSearchParams(s.calls[0].init.body);
    assert.equal(exchange.get("code_verifier"), t.verifier); assert.equal(exchange.get("client_secret"), "secret");
    assert.equal(new URLSearchParams(s.calls[1].init.body).get("nonce"), t.nonce);
    assert.equal(response.headers.get("location"), `${origin}/tenant?${options.rpc === true ? "lineLinked" : "lineError"}=1`);
    assert.equal(response.values[0].maxAge, 0); assert.deepEqual(s.logs, []);
  }
});
test("tenant displays the requested callback messages and active connection status", () => {
  const source = readFileSync(new URL("../app/tenant/page.tsx", import.meta.url), "utf8");
  for (const text of ["LINE連携が完了しました", "LINE連携を完了できませんでした。もう一度お試しください。", "LINE連携済み", 'params.lineLinked === "1"', 'params.lineError === "1"']) assert.ok(source.includes(text));
});
