import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://villagecouncil.enga.in", "https://enga018.github.io"]);
const ALLOWED_HOSTS = new Set(["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"]);
const MAX_HTML_BYTES = 5_000_000;

function response(body: Record<string, unknown>, status: number, origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://villagecouncil.enga.in";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Cache-Control": "no-store",
    },
  });
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

function textOnly(value: string) {
  return decodeHtml(value.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\u200b]/g, " ").replace(/\s+/g, " ").trim();
}

function safePortalUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "https:" || !url.hostname || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

type CookieJar = Map<string, string>;

function absorbCookies(headers: Headers, jar: CookieJar) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie") || ""];
  for (const value of values) {
    const pair = value.split(";", 1)[0].trim();
    const equals = pair.indexOf("=");
    if (equals > 0) jar.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
}

function cookieHeader(jar: CookieJar) {
  return [...jar.entries()].map(([key, value]) => key + "=" + value).join("; ");
}

async function portalRequest(url: string, referer: string, jar: CookieJar, method = "GET", body?: URLSearchParams) {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Referer": referer,
  };
  const cookies = cookieHeader(jar);
  if (cookies) headers.Cookie = cookies;
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const result = await fetch(url, {
    method,
    headers,
    body: body?.toString(),
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  absorbCookies(result.headers, jar);
  const finalUrl = safePortalUrl(result.url || url);
  if (!finalUrl) throw new Error("The portal redirected outside the approved VBGRAMG hosts.");
  const contentType = result.headers.get("content-type") || "";
  const diagnostic = { status: result.status, path: new URL(finalUrl).pathname, contentType };
  if (!result.ok) throw new Error("VBGRAMG returned HTTP " + result.status + " at " + diagnostic.path + ".");
  if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
    throw new Error("VBGRAMG returned a non-HTML response at " + diagnostic.path + ".");
  }
  const html = await result.text();
  if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) throw new Error("Portal page exceeded the 5 MB diagnostic limit.");
  if (!html.trim() || !/<html[\s>]/i.test(html)) throw new Error("VBGRAMG returned invalid HTML at " + diagnostic.path + ".");
  return { html, url: finalUrl, diagnostic };
}

function attributes(source: string) {
  const result: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of source.matchAll(pattern)) result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}

function inspectPage(html: string, pageUrl: string) {
  const controls: Array<Record<string, unknown>> = [];
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  for (const match of anchors) {
    const attr = attributes(match[1]);
    const label = textOnly(match[2]) || attr.title || attr["aria-label"] || "";
    if (!/job\s*card|registration\s+application\s+register/i.test(label)) continue;
    const raw = attr.href || "";
    const directUrl = raw && !/^javascript:/i.test(raw) && raw !== "#" ? safePortalUrl(raw, pageUrl) : null;
    const script = [attr.onclick, raw].filter(Boolean).join(" ");
    const postback = script.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
    controls.push({
      tag: "a", label: label.slice(0, 180), hrefKind: directUrl ? "direct" : raw ? "script-or-fragment" : "missing",
      directPath: directUrl ? new URL(directUrl).pathname : null,
      postbackTarget: postback?.[1] || null, postbackArgument: postback?.[2] || null,
      hasOnClick: Boolean(attr.onclick),
    });
  }

  const buttons = [...html.matchAll(/<(?:input|button)\b([^>]*)>(?:([\s\S]*?)<\/button>)?/gi)];
  for (const match of buttons) {
    const attr = attributes(match[1]);
    const label = textOnly(match[2] || "") || attr.value || attr.title || attr["aria-label"] || "";
    if (!/job\s*card|registration\s+application\s+register/i.test(label)) continue;
    const script = attr.onclick || "";
    const postback = script.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
    controls.push({
      tag: attr.type ? "input" : "button", label: label.slice(0, 180),
      inputType: attr.type || null, name: attr.name || null, value: attr.value || null,
      postbackTarget: postback?.[1] || null, postbackArgument: postback?.[2] || null,
      hasOnClick: Boolean(attr.onclick),
    });
  }

  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map((match, index) => {
    const attr = attributes(match[1]);
    const hidden = [...match[2].matchAll(/<input\b([^>]*)>/gi)].map(item => attributes(item[1]))
      .filter(item => (item.type || "").toLowerCase() === "hidden" && item.name)
      .map(item => ({ name: item.name, valueLength: (item.value || "").length }));
    const action = safePortalUrl(attr.action || pageUrl, pageUrl);
    return { index, method: (attr.method || "GET").toUpperCase(), actionPath: action ? new URL(action).pathname : null, hiddenFields: hidden };
  });

  const frames = [...html.matchAll(/<(?:iframe|frame)\b([^>]*)>/gi)].map(match => {
    const attr = attributes(match[1]);
    const src = attr.src ? safePortalUrl(attr.src, pageUrl) : null;
    return { name: attr.name || "", title: attr.title || "", srcPath: src ? new URL(src).pathname : null, src };
  });

  const windows = [...html.matchAll(/window\.open\s*\(\s*['"]([^'"]+)['"]/gi)]
    .map(match => safePortalUrl(match[1], pageUrl))
    .filter((value): value is string => Boolean(value))
    .map(value => ({ path: new URL(value).pathname, url: value }));

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return {
    path: new URL(pageUrl).pathname,
    title: titleMatch ? textOnly(titleMatch[1]).slice(0, 180) : "",
    bodyPreview: bodyMatch ? textOnly(bodyMatch[1]).slice(0, 1200) : "",
    controls, forms, frames, windows,
    tableCount: (html.match(/<table\b/gi) || []).length,
    hasViewState: /name=["']__VIEWSTATE["']/i.test(html),
    hasEventValidation: /name=["']__EVENTVALIDATION["']/i.test(html),
  };
}

function findControl(html: string, pageUrl: string, expression: RegExp) {
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  for (const match of anchors) {
    const attr = attributes(match[1]);
    const label = textOnly(match[2]) || attr.title || attr["aria-label"] || "";
    if (!expression.test(label)) continue;
    const rawHref = attr.href || "";
    const directUrl = rawHref && !/^javascript:/i.test(rawHref) && rawHref !== "#" ? safePortalUrl(rawHref, pageUrl) : null;
    const script = [attr.onclick, rawHref].filter(Boolean).join(" ");
    const postback = script.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
    return { label, directUrl, postbackTarget: postback?.[1] || null, postbackArgument: postback?.[2] || "" };
  }
  const controls = [...html.matchAll(/<(?:input|button)\b([^>]*)>(?:([\s\S]*?)<\/button>)?/gi)];
  for (const match of controls) {
    const attr = attributes(match[1]);
    const label = textOnly(match[2] || "") || attr.value || attr.title || attr["aria-label"] || "";
    if (!expression.test(label)) continue;
    const script = attr.onclick || "";
    const postback = script.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
    return { label, directUrl: null, postbackTarget: postback?.[1] || null, postbackArgument: postback?.[2] || "", inputName: attr.name || null, inputValue: attr.value || "" };
  }
  return null;
}

function buildPostbackBody(html: string, target: string, argument: string, control?: { inputName?: string | null; inputValue?: string }) {
  const params = new URLSearchParams();
  const formMatch = html.match(/<form\b[^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) throw new Error("A postback control was found, but no HTML form was available.");
  for (const match of formMatch[1].matchAll(/<input\b([^>]*)>/gi)) {
    const attr = attributes(match[1]);
    if (!attr.name) continue;
    const type = (attr.type || "").toLowerCase();
    if (type === "submit" || type === "button" || type === "image" || type === "file") continue;
    if (type === "checkbox" || type === "radio") continue;
    params.set(attr.name, attr.value || "");
  }
  if (control?.inputName) params.set(control.inputName, control.inputValue || "");
  params.set("__EVENTTARGET", target);
  params.set("__EVENTARGUMENT", argument);
  return params;
}

async function activateControl(page: { html: string; url: string }, control: NonNullable<ReturnType<typeof findControl>>, jar: CookieJar) {
  if (control.directUrl) return await portalRequest(control.directUrl, page.url, jar);
  if (control.postbackTarget) {
    const action = page.html.match(/<form\b([^>]*)>/i);
    const formAttr = action ? attributes(action[1]) : {};
    const actionUrl = safePortalUrl(formAttr.action || page.url, page.url);
    if (!actionUrl) throw new Error("The ASP.NET form action is missing or outside the approved portal hosts.");
    const body = buildPostbackBody(page.html, control.postbackTarget, control.postbackArgument, control);
    return await portalRequest(actionUrl, page.url, jar, "POST", body);
  }
  throw new Error("The matching menu item is present, but its HTTP navigation target could not be identified.");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://villagecouncil.enga.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  } });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return response({ error: "Origin not allowed." }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const publishableKey = publishableKeys ? JSON.parse(publishableKeys).default : Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) return response({ error: "Server configuration is incomplete." }, 500, origin);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return response({ error: "Authentication required." }, 401, origin);
  const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return response({ error: "Invalid or expired session." }, 401, origin);
  const { data: membership, error: membershipError } = await adminClient.from("memberships")
    .select("id").eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
  if (membershipError) return response({ error: "Unable to verify Village Council access." }, 500, origin);
  if (!membership) return response({ error: "An active Village Council assignment is required." }, 403, origin);

  let payloadUrl = "";
  try {
    const body = await req.json();
    payloadUrl = typeof body?.payloadUrl === "string" ? body.payloadUrl.trim() : "";
  } catch {
    return response({ error: "Invalid JSON request." }, 400, origin);
  }
  const safeStartUrl = safePortalUrl(payloadUrl);
  if (!safeStartUrl || new URL(safeStartUrl).hostname !== "vbgramgrep.dord.gov.in" ||
      !/\/VBGRAMG\/IndexFrame\.aspx$/i.test(new URL(safeStartUrl).pathname) ||
      !new URL(safeStartUrl).searchParams.has("payload")) {
    return response({ error: "Provide the official HTTPS VBGRAMG Village Council IndexFrame.aspx Payload URL." }, 400, origin);
  }

  const jar: CookieJar = new Map();
  const steps: Array<Record<string, unknown>> = [];
  try {
    let current = await portalRequest(safeStartUrl, "https://vbgramgrep.dord.gov.in/", jar);
    steps.push({ step: "village-council-entry", request: current.diagnostic, page: inspectPage(current.html, current.url) });

    const r1 = findControl(current.html, current.url, /R1\s*\.?\s*Job\s*Card\s*\/\s*Registration/i);
    if (!r1) {
      return response({ success: false, stage: "r1-menu", error: "Could not identify the R1 Job Card / Registration control.", steps, noDataChanged: true }, 200, origin);
    }
    current = await activateControl(current, r1, jar);
    steps.push({ step: "after-r1-navigation", request: current.diagnostic, page: inspectPage(current.html, current.url), matchedControl: r1.label });

    const register = findControl(current.html, current.url, /Registration\s+Application\s+Register/i);
    if (!register) {
      return response({ success: false, stage: "registration-register", error: "R1 navigation completed, but Registration Application Register was not identified in the returned page.", steps, noDataChanged: true }, 200, origin);
    }
    current = await activateControl(current, register, jar);
    steps.push({ step: "registration-application-register", request: current.diagnostic, page: inspectPage(current.html, current.url), matchedControl: register.label });

    const finalPage = inspectPage(current.html, current.url);
    const frameResults: Array<Record<string, unknown>> = [];
    for (const frame of finalPage.frames as Array<{ src: string | null; name: string; title: string }>) {
      if (!frame.src) continue;
      try {
        const framePage = await portalRequest(frame.src, current.url, jar);
        frameResults.push({ name: frame.name, title: frame.title, request: framePage.diagnostic, page: inspectPage(framePage.html, framePage.url) });
      } catch (error) {
        frameResults.push({ name: frame.name, title: frame.title, error: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const popup of finalPage.windows as Array<{ url: string }>) {
      try {
        const popupPage = await portalRequest(popup.url, current.url, jar);
        frameResults.push({ window: true, request: popupPage.diagnostic, page: inspectPage(popupPage.html, popupPage.url) });
      } catch (error) {
        frameResults.push({ window: true, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return response({
      success: true,
      stage: "navigation-inspected",
      summary: {
        villageCouncilPageOpened: true,
        r1ControlFoundAndRequested: true,
        registrationRegisterFoundAndRequested: true,
        reportTableDetected: finalPage.tableCount > 0 || frameResults.some(item => JSON.stringify(item).includes('"tableCount":')),
        framesAndWindowsInspected: frameResults.length,
      },
      steps,
      frameAndWindowResults: frameResults,
      noDataChanged: true,
      note: "Read-only diagnostic only. It does not import or modify MIS records.",
    }, 200, origin);
  } catch (error) {
    return response({
      success: false,
      stage: "http-navigation",
      error: error instanceof Error ? error.message : String(error),
      steps,
      noDataChanged: true,
    }, 502, origin);
  }
});
