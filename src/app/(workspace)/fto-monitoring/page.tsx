"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";

type FtoPreview = {
  inScopeFtos: number;
  outOfVillageFtos: number;
  transactions: number;
  sample: Array<{ ftoNumber: string; transactionCount: number; jobCards: string[] }>;
};

type Progress = { attempted: number; total: number; staged: number };

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

async function invokeErrorMessage(error: any, fallback: string) {
  const context = error?.context as Response | undefined;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {}
  }
  return error?.message || fallback;
}

export default function FtoMonitoringPage() {
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [batchId, setBatchId] = useState("");
  const [manifestToken, setManifestToken] = useState("");
  const [failedFtos, setFailedFtos] = useState<string[]>([]);
  const [failureDetails, setFailureDetails] = useState<Array<{ ftoNumber: string; reason: string }>>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [preview, setPreview] = useState<FtoPreview | null>(null);
  const [importResult, setImportResult] = useState<{ ftos: number; transactions: number; excluded: number } | null>(null);

  async function loadPreview(supabase: ReturnType<typeof createClient>, currentBatchId: string) {
    const rows: any[] = [];
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
        jobCards: Array.from(new Set<string>((row.row_data?.transactions || []).map((tx: any) => String(tx.jobCardNumber || "")))).slice(0, 4),
      })),
    });
  }

  async function processNumbers(numbers: string[], currentBatchId: string, token: string, supabase: ReturnType<typeof createClient>) {
    if (!numbers.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);
    const failed = new Map<string, string>();
    let staged = progress?.staged || 0;
    let attempted = 0;
    let lastBatchComplete = false;
    try {
      for (let offset = 0; offset < numbers.length; offset += 5) {
        const chunk = numbers.slice(offset, offset + 5);
        const { data, error: invokeError } = await supabase.functions.invoke<any>("council-fto-details", {
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
        setNotice("FTO details parsed. Only records matching this Village Council's Job Cards are included in the import preview.");
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

  async function startFetch() {
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
      const { data, error: invokeError } = await supabase.functions.invoke<any>("council-fto-source", { body: {} });
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
      setBatchId(data.batchId);
      setManifestToken(data.listing.manifestToken);
      setProgress({ attempted: 0, total: numbers.length, staged: 0 });
      setNotice("Found " + formatNumber(numbers.length) + " First Signatory FTOs for " + data.councilLocation.block + ". Checking transaction details and matching Job Card Numbers.");
      await processNumbers(numbers, data.batchId, data.listing.manifestToken, supabase);
    } catch (err) {
      setError(err instanceof Error ? err.message : "FTO discovery failed.");
      setBusy(false);
    }
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-medium text-blue-700">Government data</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">FTO Monitoring</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Fetch the First Signatory FTO list for this Block, inspect each transaction, and import only FTOs containing Job Cards registered to this Village Council.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Fetch Government FTOs</h2>
            <p className="mt-1 text-sm text-slate-500">Uses the saved District URL and shared FTO Status and Block links. No CAPTCHA or manual upload.</p>
          </div>
          <button
            type="button"
            onClick={startFetch}
            disabled={busy || activating || Boolean(preview && !importResult)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Fetching…" : "Fetch FTOs"}
          </button>
        </div>

        {progress && (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Detail processing</span>
              <span className="tabular-nums">{formatNumber(progress.attempted)} / {formatNumber(progress.total)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: percent + "%" }} />
            </div>
            <p className="text-xs text-slate-500">Staged FTO results: {formatNumber(progress.staged)}</p>
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{notice}</p>}

        {failedFtos.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-900">{formatNumber(failedFtos.length)} FTO detail page(s) need retry</p>
              <p className="mt-1 text-xs text-amber-800">Only failed records will be retried. Successful results remain staged.</p>
            </div>
            <button type="button" onClick={retryFailed} disabled={busy} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">
              Retry failed FTOs
            </button>
          </div>
          {failureDetails.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg border border-amber-100 bg-white p-3 text-xs text-amber-900">
              {failureDetails.slice(0, 10).map(item => (
                <li key={item.ftoNumber}><span className="font-semibold">{item.ftoNumber}:</span> {item.reason}</li>
              ))}
              {failureDetails.length > 10 && <li className="text-amber-700">And {formatNumber(failureDetails.length - 10)} more failed FTOs.</li>}
            </ul>
          )}
        )}
      </section>

      {preview && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="font-semibold text-slate-900">Import preview</h2>
            <p className="mt-1 text-sm text-slate-500">Village matching uses the complete Job Card Number. FTOs from other villages are excluded from activation.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-2xl font-bold tabular-nums text-slate-950">{formatNumber(preview.inScopeFtos)}</p>
              <p className="mt-1 text-xs text-slate-500">FTOs belonging to this Village Council</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-2xl font-bold tabular-nums text-slate-950">{formatNumber(preview.transactions)}</p>
              <p className="mt-1 text-xs text-slate-500">Matching transaction rows</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-2xl font-bold tabular-nums text-slate-950">{formatNumber(preview.outOfVillageFtos)}</p>
              <p className="mt-1 text-xs text-slate-500">Out-of-village FTOs excluded</p>
            </div>
          </div>

          {preview.sample.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-3">FTO Number</th><th className="px-4 py-3">Local transactions</th><th className="px-4 py-3">Matched Job Cards</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.sample.map(item => (
                    <tr key={item.ftoNumber}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{item.ftoNumber}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{formatNumber(item.transactionCount)}</td>
                      <td className="px-4 py-3 text-slate-600">{item.jobCards.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">No FTO records are activated until you confirm this import.</p>
            <button
              type="button"
              onClick={activateImport}
              disabled={activating || busy || preview.inScopeFtos === 0 || Boolean(importResult)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {activating ? "Importing…" : importResult ? "Imported" : "Confirm and import village FTOs"}
            </button>
          </div>
        </section>
      )}

      {importResult && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-semibold text-emerald-900">FTO import completed</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.ftos)}</p><p className="text-xs text-emerald-800">FTOs imported</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.transactions)}</p><p className="text-xs text-emerald-800">Transactions imported</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.excluded)}</p><p className="text-xs text-emerald-800">Out-of-village FTOs excluded</p></div>
          </div>
        </section>
      )}
    </div>
  );
}
