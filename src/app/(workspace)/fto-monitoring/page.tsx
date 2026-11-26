"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import FtoImportedRegister, { type FtoAutoIncrement } from "@/components/fto/fto-imported-register";

type Progress = { attempted: number; total: number; staged: number };
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
  listing?: { manifestToken?: string; ftoNumbers?: string[]; alreadyImportedCount?: number; newFtoCount?: number; existingFtoRecheckedCount?: number };
};
type ImportResult = {
  newFtos: number;
  recheckedFtos: number;
  newTransactions: number;
  pendingReview: number;
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

async function getActiveCouncilId(supabase: ReturnType<typeof createClient>) {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Your session has expired. Please sign in again.");
  const { data: membership, error: membershipError } = await supabase
    .from("council_memberships")
    .select("village_council_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error("No active Village Council assignment was found.");
  return membership.village_council_id;
}

export default function FtoMonitoringPage() {
  const [busy, setBusy] = useState(false);
  const [activating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [batchId, setBatchId] = useState("");
  const [manifestToken, setManifestToken] = useState("");
  const [failedFtos, setFailedFtos] = useState<string[]>([]);
  const [failureDetails, setFailureDetails] = useState<Array<{ ftoNumber: string; reason: string }>>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [summary, setSummary] = useState<{ ftos: number | null; transactions: number | null }>({ ftos: null, transactions: null });
  const [statusTotals, setStatusTotals] = useState<{ processed: number | null; deferred: number | null; rejected: number | null }>({ processed: null, deferred: null, rejected: null });
  const [importIncrement, setImportIncrement] = useState<FtoAutoIncrement>(null);
  const [fetchDelta, setFetchDelta] = useState<FtoAutoIncrement>(null);
  const fetchBaselineRef = useRef<FtoCountBaseline | null>(null);
  const discoveryCountsRef = useRef<{ newFtos: number; recheckedFtos: number }>({ newFtos: 0, recheckedFtos: 0 });

  useEffect(() => {
    let active = true;
    async function loadSummary() {
      try {
        const supabase = createClient();
        const councilId = await getActiveCouncilId(supabase);
        const [ftos, transactions, processed, deferred, rejected] = await Promise.all([
          supabase.from("council_ftos").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("status", "active"),
          supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }).eq("village_council_id", councilId),
          supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("normalized_status", "processed"),
          supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("normalized_status", "deferred"),
          supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("normalized_status", "rejected"),
        ]);
        const failed = [ftos, transactions, processed, deferred, rejected].find(result => result.error);
        if (failed?.error) throw failed.error;
        if (!active) return;
        setSummary({ ftos: ftos.count ?? 0, transactions: transactions.count ?? 0 });
        setStatusTotals({
          processed: processed.count ?? 0,
          deferred: deferred.count ?? 0,
          rejected: rejected.count ?? 0,
        });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load FTO summary counts.");
      }
    }
    void loadSummary();
    return () => { active = false; };
  }, [importResult]);

  async function applyAndActivate(supabase: ReturnType<typeof createClient>, currentBatchId: string) {
    const { error: suggestionError } = await supabase.rpc("apply_register_fto_review_suggestions", { p_batch_id: currentBatchId });
    if (suggestionError) throw suggestionError;
    const { data, error: activationError } = await supabase.rpc("activate_council_fto_import", { p_batch_id: currentBatchId });
    if (activationError) throw activationError;
    if (!data) throw new Error("The FTO import did not return a confirmation.");
    setFetchDelta(null);
    const baseline = fetchBaselineRef.current ?? { ftos: summary.ftos ?? 0, transactions: summary.transactions ?? 0 };
    fetchBaselineRef.current = null;
    const councilId = await getActiveCouncilId(supabase);
    const [ftoCountResult, transactionCountResult] = await Promise.all([
      supabase.from("council_ftos").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("status", "active"),
      supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }).eq("village_council_id", councilId),
    ]);
    if (ftoCountResult.error) throw ftoCountResult.error;
    if (transactionCountResult.error) throw transactionCountResult.error;
    const newTransactions = Math.max(0, (transactionCountResult.count ?? 0) - baseline.transactions);
    const newFtos = discoveryCountsRef.current.newFtos;
    setImportResult({
      newFtos,
      recheckedFtos: discoveryCountsRef.current.recheckedFtos,
      newTransactions,
      pendingReview: Number(data.pendingReviewTransactions || 0),
    });
    setImportIncrement(newFtos > 0 || newTransactions > 0 ? { newFtos, newTransactions } : null);
  }



  async function processNumbers(numbers: string[], currentBatchId: string, token: string, supabase: ReturnType<typeof createClient>, initialNotice?: string) {
    if (!numbers.length) return;
    setBusy(true);
    setError("");
    setNotice(initialNotice || ("Processing " + formatNumber(numbers.length) + " FTO detail page(s) in batches of five."));
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
        await applyAndActivate(supabase, currentBatchId);
        setNotice("");
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
      discoveryCountsRef.current = {
        newFtos: Number(data.listing.newFtoCount || 0),
        recheckedFtos: Number(data.listing.existingFtoRecheckedCount || 0),
      };
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

      <section aria-label="FTO summary" className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {([
          ["Imported FTOs", summary.ftos, "Active FTOs in this Council's register", "FT", "neutral"],
          ["Imported transactions", summary.transactions, "Transactions linked to imported FTOs", "TX", "neutral"],
          ["Processed", statusTotals.processed, "Processed in the register", "PT", "success"],
          ["Deferred", statusTotals.deferred, "Deferred (status not set yet)", "DR", "warning"],
          ["Rejected", statusTotals.rejected, "Rejected in the register", "RJ", "danger"],
        ] as const).map(([label, value, description, mark, tone]) => (
          <div key={label} className="rounded-2xl border border-slate-300 bg-white p-4 shadow-[var(--vc-shadow-card)] sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-slate-600">{label}</p>
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-[9px] font-bold ${tone === "success" ? "bg-emerald-50 text-emerald-700" : tone === "warning" ? "bg-amber-50 text-amber-700" : tone === "danger" ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-500"}`}>{mark}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <p className={`text-2xl font-bold tracking-tight tabular-nums sm:text-[28px] ${tone === "success" ? "text-emerald-700" : tone === "warning" ? "text-amber-700" : tone === "danger" ? "text-rose-700" : "text-slate-900"}`}>{value === null ? "—" : formatNumber(value)}</p>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-500">{description}</p>
          </div>
        ))}
      </section>

      <FtoImportedRegister key={importResult ? "after-import" : "initial"} autoIncrement={importIncrement || fetchDelta} />

      <div className="space-y-4">
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



      {importResult && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-6">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-800">✓</span><div><p className="text-sm font-bold text-emerald-950">FTO import completed</p><p className="mt-0.5 text-xs text-emerald-800">The Village Council import returned successfully.</p></div></div>
          <div className="mt-5 grid gap-4 border-t border-emerald-200 pt-4 sm:grid-cols-2">
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.newFtos)}</p><p className="text-[11px] text-emerald-800">New FTOs discovered</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.recheckedFtos)}</p><p className="text-[11px] text-emerald-800">Existing FTOs rechecked</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-emerald-950">{formatNumber(importResult.newTransactions)}</p><p className="text-[11px] text-emerald-800">Transactions newly imported</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-amber-800">{formatNumber(importResult.pendingReview)}</p><p className="text-[11px] text-emerald-800">Rows requiring manual review</p></div>
          </div>
        </section>
      )}
    </div>
  );
}
