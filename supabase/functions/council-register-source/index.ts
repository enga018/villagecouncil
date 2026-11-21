import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const STATE_LIST_URL = "https://vbgramg.dord.gov.in/vbgramg/statepage1.aspx?payload=pM0yiywvsMaE1zHGNIlrxcHgXCaS7CSW9SF6aHM0OYE";
const ALLOWED_ORIGINS = new Set(["https://villagecouncil.enga.in", "https://enga018.github.io"]);
const EXPECTED_PATHS = [
  /\/VBGRAMG\/homestciti\.aspx$/i,
  /\/VBGRAMG\/Homedist\.aspx$/i,
  /\/VBGRAMG\/Progofficer\/PoIndexFrame\.aspx$/i,
  /\/VBGRAMG\/IndexFrame\.aspx$/i,
];

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://villagecouncil.enga.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function reply(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
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
function extractEntries(html: string, baseUrl: string, expectedPath: RegExp) {
  const entries: { name: string; url: string }[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const name = cleanText(match[2]);
    const rawHref = decodeHtml(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
    if (!name || !rawHref || /^javascript:/i.test(rawHref) || rawHref === "#") continue;
    let resolved: URL;
    try { resolved = new URL(rawHref, baseUrl); } catch { continue; }
    if (!["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"].includes(resolved.hostname)) continue;
    if (!resolved.searchParams.has("payload") || !expectedPath.test(resolved.pathname)) continue;
    if (!entries.some(item => item.name.toLowerCase() === name.toLowerCase())) entries.push({ name, url: resolved.href });
  }
  return entries;
}
function inspectHtml(html: string, baseUrl: string) {
  const candidates: { kind: string; label: string; path: string; url: string }[] = [];
  const add = (kind: string, label: string, raw: string) => {
    try {
      const url = new URL(decodeHtml(raw), baseUrl);
      if (!["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"].includes(url.hostname)) return;
      const path = url.pathname + url.search;
      if (!candidates.some(x => x.url === url.href)) candidates.push({ kind, label: cleanText(label).slice(0, 120), path, url: url.href });
    } catch { /* Ignore invalid references. */ }
  };
  const tagPattern = /<(?:a|iframe|frame|form|script|link)\b([^>]*)>([\s\S]*?)<\/(?:a|script|form|link)>|<(?:iframe|frame|link)\b([^>]*)\/?\s*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const attrs = match[1] || match[3] || "";
    const href = attrs.match(/\b(?:href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) continue;
    const raw = href[1] ?? href[2] ?? href[3] ?? "";
    const label = match[2] || attrs.match(/\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.[1] || "";
    if (/register|registration|citizen_out|panchregpeople|job.?card/i.test(raw + " " + label)) add("matched-reference", label, raw);
    else if (/^(iframe|frame)/i.test(match[0])) add("frame", label, raw);
  }
  const directPattern = /(?:https?:\/\/[^"'\s]+)?\/VBGRAMG\/writereaddata\/citizen_out\/panchregpeople_[A-Za-z0-9_-]+_eng\d+\.html/gi;
  for (const match of html.matchAll(directPattern)) add("registration-report", "Registration Application Register", match[0]);
  return candidates;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed." }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const publishableKey = publishableKeys ? JSON.parse(publishableKeys).default : Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) return reply({ error: "Server configuration is incomplete." }, 500, origin);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply({ error: "Authentication required." }, 401, origin);
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply({ error: "Invalid or expired session." }, 401, origin);

  const { data: membership, error: membershipError } = await adminClient
    .from("council_memberships").select("village_council_id")
    .eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
  if (membershipError) return reply({ error: "Unable to verify council access." }, 500, origin);
  if (!membership) return reply({ error: "An active Village Council assignment is required." }, 403, origin);

  const { data: council, error: councilError } = await adminClient
    .from("council_tenants").select("state,district,block,village,is_active")
    .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
  if (councilError) return reply({ error: "Unable to load the assigned council location." }, 500, origin);
  if (!council || !council.state || !council.district || !council.block || !council.village) {
    return reply({ error: "Complete and save the official State, District, Block and Panchayat before discovering the register." }, 409, origin);
  }

  try {
    const baseHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Upgrade-Insecure-Requests": "1",
    };
    const cookieJar = new Map<string, string>();
    const absorbCookies = (response: Response) => {
      const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
      for (const value of values) {
        const pair = value.split(";", 1)[0].trim();
        const separator = pair.indexOf("=");
        if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    };
    const cookieHeader = () => [...cookieJar.entries()].map(([name, value]) => name + "=" + value).join("; ");
    const requestPage = async (pageUrl: string, referer: string) => {
      const response = await fetch(pageUrl, {
        method: "GET", redirect: "follow",
        headers: { ...baseHeaders, ...(cookieHeader() ? { Cookie: cookieHeader() } : {}), Referer: referer },
        signal: AbortSignal.timeout(30000),
      });
      absorbCookies(response);
      if (!response.ok) throw new Error("VBGRAMG returned HTTP " + response.status + " at " + new URL(pageUrl).pathname + ".");
      const contentType = response.headers.get("content-type") || "";
      if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) throw new Error("VBGRAMG returned an unexpected content type.");
      const html = await response.text();
      if (!html.trim() || !/<html[\s>]/i.test(html)) throw new Error("VBGRAMG returned invalid HTML.");
      return { html, finalUrl: response.url || pageUrl, status: response.status, contentType };
    };

    const names = [council.state, council.district, council.block, council.village];
    let current = await requestPage(STATE_LIST_URL, "https://vbgramg.dord.gov.in/");
    let entries = extractEntries(current.html, current.finalUrl, EXPECTED_PATHS[0]);
    const navigation: Record<string, unknown>[] = [{ level: "states", count: entries.length }];
    for (let i = 0; i < names.length; i++) {
      const selected = entries.find(entry => entry.name.trim().toLocaleLowerCase() === names[i]!.trim().toLocaleLowerCase());
      if (!selected) return reply({ success: false, error: "The saved official location was not found at level " + (i + 1) + ": " + names[i], navigation }, 404, origin);
      current = await requestPage(selected.url, current.finalUrl);
      navigation.push({ level: ["state", "district", "block", "panchayat"][i], selectedName: selected.name, status: current.status, finalPath: new URL(current.finalUrl).pathname });
      if (i < names.length - 1) {
        entries = extractEntries(current.html, current.finalUrl, EXPECTED_PATHS[i + 1]);
        navigation.push({ level: ["districts", "blocks", "panchayats"][i], count: entries.length });
        if (!entries.length) return reply({ success: false, error: "No official child locations were found after " + names[i], navigation }, 502, origin);
      }
    }

    let inspectedPages = [{ path: new URL(current.finalUrl).pathname, status: current.status, contentType: current.contentType, html: current.html }];
    let allCandidates = inspectHtml(current.html, current.finalUrl);
    for (let depth = 0; depth < 2; depth++) {
      const frames = allCandidates.filter(x => x.kind === "frame" || /frame/i.test(x.kind)).slice(0, 4);
      if (!frames.length) break;
      const nextPages = [];
      for (const frame of frames) {
        try {
          const page = await requestPage(frame.url, current.finalUrl);
          nextPages.push({ path: new URL(page.finalUrl).pathname, status: page.status, contentType: page.contentType, html: page.html });
          allCandidates = [...allCandidates, ...inspectHtml(page.html, page.finalUrl)];
        } catch (error) {
          inspectedPages.push({ path: new URL(frame.url).pathname, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (!nextPages.length) break;
      inspectedPages.push(...nextPages.map(x => ({ path: x.path, status: x.status, contentType: x.contentType })));
      inspectedPages = inspectedPages.slice(0, 10);
      break;
    }
    const report = allCandidates.find(x => x.kind === "registration-report" || /panchregpeople/i.test(x.path));
    const jurisdictionKey = report?.path.match(/panchregpeople_([A-Za-z0-9-]+)_eng\d+\.html/i)?.[1] || null;
    return reply({
      success: true,
      found: Boolean(report),
      councilLocation: { state: council.state, district: council.district, block: council.block, panchayat: council.village },
      jurisdictionKey,
      reportPath: report?.path || null,
      candidates: allCandidates.slice(0, 30).map(({ kind, label, path }) => ({ kind, label, path })),
      inspectedPages: inspectedPages.map(({ path, status, contentType, error }) => ({ path, status, contentType, error })),
      navigation,
      dataChanged: false,
      note: "Read-only discovery. No encrypted navigation URL or source register data was saved.",
    }, 200, origin);
  } catch (error) {
    return reply({ success: false, error: "Could not inspect the official registration register: " + (error instanceof Error ? error.message : String(error)), dataChanged: false }, 502, origin);
  }
});
