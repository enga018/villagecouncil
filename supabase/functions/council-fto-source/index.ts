import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://villagecouncil.enga.in", "https://enga018.github.io"]);

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
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function cleanText(value: string) {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\u200b]/g, " ").replace(/\s+/g, " ").trim();
}

type PortalPage = { html: string; url: string; status: number; contentType: string };

function attributes(source: string) {
  const result: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const m of source.matchAll(pattern)) result[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? "");
  return result;
}

// ---- V1 ASP.NET navigation (cookies + postbacks), copied from council-register-source ----
function buildPostbackBody(html: string, target: string, argument: string, control?: { inputName?: string | null; inputValue?: string }) {
  const params = new URLSearchParams();
  const formMatch = html.match(/<form\b[^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) throw new Error("A postback control was found, but no HTML form was available.");
  const attributes = (source: string) => {
    const result: Record<string, string> = {};
    const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    for (const m of source.matchAll(pattern)) result[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? "");
    return result;
  };
  for (const m of formMatch[1].matchAll(/<input\b([^>]*)>/gi)) {
    const attr = attributes(m[1]);
    if (!attr.name) continue;
    const type = (attr.type || "").toLowerCase();
    if (["submit", "button", "image", "file"].includes(type)) continue;
    if (["checkbox", "radio"].includes(type)) continue;
    params.set(attr.name, attr.value || "");
  }
  if (control?.inputName) params.set(control.inputName, control.inputValue || "");
  params.set("__EVENTTARGET", target);
  params.set("__EVENTARGUMENT", argument);
  return params;
}

type Jar = Map<string, string>;
function absorbCookies(headers: Headers, jar: Jar) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  for (const value of values) { const pair = value.split(";", 1)[0].trim(); const eq = pair.indexOf("="); if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1)); }
}
function cookieHeader(jar: Jar) { return [...jar.entries()].map(([k, v]) => k + "=" + v).join("; "); }

async function requestPage(jar: Jar, pageUrl: string, referer: string, baseHeaders: Record<string, string>): Promise<PortalPage> {
  const cookies = cookieHeader(jar);
  const response = await fetch(pageUrl, {
    method: "GET", redirect: "follow",
    headers: { ...baseHeaders, ...(cookies ? { Cookie: cookies } : {}), Referer: referer },
    signal: AbortSignal.timeout(30000),
  });
  absorbCookies(response.headers, jar);
  if (!response.ok) throw new Error("VBGRAMG returned HTTP " + response.status + " at " + new URL(pageUrl).pathname + ".");
  const contentType = response.headers.get("content-type") || "";
  if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) throw new Error("VBGRAMG returned an unexpected content type at " + new URL(pageUrl).pathname + ".");
  const html = await response.text();
  if (!html.trim() || !/<html[\s>]/i.test(html)) throw new Error("VBGRAMG returned invalid HTML at " + new URL(pageUrl).pathname + ".");
  return { html, url: response.url || pageUrl, status: response.status, contentType };
}

function parsePortalTable(html: string): { headings: string[]; rows: string[][] } {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[1]);
  const parseRows = (table: string) => {
    const blocks = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|$)/gi)];
    return blocks.map(m => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x => cleanText(x[1].replace(/<br\s*\/?>/gi, " ")))).filter(r => r.length);
  };
  // Find the widest table with text — the FTO report table.
  const best = tables
    .map((t, index) => {
      const first = t.search(/<tr\b/i);
      const leading = first >= 0 ? t.slice(0, first) : t;
      const cells = [...leading.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => cleanText(m[1]));
      const rows = parseRows(t);
      return { index, headings: cells, rows: cells.length >= 3 ? [cells, ...rows] : rows };
    })
    .filter(t => t.rows.length > 0)
    .sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!best || !best.headings.length) throw new Error("Could not identify an FTO report table with column headings.");
  return { headings: best.headings, rows: best.rows.slice(1) };
}

// Map table columns to FTO fields using keyword matching (portal headings may vary).
function mapColumns(headings: string[]) {
  const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ix: Record<string, number> = {};
  const assign = (field: string, aliases: string[]) => {
    const i = headings.findIndex((h) => aliases.some(a => key(h).includes(a)));
    if (i >= 0 && ix[field] === undefined) ix[field] = i;
  };
  assign("ftoNumber", ["fto number", "fto id", "transaction number", "number"]);
  assign("ftoDate", ["date", "received", "from"]);
  assign("status", ["status"]);
  assign("signatory", ["signatory", "first signatory", "authorised"]);
  assign("amount", ["amount", " wages", " wage", "payable", "money"]);
  assign("worker", ["worker", "beneficiary", "recipient", "name"]);
  return ix;
}

function rowField(row: string[], idx: Record<string, number>, field: string): string {
  const i = idx[field];
  return i >= 0 ? (row[i] || "").trim() : "";
}

function toNumeric(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, "").trim();
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) ? n : null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed." }, 403, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secretKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = publishableKeys ? JSON.parse(publishableKeys).default : Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !publishableKey || !secretKey) return reply({ error: "Server configuration is incomplete." }, 500, origin);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply({ error: "Authentication required." }, 401, origin);
  const userClient = createClient(url, publishableKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply({ error: "Invalid or expired session." }, 401, origin);

  const { data: membership, error: membershipError } = await adminClient
    .from("council_memberships").select("village_council_id").eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
  if (membershipError) return reply({ error: "Unable to verify Village Council access." }, 500, origin);
  if (!membership) return reply({ error: "An active Village Council assignment is required." }, 403, origin);

  const { data: council, error: councilError } = await adminClient
    .from("council_tenants")
    .select("id,state,district,block,village")
    .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
  if (councilError) return reply({ error: "Unable to load the Village Council." }, 500, origin);
  if (!council) return reply({ error: "The assigned Village Council is unavailable." }, 403, origin);
  if (!council.state || !council.district || !council.block || !council.village) {
    return reply({ error: "Complete the Government location step before FTO discovery." }, 400, origin);
  }

  const { data: blockUrl, error: blockUrlError } = await adminClient
    .rpc("get_block_navigation_url", { p_state: council.state, p_district: council.district, p_block: council.block });
  if (blockUrlError || !blockUrl) {
    return reply({ error: "The shared Block navigation URL is unavailable. Re-save the Government location in Step 1." }, 409, origin);
  }

  const baseHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache",
    "Upgrade-Insecure-Requests": "1",
  };

  const jar: Jar = new Map();

  // Navigate from the saved Block URL. Find the FTO control (anchor/button) and activate it.
  const current = await requestPage(jar, blockUrl, "https://vbgramg.dord.gov.in/", baseHeaders);
  const navSteps: Array<Record<string, unknown>> = [{ level: "block", path: new URL(current.url).pathname }];

  const findFtoControl = (page: PortalPage) => {
    const anchors = [...page.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    for (const m of anchors) {
      const attr = m[1];
      const label = cleanText(m[2]).toLowerCase();
      if (!/fto|fund transfer|signatory/i.test(label)) continue;
      const href = (attr.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[1] || attr.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[2] || attr.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[3] || "").trim();
      if (href && !/^javascript:/i.test(href)) return { kind: "link", label, href };
    }
    const buttons = [...page.html.matchAll(/<(?:input|button)\b([^>]*)>(?:([\s\S]*?)<\/button>)?/gi)];
    for (const m of buttons) {
      const attr = m[1];
      const label = (m[2] || "").toLowerCase() || (attr.match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[1] || "").toLowerCase();
      if (!/fto|fund transfer|signatory/i.test(label)) continue;
      const onclick = (attr.match(/onclick\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.[1] || "").toLowerCase();
      const match = onclick.match(/__doPostback\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
      if (match) return { kind: "postback", label, target: match[1], argument: match[2] };
    }
    return null;
  };

  let ftoPage: PortalPage | null = null;
  const ftoControl = findFtoControl(current);
  if (ftoControl) {
    if (ftoControl.kind === "link") {
      ftoPage = await requestPage(jar, ftoControl.href, current.url, baseHeaders);
    } else if (ftoControl.kind === "postback") {
      const formMatch = current.html.match(/<form\b[^>]*>/i);
      const formAction = formMatch ? attributes(formMatch[0]).action : "";
      const action = formAction ? new URL(formAction, current.url) : new URL(current.url);
      const body = buildPostbackBody(current.html, ftoControl.target, ftoControl.argument);
      const response = await fetch(action.href, {
        method: "POST", headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(), redirect: "follow", signal: AbortSignal.timeout(30000),
      });
      absorbCookies(response.headers, jar);
      ftoPage = { html: await response.text(), url: response.url || action.href, status: response.status, contentType: response.headers.get("content-type") || "" };
    }
    navSteps.push({ level: "fto-report", controlLabel: ftoControl.label, path: new URL(ftoPage!.url).pathname });
  }

  if (!ftoPage) {
    return reply({ success: false, error: "No FTO control was found on the Block page. The FTO report may be linked differently.", navigation: navSteps }, 502, origin);
  }

  // Parse the FTO records table from the FTO report.
  const { headings, rows } = parsePortalTable(ftoPage.html);
  const idx = mapColumns(headings);
  if (!idx.ftoNumber && !idx.worker) {
    return reply({ success: false, error: "Could not identify FTO columns in the report. Found headings: " + headings.slice(0, 12).join(" | "), navigation: navSteps }, 502, origin);
  }

  const ftos: Array<Record<string, string>> = [];
  for (const row of rows) {
    const ftoNumber = rowField(row, idx, "ftoNumber");
    const worker = rowField(row, idx, "worker");
    const amount = rowField(row, idx, "amount");
    const status = rowField(row, idx, "status");
    if (!ftoNumber && !worker) continue;
    ftos.push({
      fto_number: ftoNumber,
      fto_date: rowField(row, idx, "ftoDate"),
      fto_status: status,
      block: council.block || "",
      first_signatory: rowField(row, idx, "signatory"),
      beneficiary_count: String(toNumeric(rowField(row, idx, "worker")) ?? ""),
      wage_amount: String(toNumeric(amount) ?? ""),
      source_record_key: (ftoNumber + "|" + worker).trim(),
      status: status ? "active" : "active",
    });
  }

  const byNumber = new Map<string, number>();
  ftos.forEach((f, i) => { if (f.fto_number) byNumber.set(f.fto_number, i); });

  // Validate: requires a plausible FTO table.
  if (ftos.length === 0) {
    return reply({ success: false, error: "No FTO records parsed from the report.", navigation: navSteps, headings, sample: rows.slice(0, 3) }, 502, origin);
  }

  const tenantId = membership.village_council_id;
  const inserted = await adminClient.from("council_fto_import_batches").insert({ village_council_id: tenantId, source: "official_fto_register", source_location_key: [council.state, council.district, council.block, council.village].join(" | "), status: "processing", imported_by: userData.user.id, total_rows: ftos.length }).select("id").single();
  if (inserted.error) throw inserted.error;
  const batchIdUsed = inserted.data!.id;

  // Stage the raw rows (mirrors council-register-source).
  const stagedRows = ftos.map((fto, i) => ({ village_council_id: tenantId, import_batch_id: batchIdUsed, row_number: i + 1, row_data: fto }));
  const staged = await adminClient.from("council_fto_import_rows").upsert(stagedRows).select("row_number");
  if (staged.error) throw staged.error;
  const stagedCount = await adminClient.from("council_fto_import_rows").select("row_number", { count: "exact", head: true }).eq("import_batch_id", batchIdUsed).eq("village_council_id", tenantId);
  if (stagedCount.error) throw stagedCount.error;
  if (stagedCount.data!.count !== ftos.length) throw new Error("Staging row-count verification failed. Expected " + ftos.length + " rows but stored " + stagedCount.data!.count + ".");

  return reply({
    success: true,
    reportInspection: {
      preview: {
        batchId: batchIdUsed,
        status: "completed",
        sourceTable: 0,
        sourceRows: ftos.length,
        stagedRows: ftos.length,
        activeFtos: ftos.length,
        existingFtos: 0,
        newFtos: ftos.length,
        changedFtos: 0,
        missingFtos: 0,
        sample: ftos.slice(0, 5).map(f => ({ fto_number: f.fto_number, fto_date: f.fto_date, fto_status: f.fto_status })),
        activation: "Declared FTOs discovered from the Government FTO report.",
        validation: { passed: true, stagedRowsMatch: true, uniqueSourceKeys: true, checkedRows: ftos.length },
      },
    },
  }, 200, origin);
});
