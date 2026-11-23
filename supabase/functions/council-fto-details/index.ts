import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://villagecouncil.enga.in", "https://enga018.github.io"]);
const GOVERNMENT_HOSTS = new Set(["vbgramg.dord.gov.in", "vbgramgrep.dord.gov.in"]);
const DETAIL_PATH = "/vbgramg/fto/fto_trasction_dtl.aspx";
type Candidate = { detailUrl: string; listingRow: string[]; listingHeaders?: string[]; ftoNumber: string };
type Transaction = {
  ftoNumber: string;
  jobCardNumber: string;
  referenceNumber: string;
  status: "processed" | "rejected" | "deferred" | "other";
  normalizedStatus: "processed" | "rejected" | "blank" | "other";
  governmentStatus: string;
  amount: string;
  jobCardNo: string;
  referenceNo: string;
  amountToBeCredited: string;
  creditAmount: string;
  transactionDate: string;
  processedDate: string;
  rejectionReason: string;
  village: string;
  villageName: string;
  personName: string;
  primaryAccountHolder: string;
  sourceRow: Array<{ name: string; value: string }>;
};

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
async function readJsonBody(req: Request, maxBytes: number) {
  const declaredLength = Number(req.headers.get("Content-Length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("Request body is too large.");
  if (!req.body) throw new Error("Request body is empty.");
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error("Request body is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function decodeHtml(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, " ").replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function textOf(value: string) {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\u200b]/g, " ").replace(/\s+/g, " ").trim();
}
function rowsOf(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => textOf(c[1])))
    .filter(row => row.some(Boolean));
}
function parseGovernmentAmount(value: string) {
  const raw = String(value || "").trim().replace(/[₹,\s]/g, "");
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return "";
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? String(amount) : "";
}
function parseGovernmentDate(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) return match[3] + "-" + match[2].padStart(2, "0") + "-" + match[1].padStart(2, "0");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return "";
}
function normalizeGovernmentStatus(value: string): Transaction["normalizedStatus"] {
  const raw = String(value || "").trim();
  if (!raw) return "blank";
  if (/^processed$/i.test(raw)) return "processed";
  if (/^rejected$/i.test(raw)) return "rejected";
  return "other";
}
function extractJobCard(value: string) {
  const match = String(value || "").match(/\bMZ-\d{2}-(?:\d{3}-){2,3}\d{3}\/\d+(?:-[A-Z]+)?\b/i);
  return match ? match[0].toUpperCase() : "";
}
function extractVillage(value: string, jobCardNumber: string) {
  return String(value || "").replace(jobCardNumber, " ").replace(/[()\[\]{}]/g, " ")
    .replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "").trim();
}
function validateGovernmentTransactions(transactions: Transaction[], listingRow: string[]) {
  const errors: string[] = [], refs = new Set<string>();
  for (let index = 0; index < transactions.length; index++) {
    const tx = transactions[index], label = "Government row " + (index + 1);
    if (!tx.jobCardNumber) errors.push(label + ": missing or invalid Job Card Number.");
    if (!tx.referenceNumber) errors.push(label + ": missing Reference Number.");
    const ref = String(tx.referenceNumber || "").trim().toUpperCase();
    if (ref && refs.has(ref)) errors.push(label + ": duplicate Reference Number " + ref + ".");
    if (ref) refs.add(ref);
    if (!tx.creditAmount) errors.push(label + ": missing or invalid Credit Amount.");
    if (tx.normalizedStatus === "other") errors.push(label + ": unrecognized Government status.");
  }
  const sum = (rows: Transaction[]) => rows.reduce((n, tx) => n + Number(tx.creditAmount || 0), 0);
  const countAt = (i: number) => { const v = String(listingRow[i] ?? "").replace(/,/g, "").trim(); return /^\d+$/.test(v) ? Number(v) : null; };
  const amountAt = (i: number) => { const v = String(listingRow[i] ?? "").replace(/[₹,\s]/g, ""); return /^\d+(?:\.\d+)?$/.test(v) ? Number(v) : null; };
  const checks = [
    { label: "Processed count", expected: countAt(8), actual: transactions.filter(tx => tx.normalizedStatus === "processed").length },
    { label: "Rejected count", expected: countAt(10), actual: transactions.filter(tx => tx.normalizedStatus === "rejected").length },
    { label: "Processed amount", expected: amountAt(9), actual: sum(transactions.filter(tx => tx.normalizedStatus === "processed")) },
    { label: "Rejected amount", expected: amountAt(11), actual: sum(transactions.filter(tx => tx.normalizedStatus === "rejected")) },
    { label: "Total amount", expected: amountAt(7), actual: sum(transactions) },
  ];
  for (const check of checks) {
    if (check.expected === null) errors.push("Government listing " + check.label + " is missing or invalid.");
    else if (Math.abs(check.expected - check.actual) >= 0.005) errors.push("Government listing " + check.label + " does not reconcile with detail rows.");
  }
  return errors;
}
async function getPage(url: string, ftoNumber: string) {
  const parsed = new URL(url);
  if (!GOVERNMENT_HOSTS.has(parsed.hostname) || parsed.pathname.toLowerCase() !== DETAIL_PATH || !parsed.searchParams.has("payload"))
    throw new Error("FTO " + ftoNumber + " has an invalid Government detail URL.");
  const response = await fetch(parsed.href, {
    method: "GET", redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Encoding": "identity",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
    signal: AbortSignal.timeout(12000),
  });
  const html = await response.text();
  if (!response.ok) throw new Error("Government detail request returned HTTP " + response.status + ".");
  const finalUrl = new URL(response.url || parsed.href);
  if (!GOVERNMENT_HOSTS.has(finalUrl.hostname) || finalUrl.pathname.toLowerCase() !== DETAIL_PATH)
    throw new Error("FTO " + ftoNumber + " redirected outside the expected Government detail page.");
  const tableRows = rowsOf(html), pageText = textOf(html);
  const header = tableRows.find(row => row.some(cell => /job\s*card\s*no/i.test(cell)) && row.some(cell => /reference\s*no/i.test(cell)));
  if (!header || !/FTO\s+Transaction\s+Details/i.test(pageText)) throw new Error("FTO " + ftoNumber + " did not return a valid FTO Transaction Details page.");
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const names = header.map(normalize);
  const find = (...exactNames: string[]) => names.findIndex(name => exactNames.includes(name));
  const job = find("job card no panchayat name", "job card no", "job card number");
  const reference = find("reference no", "reference number");
  const transactionDate = find("transaction date");
  const applicant = find("applicant name", "name of applicant", "name of person");
  const primaryHolder = find("name of primary account holder");
  const amountToBeCredited = find("amount to be credited in rs", "amount to be credited");
  const creditAmount = find("credit amount in rs", "credit amount");
  const status = find("status");
  const processedDate = find("processed date");
  const rejectionReason = find("rejection reason");
  if (job < 0 || reference < 0 || amountToBeCredited < 0 || creditAmount < 0 || status < 0)
    throw new Error("FTO " + ftoNumber + " has an unexpected transaction table structure.");
  const headerIndex = tableRows.indexOf(header), transactions: Transaction[] = [];
  for (const row of tableRows.slice(headerIndex + 1)) {
    const jobCell = row[job] || "", jobCardNumber = extractJobCard(jobCell);
    const referenceNumber = (row[reference] || "").trim();
    const rawStatus = (row[status] || "").trim(), normalizedStatus = normalizeGovernmentStatus(rawStatus);
    const personName = (row[applicant >= 0 ? applicant : primaryHolder] || "").trim();
    const primaryAccountHolder = primaryHolder >= 0 ? (row[primaryHolder] || "").trim() : "";
    const village = extractVillage(jobCell, jobCardNumber);
    const sourceRow = header.map((name, index) => ({ name, value: row[index] || "" }));
    transactions.push({
      ftoNumber,
      jobCardNumber,
      referenceNumber,
      status: normalizedStatus === "blank" ? "deferred" : normalizedStatus,
      normalizedStatus,
      governmentStatus: rawStatus || "blank",
      amount: row[creditAmount] || "",
      jobCardNo: jobCardNumber,
      referenceNo: referenceNumber,
      amountToBeCredited: parseGovernmentAmount(row[amountToBeCredited] || ""),
      creditAmount: parseGovernmentAmount(row[creditAmount] || ""),
      transactionDate: transactionDate >= 0 ? parseGovernmentDate(row[transactionDate] || "") : "",
      processedDate: processedDate >= 0 ? parseGovernmentDate(row[processedDate] || "") : "",
      rejectionReason: rejectionReason >= 0 ? (row[rejectionReason] || "").trim() : "",
      village,
      villageName: village,
      personName,
      primaryAccountHolder,
      sourceRow,
    });
  }
  if (!transactions.length) throw new Error("FTO " + ftoNumber + " contains no transaction rows.");
  return transactions;
}
function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2_000_000) throw new Error("Invalid or oversized FTO manifest token.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
async function openManifest(token: string, serviceKey: string) {
  const bytes = base64UrlToBytes(token);
  if (bytes.length < 29) throw new Error("FTO manifest token is incomplete.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("COUNCIL-FTO-MANIFEST-v1:" + serviceKey));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  const manifest = JSON.parse(new TextDecoder().decode(clear));
  if (manifest?.v !== 1 || !Number.isFinite(manifest.exp) || manifest.exp < Date.now() ||
      !Array.isArray(manifest.candidates) || !manifest.context ||
      !Array.isArray(manifest.jobCardNumbers) || manifest.jobCardNumbers.length === 0)
    throw new Error("FTO manifest has expired or is invalid. Run FTO discovery again.");
  return manifest as { v: number; exp: number; context: { tenantId: string; districtId: string; blockId: string; batchId: string }; candidates: Candidate[]; jobCardNumbers: string[] };
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
  const tenantId = membership.village_council_id;
  const body = await readJsonBody(req, 2_200_000);
  const manifestToken = String(body.manifestToken || "");
  const batchId = String(body.batchId || "");
  const requested: string[] = Array.isArray(body.ftoNumbers)
    ? (body.ftoNumbers as unknown[]).map((value: unknown) => String(value || "").trim()).filter((value: string) => Boolean(value))
    : [];
  if (!manifestToken || !batchId || requested.length < 1 || requested.length > 5 ||
      new Set(requested.map(value => value.toUpperCase())).size !== requested.length) {
    return reply({ error: "Provide a valid manifest, batch ID, and between one and five distinct FTO numbers." }, 400, origin);
  }
  const manifest = await openManifest(manifestToken, secretKey);
  if (manifest.context.tenantId !== tenantId || manifest.context.batchId !== batchId)
    return reply({ error: "The FTO manifest does not belong to this Village Council or import batch." }, 403, origin);

  const { data: council, error: councilError } = await admin.from("council_tenants")
    .select("id,location_panchayat_id,is_active").eq("id", tenantId).eq("is_active", true).maybeSingle();
  if (councilError || !council?.location_panchayat_id) return reply({ error: "The assigned Village Council location is unavailable." }, 409, origin);
  const { data: panchayat, error: panchayatError } = await admin.from("location_panchayats")
    .select("id,block_id").eq("id", council.location_panchayat_id).maybeSingle();
  if (panchayatError || !panchayat?.block_id) return reply({ error: "The Panchayat Block mapping is unavailable." }, 409, origin);
  const { data: block, error: blockError } = await admin.from("location_blocks")
    .select("id,district_id,official_name").eq("id", panchayat.block_id).maybeSingle();
  if (blockError || !block?.district_id) return reply({ error: "The Block mapping is unavailable." }, 409, origin);
  const { data: district, error: districtError } = await admin.from("location_districts")
    .select("id").eq("id", block.district_id).maybeSingle();
  if (districtError || !district || manifest.context.blockId !== block.id || manifest.context.districtId !== district.id)
    return reply({ error: "The FTO manifest jurisdiction does not match this Village Council." }, 403, origin);

  const { data: batch, error: batchError } = await admin.from("council_fto_import_batches")
    .select("id,status,total_rows,village_council_id").eq("id", batchId).eq("village_council_id", tenantId).maybeSingle();
  if (batchError || !batch) return reply({ error: "The FTO import batch was not found for this Village Council." }, 404, origin);
  if (!["processing", "pending"].includes(batch.status)) return reply({ error: "This FTO import batch is no longer available for processing." }, 409, origin);
  if (Number(batch.total_rows) !== manifest.candidates.length) return reply({ error: "The FTO manifest does not match the batch's discovered record count." }, 409, origin);

  const candidateByNumber = new Map<string, { candidate: Candidate; rowNumber: number }>();
  manifest.candidates.forEach((candidate, index) => {
    candidateByNumber.set(String(candidate.ftoNumber || "").trim().toUpperCase(), { candidate, rowNumber: index + 1 });
  });
  const selected: Array<{ candidate: Candidate; rowNumber: number; requestedNumber: string }> = requested.map((number: string) => {
    const item = candidateByNumber.get(number.toUpperCase());
    if (!item) throw new Error("FTO " + number + " is not part of this Government listing.");
    return { ...item, requestedNumber: number };
  });
  const cardNumberMap = new Map<string, string>();
  for (const value of manifest.jobCardNumbers) {
    const original = String(value || "").trim();
    if (original) cardNumberMap.set(original.toUpperCase(), original);
  }
  const cardSet = new Set(cardNumberMap.keys());
  if (!cardSet.size) return reply({ error: "The FTO manifest contains no Job Card snapshot for this Village Council." }, 409, origin);
  const selectedRowNumbers = selected.map(item => item.rowNumber);
  const { data: existingRows, error: existingRowsError } = await admin.from("council_fto_import_rows")
    .select("row_number").eq("import_batch_id", batchId).eq("village_council_id", tenantId).in("row_number", selectedRowNumbers);
  if (existingRowsError) throw new Error("Could not check previously processed FTOs: " + existingRowsError.message);
  const alreadyStaged = new Set((existingRows || []).map((row: { row_number: number }) => Number(row.row_number)));
  const pending = selected.filter(item => !alreadyStaged.has(item.rowNumber));
  const results: Record<string, unknown>[] = [];
  const stagedRows: Record<string, unknown>[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      try {
        const transactions = await getPage(item.candidate.detailUrl, item.candidate.ftoNumber);
        const validationErrors = validateGovernmentTransactions(transactions, item.candidate.listingRow || []);
        if (validationErrors.length) {
          results.push({ ftoNumber: item.candidate.ftoNumber, kind: "validation_failure", validationErrors });
          continue;
        }
        const matching: Transaction[] = transactions
          .filter((tx: Transaction) => cardSet.has(String(tx.jobCardNumber || "").trim().toUpperCase()))
          .map((tx: Transaction): Transaction => ({
            ...tx,
            jobCardNumber: cardNumberMap.get(String(tx.jobCardNumber || "").trim().toUpperCase()) || tx.jobCardNumber,
            jobCardNo: cardNumberMap.get(String(tx.jobCardNumber || "").trim().toUpperCase()) || tx.jobCardNo,
          }));
        const unmatchedCount = transactions.length - matching.length;
        const scope = matching.length ? "IN_SCOPE" : "OUT_OF_SCOPE";
        const listingRow = item.candidate.listingRow || [];
        const ftoRow = {
          scope,
          fto_number: item.candidate.ftoNumber,
          fto_date: listingRow[5] || "",
          fto_status: "",
          block: block.official_name,
          first_signatory: "",
          beneficiary_count: String(matching.length),
          wage_amount: matching.reduce((sum: number, tx: Transaction) => sum + Number(tx.creditAmount || 0), 0).toFixed(2),
          source_record_key: item.candidate.ftoNumber,
          government_transaction_count: transactions.length,
          matching_transaction_count: matching.length,
          unmatched_transaction_count: unmatchedCount,
          transactions: matching,
        };
        stagedRows.push({
          village_council_id: tenantId,
          import_batch_id: batchId,
          row_number: item.rowNumber,
          row_data: ftoRow,
        });
        results.push({
          ftoNumber: item.candidate.ftoNumber,
          kind: scope === "IN_SCOPE" ? "village_match" : "out_of_village",
          governmentTransactionCount: transactions.length,
          matchingTransactionCount: matching.length,
          excludedTransactionCount: unmatchedCount,
          matchedJobCards: [...new Set(matching.map((tx: Transaction) => String(tx.jobCardNumber).trim().toUpperCase()))],
        });
      } catch (error) {
        results.push({
          ftoNumber: item.candidate.ftoNumber,
          kind: "fetch_failure",
          error: error instanceof Error ? error.message : "FTO detail processing failed.",
        });
      }
    }
  });
  await Promise.all(workers);

  if (stagedRows.length) {
    const { error: stageError } = await admin.from("council_fto_import_rows")
      .upsert(stagedRows, { onConflict: "import_batch_id,row_number" });
    if (stageError) throw new Error("Could not stage the village-filtered FTO results: " + stageError.message);
  }
  const { count: stagedCount, error: countError } = await admin.from("council_fto_import_rows")
    .select("row_number", { count: "exact", head: true })
    .eq("import_batch_id", batchId).eq("village_council_id", tenantId);
  if (countError) throw new Error("Could not verify FTO processing progress: " + countError.message);
  const batchComplete = stagedCount === Number(batch.total_rows);
  if (batchComplete && batch.status === "processing") {
    const { error: finishError } = await admin.from("council_fto_import_batches")
      .update({ status: "pending", error_message: null })
      .eq("id", batchId).eq("village_council_id", tenantId).eq("status", "processing");
    if (finishError) throw new Error("All FTOs were processed, but the review batch could not be finalized: " + finishError.message);
  }
  return reply({
    success: true,
    batchId,
    requestedCount: requested.length,
    alreadyStagedCount: alreadyStaged.size,
    fetchedCount: pending.length,
    stagedThisRequest: stagedRows.length,
    stagedTotal: stagedCount || 0,
    totalFtos: batch.total_rows,
    batchComplete,
    results: [...results, ...selected.filter(item => alreadyStaged.has(item.rowNumber)).map(item => ({ ftoNumber: item.candidate.ftoNumber, kind: "already_staged" }))],
    message: batchComplete
      ? "All FTO details have been parsed. Only FTOs with at least one exact Job Card Number match in this Village Council are marked IN_SCOPE and eligible for review."
      : "FTO details processed for this batch. Retry any failed FTO numbers; no manual import fallback is available.",
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
    return reply({ success: false, error: error instanceof Error ? error.message : "FTO detail processing failed." }, 502, origin);
  }
});
