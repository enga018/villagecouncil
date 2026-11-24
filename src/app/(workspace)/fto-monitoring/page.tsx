"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import FtoImportedRegister from "@/components/fto/fto-imported-register";

type FtoPreview = {
  inScopeFtos: number;
  outOfVillageFtos: number;
  transactions: number;
  sample: Array<{ ftoNumber: string; transactionCount: number; jobCards: string[] }>;
};

type Progress = { attempted: number; total: number; staged: number };
type FtoTransactionPreview = { jobCardNumber?: string };
type FtoImportRow = {
  row_number: number;
  row_data: { scope?: string; fto_number?: string; transactions?: FtoTransactionPreview[] };
};
type FtoDetailsResponse = {
  success?: boolean;
  error?: string;
  results?: Array<{ kind: string; validationErrors?: string[]; error?: string; ftoNumber?: string }>;
  stagedTotal?: number;
  batchComplete?: boolean;
};
type FtoSourceResponse = {
  success?: boolean;
  error?: string;
  noNewFtos?: boolean;
  message?: string;
  batchId?: string;
  councilLocation?: { block?: string };
  listing?: { manifestToken?: string; ftoNumbers?: string[]; alreadyImportedCount?: number };
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

async function invokeErrorMessage(error: unknown, fallback: string) {
  const value = error as { message?: string; context?: Response } | null;
  const context = value?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json() as { error?: string };
      if (body?.error) return String(body.error);
    } catch {}
  }
  return value?.message || fallback;
}

function getSampleResults(
  sample: string[],
  response: FtoDetailsResponse | null | undefined,
  requestError?: string,
) {
  type Result = NonNullable<FtoDetailsResponse["results"]>[number];
  if (requestError) return sample.map(ftoNumber => ({ ftoNumber, kind: "request_failure", error: requestError }));
  if (!response || response.success !== true || !Array.isArray(response.results)) {
    const message = response?.error || "The parser test returned an incomplete or unsuccessful response.";
    return sample.map(ftoNumber => ({ ftoNumber, kind: "request_failure", error: message }));
  }
  const grouped = new Map<string, Result[]>();
  for (const result of response.results) {
    const number = String(result.ftoNumber || "");
    grouped.set(number, [...(grouped.get(number) || []), result]);
  }
  return sample.map(ftoNumber => {
    const matches = grouped.get(ftoNumber) || [];
    if (matches.length !== 1) {
      return { ftoNumber, kind: "response_validation_failure", error: matches.length ? "The parser returned duplicate results for this FTO." : "The parser did not return a result for this FTO." };
    }
    const result = matches[0];
    if (result.kind !== "village_match" && result.kind !== "out_of_village") {
      return { ...result, ftoNumber };
    }
    return { ...result, ftoNumber };
  });
}

export default function FtoMonitoringPage() {
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [batchId, setBatchId] = useState("");
  const [manifestToken, setManifestToken] = useState("");
  const [ftoNumbers, setFtoNumbers] = useState<string[]>([]);
  const [testingParser, setTestingParser] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [liveTest, setLiveTest] = useState<{ checked: number; passed: number; failed: number; results: Array<{ ftoNumber?: string; kind: string; error?: string; validationErrors?: string[] }> } | null>(null);
  const [failedFtos, setFailedFtos] = useState<string[]>([]);
  const [failureDetails, setFailureDetails] = useState<Array<{ ftoNumber: string; reason: string }>>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [preview, setPreview] = useState<FtoPreview | null>(null);
  const [importResult, setImportResult] = useState<{ ftos: number; transactions: number; excluded: number } | null>(null);

  async function loadPreview(supabase: ReturnType<typeof createClient>, currentBatchId: string) {
    const rows: FtoImportRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error: rowsError } = await supabase
        .from("council_fto_import_rows")
        .select("row_number,row_data")
        .eq("import_batch_id", currentBatchId)
        .order("row_number", { ascending: true })
        .range(offset, offset + 999);
      if (rowsError) throw rowsError;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const inScope = rows.filter(row => row.row_data?.scope === "IN_SCOPE");
    const outOfVillage = rows.filter(row => row.row_data?.scope === "OUT_OF_SCOPE");
    const transactions = inScope.reduce((sum, row) => sum + (Array.isArray(row.row_data?.transactions) ? row.row_data.transactions.length : 0), 0);
    setPreview({
      inScopeFtos: inScope.length,
      outOfVillageFtos: outOfVillage.length,
      transactions,
      sample: inScope.slice(0, 12).map(row => ({
        ftoNumber: String(row.row_data?.fto_number || ""),
        transactionCount: Array.isArray(row.row_data?.transactions) ? row.row_data.transactions.length : 0,
        jobCards: Array.from(new Set<string>((row.row_data?.transactions || []).map(tx => String(tx.jobCardNumber || "")))).slice(0, 4),
      })),
    });
  }

  async function processNumbers(numbers: string[], currentBatchId: string, token: string, supabase: ReturnType<typeof createClient>, initialNotice?: string) {
    if (!numbers.length) return;
    setBusy(true);
    setError("");
    setNotice(initialNotice || ("Processing " + formatNumber(numbers.length) + " FTO detail page(s) in batches of five."));
    setPreview(null);
    const failed = new Map<string, string>();
    let staged = progress?.staged || 0;
    let attempted = 0;
    let lastBatchComplete = false;
    try {
      for (let offset = 0; offset < numbers.length; offset += 5) {
        const chunk = numbers.slice(offset, offset + 5);
        const { data, error: invokeError } = await supabase.functions.invoke<FtoDetailsResponse>("council-fto-details", {
          body: { manifestToken: token, batchId: currentBatchId, ftoNumbers: chunk },
        });
        attempted += chunk.length;
        if (invokeError) {
          const message = await invokeErrorMessage(invokeError, "FTO detail request failed.");
          chunk.forEach(number => failed.set(number, message));
          setError(message);
        } else if (!data?.success) {
          const message = data?.error || "FTO details could not be processed.";
          chunk.forEach(number => failed.set(number, message));
          setError(message);
        } else {
          for (const result of data.results || []) {
            if (result.kind === "fetch_failure" || result.kind === "validation_failure") {
              const reason = result.kind === "validation_failure"
                ? (Array.isArray(result.validationErrors) ? result.validationErrors.join(" ") : "FTO detail validation failed.")
                : String(result.error || "Government detail fetch failed.");
              failed.set(String(result.ftoNumber), reason);
            }
          }
          staged = Number(data.stagedTotal || staged);
          lastBatchComplete = Boolean(data.batchComplete);
          if (failed.size) setError("Some FTO detail pages could not be fetched or validated. Retry the failed FTOs.");
        }
        setProgress({ attempted, total: numbers.length, staged });
      }
      const failedList = [...failed.keys()];
      setFailedFtos(failedList);
      setFailureDetails([...failed.entries()].map(([ftoNumber, reason]) => ({ ftoNumber, reason })));
      if (failedList.length) {
        setNotice(formatNumber(failedList.length) + " FTO(s) need retry. No manual import option is available.");
      } else if (!lastBatchComplete) {
        // A partial retry can finish a previously staged batch; verify its status below.
        const { data: batch, error: batchError } = await supabase
          .from("council_fto_import_batches")
          .select("status,total_rows")
          .eq("id", currentBatchId)
          .maybeSingle();
        if (batchError) throw batchError;
        lastBatchComplete = batch?.status === "pending";
      }
      if (!failedList.length && lastBatchComplete) {
        await loadPreview(supabase, currentBatchId);
        setNotice("FTO details parsed. Only transactions whose FTO Panchayat matches this Village Council are included in the import preview.");
      } else if (!failedList.length) {
        setFailedFtos(numbers);
        setNotice("The batch is not complete yet. Retry this set; FTOs already staged will be skipped automatically.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare the FTO import preview.");
    } finally {
      setBusy(false);
    }
  }

  async function startFetch(forceRefresh = false) {
    if (busy || activating) return;
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);
    setImportResult(null);
    setFailedFtos([]);
    setFailureDetails([]);
    setProgress(null);
    setBatchId("");
    setManifestToken("");
    try {
      const supabase = createClient();
      const { data, error: invokeError } = await supabase.functions.invoke<FtoSourceResponse>("council-fto-source", { body: { forceRefresh } });
      if (invokeError) throw new Error(await invokeErrorMessage(invokeError, "Could not discover the Government FTO listing."));
      if (!data?.success) throw new Error(data?.error || "The Government FTO listing could not be prepared.");
      if (data.noNewFtos) {
        setNotice(data.message || "No new FTOs were found for this Village Council.");
        setBusy(false);
        return;
      }
      if (!data?.batchId || !data?.listing?.manifestToken || !Array.isArray(data?.listing?.ftoNumbers)) {
        throw new Error("The Government FTO listing did not return a valid processing batch.");
      }
      const numbers = data.listing.ftoNumbers.map((value: unknown) => String(value || "").trim()).filter(Boolean);
      if (!numbers.length) throw new Error("The Government listing returned no eligible FTO numbers to test.");
      setBatchId(data.batchId);
      setManifestToken(data.listing.manifestToken);
      setFtoNumbers(numbers);
      setLiveTest(null);
      setAwaitingConfirmation(true);
      setProgress({ attempted: 0, total: numbers.length, staged: 0 });
      const skipped = Number(data.listing.alreadyImportedCount || 0);
      const initialNotice = "Processing " + formatNumber(numbers.length) + " eligible First Signatory FTOs for " + (data.councilLocation?.block || "the selected Block") +
        (skipped ? "; skipped " + formatNumber(skipped) + " completed or out-of-village FTOs." : ".") +
        " Matching the Panchayat recorded in each FTO to this Village Council.";
      setNotice(initialNotice + " Running a read-only parser test on the first two FTOs before any staging.");
      const sample = numbers.slice(0, 2);
      const { data: testData, error: testError } = await supabase.functions.invoke<FtoDetailsResponse>("council-fto-details", {
        body: { manifestToken: data.listing.manifestToken, batchId: data.batchId, ftoNumbers: sample, dryRun: true },
      });
      const requestError = testError ? await invokeErrorMessage(testError, "Live parser test request failed.") : undefined;
      const testResults = getSampleResults(sample, testData, requestError);
      const passed = testResults.filter(result => result.kind === "village_match" || result.kind === "out_of_village").length;
      const failed = testResults.length - passed;
      setLiveTest({ checked: sample.length, passed, failed, results: testResults });
      setNotice(failed
        ? "The initial live parser test failed. No FTO records or inspection history were changed. Review the errors before continuing."
        : "Initial live parser test passed. No FTO records or inspection history were changed. Review the result, then continue when ready.");
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "FTO discovery failed.");
      setBusy(false);
    }
  }

  async function continueProcessing() {
    if (!awaitingConfirmation || !liveTest || liveTest.failed > 0 || !batchId || !manifestToken || busy) return;
    setAwaitingConfirmation(false);
    setLiveTest(null);
    const supabase = createClient();
    await processNumbers(ftoNumbers, batchId, manifestToken, supabase,
      "Initial parser test passed. Preparing all discovered FTO details for manual review; nothing will be activated.");
  }

  async function retryFailed() {
    if (!failedFtos.length || !batchId || !manifestToken || busy) return;
    const supabase = createClient();
    const retryList = failedFtos;
    setFailedFtos([]);
    setFailureDetails([]);
    setProgress({ attempted: 0, total: retryList.length, staged: progress?.staged || 0 });
    await processNumbers(retryList, batchId, manifestToken, supabase);
  }

  async function testLiveParser() {
    if (!batchId || !manifestToken || !ftoNumbers.length || busy || activating || testingParser) return;
    setTestingParser(true);
    setError("");
    setNotice("Retesting the first two Government FTO detail pages without staging or importing records.");
    setLiveTest(null);
    try {
      const supabase = createClient();
      const sample = ftoNumbers.slice(0, 2);
      const { data, error: invokeError } = await supabase.functions.invoke<FtoDetailsResponse>("council-fto-details", {
        body: { manifestToken, batchId, ftoNumbers: sample, dryRun: true },
      });
      const requestError = invokeError ? await invokeErrorMessage(invokeError, "Live parser test request failed.") : undefined;
      const results = getSampleResults(sample, data, requestError);
      const passed = results.filter(result => result.kind === "village_match" || result.kind === "out_of_village").length;
      const failed = results.length - passed;
      setLiveTest({ checked: sample.length, passed, failed, results });
      setNotice(failed
        ? "Live parser test completed with failures. No FTO records or inspection history were changed."
        : "Live parser test passed for the first two FTOs. No FTO records or inspection history were changed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live parser test failed.");
    } finally {
      setTestingParser(false);
    }
  }

  async function activateImport() {
    if (!batchId || !preview || preview.inScopeFtos === 0 || activating || busy) return;
    setActivating(true);
    setError("");
    setNotice("");
    try {
      const supabase = createClient();
      const { data, error: activationError } = await supabase.rpc("activate_council_fto_import", { p_batch_id: batchId });
      if (activationError) throw activationError;
      if (!data) throw new Error("The FTO import did not return a confirmation.");
      setImportResult({
        ftos: Number(data.importedFtos || 0),
        transactions: Number(data.importedTransactions || 0),
        excluded: Number(data.excludedOutOfVillageFtos || 0),
      });
      setNotice("Village FTO import completed successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "FTO import activation failed.");
    } finally {
      setActivating(false);
    }
  }

  const percent = progress?.total ? Math.min(100, Math.round((progress.attempted / progress.total) * 100)) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Financial operations</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">FTO Monitoring</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Discover First Signatory FTOs, validate their details and review transactions belonging to this Village Council before importing.</p>
        </div>
        <span className="inline-flex items-center gap-2 self-start rounded-full border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] font-semibold text-blue-800 sm:self-auto"><span className="h-1.5 w-1.5 rounded-full bg-blue-600"/> Government portal connection</span>
      </section>

      <FtoImportedRegister />

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--vc-shadow-card)]">
        <div className="border-b border-slate-100 p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="max-w-xl">
              <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[10px] font-bold text-blue-800">FTO</span><div><h2 className="text-base font-bold tracking-tight text-slate-950">Discover Government FTOs</h2><p className="mt-0.5 text-xs text-slate-500">First Signatory listing for this Council&apos;s Block</p></div></div>
              <p className="mt-3 text-xs leading-5 text-slate-500">Uses saved District/Block navigation and official Government links. No CAPTCHA or manual file upload is required.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button type="button" onClick={() => startFetch(false)} disabled={busy || activating || Boolean(preview && !importResult)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? "Fetching…" : "Fetch FTOs"}
              </button>
              {awaitingConfirmation && liveTest?.failed === 0 && <button type="button" onClick={continueProcessing} disabled={busy || testingParser} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">Continue and prepare all FTOs</button>}
              {awaitingConfirmation && liveTest && liveTest.failed > 0 && <button type="button" onClick={testLiveParser} disabled={busy || testingParser} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900 disabled:opacity-50">{testingParser ? "Retesting…" : "Retry sample test"}</button>}
            </div>
          </div>
        </div>

        {progress && (
          <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-700">FTO detail processing</p><p className="text-xs tabular-nums text-slate-500">{formatNumber(progress.attempted)} / {formatNumber(progress.total)} attempted</p></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: percent + "%" }}/></div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-slate-400"><span>{percent}% processed</span><span>{formatNumber(progress.staged)} staged FTO results</span></div>
          </div>
        )}

        {liveTest && (
          <div className="border-b border-slate-100 p-4 sm:p-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-900">Live parser test</h3><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500">Read-only test</span></div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div><p className="text-2xl font-bold tabular-nums text-slate-950">{formatNumber(liveTest.checked)}</p><p className="text-[10px] text-slate-500">Checked</p></div>
                <div><p className="text-2xl font-bold tabular-nums text-emerald-700">{formatNumber(liveTest.passed)}</p><p className="text-[10px] text-slate-500">Passed</p></div>
                <div><p className="text-2xl font-bold tabular-nums text-red-700">{formatNumber(liveTest.failed)}</p><p className="text-[10px] text-slate-500">Failed</p></div>
              </div>
              {liveTest.failed > 0 && <ul className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-xs text-red-700">{liveTest.results.filter(item => item.kind !== "village_match" && item.kind !== "out_of_village").slice(0, 12).map((item, index) => <li key={String(item.ftoNumber || index)}><span className="font-semibold">{item.ftoNumber || "Request"}:</span> {item.error || (item.validationErrors || []).join(" ") || item.kind}</li>)}</ul>}
              <p className="mt-3 text-[10px] text-slate-500">Read-only sample: first two discovered FTOs. No FTO records or inspection history are changed by this test.</p>
            </div>
          </div>
        )}

        {(error || notice) && <div className="space-y-2 border-b border-slate-100 p-4 sm:px-6">{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-800"><span className="font-bold">Action required: </span>{error}</p>}{notice && <p role="status" className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">{notice}</p>}</div>}

        {failedFtos.length > 0 && (
          <div className="border-b border-slate-100 p-4 sm:p-6">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div><p className="text-sm font-bold text-amber-950">{formatNumber(failedFtos.length)} FTO detail page(s) need retry</p><p className="mt-1 text-xs text-amber-800">Only failed records will be retried. Successful results remain staged.</p></div>
                <button type="button" onClick={retryFailed} disabled={busy} className="min-h-10 rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-bold text-amber-900 disabled:opacity-50">Retry failed FTOs</button>
              </div>
              {failureDetails.length > 0 && <ul className="mt-3 space-y-1 border-t border-amber-200 pt-3 text-[11px] leading-5 text-amber-900">{failureDetails.slice(0, 10).map(item => <li key={item.ftoNumber}><span className="font-bold">{item.ftoNumber}:</span> {item.reason}</li>)}{failureDetails.length > 10 && <li className="text-amber-700">And {formatNumber(failureDetails.length - 10)} more failed FTOs.</li>}</ul>}
            </div>
          </div>
        )}
      </section>

      {preview && (
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-emerald-700">Review before activation</p><h2 className="mt-1 text-lg font-bold tracking-tight text-slate-950">Import preview</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Ownership is determined by the Panchayat recorded in each FTO transaction, not by matching Job Card numbers alone.</p></div>
            <span className="rounded-full border border-amber-100 bg-amber-50 px-3 py-1.5 text-[10px] font-semibold text-amber-800">Not imported yet</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4"><p className="text-2xl font-bold tabular-nums text-emerald-900">{formatNumber(preview.inScopeFtos)}</p><p className="mt-1 text-[11px] font-medium text-emerald-800">FTOs matching this Council</p></div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4"><p className="text-2xl font-bold tabular-nums text-blue-900">{formatNumber(preview.transactions)}</p><p className="mt-1 text-[11px] font-medium text-blue-800">Matching transaction rows</p></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-2xl font-bold tabular-nums text-slate-800">{formatNumber(preview.outOfVillageFtos)}</p><p className="mt-1 text-[11px] font-medium text-slate-500">Out-of-village FTOs excluded</p></div>
          </div>

          {preview.sample.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold text-slate-800">Matching FTO sample</h3><span className="text-[10px] text-slate-400">First {preview.sample.length} FTOs</span></div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">FTO number</th><th className="px-4 py-3">Local transactions</th><th className="px-4 py-3">Job Card numbers</th></tr></thead>
                    <tbody className="divide-y divide-slate-100 bg-white">{preview.sample.map(item => <tr key={item.ftoNumber}><td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{item.ftoNumber}</td><td className="px-4 py-3 tabular-nums text-slate-600">{formatNumber(item.transactionCount)}</td><td className="px-4 py-3 text-slate-600">{item.jobCards.join(", ") || "—"}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-[11px] leading-5 text-slate-500">Review the counts and sample before confirming. No FTO records are activated until you confirm.</p>
            <button type="button" onClick={activateImport} disabled={activating || busy || preview.inScopeFtos === 0 || Boolean(importResult)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
              {activating ? "Activating import…" : importResult ? "Import completed" : "Confirm and import village FTOs"}
            </button>
          </div>
        </section>
      )}

      {importResult && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-6">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-800">✓</span><div><p className="text-sm font-bold text-emerald-950">FTO import completed</p><p className="mt-0.5 text-xs text-emerald-800">The Village Council import activation returned successfully.</p></div></div>
          <div className="mt-5 grid gap-4 border-t border-emerald-200 pt-4 sm:grid-cols-3">
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.ftos)}</p><p className="text-[11px] text-emerald-800">FTOs imported</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.transactions)}</p><p className="text-[11px] text-emerald-800">Transactions imported</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.excluded)}</p><p className="text-[11px] text-emerald-800">Out-of-village FTOs excluded</p></div>
          </div>
        </section>
      )}
    </div>
  );
}
