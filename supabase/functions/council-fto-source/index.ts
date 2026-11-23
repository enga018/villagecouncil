import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://villagecouncil.enga.in", "https://enga018.github.io"]);
const GOVERNMENT_HOSTS = new Set(["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"]);
const DETAIL_PATH = "/vbgramg/fto/fto_trasction_dtl.aspx";

type PortalPage = { html: string; url: string; status: number; contentType: string };
type Control = { kind: "link" | "postback"; label: string; href?: string; target?: string; argument?: string; inputName?: string; inputValue?: string };
type Candidate = { detailUrl: string; listingRow: string[]; listingHeaders: string[]; ftoNumber: string };

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://villagecouncil.enga.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function reply(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
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
function attributes(source: string) {
  const result: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const m of source.matchAll(pattern)) result[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? "");
  return result;
}
function safeGovernmentUrl(raw: string, base: string) {
  const url = new URL(decodeHtml(raw), base);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported Government navigation URL scheme.");
  if (!GOVERNMENT_HOSTS.has(url.hostname.toLowerCase())) throw new Error("A discovered link points outside the official VBGRAMG hosts.");
  url.protocol = "https:";
  return url.href;
}
type Jar = Map<string, Map<string, string>>;
function jarFor(jars: Jar, hostname: string) {
  let jar = jars.get(hostname);
  if (!jar) { jar = new Map<string, string>(); jars.set(hostname, jar); }
  return jar;
}
function absorbCookies(headers: Headers, responseUrl: string, jars: Jar) {
  const host = new URL(responseUrl).hostname;
  const jar = jarFor(jars, host);
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  for (const value of values) {
    const pair = value.split(";", 1)[0].trim(), eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
function cookieHeader(jars: Jar, hostname: string) {
  return [...jarFor(jars, hostname).entries()].map(([k, v]) => k + "=" + v).join("; ");
}
const baseHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Upgrade-Insecure-Requests": "1",
};
async function requestPage(jars: Jar, pageUrl: string, referer: string): Promise<PortalPage> {
  const target = new URL(pageUrl);
  if (!GOVERNMENT_HOSTS.has(target.hostname)) throw new Error("Refusing to fetch a non-Government URL.");
  target.protocol = "https:";
  const cookies = cookieHeader(jars, target.hostname);
  const response = await fetch(target.href, {
    method: "GET", redirect: "follow",
    headers: { ...baseHeaders, ...(cookies ? { Cookie: cookies } : {}), Referer: referer },
    signal: AbortSignal.timeout(25000),
  });
  absorbCookies(response.headers, response.url || target.href, jars);
  if (!response.ok) throw new Error("VBGRAMG returned HTTP " + response.status + " at " + target.pathname + ".");
  const contentType = response.headers.get("content-type") || "";
  if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) throw new Error("VBGRAMG returned a non-HTML response at " + target.pathname + ".");
  const html = await response.text();
  if (!html.trim() || !/<html[\s>]/i.test(html)) throw new Error("VBGRAMG returned invalid HTML at " + target.pathname + ".");
  const finalUrl = new URL(response.url || target.href);
  if (!GOVERNMENT_HOSTS.has(finalUrl.hostname)) throw new Error("VBGRAMG redirected outside the official Government hosts.");
  return { html, url: finalUrl.href, status: response.status, contentType };
}
function buildPostbackBody(html: string, target: string, argument: string, inputName?: string, inputValue?: string) {
  const formMatch = html.match(/<form\b[^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) throw new Error("The Government page did not contain an ASP.NET form for the selected link.");
  const params = new URLSearchParams();
  const form = formMatch[1];
  for (const m of form.matchAll(/<input\b([^>]*)>/gi)) {
    const attr = attributes(m[1]);
    if (!attr.name) continue;
    const type = (attr.type || "text").toLowerCase();
    if (["submit", "button", "image", "file", "reset"].includes(type)) continue;
    if (["checkbox", "radio"].includes(type) && !/\bchecked\b/i.test(m[1])) continue;
    params.set(attr.name, attr.value || "");
  }
  for (const m of form.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const attr = attributes(m[1]);
    if (attr.name) params.set(attr.name, cleanText(m[2]));
  }
  for (const m of form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attr = attributes(m[1]);
    if (!attr.name) continue;
    const options = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
    const selected = options.find(option => /\bselected\b/i.test(option[1])) || options[0];
    if (selected) params.set(attr.name, attributes(selected[1]).value || cleanText(selected[2]));
  }
  if (inputName) params.set(inputName, inputValue || "");
  params.set("__EVENTTARGET", target);
  params.set("__EVENTARGUMENT", argument);
  return params;
}
function controlFromMarkup(href: string, onclick: string, label: string, pageUrl: string): Control | null {
  const raw = href + " " + onclick;
  const postback = raw.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
  if (postback) return { kind: "postback", label, target: postback[1], argument: postback[2] };
  const scriptedUrl = raw.match(/(?:window\.open|window\.location(?:\.href)?|location(?:\.href)?)\s*(?:\(\s*|=\s*)['"]([^'"]+)['"]/i);
  if (scriptedUrl) return { kind: "link", label, href: safeGovernmentUrl(scriptedUrl[1], pageUrl) };
  if (href && !/^javascript:/i.test(href) && href !== "#") {
    return { kind: "link", label, href: safeGovernmentUrl(href, pageUrl) };
  }
  return null;
}
function findTextControl(html: string, pageUrl: string, matcher: RegExp): Control | null {
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attr = attributes(m[1]), label = cleanText(m[2]);
    if (!matcher.test(label)) continue;
    const control = controlFromMarkup(attr.href || "", attr.onclick || "", label, pageUrl);
    if (control) return control;
  }
  for (const m of html.matchAll(/<(?:input|button)\b([^>]*)>(?:([\s\S]*?)<\/button>)?/gi)) {
    const attr = attributes(m[1]), label = cleanText(m[2] || attr.value || attr.title || "");
    if (!matcher.test(label)) continue;
    const control = controlFromMarkup(attr.href || "", attr.onclick || "", label, pageUrl);
    if (control) return control;
    if (attr.name && attr.value) return { kind: "postback", label, target: "", argument: "", inputName: attr.name, inputValue: attr.value };
  }
  return null;
}
async function activateControl(jars: Jar, page: PortalPage, control: Control): Promise<PortalPage> {
  if (control.kind === "link" && control.href) return await requestPage(jars, control.href, page.url);
  const formMatch = page.html.match(/<form\b([^>]*)>/i);
  const actionRaw = formMatch ? attributes(formMatch[1]).action : "";
  const action = safeGovernmentUrl(actionRaw || page.url, page.url);
  const body = buildPostbackBody(page.html, control.target || "", control.argument || "", control.inputName, control.inputValue);
  const host = new URL(action).hostname, cookies = cookieHeader(jars, host);
  const response = await fetch(action, {
    method: "POST", redirect: "follow",
    headers: { ...baseHeaders, ...(cookies ? { Cookie: cookies } : {}), Referer: page.url, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(), signal: AbortSignal.timeout(25000),
  });
  absorbCookies(response.headers, response.url || action, jars);
  if (!response.ok) throw new Error("VBGRAMG postback returned HTTP " + response.status + ".");
  const contentType = response.headers.get("content-type") || "";
  if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) throw new Error("VBGRAMG postback did not return HTML.");
  const html = await response.text(), finalUrl = response.url || action;
  if (!/<html[\s>]/i.test(html)) throw new Error("VBGRAMG postback returned invalid HTML.");
  if (!GOVERNMENT_HOSTS.has(new URL(finalUrl).hostname)) throw new Error("VBGRAMG postback redirected outside the official Government hosts.");
  return { html, url: finalUrl, status: response.status, contentType };
}
function cacheNavigationData(control: Control | null, parentNavigation?: Record<string, unknown> | null, contextData?: Record<string, unknown> | null) {
  return {
    label: control?.label || "Direct Government navigation",
    mode: control?.kind || "direct",
    href: control?.kind === "link" ? control.href : null,
    inputName: control?.inputName || null,
    inputValue: control?.inputValue || null,
    parentNavigation: parentNavigation || null,
    ...(contextData || {}),
  };
}
async function saveSharedNavigation(admin: any, values: {
  districtId: string; blockId: string | null; type: "fto_status" | "first_signatory_list";
  url: string; control: Control | null; parentNavigation?: Record<string, unknown> | null; contextData?: Record<string, unknown> | null;
}) {
  const filters = admin.from("shared_fto_navigation").select("id")
    .eq("district_id", values.districtId).eq("navigation_type", values.type).eq("is_active", true);
  const { data: existing, error: lookupError } = await (values.blockId
    ? filters.eq("block_id", values.blockId).maybeSingle()
    : filters.is("block_id", null).maybeSingle());
  if (lookupError) throw new Error("Could not read the shared FTO navigation cache: " + lookupError.message);
  const record = {
    district_id: values.districtId,
    block_id: values.blockId,
    navigation_type: values.type,
    navigation_url: values.url,
    control_target: values.control?.kind === "postback" ? values.control.target || "" : null,
    control_argument: values.control?.kind === "postback" ? values.control.argument || "" : null,
    navigation_data: cacheNavigationData(values.control, values.parentNavigation, values.contextData),
    verified_at: new Date().toISOString(),
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  const write = existing?.id
    ? await admin.from("shared_fto_navigation").update(record).eq("id", existing.id)
    : await admin.from("shared_fto_navigation").insert(record);
  if (write.error) throw new Error("Could not save the shared FTO navigation link: " + write.error.message);
}
async function openCachedNavigation(jars: Jar, record: any, referer: string): Promise<PortalPage> {
  const parentNavigation = record.navigation_data?.parentNavigation;
  let parent = await requestPage(jars, parentNavigation?.url || record.navigation_url, referer);
  if (parentNavigation?.mode === "postback") {
    const parentControl: Control = {
      kind: "postback",
      label: String(parentNavigation.label || "Saved parent navigation"),
      target: String(parentNavigation.control_target || ""),
      argument: String(parentNavigation.control_argument || ""),
      inputName: parentNavigation.inputName || undefined,
      inputValue: parentNavigation.inputValue || undefined,
    };
    parent = await activateControl(jars, parent, parentControl);
  }
  if (record.navigation_data?.mode !== "postback") return parent;
  const control: Control = {
    kind: "postback",
    label: String(record.navigation_data?.label || "Saved Government navigation"),
    target: String(record.control_target || ""),
    argument: String(record.control_argument || ""),
    inputName: record.navigation_data?.inputName || undefined,
    inputValue: record.navigation_data?.inputValue || undefined,
  };
  return await activateControl(jars, parent, control);
}
function normalizeName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
type GridCell = { text: string; inner: string; tag: string; attrs: Record<string, string> };
function expandedTable(table: string): GridCell[][] {
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const grid: GridCell[][] = [];
  for (let r = 0; r < rows.length; r++) {
    grid[r] ||= [];
    let col = 0;
    const cells = [...rows[r][1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)];
    for (const cellMatch of cells) {
      while (grid[r][col]) col++;
      const attrs = attributes(cellMatch[2]);
      const colspan = Math.max(1, Math.min(20, Number(attrs.colspan || 1)));
      const rowspan = Math.max(1, Math.min(20, Number(attrs.rowspan || 1)));
      const cell: GridCell = { text: cleanText(cellMatch[3]), inner: cellMatch[3], tag: cellMatch[1].toLowerCase(), attrs };
      for (let rr = r; rr < r + rowspan; rr++) {
        grid[rr] ||= [];
        for (let cc = col; cc < col + colspan; cc++) grid[rr][cc] = cell;
      }
      col += colspan;
    }
  }
  return grid;
}
function findBlockSignedCountControl(html: string, pageUrl: string, blockName: string) {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[1]);
  const target = normalizeName(blockName);
  for (const table of tables) {
    const grid = expandedTable(table);
    const blockRowIndex = grid.findIndex(row => row.some(cell => cell && normalizeName(cell.text) === target));
    if (blockRowIndex < 0) continue;
    const blockRow = grid[blockRowIndex];
    const width = Math.max(...grid.map(row => row.length));
    const headerRows = grid.slice(0, blockRowIndex);
    const headerPath = (col: number) => headerRows.map(row => row[col]?.text || "").filter(Boolean).join(" ").toLowerCase();
    const blockCol = Array.from({ length: width }, (_, i) => i).find(i => /\bblock\b/.test(headerPath(i)));
    const signatoryCols = Array.from({ length: width }, (_, i) => i)
      .filter(i => /(?:first|1st)\s+signatory/.test(headerPath(i)));
    const signedCol = signatoryCols.find(i => {
      const path = headerPath(i);
      return /signed\s+fto|fto\s+signe?d|no\.?\s*of\s*signed\s*fto|number\s+of\s+signed\s*fto/.test(path);
    });
    const fallbackCols = signatoryCols.length ? signatoryCols : Array.from({ length: width }, (_, i) => i)
      .filter(i => i > (blockCol ?? -1));
    const candidateCols = signedCol !== undefined ? [signedCol] : fallbackCols
      .filter(i => /<a\b/i.test(blockRow[i]?.inner || "") && /^\d[\d,]*$/.test(blockRow[i]?.text || ""));
    for (const col of candidateCols) {
      const cell = blockRow[col];
      if (!cell) continue;
      const anchor = cell.inner.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
      if (!anchor) continue;
      const attr = attributes(anchor[1]), label = cleanText(anchor[2]);
      if (!/^\d[\d,]*$/.test(label)) continue;
      const control = controlFromMarkup(attr.href || "", attr.onclick || "", label, pageUrl);
      if (control) return { control, count: Number(label.replace(/,/g, "")), blockRow: blockRow.map(c => c?.text || ""), blockColumn: blockCol ?? null, signedCountColumn: col, headers: Array.from({ length: width }, (_, i) => headerPath(i)) };
    }
    // Some GridViews place a numeric link in a child table or wrap the cell in a control.
    const rowInner = blockRow.map(c => c?.inner || "").join(" ");
    const fallback = rowInner.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (fallback) {
      const label = cleanText(fallback[2]), attr = attributes(fallback[1]);
      const control = controlFromMarkup(attr.href || "", attr.onclick || "", label, pageUrl);
      if (control && /^\d[\d,]*$/.test(label)) return { control, count: Number(label.replace(/,/g, "")), blockRow: blockRow.map(c => c?.text || ""), blockColumn: blockCol ?? null, signedCountColumn: null, headers: [] };
    }
  }
  throw new Error("Could not find the First Signatory signed-FTO count for Block '" + blockName + "' in the FTO Status table.");
}
function findFtoStatusControl(html: string, pageUrl: string) {
  const control = findTextControl(html, pageUrl, /^\s*fto\s+status\s*$/i);
  if (control) return control;
  return findTextControl(html, pageUrl, /\bfto\s+status\b/i);
}
function isFirstSignatoryListing(html: string) {
  return /fto\s+first\s+signatory/i.test(cleanText(html));
}
function discoverCandidates(html: string, baseUrl: string): Candidate[] {
  const candidates: Candidate[] = [], seen = new Set<string>();
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const cellValues = (rowHtml: string) => [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => cleanText(cell[1]));
    for (let index = 0; index < rows.length; index++) {
      const rowHtml = rows[index][1];
      const hrefMatch = rowHtml.match(/<a\b[^>]*href\s*=\s*["']([^"']*fto_trasction_dtl\.aspx\?payload=[^"']+)["'][^>]*>/i);
      if (!hrefMatch) continue;
      let detailUrl: string;
      try { detailUrl = safeGovernmentUrl(hrefMatch[1], baseUrl); } catch { continue; }
      const parsed = new URL(detailUrl);
      if (parsed.pathname.toLowerCase() !== DETAIL_PATH) continue;
      if (seen.has(detailUrl)) continue;
      seen.add(detailUrl);
      const listingRow = cellValues(rowHtml);
      let listingHeaders: string[] = [];
      for (let prior = index - 1; prior >= 0; prior--) {
        const priorHtml = rows[prior][1];
        if (/<a\b/i.test(priorHtml)) continue;
        const values = cellValues(priorHtml);
        if (values.length === listingRow.length && values.some(value => /[A-Za-z]/.test(value))) {
          listingHeaders = values;
          break;
        }
      }
      candidates.push({ detailUrl, listingRow, listingHeaders, ftoNumber: String(listingRow[3] || "").trim() });
    }
  }
  return candidates;
}
async function makeManifestToken(serviceKey: string, candidates: Candidate[], jobCardNumbers: string[], context: { tenantId: string; districtId: string; blockId: string; batchId: string }) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("COUNCIL-FTO-MANIFEST-v1:" + serviceKey));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = new TextEncoder().encode(JSON.stringify({ v: 1, exp: Date.now() + 45 * 60 * 1000, context, candidates, jobCardNumbers }));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, clear));
  const bytes = new Uint8Array(iv.length + encrypted.length);
  bytes.set(iv); bytes.set(encrypted, iv.length);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function loadCouncilJobCards(admin: any, tenantId: string) {
  const numbers = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from("council_job_cards")
      .select("job_card_number")
      .eq("village_council_id", tenantId)
      .order("job_card_number", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error("Could not load the Village Council Job Card register: " + error.message);
    for (const row of data || []) {
      const number = String(row.job_card_number || "").trim().toUpperCase();
      if (number) numbers.add(number);
    }
    if (!data || data.length < 1000) break;
  }
  if (!numbers.size) throw new Error("The Village Council has no registered Job Cards. Import the Job Card register before fetching FTO details.");
  return [...numbers];
}

async function main(req: Request, origin: string | null) {
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
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply({ error: "Invalid or expired session." }, 401, origin);
  const { data: membership, error: membershipError } = await admin.from("council_memberships")
    .select("village_council_id").eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
  if (membershipError) return reply({ error: "Unable to verify Village Council access." }, 500, origin);
  if (!membership) return reply({ error: "An active Village Council assignment is required." }, 403, origin);
  const { data: council, error: councilError } = await admin.from("council_tenants")
    .select("id,location_panchayat_id,is_active").eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
  if (councilError || !council?.location_panchayat_id) return reply({ error: "The assigned Village Council has no canonical Panchayat location." }, 409, origin);
  const { data: panchayat, error: panchayatError } = await admin.from("location_panchayats")
    .select("id,official_name,block_id").eq("id", council.location_panchayat_id).eq("is_active", true).maybeSingle();
  if (panchayatError || !panchayat?.block_id) return reply({ error: "The Village Council Panchayat location is incomplete." }, 409, origin);
  const { data: block, error: blockError } = await admin.from("location_blocks")
    .select("id,official_name,district_id").eq("id", panchayat.block_id).eq("is_active", true).maybeSingle();
  if (blockError || !block?.district_id) return reply({ error: "The Village Council Block location is incomplete." }, 409, origin);
  const { data: district, error: districtError } = await admin.from("location_districts")
    .select("id,official_name,navigation_url").eq("id", block.district_id).eq("is_active", true).maybeSingle();
  if (districtError || !district?.navigation_url) return reply({ error: "The shared District navigation URL is unavailable." }, 409, origin);

  const jars: Jar = new Map();
  const navigation: Record<string, unknown>[] = [];
  let ftoStatusPage: PortalPage | null = null;
  let ftoStatusControl: Control | null = null;
  let ftoStatusParentNavigation: Record<string, unknown> | null = null;
  const { data: cachedStatus, error: cachedStatusError } = await admin.from("shared_fto_navigation")
    .select("navigation_url,control_target,control_argument,navigation_data")
    .eq("district_id", district.id).eq("navigation_type", "fto_status").eq("is_active", true).maybeSingle();
  if (cachedStatusError) return reply({ error: "Could not read the shared District FTO link." }, 500, origin);
  if (cachedStatus) {
    try {
      ftoStatusPage = await openCachedNavigation(jars, cachedStatus, district.navigation_url);
      if (cachedStatus.navigation_data?.mode === "postback") {
        ftoStatusParentNavigation = {
          mode: "postback",
          url: district.navigation_url,
          control_target: cachedStatus.control_target,
          control_argument: cachedStatus.control_argument,
          label: cachedStatus.navigation_data?.label || "Saved FTO Status",
          inputName: cachedStatus.navigation_data?.inputName || null,
          inputValue: cachedStatus.navigation_data?.inputValue || null,
        };
      }
      if (!/fto\s+status/i.test(cleanText(ftoStatusPage.html))) throw new Error("Cached link did not open the FTO Status report.");
      navigation.push({ step: "fto_status", source: "shared_cache", path: new URL(ftoStatusPage.url).pathname });
    } catch {
      ftoStatusPage = null;
      ftoStatusParentNavigation = null;
    }
  }
  if (!ftoStatusPage) {
    const districtPage = await requestPage(jars, district.navigation_url, "https://vbgramg.dord.gov.in/");
    navigation.push({ step: "district", source: "location_districts.navigation_url", path: new URL(districtPage.url).pathname });
    ftoStatusControl = findFtoStatusControl(districtPage.html, districtPage.url);
    if (!ftoStatusControl) return reply({ success: false, error: "The FTO Status link was not found on the saved District page.", navigation }, 502, origin);
    ftoStatusPage = await activateControl(jars, districtPage, ftoStatusControl);
    if (ftoStatusControl.kind === "postback") {
      ftoStatusParentNavigation = {
        mode: "postback",
        url: districtPage.url,
        control_target: ftoStatusControl.target || "",
        control_argument: ftoStatusControl.argument || "",
        label: ftoStatusControl.label,
        inputName: ftoStatusControl.inputName || null,
        inputValue: ftoStatusControl.inputValue || null,
      };
    }
    if (!/fto\s+status/i.test(cleanText(ftoStatusPage.html))) {
      throw new Error("The selected District link did not open a page validated as FTO Status.");
    }
    const savedUrl = ftoStatusControl.kind === "link" ? ftoStatusControl.href! : districtPage.url;
    await saveSharedNavigation(admin, { districtId: district.id, blockId: null, type: "fto_status", url: savedUrl, control: ftoStatusControl });
    navigation.push({ step: "fto_status", source: "discovered_and_saved", label: ftoStatusControl.label, path: new URL(ftoStatusPage.url).pathname });
  }

  let listingPage: PortalPage | null = null;
  let listControl: Control | null = null;
  let selectedBlockLink: ReturnType<typeof findBlockSignedCountControl> | null = null;
  try {
    selectedBlockLink = findBlockSignedCountControl(ftoStatusPage.html, ftoStatusPage.url, block.official_name);
  } catch {
    selectedBlockLink = null;
  }
  const { data: cachedList, error: cachedListError } = await admin.from("shared_fto_navigation")
    .select("navigation_url,control_target,control_argument,navigation_data")
    .eq("district_id", district.id).eq("block_id", block.id)
    .eq("navigation_type", "first_signatory_list").eq("is_active", true).maybeSingle();
  if (cachedListError) return reply({ error: "Could not read the shared Block First Signatory link." }, 500, origin);
  if (cachedList) {
    try {
      if (cachedList.navigation_data?.blockName && normalizeName(String(cachedList.navigation_data.blockName)) !== normalizeName(block.official_name)) {
        throw new Error("Cached First Signatory link belongs to a different Block.");
      }
      if (selectedBlockLink) {
        const currentControl = selectedBlockLink.control;
        const expectedUrl = currentControl.kind === "link"
          ? currentControl.href
          : (ftoStatusParentNavigation?.url as string | undefined) || ftoStatusPage.url;
        const expectedMode = currentControl.kind;
        const cachedParent = cachedList.navigation_data?.parentNavigation;
        const parentMatches = currentControl.kind !== "postback"
          ? !cachedParent
          : !ftoStatusParentNavigation
            ? !cachedParent
            : cachedParent?.mode === "postback" &&
              cachedParent?.url === ftoStatusParentNavigation.url &&
              cachedParent?.control_target === ftoStatusParentNavigation.control_target &&
              cachedParent?.control_argument === ftoStatusParentNavigation.control_argument;
        const controlMatches = cachedList.navigation_data?.mode === expectedMode &&
          cachedList.navigation_url === expectedUrl &&
          (currentControl.kind !== "postback" ||
            (String(cachedList.control_target || "") === String(currentControl.target || "") &&
             String(cachedList.control_argument || "") === String(currentControl.argument || ""))) &&
          parentMatches;
        if (!controlMatches) throw new Error("The saved First Signatory link no longer matches the selected Block's signed-FTO count.");
      }
      listingPage = await openCachedNavigation(jars, cachedList, ftoStatusPage.url);
      if (!isFirstSignatoryListing(listingPage.html)) throw new Error("Cached link did not open the First Signatory listing for this Block.");
      navigation.push({ step: "first_signatory_list", source: "shared_cache", path: new URL(listingPage.url).pathname });
    } catch {
      listingPage = null;
    }
  }
  if (!listingPage) {
    const selected = selectedBlockLink || findBlockSignedCountControl(ftoStatusPage.html, ftoStatusPage.url, block.official_name);
    listControl = selected.control;
    listingPage = await activateControl(jars, ftoStatusPage, listControl);
    if (!isFirstSignatoryListing(listingPage.html)) {
      throw new Error("The signed-FTO count for Block '" + block.official_name + "' did not open a validated First Signatory listing for that Block.");
    }
    const savedUrl = listControl.kind === "link"
      ? listControl.href!
      : (ftoStatusParentNavigation?.url as string | undefined) || ftoStatusPage.url;
    await saveSharedNavigation(admin, {
      districtId: district.id, blockId: block.id, type: "first_signatory_list",
      url: savedUrl, control: listControl,
      parentNavigation: listControl.kind === "postback" ? ftoStatusParentNavigation : null,
      contextData: { blockName: block.official_name, signedFtoCount: selected.count },
    });
    navigation.push({ step: "first_signatory_list", source: "discovered_and_saved", block: block.official_name, signedFtoCount: selected.count, path: new URL(listingPage.url).pathname });
  }

  const pageText = cleanText(listingPage.html);
  if (!isFirstSignatoryListing(listingPage.html)) {
    throw new Error("The Government response is not the First Signatory FTO listing for the selected Block.");
  }
  const candidates = discoverCandidates(listingPage.html, listingPage.url);
  if (!candidates.length) throw new Error("No valid FTO transaction-detail links were found in the First Signatory listing.");
  const numbers = candidates.map(item => item.ftoNumber).filter(Boolean);
  if (numbers.length !== candidates.length) throw new Error("One or more FTO numbers could not be parsed from the First Signatory listing. No import batch was created.");
  const uniqueNumbers = new Set(numbers.map(value => value.toUpperCase()));
  if (uniqueNumbers.size !== numbers.length) throw new Error("The First Signatory listing contains duplicate or ambiguous FTO numbers.");
  const jobCardNumbers = await loadCouncilJobCards(admin, council.id);
  const fingerprintBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(candidates.map(item => item.detailUrl).join("\n")));
  const fingerprint = [...new Uint8Array(fingerprintBytes)].map(value => value.toString(16).padStart(2, "0")).join("");
  const { data: importBatch, error: importBatchError } = await admin.from("council_fto_import_batches").insert({
    village_council_id: council.id,
    source: "official_fto_register",
    source_location_key: [district.official_name, block.official_name, panchayat.official_name].join(" | "),
    status: "processing",
    imported_by: userData.user.id,
    total_rows: candidates.length,
  }).select("id").single();
  if (importBatchError || !importBatch) throw new Error("Could not create the FTO discovery batch: " + (importBatchError?.message || "Unknown database error."));
  const manifestToken = await makeManifestToken(secretKey, candidates, jobCardNumbers, {
    tenantId: council.id, districtId: district.id, blockId: block.id, batchId: importBatch.id,
  });
  return reply({
    success: true,
    source: "official_vbgramg_first_signatory",
    councilLocation: { district: district.official_name, block: block.official_name, panchayat: panchayat.official_name },
    navigation,
    sharedLinks: { districtFtoStatusSaved: true, blockFirstSignatorySaved: true },
    batchId: importBatch.id,
    listing: {
      title: cleanText(listingPage.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""),
      ftoCount: candidates.length,
      uniqueFtoCount: uniqueNumbers.size,
      jobCardSnapshotCount: jobCardNumbers.length,
      ftoNumbers: numbers,
      listingFingerprint: fingerprint,
      manifestToken,
      manifestExpiresInSeconds: 2700,
    },
    databaseChanged: true,
    note: "Navigation links were verified and saved as shared District/Block data. A processing batch was opened; no FTO records have been imported. The detail parser and exact Job Card Number village filter run in the next processing step.",
  }, 200, origin);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed." }, 403, origin);
  try {
    return await main(req, origin);
  } catch (error) {
    return reply({ success: false, error: error instanceof Error ? error.message : "FTO source discovery failed." }, 502, origin);
  }
});
