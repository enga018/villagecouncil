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

function extractEntries(html: string, baseUrl: string, expectedPath: RegExp) {
  const entries: { name: string; url: string }[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const name = cleanText(match[2]);
    if (!name) continue;
    const rawHref = decodeHtml(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "").trim();
    if (!rawHref || /^javascript:/i.test(rawHref) || rawHref === "#") continue;
    let resolved: URL;
    try { resolved = new URL(rawHref, baseUrl); } catch { continue; }
    if (!["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"].includes(resolved.hostname) || !resolved.searchParams.has("payload")) continue;
    resolved.protocol = "https:";
    if (!expectedPath.test(resolved.pathname)) continue;
    if (!entries.some(item => item.url === resolved.href)) entries.push({ name, url: resolved.href });
  }
  return entries;
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

  const adminClient = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  async function cacheLocationList(
    table: "location_states" | "location_districts" | "location_blocks" | "location_panchayats",
    parentColumn: "state_id" | "district_id" | "block_id" | null,
    parentId: string | null,
    entries: { name: string; url: string }[],
  ) {
    if (!entries.length) return;
    try {
      const rows = entries.map((entry) => {
        const row: Record<string, unknown> = { official_name: entry.name, navigation_url: entry.url };
        if (parentColumn && parentId) row[parentColumn] = parentId;
        return row;
      });
      const onConflict = parentColumn ? `${parentColumn},official_name` : "official_name";
      await adminClient.from(table).upsert(rows, { onConflict });
    } catch {
      // Existing behavior: live scrape results remain usable if cache write fails.
    }
  }

  async function resolveLocationId(
    table: "location_states" | "location_districts" | "location_blocks",
    name: string,
    parentColumn?: "state_id" | "district_id",
    parentId?: string | null,
  ): Promise<string | null> {
    try {
      let query = adminClient.from(table).select("id").eq("official_name", name);
      if (parentColumn && parentId) query = query.eq(parentColumn, parentId);
      const { data } = await query.maybeSingle();
      return data?.id ?? null;
    } catch {
      return null;
    }
  }

  let body: { action?: string; selectedNames?: string[]; publicRequest?: boolean };
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON request." }, 400, origin); }
  if (!["states", "districts", "blocks", "panchayats"].includes(body.action || "")) return reply({ error: "Unsupported action." }, 400, origin);
  const isPublicRequest = body.publicRequest === true;

  if (!isPublicRequest) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return reply({ error: "Authentication required." }, 401, origin);
    const userClient = createClient(url, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return reply({ error: "Invalid or expired session." }, 401, origin);
    const { data: membership, error: membershipError } = await adminClient
      .from("council_memberships").select("id")
      .eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
    if (membershipError) return reply({ error: "Unable to verify Village Council access." }, 500, origin);
    if (!membership) return reply({ error: "An active Village Council assignment is required." }, 403, origin);
  }

  const requiredNames = { states: 0, districts: 1, blocks: 2, panchayats: 3 }[body.action || ""]!;
  const selectedNames = body.selectedNames || [];
  if (!Array.isArray(selectedNames) || selectedNames.length !== requiredNames || selectedNames.some(name => typeof name !== "string" || !name.trim())) {
    return reply({ error: "Select each preceding location level before continuing." }, 400, origin);
  }

  async function readCachedLocationList(action: string, names: string[]): Promise<{ id: string; name: string; url: string; available?: boolean }[]> {
    const mapRows = (rows: { id: string; official_name: string; navigation_url: string | null }[] | null) =>
      (rows || []).filter(row => row.navigation_url).map(row => ({ id: row.id, name: row.official_name, url: row.navigation_url as string }));

    if (action === "states") {
      const { data, error } = await adminClient.from("location_states")
        .select("id,official_name,navigation_url").eq("is_active", true).order("official_name");
      if (error) throw error;
      return mapRows(data);
    }

    const { data: state, error: stateError } = await adminClient.from("location_states")
      .select("id").eq("official_name", names[0]).eq("is_active", true).maybeSingle();
    if (stateError) throw stateError;
    if (!state) return [];

    if (action === "districts") {
      const { data, error } = await adminClient.from("location_districts")
        .select("id,official_name,navigation_url").eq("state_id", state.id).eq("is_active", true).order("official_name");
      if (error) throw error;
      return mapRows(data);
    }

    const { data: district, error: districtError } = await adminClient.from("location_districts")
      .select("id").eq("state_id", state.id).eq("official_name", names[1]).eq("is_active", true).maybeSingle();
    if (districtError) throw districtError;
    if (!district) return [];

    if (action === "blocks") {
      const { data, error } = await adminClient.from("location_blocks")
        .select("id,official_name,navigation_url").eq("district_id", district.id).eq("is_active", true).order("official_name");
      if (error) throw error;
      return mapRows(data);
    }

    const { data: block, error: blockError } = await adminClient.from("location_blocks")
      .select("id").eq("district_id", district.id).eq("official_name", names[2]).eq("is_active", true).maybeSingle();
    if (blockError) throw blockError;
    if (!block) return [];

    const { data, error } = await adminClient.from("location_panchayats")
      .select("id,official_name,navigation_url").eq("block_id", block.id).eq("is_active", true).order("official_name");
    if (error) throw error;
    const entries = mapRows(data);
    if (!entries.length) return entries;
    const ids = entries.map(entry => entry.id);
    const { data: assignedRows, error: assignedError } = await adminClient.from("council_tenants")
      .select("location_panchayat_id").in("location_panchayat_id", ids).eq("is_active", true);
    if (assignedError) throw assignedError;
    let pendingRows: { location_panchayat_id: string }[] = [];
    if (isPublicRequest) {
      const { data, error: pendingError } = await adminClient.from("council_onboarding_requests")
        .select("location_panchayat_id").in("location_panchayat_id", ids)
        .in("status", ["pending", "under_review", "more_information_required"]);
      if (pendingError) throw pendingError;
      pendingRows = data || [];
    }
    const unavailable = new Set([
      ...(assignedRows || []).map(row => row.location_panchayat_id),
      ...pendingRows.map(row => row.location_panchayat_id),
    ]);
    return entries.map(entry => ({ ...entry, available: !unavailable.has(entry.id) }));
  }

  const expectedPaths = [
    /\/VBGRAMG\/homestciti\.aspx$/i,
    /\/VBGRAMG\/Homedist\.aspx$/i,
    /\/VBGRAMG\/Progofficer\/PoIndexFrame\.aspx$/i,
    /\/VBGRAMG\/IndexFrame\.aspx$/i,
  ];
  try {
    // Prefer the shared official location master. Only scrape VBGRAMG when this
    // particular level has not yet been cached.
    const cachedEntries = await readCachedLocationList(body.action || "", selectedNames);
    if (cachedEntries.length) {
      return reply({ success: true, level: body.action, count: cachedEntries.length, entries: cachedEntries, cached: true }, 200, origin);
    }

    const baseHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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
      if (!response.ok) throw new Error("VBGRAMG returned HTTP " + response.status + " while loading " + new URL(pageUrl).pathname + ".");
      const contentType = response.headers.get("content-type") || "";
      if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) throw new Error("VBGRAMG returned an unexpected content type.");
      const html = await response.text();
      if (!html.trim() || !/<html[\s>]/i.test(html)) throw new Error("VBGRAMG returned an invalid HTML page.");
      return { html, finalUrl: response.url || pageUrl, diagnostic: { status: response.status, finalUrl: response.url || pageUrl, contentType } };
    };

    // Start a fresh session, then generate and consume every payload in that same session.
    const statePage = await requestPage(STATE_LIST_URL, "https://vbgramg.dord.gov.in/");
    let currentHtml = statePage.html;
    let currentUrl = statePage.finalUrl;
    let entries = extractEntries(currentHtml, currentUrl, expectedPaths[0]);
    await cacheLocationList("location_states", null, null, entries);
    if (body.action === "states") {
      if (!entries.length) return reply({ success: false, error: "No State / UT links were found.", diagnostic: statePage.diagnostic }, 502, origin);
      const cachedStates = await readCachedLocationList("states", []);
      if (isPublicRequest && !cachedStates.length) return reply({ success: false, error: "The official State list could not be saved. Please try again." }, 502, origin);
      return reply({ success: true, level: body.action, count: cachedStates.length || entries.length, entries: cachedStates.length ? cachedStates : entries, cached: false, diagnostic: statePage.diagnostic }, 200, origin);
    }

    let selectedUrl = "";
    let lastDiagnostic = statePage.diagnostic;
    let stateId: string | null = null;
    let districtId: string | null = null;
    for (let i = 0; i < selectedNames.length; i++) {
      const selected = entries.find(entry => entry.name.trim().toLocaleLowerCase() === selectedNames[i].trim().toLocaleLowerCase());
      if (!selected) return reply({ success: false, error: "The selected official location was not found: " + selectedNames[i], diagnostic: lastDiagnostic }, 404, origin);
      selectedUrl = selected.url;
      const nextPage = await requestPage(selectedUrl, currentUrl);
      currentHtml = nextPage.html;
      currentUrl = nextPage.finalUrl;
      lastDiagnostic = nextPage.diagnostic;
      entries = extractEntries(currentHtml, currentUrl, expectedPaths[i + 1]);
      if (i === 0) {
        stateId = await resolveLocationId("location_states", selected.name);
        await cacheLocationList("location_districts", "state_id", stateId, entries);
      } else if (i === 1) {
        districtId = await resolveLocationId("location_districts", selected.name, "state_id", stateId);
        await cacheLocationList("location_blocks", "district_id", districtId, entries);
      } else if (i === 2) {
        const blockId = await resolveLocationId("location_blocks", selected.name, "district_id", districtId);
        await cacheLocationList("location_panchayats", "block_id", blockId, entries);
      }
    }
    if (!entries.length) return reply({ success: false, error: "No official location links were found for this level.", diagnostic: lastDiagnostic }, 502, origin);
    const cachedResult = await readCachedLocationList(body.action || "", selectedNames);
    if (isPublicRequest && !cachedResult.length) return reply({ success: false, error: "The official location list could not be saved. Please try again." }, 502, origin);
    return reply({ success: true, level: body.action, count: cachedResult.length || entries.length, entries: cachedResult.length ? cachedResult : entries, cached: false, diagnostic: lastDiagnostic }, 200, origin);
  } catch (error) {
    return reply({ success: false, error: "Could not retrieve the VBGRAMG location list: " + (error instanceof Error ? error.message : String(error)), noDataChanged: true }, 502, origin);
  }
});
