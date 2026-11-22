import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_HOSTS = new Set(["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"]);
const MAX_HTML_BYTES = 8_000_000;

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "https://villagecouncil.enga.in", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin", "Cache-Control": "no-store" },
  });
}
function decodeHtml(value: string) {
  return value.replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function textOnly(value: string) {
  return decodeHtml(value.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\u200b]/g, " ").replace(/\s+/g, " ").trim();
}
function safeUrl(raw: string, base?: string): string | null {
  try { const u = new URL(raw, base); if (u.protocol !== "https:" || !u.hostname || !ALLOWED_HOSTS.has(u.hostname.toLowerCase())) return null; if (u.username || u.password) return null; return u.href; } catch { return null; }
}
type Jar = Map<string, string>;
function absorb(headers: Headers, jar: Jar) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  for (const value of values) { const pair = value.split(";", 1)[0].trim(); const eq = pair.indexOf("="); if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1)); }
}
function cookieHeader(jar: Jar) { return [...jar.entries()].map(([k, v]) => k + "=" + v).join("; "); }
function attributes(source: string) {
  const result: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const m of source.matchAll(pattern)) result[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? "");
  return result;
}

async function requestPage(url: string, referer: string, jar: Jar) {
  const response = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", Accept: "text/html", Referer: referer, ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}) }, signal: AbortSignal.timeout(30000) });
  absorb(response.headers, jar);
  const finalUrl = safeUrl(response.url || url);
  if (!finalUrl) throw new Error("redirect outside allowed hosts");
  const html = await response.text();
  if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) throw new Error("page too large at " + new URL(finalUrl).pathname);
  if (!response.ok || !html.trim() || !/<html[\s>]/i.test(html)) throw new Error("page fetch failed at " + new URL(finalUrl).pathname + " status=" + response.status);
  return { html, url: finalUrl };
}

function buildPostbackBody(html: string, target: string, argument: string) {
  const params = new URLSearchParams();
  const formMatch = html.match(/<form\b[^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) throw new Error("no form for postback");
  for (const m of formMatch[1].matchAll(/<input\b([^>]*)>/gi)) {
    const a = attributes(m[1]);
    if (!a.name) continue;
    const type = (a.type || "").toLowerCase();
    if (["submit","button","image","file"].includes(type)) continue;
    if (["checkbox","radio"].includes(type)) continue;
    params.set(a.name, a.value || "");
  }
  params.set("__EVENTTARGET", target);
  params.set("__EVENTARGUMENT", argument);
  return params;
}

function findControl(html: string, pageUrl: string, expression: RegExp) {
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attr = attributes(m[1]);
    const label = textOnly(m[2]) || attr.title || attr["aria-label"] || "";
    if (!label || !expression.test(label)) continue;
    const direct = attr.href ? safeUrl(attr.href, pageUrl) : null;
    const script = [attr.onclick, attr.href].filter(Boolean).join(" ");
    const postback = script.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
    if (direct || postback) return { label, direct: direct || null, postback: postback || null, tag: "a" };
  }
  for (const m of html.matchAll(/<(?:input|button)\b([^>]*)>(?:([\s\S]*?)<\/button>)?/gi)) {
    const attr = attributes(m[1]);
    const label = textOnly(m[2] || "") || attr.value || attr.title || attr["aria-label"] || "";
    if (!label || !expression.test(label)) continue;
    const script = attr.onclick || "";
    const postback = script.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
    if (postback) return { label, direct: null, postback, tag: attr.type ? "input" : "button", name: attr.name || null };
  }
  return null;
}

function activateControl(page: { html: string; url: string }, control: NonNullable<ReturnType<typeof findControl>>, jar: Jar, referer: string) {
  if (control.direct) return requestPage(control.direct, page.url, jar);
  if (control.postback) {
    const formMatch = page.html.match(/<form\b[^>]*>/i);
    const action = formMatch ? safeUrl(attributes(formMatch[0]).action || page.url, page.url) : safeUrl(page.url, page.url);
    if (!action) throw new Error("no form action");
    const body = buildPostbackBody(page.html, control.postback[1], control.postback[2]);
    return fetch(action, {
      method: "POST", headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded", Referer: referer, ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}) },
      body: body.toString(), redirect: "follow", signal: AbortSignal.timeout(30000),
    }).then(async (r) => { absorb(r.headers, jar); if (!r.ok) throw new Error("postback HTTP " + r.status); const finalUrl = safeUrl(r.url || action); if (!finalUrl) throw new Error("postback redirect outside hosts"); return requestPage(finalUrl, action, jar); });
  }
  throw new Error("control has neither direct url nor postback: " + control.label);
}

function describePage(html: string, pageUrl: string) {
  const page = new URL(pageUrl);
  const info: Record<string, unknown> = { path: page.pathname, title: "" };
  const t = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (t) info.title = textOnly(t[1]).slice(0, 200);

  const anchors: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attr = attributes(m[1]);
    const label = textOnly(m[2]).slice(0, 160);
    if (!label) continue;
    const direct = attr.href ? safeUrl(attr.href, pageUrl) : null;
    const script = [attr.onclick, attr.href].filter(Boolean).join(" ");
    const postback = script.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
    anchors.push({ label, href: direct, onclick: (attr.onclick || "").slice(0, 250) || null, postbackTarget: postback?.[1] || null, postbackArgument: postback?.[2] || null, name: attr.name || null });
  }
  info.anchors = anchors;

  const controls: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<(?:input|button)\b([^>]*)>(?:([\s\S]*?)<\/button>)?/gi)) {
    const attr = attributes(m[1]);
    const label = textOnly(m[2] || "") || attr.value || attr.title || attr["aria-label"] || "";
    if (!label) continue;
    const script = attr.onclick || "";
    const postback = script.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
    controls.push({ tag: attr.type ? "input" : "button", label: label.slice(0, 160), type: attr.type || null, value: attr.value || null, postbackTarget: postback?.[1] || null, postbackArgument: postback?.[2] || null, name: attr.name || null, formAction: attr["formaction"] || null });
  }
  info.controls = controls;

  const forms: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attr = attributes(m[1]);
    const action = safeUrl(attr.action || pageUrl, pageUrl);
    forms.push({ action: action || null, method: (attr.method || "GET").toUpperCase(), hiddenFields: [...m[2].matchAll(/name="[^"]+"/gi)].map(h => h[0]) });
  }
  info.forms = forms;

  const selects: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attr = attributes(m[1]);
    const options = [...m[2].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)].map(o => textOnly(o[1]).slice(0, 100)).filter(Boolean);
    selects.push({ name: attr.name || null, selected: attr.selected ? attr.selected : null, optionCount: options.length, options: options.slice(0, 12) });
  }
  info.selects = selects;

  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m, i) => {
    const headings = [...m[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => textOnly(c[1]).slice(0, 80));
    const rows = [...m[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1).map(r => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => textOnly(c[1]).slice(0, 80)).filter(Boolean));
    return { index: i, headingCount: headings.length, headings, rowCount: rows.length, firstRows: rows.slice(0, 6) };
  });
  info.tables = tables;

  const ftoFragments = textOnly(html).match(/.{0,120}FTO.{0,160}/gi)?.slice(0, 10) || [];
  info.ftoFragments = ftoFragments;
  return info;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({}, 0);
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = (Deno.env.get("SUPABASE_SECRET_KEYS") ? JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) || "";
  if (!supabaseUrl || !secretKey) return json({ error: "Server configuration is incomplete." }, 500);
  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Invalid session." }, 401);

  const { data: membership } = await adminClient.from("council_memberships").select("village_council_id").eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
  if (!membership) return json({ error: "No council assignment." }, 403);

  const { data: council, error: councilError } = await adminClient
    .from("council_tenants")
    .select("id,state,district,block,village,panchayat_url")
    .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
  if (councilError || !council) return json({ error: "Unable to load council." }, 500);

  const { data: blockUrl } = await adminClient.rpc("get_block_navigation_url", { p_state: council.state, p_district: council.district, p_block: council.block });
  if (!blockUrl) return json({ error: "Block URL not found in location_blocks. Re-save Step 1." }, 409);

  const jar: Jar = new Map();
  const visited: string[] = [];
  const steps: Array<Record<string, unknown>> = [];
  let current = await requestPage(blockUrl, "https://vbgramg.dord.gov.in/", jar);
  visited.push(new URL(current.url).pathname);
  steps.push({ label: "block", path: new URL(current.url).pathname, page: describePage(current.html, current.url) });

  // Follow FTO links (direct hrefs or postbacks)
  const follow = async (control: NonNullable<ReturnType<typeof findControl>>, label: string) => {
    if (visited.includes(String(control.direct || ""))) return false;
    try {
      const page = await activateControl({ html: current.html, url: current.url }, control, jar, current.url);
      const path = new URL(page.url).pathname;
      if (visited.includes(path)) return false;
      visited.push(path);
      current = page;
      steps.push({ label, path, page: describePage(current.html, current.url) });
      return true;
    } catch (error) {
      steps.push({ label, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  // Try to find and follow FTO controls
  for (let attempt = 0; attempt < 4; attempt++) {
    const page = current;
    const ftoAnchor = findControl(page.html, page.url, /FTO|Fund Transfer|Signatory|Transaction/i);
    if (!ftoAnchor) {
      const next = [findControl(page.html, page.url, /View|Details|Entry|Report/i), findControl(page.html, page.url, /.+/i)].find(c => c && (c.direct || c.postback));
      if (next && await follow(next as NonNullable<ReturnType<typeof findControl>>, "next-control")) continue;
      break;
    }
    if (!(await follow(ftoAnchor, "fto-control-" + attempt))) break;
  }

  return json({ ok: true, blockUrl, steps }, 200);
});
