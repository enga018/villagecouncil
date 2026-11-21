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
  const cellText = (value: string) => cleanText(value.replace(/<!--[\s\S]*?-->/g, " ").replace(/<br\s*\/?>/gi, " "));
  const parseRows = (table: string) => {
    const blocks = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|$)/gi)];
    return blocks.map(match => [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => cellText(cell[1]))).filter(row => row.some(Boolean));
  };
  const headerAliases = [
    ["sl no", "s no"], ["head of household", "head of household name"], ["caste"],
    ["name of applicant", "applicant name"], ["father husband name", "father name", "husband name"],
    ["gender", "sex"], ["age"], ["date of receipt of application request for registration", "date of receipt of application"],
    ["job card number", "jobcard number"], ["job card issue date"],
    ["reasons if job card not issued any other remarks", "reasons if job card not issued", "remarks"],
    ["disabled"], ["minority"], ["job card verified on date"],
  ];
  const key = (value: unknown) => String(value ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(match => match[1]);
  let headerCandidate: Record<string, unknown> | null = null;
  const tableStats = tables.map((table, index) => {
    const firstRow = table.search(/<tr\b/i);
    const leadingMarkup = firstRow >= 0 ? table.slice(0, firstRow) : table;
    const leadingCells = [...leadingMarkup.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => cellText(cell[1]));
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
            if (value && !/^\d+$/.test(value)) return value;
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
    const jobCardLikeRows = rows.filter(row => row.some(cell => /^MZ-[A-Z0-9-]+\//i.test(String(cell).trim()))).length;
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
    globalTrCount: (html.match(/<tr\b/gi) || []).length,
    globalTdCount: (html.match(/<td\b/gi) || []).length,
    globalThCount: (html.match(/<th\b/gi) || []).length,
    tableStats,
    headerCandidate,
    likelyApplicantTableIndex: tableStats.filter(table => table.effectiveRowCount > 100).sort((a,b) => b.effectiveRowCount-a.effectiveRowCount)[0]?.index ?? null,
  };
}


function normalizeApplicantName(value: unknown) {
  return String(value ?? "").replace(/\*/g, "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function parseOfficialRegister(html: string, village: string) {
  const text = cleanText(html).toLowerCase();
  if (new TextEncoder().encode(html).length > 8_000_000 || !text.includes("registration application register") || !text.includes(village.toLowerCase())) throw new Error("Official report title or Panchayat identity validation failed.");
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[1]);
  const parseRows = (table: string) => {
    const blocks = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|$)/gi)];
    return blocks.map(m => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x => cleanText(x[1].replace(/<br\s*\/?>/gi, " ")))).filter(row => row.length);
  };
  const parsedTables = tables.map((table,index) => {
    const first = table.search(/<tr\b/i);
    const leading = first >= 0 ? table.slice(0,first) : table;
    const cells = [...leading.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => cleanText(m[1]));
    const rows = parseRows(table);
    return { index, rows: cells.length >= 10 ? [cells,...rows] : rows };
  });
  const key = (v: unknown) => String(v ?? "").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim().replace(/\bno\b/g,"number");
  const aliases = [["sl number","s number"],["head of household","head of household name"],["caste"],["name of applicant","applicant name"],["father husband name","father name","husband name"],["gender","sex"],["age"],["date of receipt of application request for registration","date of receipt of application"],["job card number","jobcard number"],["job card issue date"],["reasons if job card not issued any other remarks","reasons if job card not issued","remarks"],["disabled"],["minority"],["job card verified on date"]];
  let selected: {index:number;rows:string[][]}|null = null, header:string[] = [];
  for (const table of parsedTables) {
    for (let i=0;i<Math.min(table.rows.length,12) && !selected;i++) for(let span=1;span<=3 && i+span<=table.rows.length;span++) {
      const win=table.rows.slice(i,i+span), width=Math.max(...win.map(row=>row.length));
      const merged=Array.from({length:width},(_,col)=>{for(const row of win){const v=String(row[col]??"").trim();if(v&&!/^\d+$/.test(v))return v;}return "";});
      const keys=merged.map(key), matched=aliases.filter(group=>keys.some(v=>group.some(a=>v===a||v.includes(a)))).length;
      if(matched>=6 && keys.some(v=>v.includes("job card number")) && keys.some(v=>v.includes("name of applicant")) && keys.some(v=>v.includes("head of household"))) {selected=table;header=merged;break;}
    }
    if(selected)break;
  }
  if(!selected) throw new Error("Could not identify applicant table headings.");
  if(header.length<14||header.length>15) throw new Error("Unexpected applicant heading count: "+header.length+".");
  if(header.length===15&&!String(header[14]??"").trim())header=header.slice(0,14);
  const col=(names:string[])=>{const keys=header.map(key);let i=keys.findIndex(v=>names.includes(v));return i>=0?i:keys.findIndex(v=>names.some(a=>v.includes(a)||a.includes(v)));};
  const ix={house:col(["head of household","head of household name"]),caste:col(["caste"]),name:col(["name of applicant","applicant name"]),father:col(["father husband name","father name","husband name"]),gender:col(["gender","sex"]),age:col(["age"]),received:col(["date of receipt of application request for registration","date of receipt of application"]),job:col(["job card number","jobcard number"]),issue:col(["job card issue date"]),remarks:col(["reasons if job card not issued any other remarks","reasons if job card not issued","remarks"]),disabled:col(["disabled"]),minority:col(["minority"]),verified:col(["job card verified on date"])};
  if([ix.house,ix.name,ix.job].some(v=>v<0))throw new Error("Required household, applicant-name or Job Card columns are missing.");
  const rows:Record<string,unknown>[]=[], review:string[]=[], identityOccurrences=new Map<string,number>(), households=new Map<string,string>(), sequences=new Map<string,number>();
  let deletedCount=0;
  for(let n=3;n<selected.rows.length;n++){
    const row=selected.rows[n], content=row.join(" ").trim();
    if(!content||/^(villages?\b|no\. of registrants\b|total no\. of registered applicants\b|total\b|report completed\b|# end of report\b)/i.test(content))continue;
    const card=String(row[ix.job]??"").trim(), raw=String(row[ix.name]??"").trim();
    if(!card&&!raw)continue;
    if(!/^MZ-/i.test(card)||!card.includes("/")||!raw){review.push("Unrecognized applicant row "+(n+1));continue;}
    const rawHouse=String(row[ix.house]??"").trim();if(rawHouse)households.set(card,rawHouse.replace(/\*/g,"").trim());
    const house=rawHouse?rawHouse.replace(/\*/g,"").trim():(households.get(card)||"");
    if(!house){review.push("Missing household head for Job Card "+card+" at source row "+(n+1));continue;}
    const remarks=ix.remarks>=0?String(row[ix.remarks]??"").trim():"", name=raw.replace(/\*/g,"").trim();
    const status=rawHouse.includes("*")||raw.includes("*")||/\bdeleted\b/i.test(remarks)?"deleted":"active";
    const identityBase=card.toUpperCase()+"|"+normalizeApplicantName(name);
    // The legacy VB-GRAMG importer supports repeated applicant names on one
    // Job Card by consuming matching records in source order. The new register
    // has no applicant-number/Unique-ID columns, so retain each occurrence with
    // a deterministic ordinal instead of rejecting a legitimate duplicate.
    const occurrence=(identityOccurrences.get(identityBase)||0)+1;identityOccurrences.set(identityBase,occurrence);
    const sourceKey=occurrence===1?identityBase:identityBase+"|DUP"+occurrence;
    const seq=(sequences.get(card)||0)+1;sequences.set(card,seq);
    const val=(i:number)=>i>=0?String(row[i]??"").trim():"";
    // Preserve every source applicant. Numbering is calculated across the
    // complete Government source order, including deleted applicants.
    if(status==="deleted") deletedCount++;
    rows.push({source_record_key:sourceKey,source_sequence:seq,job_card_number:card,jc_number:card.split("/").pop()||card,head_of_household:house,applicant_number:String(seq),official_unique_id:card+"/"+seq,applicant_name:name,caste:val(ix.caste),father_husband_name:val(ix.father),gender:val(ix.gender),age:val(ix.age),application_received_date:val(ix.received),job_card_issue_date:val(ix.issue),remarks,is_disabled:val(ix.disabled),is_minority:val(ix.minority),job_card_verified_date:val(ix.verified),status,source_row_number:n+1});
  }
  if(review.length)throw new Error("Import preview paused for "+review.length+" uncertain row(s). First issue: "+review[0]);
  const active=rows.filter(row=>row.status==="active");
  if(!rows.length||rows.length>100000)throw new Error("Parsed applicant count is outside permitted range.");
  return {rows,active,deletedCount,tableIndex:selected.index,sourceRowCount:selected.rows.length,columnCount:header.length};
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

  const requestBody = await req.json().catch(() => ({}));
  const action = requestBody?.action === "prepare-preview" ? "prepare-preview" : "discover";

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
      // The VBGRAMG origin intermittently serves malformed gzip responses.
      // Request identity encoding so the Edge Runtime does not need to decode them.
      "Accept-Encoding": "identity",
      "Cache-Control": "no-cache",
      "Upgrade-Insecure-Requests": "1",
    };
    // Keep session cookies isolated by official host. The Government site is
    // intermittently unavailable on one hostname while the equivalent hostname
    // serves the same jurisdiction path and encrypted payload.
    const cookieJars = new Map<string, Map<string, string>>();
    const jarFor = (hostname: string) => {
      let jar = cookieJars.get(hostname);
      if (!jar) { jar = new Map<string, string>(); cookieJars.set(hostname, jar); }
      return jar;
    };
    const absorbCookies = (response: Response, requestHost: string) => {
      const responseHost = (() => { try { return new URL(response.url).hostname; } catch { return requestHost; } })();
      const jar = jarFor(responseHost);
      const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
      for (const value of values) {
        const pair = value.split(";", 1)[0].trim();
        const separator = pair.indexOf("=");
        if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    };
    const cookieHeader = (hostname: string) => [...jarFor(hostname).entries()].map(([name, value]) => name + "=" + value).join("; ");
    const requestPage = async (pageUrl: string, referer: string) => {
      const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
      const original = new URL(pageUrl);
      const hosts = ["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"];
      const candidates = [original.href];
      if (hosts.includes(original.hostname)) {
        const alternate = new URL(original.href);
        alternate.hostname = original.hostname === hosts[0] ? hosts[1] : hosts[0];
        candidates.push(alternate.href);
      }
      let lastError = "Unknown Government server error.";
      for (const candidate of candidates) {
        const target = new URL(candidate);
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const cookies = cookieHeader(target.hostname);
            const response = await fetch(candidate, {
              method: "GET", redirect: "follow",
              headers: { ...baseHeaders, ...(cookies ? { Cookie: cookies } : {}), Referer: referer },
              signal: AbortSignal.timeout(15000),
            });
            absorbCookies(response, target.hostname);
            if (!response.ok) {
              lastError = "VBGRAMG returned HTTP " + response.status + " at " + target.pathname + " on " + target.hostname + ".";
              await response.body?.cancel().catch(() => {});
              if (retryableStatuses.has(response.status) && attempt === 1) continue;
              if (retryableStatuses.has(response.status)) break;
              throw new Error(lastError);
            }
            const contentType = response.headers.get("content-type") || "";
            if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
              throw new Error("VBGRAMG returned an unexpected content type at " + target.pathname + ".");
            }
            const html = await response.text();
            if (!html.trim() || !/<html[\s>]/i.test(html)) {
              throw new Error("VBGRAMG returned invalid HTML at " + target.pathname + ".");
            }
            return { html, finalUrl: response.url || candidate, status: response.status, contentType };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            const retryableTransportError = /timed out|timeout|network|connection|fetch failed|gzip|decompress|invalid header|unexpected end|content decoding/i.test(lastError);
            if (!retryableTransportError || attempt === 2) break;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      throw new Error(lastError + " (primary and alternate Government hosts checked)");
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
        if (action === "prepare-preview") {
          const parsed = parseOfficialRegister(reportPage.html, council.village!);
          const tenantId = membership.village_council_id;

          // Validate normalized identities and numbering before creating a review batch.
          const sourceKeys = parsed.rows.map(row => String(row.source_record_key));
          const officialIds = parsed.rows.map(row => String(row.official_unique_id));
          const requiredFieldsPresent = parsed.rows.every(row =>
            Boolean(row.job_card_number && row.head_of_household && row.applicant_name &&
              row.applicant_number && row.official_unique_id && row.source_record_key &&
              (row.status === "active" || row.status === "deleted"))
          );
          const numberingValid = parsed.rows.every(row =>
            String(row.applicant_number) === String(row.source_sequence) &&
            String(row.official_unique_id) === String(row.job_card_number) + "/" + String(row.applicant_number)
          );
          const identityValid = new Set(sourceKeys).size === sourceKeys.length &&
            new Set(officialIds).size === officialIds.length;
          if (!requiredFieldsPresent || !numberingValid || !identityValid) {
            throw new Error("Register validation failed: required fields, applicant numbering, or unique identities are inconsistent. No import batch was created.");
          }
          const activeJobCardNumbers = new Set(parsed.active.map(row => String(row.job_card_number)));
          const allJobCardNumbers = new Set(parsed.rows.map(row => String(row.job_card_number)));
          const validation = {
            passed: true,
            stagedRowsMatch: true,
            requiredFieldsPresent: true,
            uniqueSourceKeys: true,
            uniqueOfficialIds: true,
            applicantNumbering: true,
            activeJobCards: activeJobCardNumbers.size,
            inactiveJobCards: allJobCardNumbers.size - activeJobCardNumbers.size,
            checkedRows: parsed.rows.length,
          };
          const existingCards: any[] = [];
          const existingApplicants: any[] = [];
          for (let offset = 0; ; offset += 1000) {
            const { data, error } = await adminClient.from("council_job_cards")
              .select("id,job_card_number,head_of_household,status")
              .eq("village_council_id", tenantId).order("job_card_number").range(offset, offset + 999);
            if (error) throw error;
            existingCards.push(...(data || []));
            if (!data || data.length < 1000) break;
          }
          for (let offset = 0; ; offset += 1000) {
            const { data, error } = await adminClient.from("council_applicants")
              .select("id,job_card_id,source_record_key,applicant_number,applicant_name,caste,father_husband_name,gender,age,application_received_date,job_card_issue_date,remarks,is_disabled,is_minority,job_card_verified_date,status")
              .eq("village_council_id", tenantId).order("source_record_key").range(offset, offset + 999);
            if (error) throw error;
            existingApplicants.push(...(data || []));
            if (!data || data.length < 1000) break;
          }
          const cardMap = new Map(existingCards.map(row => [row.job_card_number, row]));
          const applicantMap = new Map(existingApplicants.map(row => [row.source_record_key, row]));
          const sourceKeys = new Set(parsed.rows.map(row => String(row.source_record_key)));
          const sourceCards = new Map<string,string>();
          const activeCardNumbers = new Set<string>();
          for (const row of parsed.rows) {
            sourceCards.set(String(row.job_card_number), String(row.head_of_household));
            if (row.status === "active") activeCardNumbers.add(String(row.job_card_number));
          }
          let newCards = 0, changedCards = 0, newApplicants = 0, changedApplicants = 0, unchangedApplicants = 0;
          for (const [number, household] of sourceCards) {
            const old = cardMap.get(number);
            if (!old) newCards++;
            else if (old.head_of_household !== household) changedCards++;
          }
          const compareFields = ["applicant_name","caste","father_husband_name","gender","age","application_received_date","job_card_issue_date","remarks","is_disabled","is_minority","job_card_verified_date","status"];
          for (const row of parsed.rows) {
            const old = applicantMap.get(String(row.source_record_key));
            if (!old) newApplicants++;
            else if (compareFields.some(field => String(old[field] ?? "") !== String(row[field] ?? ""))) changedApplicants++;
            else unchangedApplicants++;
          }
          const missingApplicants = existingApplicants.filter(row => row.status === "active" && !sourceKeys.has(row.source_record_key)).length;
          const missingCards = existingCards.filter(row => row.status === "active" && !sourceCards.has(row.job_card_number)).length;
          const inactiveJobCards = [...sourceCards.keys()].filter(number => !activeCardNumbers.has(number)).length;
          const { data: batch, error: batchError } = await adminClient.from("council_register_import_batches").insert({
            village_council_id: tenantId,
            source: "official_registration_register",
            source_location_key: [council.state,council.district,council.block,council.village].join(" | "),
            status: "processing",
            imported_by: userData.user.id,
            total_rows: parsed.rows.length,
          }).select("id").single();
          if (batchError) throw batchError;
          try {
            for (let offset = 0; offset < parsed.rows.length; offset += 200) {
              const payload = parsed.rows.slice(offset, offset + 200).map((row, index) => ({
                village_council_id: tenantId,
                import_batch_id: batch.id,
                row_number: Number(row.source_row_number) || offset + index + 1,
                row_data: row,
              }));
              const { error } = await adminClient.from("council_register_import_rows").insert(payload);
              if (error) throw error;
            }
            const { count: stagedCount, error: countError } = await adminClient.from("council_register_import_rows")
              .select("row_number", { count: "exact", head: true })
              .eq("import_batch_id", batch.id).eq("village_council_id", tenantId);
            if (countError) throw countError;
            validation.stagedRowsMatch = stagedCount === parsed.rows.length;
            if (!validation.stagedRowsMatch) {
              throw new Error("Staging row-count verification failed. Expected " + parsed.rows.length + " rows but stored " + String(stagedCount) + ".");
            }
            const { error: finishError } = await adminClient.from("council_register_import_batches")
              .update({ status: "pending", error_message: null }).eq("id", batch.id).eq("village_council_id", tenantId);
            if (finishError) throw finishError;
          } catch (error) {
            await adminClient.from("council_register_import_rows").delete().eq("import_batch_id", batch.id);
            await adminClient.from("council_register_import_batches").update({
              status: "failed", completed_at: new Date().toISOString(),
              error_message: error instanceof Error ? error.message.slice(0,1000) : "Staging failed",
            }).eq("id", batch.id);
            throw error;
          }
          reportInspection.preview = {
            batchId: batch.id, status: "pending_review",
            sourceTable: parsed.tableIndex + 1, sourceRows: parsed.sourceRowCount,
            stagedRows: parsed.rows.length, activeApplicants: parsed.active.length,
            deletedApplicants: parsed.deletedCount, inactiveJobCards,
            sourceDeletedApplicants: parsed.deletedCount,
            existingJobCards: existingCards.length, newJobCards: newCards, changedJobCards: changedCards,
            existingApplicants: existingApplicants.length, newApplicants, changedApplicants,
            unchangedApplicants, missingApplicants, missingJobCards: missingCards,
            sample: parsed.rows.slice(0, 8).map(row => ({
              jobCardNumber: row.job_card_number, headOfHousehold: row.head_of_household,
              applicantNumber: row.applicant_number, applicantName: row.applicant_name,
            })),
            activation: "Not activated. Existing Job Cards and applicants were not modified.",
          };
        }
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
      note: action === "prepare-preview"
        ? "All source applicants, including deleted applicants, were parsed and staged for review. Job Cards with no active applicants are retained as inactive. Canonical records were not activated or modified."
        : "Read-only discovery and report structure inspection. Applicant records were not returned or saved.",
    }, 200, origin);
  } catch (error) {
    return reply({ success: false, error: "Could not inspect the official registration register: " + (error instanceof Error ? error.message : String(error)), dataChanged: false }, 502, origin);
  }
});
