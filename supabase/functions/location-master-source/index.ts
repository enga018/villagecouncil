import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const STATE_LIST_URL = "https://vbgramg.dord.gov.in/vbgramg/statepage1.aspx?payload=pM0yiywvsMaE1zHGNIlrxcHgXCaS7CSW9SF6aHM0OYE";
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
  const { data: membership, error: membershipError } = await adminClient
    .from("memberships").select("id")
    .eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
  if (membershipError) return reply({ error: "Unable to verify Village Council access." }, 500, origin);
  if (!membership) return reply({ error: "An active Village Council assignment is required." }, 403, origin);

  let body: { action?: string; parentUrl?: string; navigationUrls?: string[] };
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON request." }, 400, origin); }
  if (!["states", "districts", "blocks", "panchayats"].includes(body.action || "")) return reply({ error: "Unsupported action." }, 400, origin);

  const expectedPaths = [
    /\/VBGRAMG\/homestciti\.aspx$/i,
    /\/VBGRAMG\/Homedist\.aspx$/i,
    /\/VBGRAMG\/Progofficer\/PoIndexFrame\.aspx$/i,
  ];
  const expectedDepth = { districts: 1, blocks: 2, panchayats: 3 }[body.action || ""];
  // Backward compatibility for already-open/cached onboarding clients:
  // a District request needs only the selected State URL.
  const navigationUrls = body.action === "states" ? [] :
    Array.isArray(body.navigationUrls) ? body.navigationUrls :
    body.action === "districts" && typeof body.parentUrl === "string" ? [body.parentUrl] : undefined;
  if (body.action !== "states" && (!Array.isArray(navigationUrls) || navigationUrls.length !== expectedDepth)) {
    return reply({ error: "The selected location path is incomplete. Refresh onboarding and select the locations again." }, 400, origin);
  }
  const validatedUrls: string[] = [];
  for (let i = 0; i < (navigationUrls || []).length; i++) {
    try {
      const candidate = new URL(navigationUrls![i]);
      if (!["vbgramgrep.dord.gov.in", "vbgramg.dord.gov.in"].includes(candidate.hostname)
        || !expectedPaths[i].test(candidate.pathname)
        || !candidate.searchParams.has("payload")) {
        return reply({ error: "An official parent location link is invalid." }, 400, origin);
      }
      candidate.protocol = "https:";
      validatedUrls.push(candidate.href);
    } catch {
      return reply({ error: "An official parent location URL is invalid." }, 400, origin);
    }
  }

  try {
    const baseHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Upgrade-Insecure-Requests": "1",
    };
    const cookieJar = new Map<string, string>();
    const absorbCookies = (response: Response) => {
      const values = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie") || ""];
      for (const value of values) {
        const pair = value.split(";", 1)[0].trim();
        const separator = pair.indexOf("=");
        if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    };
    const cookieHeader = () => [...cookieJar.entries()].map(([name, value]) => name + "=" + value).join("; ");

    let previousUrl = STATE_LIST_URL;
    const initialResponse = await fetch(STATE_LIST_URL, {
      method: "GET", redirect: "follow", headers: baseHeaders,
      signal: AbortSignal.timeout(30000),
    });
    absorbCookies(initialResponse);
    if (!initialResponse.ok) {
      return reply({ success: false, error: "VBGRAMG session initialization returned HTTP " + initialResponse.status + ".", diagnostic: { status: initialResponse.status, finalUrl: initialResponse.url } }, 502, origin);
    }
    await initialResponse.body?.cancel();
    previousUrl = initialResponse.url || STATE_LIST_URL;

    const targetUrl = body.action === "states" ? STATE_LIST_URL : validatedUrls[validatedUrls.length - 1];
    let response: Response | null = null;
    if (body.action === "states") {
      response = await fetch(STATE_LIST_URL, {
        method: "GET", redirect: "follow",
        headers: { ...baseHeaders, ...(cookieHeader() ? { Cookie: cookieHeader() } : {}), Referer: previousUrl },
        signal: AbortSignal.timeout(30000),
      });
      absorbCookies(response);
    } else {
      for (const stepUrl of validatedUrls) {
        const stepResponse = await fetch(stepUrl, {
          method: "GET", redirect: "follow",
          headers: { ...baseHeaders, ...(cookieHeader() ? { Cookie: cookieHeader() } : {}), Referer: previousUrl },
          signal: AbortSignal.timeout(30000),
        });
        absorbCookies(stepResponse);
        if (!stepResponse.ok) {
          return reply({
            success: false,
            error: "VBGRAMG returned HTTP " + stepResponse.status + " at navigation step " + (validatedUrls.indexOf(stepUrl) + 1) + " of " + validatedUrls.length + " (" + new URL(stepUrl).hostname + new URL(stepUrl).pathname + "; referer " + new URL(previousUrl).hostname + new URL(previousUrl).pathname + "; cookies " + [...cookieJar.keys()].join(",") + ").",
            diagnostic: {
              status: stepResponse.status,
              step: validatedUrls.indexOf(stepUrl) + 1,
              requestedHost: new URL(stepUrl).hostname,
              requestedPath: new URL(stepUrl).pathname,
              finalHost: stepResponse.url ? new URL(stepResponse.url).hostname : null,
              finalPath: stepResponse.url ? new URL(stepResponse.url).pathname : null,
              refererHost: previousUrl ? new URL(previousUrl).hostname : null,
              cookieNames: [...cookieJar.keys()],
            },
          }, 502, origin);
        }
        previousUrl = stepResponse.url || stepUrl;
        if (stepUrl === targetUrl) response = stepResponse;
        else await stepResponse.body?.cancel();
      }
    }
    if (!response) return reply({ success: false, error: "The official location page could not be loaded." }, 502, origin);
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
      if (!["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"].includes(resolved.hostname) || !resolved.searchParams.has("payload")) continue;
      resolved.protocol = "https:";
      const expectedPath = {
        states: /\/VBGRAMG\/homestciti\.aspx$/i,
        districts: /\/VBGRAMG\/Homedist\.aspx$/i,
        blocks: /\/VBGRAMG\/Progofficer\/PoIndexFrame\.aspx$/i,
        panchayats: /\/VBGRAMG\/IndexFrame\.aspx$/i,
      }[body.action || ""];
      if (!expectedPath.test(resolved.pathname)) continue;
      if (!entries.some(item => item.url === resolved.href)) entries.push({ name, url: resolved.href });
    }
    if (!entries.length) return reply({ success: false, error: "No official location links were detected for this level. No data was changed.", diagnostic, htmlBytes: new TextEncoder().encode(html).length, title: cleanText((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1]) }, 502, origin);
    return reply({ success: true, level: body.action, count: entries.length, entries, diagnostic }, 200, origin);
  } catch (error) {
    return reply({ success: false, error: "Could not retrieve the VBGRAMG location list: " + (error instanceof Error ? error.message : String(error)), noDataChanged: true }, 502, origin);
  }
});
