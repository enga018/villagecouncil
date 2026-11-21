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
    // Government navigation pages may emit legacy HTTP links; use HTTPS for every request.
    resolved.protocol = "https:";
    if (!resolved.searchParams.has("payload") || !expectedPath.test(resolved.pathname)) continue;
    if (!entries.some(item => item.name.toLowerCase() === name.toLowerCase())) entries.push({ name, url: resolved.href });
  }
  return entries;
}
function inspectRegisterStructure(html: string) {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(match => match[1]);
  const tableSummaries = tables.map((table, index) => {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const columnCounts = rows.slice(0, 3).map(row =>
      [...row[1].matchAll(/<t[hd]\b[^>]*>/gi)].length
    );
    const safeLabels = [...table.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map(cell => cleanText(cell[1]))
      .filter(label => /job.?card|applicant|household|caste|father|husband|gender|age|receipt|issue date|remarks|disabled|minority|verified|registration/i.test(label))
      .slice(0, 30);
    return { index, rowCount: rows.length, columnCounts, relevantColumnLabels: [...new Set(safeLabels)] };
  });
  const title = cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const text = cleanText(html);
  return {
    title,
    htmlBytes: new TextEncoder().encode(html).length,
    tableCount: tables.length,
    tableSummaries,
    hasRegisterTitle: /registration application register/i.test(text),
    hasApplicantFields: /job card number/i.test(text) && /name of applicant|applicant name/i.test(text),
  };
}
function inspectRegisterParserCompatibility(html: string) {
  const cellText = (value: string) => cleanText(value.replace(/<!--[\\s\\S]*?-->/g, " ").replace(/<br\\s*\\/?>/gi, " "));
  const parseRows = (table: string) => {
    const blocks = [...table.matchAll(/<tr\\b[^>]*>([\\s\\S]*?)(?=<tr\\b|$)/gi)];
    return blocks.map(match => [...match[1].matchAll(/<t[dh]\\b[^>]*>([\\s\\S]*?)<\\/t[dh]>/gi)].map(cell => cellText(cell[1]))).filter(row => row.some(Boolean));
  };
  const headerAliases = [
    ["sl no", "s no"], ["head of household", "head of household name"], ["caste"],
    ["name of applicant", "applicant name"], ["father husband name", "father name", "husband name"],
    ["gender", "sex"], ["age"], ["date of receipt of application request for registration", "date of receipt of application"],
    ["job card number", "jobcard number"], ["job card issue date"],
    ["reasons if job card not issued any other remarks", "reasons if job card not issued", "remarks"],
    ["disabled"], ["minority"], ["job card verified on date"],
  ];
  const key = (value: unknown) => String(value ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\\s+/g, " ").trim();
  const tables = [...html.matchAll(/<table\\b[^>]*>([\\s\\S]*?)<\\/table>/gi)].map(match => match[1]);
  let headerCandidate: Record<string, unknown> | null = null;
  const tableStats = tables.map((table, index) => {
    const firstRow = table.search(/<tr\\b/i);
    const leadingMarkup = firstRow >= 0 ? table.slice(0, firstRow) : table;
    const leadingCells = [...leadingMarkup.matchAll(/<t[dh]\\b[^>]*>([\\s\\S]*?)<\\/t[dh]>/gi)].map(cell => cellText(cell[1]));
    const parsedRows = parseRows(table);
    const rows = leadingCells.length >= 10 ? [leadingCells, ...parsedRows] : parsedRows;
    let candidate: Record<string, unknown> | null = null;
    for (let i = 0; i < Math.min(rows.length, 12) && !candidate; i++) {
      for (let span = 1; span <= 3 && i + span <= rows.length; span++) {
        const window = rows.slice(i, i + span);
        const width = Math.max(...window.map(row => row.length));
        const merged = Array.from({ length: width }, (_, column) => {
          for (const row of window) {
            const value = String(row[column] ?? "").trim();
            if (value && !/^\\d+$/.test(value)) return value;
          }
          return "";
        });
        const keys = merged.map(key);
        const matches = headerAliases.filter(aliases => keys.some(value => aliases.some(alias => value === alias || value.includes(alias)))).length;
        const hasJob = keys.some(value => value.includes("job card number") || value.includes("jobcard number"));
        const hasName = keys.some(value => value.includes("name of applicant") || value.includes("applicant name"));
        const hasHousehold = keys.some(value => value.includes("head of household"));
        if (matches >= 6 && hasJob && hasName && hasHousehold) {
          candidate = { rowIndex: i, headerSpan: span, headerColumnCount: merged.length, headings: merged.filter(Boolean).slice(0, 20) };
          break;
        }
      }
    }
    if (candidate) headerCandidate = { tableIndex: index, ...candidate };
    const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const wideRows = rows.filter(row => row.length >= 14).length;
    const jobCardLikeRows = rows.filter(row => row.some(cell => /^MZ-[A-Z0-9-]+\\//i.test(String(cell).trim()))).length;
    return {
      index,
      leadingCellCount: leadingCells.length,
      parsedRowCount: parsedRows.length,
      effectiveRowCount: rows.length,
      maxColumns,
      rowsWith14PlusCells: wideRows,
      rowsContainingJobCardPattern: jobCardLikeRows,
      headerCandidate: candidate,
    };
  });
  return {
    globalTrCount: (html.match(/<tr\\b/gi) || []).length,
    globalTdCount: (html.match(/<td\\b/gi) || []).length,
    globalThCount: (html.match(/<th\\b/gi) || []).length,
    tableStats,
    headerCandidate,
    likelyApplicantTableIndex: tableStats.filter(table => table.effectiveRowCount > 100).sort((a,b) => b.effectiveRowCount-a.effectiveRowCount)[0]?.index ?? null,
  };
}

function inspectHtml(html: string, baseUrl: string) {
  const candidates: { kind: string; label: string; path: string; url: string }[] = [];
  const add = (kind: string, label: string, raw: string) => {
    try {
      const url = new URL(decodeHtml(raw), baseUrl);
      if (!["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"].includes(url.hostname)) return;
      // Report and frame references can also be emitted as HTTP; normalize before fetching.
      url.protocol = "https:";
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
    .from("council_tenants").select("state,district,block,village,block_url,panchayat_url,is_active")
    .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
  if (councilError) return reply({ error: "Unable to load the assigned council location." }, 500, origin);
  if (!council || !council.state || !council.district || !council.block || !council.village || !council.block_url || !council.panchayat_url) {
    return reply({ error: "Save the official location, including its Block URL and Panchayat URL, before discovering the register." }, 409, origin);
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

    const navigation: Record<string, unknown>[] = [];
    let current = await requestPage(STATE_LIST_URL, "https://vbgramg.dord.gov.in/");
    let entries = extractEntries(current.html, current.finalUrl, EXPECTED_PATHS[0]);
    navigation.push({ level: "states", count: entries.length });
    const stateEntry = entries.find(entry => entry.name.trim().toLocaleLowerCase() === council.state!.trim().toLocaleLowerCase());
    if (!stateEntry) return reply({ success: false, error: "The saved State was not found in the official State list.", navigation }, 404, origin);
    current = await requestPage(stateEntry.url, current.finalUrl);
    navigation.push({ level: "state", selectedName: stateEntry.name, status: current.status, finalPath: new URL(current.finalUrl).pathname });

    entries = extractEntries(current.html, current.finalUrl, EXPECTED_PATHS[1]);
    navigation.push({ level: "districts", count: entries.length });
    const districtEntry = entries.find(entry => entry.name.trim().toLocaleLowerCase() === council.district!.trim().toLocaleLowerCase());
    if (!districtEntry) return reply({ success: false, error: "The saved District was not found under the selected State.", navigation }, 404, origin);
    current = await requestPage(districtEntry.url, current.finalUrl);
    navigation.push({ level: "district", selectedName: districtEntry.name, status: current.status, finalPath: new URL(current.finalUrl).pathname });

    const validateSavedUrl = (raw: string, expectedPath: RegExp, label: string) => {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:" || !["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"].includes(parsed.hostname) || !expectedPath.test(parsed.pathname) || !parsed.searchParams.has("payload")) {
        throw new Error("The saved " + label + " URL is invalid or does not match the official VBGRAMG navigation path. Please update the saved location.");
      }
      return parsed.href;
    };
    const savedBlockUrl = validateSavedUrl(council.block_url, EXPECTED_PATHS[2], "Block");
    current = await requestPage(savedBlockUrl, current.finalUrl);
    navigation.push({ level: "block", selectedName: council.block, status: current.status, finalPath: new URL(current.finalUrl).pathname, source: "saved_block_url" });

    entries = extractEntries(current.html, current.finalUrl, EXPECTED_PATHS[3]);
    navigation.push({ level: "panchayat_links_on_saved_block", count: entries.length });
    const savedPanchayatUrl = validateSavedUrl(council.panchayat_url, EXPECTED_PATHS[3], "Panchayat");

    // Use the exact Panchayat URL saved during onboarding. Do not compare encrypted
    // payloads against links regenerated in this session: VBGRAMG may issue a new
    // payload for the same Panchayat in each navigation session.
    current = await requestPage(savedPanchayatUrl, current.finalUrl);
    navigation.push({ level: "panchayat", selectedName: council.village, status: current.status, finalPath: new URL(current.finalUrl).pathname, source: "saved_panchayat_url_direct" });

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
    const report = allCandidates.find(x => /panchregpeople\\.aspx/i.test(x.path))
      || allCandidates.find(x => x.kind === "registration-report" || /panchregpeople/i.test(x.path));
    const jurisdictionKey = report?.path.match(/panchregpeople_([A-Za-z0-9-]+)_eng\\d+\\.html/i)?.[1] || null;
    let reportInspection: Record<string, unknown> | null = null;
    if (report) {
      try {
        const reportPage = await requestPage(report.url, current.finalUrl);
        reportInspection = {
          path: new URL(reportPage.finalUrl).pathname,
          status: reportPage.status,
          contentType: reportPage.contentType,
          ...inspectRegisterStructure(reportPage.html),
          parserCompatibility: inspectRegisterParserCompatibility(reportPage.html),
        };
      } catch (error) {
        reportInspection = {
          path: new URL(report.url).pathname,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return reply({
      success: true,
      found: Boolean(report),
      councilLocation: { state: council.state, district: council.district, block: council.block, panchayat: council.village },
      jurisdictionKey,
      reportPath: report?.path || null,
      reportInspection,
      candidates: allCandidates.slice(0, 30).map(({ kind, label, path }) => ({ kind, label, path })),
      inspectedPages: inspectedPages.map(({ path, status, contentType, error }) => ({ path, status, contentType, error })),
      navigation,
      dataChanged: false,
      note: "Read-only discovery and report structure inspection. Applicant records were not returned or saved.",
    }, 200, origin);
  } catch (error) {
    return reply({ success: false, error: "Could not inspect the official registration register: " + (error instanceof Error ? error.message : String(error)), dataChanged: false }, 502, origin);
  }
});
