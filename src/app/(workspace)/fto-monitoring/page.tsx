"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import FtoImportedRegister, { type FtoAutoIncrement } from "@/components/fto/fto-imported-register";
import FtoReviewQueue from "@/components/fto/fto-review-queue";

type FtoPreview = {
  inScopeFtos: number;
  reviewFtos: number;
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
type ImportResult = {
  ftos: number;
  transactions: number;
  excluded: number;
  pendingReview: number;
  autoIncluded: number;
};
type FtoCountBaseline = { ftos: number; transactions: number };

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
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [summary, setSummary] = useState<{ ftos: number | null; transactions: number | null; registerTotal: number | null }>({ ftos: null, transactions: null, registerTotal: null });
  const [statusTotals, setStatusTotals] = useState<{ processed: number | null; deferred: number | null; rejected: number | null }>({ processed: null, deferred: null, rejected: null });
  const [importIncrement, setImportIncrement] = useState<FtoAutoIncrement>(null);
  const [fetchDelta, setFetchDelta] = useState<FtoAutoIncrement>(null);
  const fetchBaselineRef = useRef<FtoCountBaseline | null>(null);

  useEffect(() => {
    let active = true;
    async function loadSummary() {
      const supabase = createClient();
      const [ftos, transactions, registerTotals, statusRows] = await Promise.all([
        supabase.from("council_ftos").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("council_fto_transactions").select("id"),
        supabase.from("council_ftos").select("id", { count: "exact", head: true }),
        supabase.from("council_fto_transactions").select("normalized_status"),
      ]);
      if (!active) return;
      const rows = Array.isArray(statusRows?.data) ? statusRows.data as Array<{ normalized_status: string }> : [];
      setStatusTotals({
        processed: rows.filter(row => row.normalized_status === "processed").length,
        deferred: rows.filter(row => row.normalized_status === "deferred").length,
        rejected: rows.filter(row => row.normalized_status === "rejected").length,
      });
      setSummary({ ftos: ftos.count ?? null, transactions: transactions.count ?? null, registerTotal: registerTotals.count ?? null });
    }
    void loadSummary();
    return () => { active = false; };
  }, [importResult]);

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
    const reviewRows = rows.filter(row => row.row_data?.scope === "NEEDS_REVIEW");
    const outOfVillage = rows.filter(row => row.row_data?.scope === "OUT_OF_SCOPE");
    const transactions = inScope.reduce((sum, row) => sum + (Array.isArray(row.row_data?.transactions) ? row.row_data.transactions.length : 0), 0);
    setPreview({
      inScopeFtos: inScope.length,
      reviewFtos: reviewRows.length,
      outOfVillageFtos: outOfVillage.length,
      transactions,
      sample: inScope.slice(0, 12).map(row => ({
        ftoNumber: String(row.row_data?.fto_number || ""),
        transactionCount: Array.isArray(row.row_data?.transactions) ? row.row_data.transactions.length : 0,
        jobCards: Array.from(new Set<string>((row.row_data?.transactions || []).map(tx => String(tx.jobCardNumber || "")))).slice(0, 4),
      })),
    });
  }

  async function applyAndActivate(supabase: ReturnType<typeof createClient>, currentBatchId: string) {
    const { data: autoIncluded, error: suggestionError } = await supabase.rpc("apply_register_fto_review_suggestions", { p_batch_id: currentBatchId });
    if (suggestionError) throw suggestionError;
    const { data, error: activationError } = await supabase.rpc("activate_council_fto_import", { p_batch_id: currentBatchId });
    if (activationError) throw activationError;
    if (!data) throw new Error("The FTO import did not return a confirmation.");
    setFetchDelta(null);
    const baseline = fetchBaselineRef.current ?? { ftos: summary.ftos ?? 0, transactions: summary.transactions ?? 0 };
    fetchBaselineRef.current = null;
    const ftos = Number(data.importedFtos || 0), transactions = Number(data.importedTransactions || 0);
    const newFtos = Math.max(0, ftos - baseline.ftos);
    const newTransactions = Math.max(0, transactions - baseline.transactions);
    setImportResult({ ftos, transactions, excluded: Number(data.excludedOutOfVillageFtos || 0), pendingReview: Number(data.pendingReviewTransactions || 0), autoIncluded: Number(autoIncluded || 0) });
    setImportIncrement(newFtos > 0 || newTransactions > 0 ? { newFtos, newTransactions } : null);
  }

  async function applyReviewDecisions() {
    if (!batchId || activating || busy) return;
    setActivating(true);
    setError("");
    setNotice("");
    try {
      await applyAndActivate(createClient(), batchId);
      setImportIncrement(null);
      setNotice("Review decisions applied. Rows marked In village are now in the Council's FTO register.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Applying review decisions failed.");
    } finally {
      setActivating(false);
    }
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
        setNotice(formatNumber(failedList.length) + " FTO(s) need retry. Successful FTOs stay staged.");
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
        const baseline = fetchBaselineRef.current ?? { ftos: summary.ftos ?? 0, transactions: summary.transactions ?? 0 };
        fetchBaselineRef.current = null;
        const [nextFtosResult, nextTransactionsResult] = await Promise.all([
          supabase.from("council_ftos").select("id", { count: "exact", head: true }).eq("status", "active"),
          supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }),
        ]);
        const nextFtos = nextFtosResult.count ?? 0, nextTransactions = nextTransactionsResult.count ?? 0;
        const delta = { newFtos: Math.max(0, nextFtos - baseline.ftos), newTransactions: Math.max(0, nextTransactions - baseline.transactions) };
        setFetchDelta(delta.newFtos > 0 || delta.newTransactions > 0 ? delta : null);
        await loadPreview(supabase, currentBatchId);
        await applyAndActivate(supabase, currentBatchId);
        setNotice("Import complete. Active register Job Cards were included automatically; rows that still need a decision are listed for manual review.");
      } else if (!failedList.length) {
        setFailedFtos(numbers);
        setNotice("The batch is not complete yet. Retry this set; FTOs already staged will be skipped automatically.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete the FTO import.");
      setImportIncrement(null);
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
    setImportIncrement(null);
    setFetchDelta(null);
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
      const beforeFetch = fetchBaselineRef.current ?? { ftos: summary.ftos ?? 0, transactions: summary.transactions ?? 0 };
      fetchBaselineRef.current = null;
      setFetchDelta(null);
      if (!data?.batchId || !data?.listing?.manifestToken || !Array.isArray(data?.listing?.ftoNumbers)) {
        throw new Error("The Government FTO listing did not return a valid processing batch.");
      }
      const numbers = data.listing.ftoNumbers.map((value: unknown) => String(value || "").trim()).filter(Boolean);
      if (!numbers.length) throw new Error("The Government listing returned no eligible FTO numbers.");
      setBatchId(data.batchId);
      setManifestToken(data.listing.manifestToken);
      setProgress({ attempted: 0, total: numbers.length, staged: 0 });
      fetchBaselineRef.current = beforeFetch;
      const skipped = Number(data.listing.alreadyImportedCount || 0);
      const initialNotice = "Importing " + formatNumber(numbers.length) + " eligible First Signatory FTOs for " + (data.councilLocation?.block || "the selected Block") +
        (skipped ? "; skipped " + formatNumber(skipped) + " completed or out-of-village FTOs." : ".");
      await processNumbers(numbers, data.batchId, data.listing.manifestToken, supabase, initialNotice);
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

  const percent = progress?.total ? Math.min(100, Math.round((progress.attempted / progress.total) * 100)) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Financial operations</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">FTO Monitoring</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Fetching imports this Council&apos;s FTOs automatically. Only rows without a Panchayat name on the Government page need a manual decision.</p>
        </div>
        <button
          type="button"
          onClick={() => startFetch(false)}
          disabled={busy || activating}
          aria-busy={busy}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} stroke="currentColor" strokeWidth="1.7">
            <path d="M16.5 7.5A6.8 6.8 0 0 0 4.2 5.2L2.5 7M2.5 7V3.8M2.5 7h3.2M3.5 12.5a6.8 6.8 0 0 0 12.3 2.3l1.7-1.8m0 0v3.2m0-3.2h-3.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {busy ? "Fetching…" : "Fetch FTOs"}
        </button>
      </section>

      <section aria-label="FTO summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {([
          ["Imported FTOs", summary.ftos, "Active FTOs in this Council's register", "FT", importIncrement?.newFtos || fetchDelta?.newFtos || 0],
          ["Imported transactions", summary.transactions, "Transactions linked to imported FTOs", "TX", importIncrement?.newTransactions || fetchDelta?.newTransactions || 0],
          ["Processed", statusTotals.processed, "Processed in the register", "PT", 0],
          ["Deferred", statusTotals.deferred, "Deferred (status not set yet)", "DR", 0],
          ["Rejected", statusTotals.rejected, "Rejected in the register", "RJ", 0],
          ["FTO register", summary.registerTotal, "Total FTOs in the register", "TOT", 0],
        ] as const).map(([label, value, description, mark]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--vc-shadow-card)] sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-[9px] font-bold text-slate-500">{mark}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <p className="text-2xl font-bold tracking-tight tabular-nums text-slate-950 sm:text-[28px]">{value === null ? "—" : formatNumber(value)}</p>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">{description}</p>
          </div>
        ))}
      </section>

      <FtoImportedRegister key={importResult ? "after-import" : "initial"} autoIncrement={importIncrement || fetchDelta} />

      <div className="space-y-4">
        {progress && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-700">FTO detail processing</p><p className="text-xs tabular-nums text-slate-500">{formatNumber(progress.attempted)} / {formatNumber(progress.total)} attempted</p></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: percent + "%" }}/></div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-slate-400"><span>{percent}% processed</span><span>{formatNumber(progress.staged)} staged FTO results</span></div>
          </div>
        )}

        {(error || notice) && <div className="space-y-2">{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-800"><span className="font-bold">Action required: </span>{error}</p>}{notice && <p role="status" className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">{notice}</p>}</div>}

        {failedFtos.length > 0 && (
          <div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div><p className="text-sm font-bold text-amber-950">{formatNumber(failedFtos.length)} FTO detail page(s) need retry</p><p className="mt-1 text-xs text-amber-800">Only failed records will be retried. Successful results remain staged.</p></div>
                <button type="button" onClick={retryFailed} disabled={busy} className="min-h-10 rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-bold text-amber-900 disabled:opacity-50">Retry failed FTOs</button>
              </div>
              {failureDetails.length > 0 && <ul className="mt-3 space-y-1 border-t border-amber-200 pt-3 text-[11px] leading-5 text-amber-900">{failureDetails.slice(0, 10).map(item => <li key={item.ftoNumber}><span className="font-bold">{item.ftoNumber}:</span> {item.reason}</li>)}{failureDetails.length > 10 && <li className="text-amber-700">And {formatNumber(failureDetails.length - 10)} more failed FTOs.</li>}</ul>}
            </div>
          </div>
        )}
      </div>

      {preview && (
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-emerald-700">Import summary</p><h2 className="mt-1 text-lg font-bold tracking-tight text-slate-950">Matching transactions</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Named Panchayat rows are included when they match this Council. Blank-name rows are included when their Job Card is active in your register, or when you mark them In village below.</p></div>
            <span className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${importResult ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-amber-100 bg-amber-50 text-amber-800"}`}>{importResult ? "Imported" : "Not imported yet"}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4"><p className="text-2xl font-bold tabular-nums text-emerald-900">{formatNumber(preview.inScopeFtos + preview.reviewFtos)}</p><p className="mt-1 text-[11px] font-medium text-emerald-800">FTOs with transactions for this Council</p></div>
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

        </section>
      )}

      {batchId && preview && <FtoReviewQueue batchId={batchId} applied={applyReviewDecisions} />}

      {importResult && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-6">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-800">✓</span><div><p className="text-sm font-bold text-emerald-950">FTO import completed</p><p className="mt-0.5 text-xs text-emerald-800">The Village Council import returned successfully.</p></div></div>
          <div className="mt-5 grid gap-4 border-t border-emerald-200 pt-4 sm:grid-cols-5">
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.ftos)}</p><p className="text-[11px] text-emerald-800">Total FTOs in register</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.transactions)}</p><p className="text-[11px] text-emerald-800">Total transactions in register</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.excluded)}</p><p className="text-[11px] text-emerald-800">Out-of-village FTOs excluded</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-amber-800">{formatNumber(importResult.pendingReview)}</p><p className="text-[11px] text-emerald-800">Review rows still undecided</p></div>
          </div>
        </section>
      )}
    </div>
  );
}
