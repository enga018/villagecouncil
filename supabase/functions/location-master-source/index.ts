import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const STATE_LIST_URL = "https://vbgramgrep.dord.gov.in/VBGRAMG/homestciti.aspx?payload=uxnA_h-_hbliJnZeq7CJW2GKLXuA2Xl8aRCpToX23hA43Yk099RtoB3PPXb5edYa3WppmkwktkBRxsmhneuKgGB2yQS8NavSlH29R3N89NI";
const ALLOWED_ORIGINS = new Set(["https://villagecouncil.enga.in", "https://enga018.github.io"]);

function headers(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://villagecouncil.enga.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function reply(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(origin), "Content-Type": "application/json" } });
}
function decodeHtml(value: string) {
  return value.replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
}
function cleanText(value: string) {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\u200b]/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed." }, 403, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const publishableKey = publishableKeys ? JSON.parse(publishableKeys).default : Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !secretKey) return reply({ error: "Server configuration is incomplete." }, 500, origin);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply({ error: "Authentication required." }, 401, origin);
  const userClient = createClient(url, publishableKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply({ error: "Invalid or expired session." }, 401, origin);
  const { data: admin, error: adminError } = await adminClient.from("platform_superadmins").select("id").eq("user_id", userData.user.id).maybeSingle();
  if (adminError) return reply({ error: "Unable to verify platform administrator role." }, 500, origin);
  if (!admin) return reply({ error: "Platform administrator access required." }, 403, origin);

  let body: { action?: string };
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON request." }, 400, origin); }
  if (body.action !== "states") return reply({ error: "Unsupported action." }, 400, origin);

  try {
    const response = await fetch(STATE_LIST_URL, {
      method: "GET", redirect: "follow",
      headers: { "User-Agent": "VillageCouncil-Location-Reader/1.0", "Accept": "text/html,application/xhtml+xml", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(30000),
    });
    const contentType = response.headers.get("content-type") || "";
    const diagnostic = { status: response.status, contentType, finalUrl: response.url, server: response.headers.get("server") || "" };
    if (!response.ok) return reply({ success: false, error: "VBGRAMG returned HTTP " + response.status + ".", diagnostic }, 502, origin);
    if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) return reply({ success: false, error: "VBGRAMG returned an unexpected content type.", diagnostic }, 502, origin);
    const html = await response.text();
    if (!html.trim() || !/<html[\s>]/i.test(html)) return reply({ success: false, error: "VBGRAMG response was not a valid HTML page.", diagnostic }, 502, origin);

    const entries: { name: string; url: string }[] = [];
    const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(anchorPattern)) {
      const attrs = match[1];
      const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (!hrefMatch) continue;
      const name = cleanText(match[2]);
      if (!name) continue;
      const rawHref = decodeHtml(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "").trim();
      if (!rawHref || /^javascript:/i.test(rawHref) || rawHref === "#") continue;
      let resolved: URL;
      try { resolved = new URL(rawHref, response.url); } catch { continue; }
      if (resolved.hostname !== "vbgramgrep.dord.gov.in" || !/\/VBGRAMG\/Homedist\.aspx$/i.test(resolved.pathname) || !resolved.searchParams.has("payload")) continue;
      if (!entries.some(item => item.url === resolved.href)) entries.push({ name, url: resolved.href });
    }
    if (!entries.length) return reply({ success: false, error: "No State/UT payload links were detected. No data was changed.", diagnostic, htmlBytes: new TextEncoder().encode(html).length, title: cleanText((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1]) }, 502, origin);
    return reply({ success: true, level: "states", count: entries.length, entries, diagnostic }, 200, origin);
  } catch (error) {
    return reply({ success: false, error: "Could not retrieve the VBGRAMG State list: " + (error instanceof Error ? error.message : String(error)), noDataChanged: true }, 502, origin);
  }
});
