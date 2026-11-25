"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

type ReviewTransaction = {
  jobCardNumber?: string;
  referenceNumber?: string;
  village?: string;
  creditAmount?: string;
  governmentStatus?: string;
  transactionDate?: string;
};

type ReviewRow = {
  row_data?: { scope?: string; fto_number?: string; transactions?: ReviewTransaction[] };
};

type ReviewItem = {
  key: string;
  batchId: string;
  ftoNumber: string;
  referenceNumber: string;
  jobCardNumber: string;
  amount: string;
  status: string;
  date: string;
};

type Decision = "in_village" | "not_in_village";
type ApplyState = "idle" | "applying" | "done";

function money(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && value !== "" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount) : "—";
}

function itemKey(ftoNumber: string, referenceNumber: string) {
  return ftoNumber + "|" + referenceNumber;
}

function normalizeJobCard(value: string) {
  return value.trim().toUpperCase();
}

function decisionButtonClasses(isActive: boolean, busy: boolean) {
  return `min-h-9 rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${isActive ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}${busy ? " disabled:cursor-not-allowed" : ""}`;
}

function rowKey(item: ReviewItem) {
  return item.key;
}

async function loadBatchRows(supabase: ReturnType<typeof createClient>, batchId: string) {
  const rows: ReviewRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("council_fto_import_rows")
      .select("row_data")
      .eq("import_batch_id", batchId)
      .order("row_number", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data || []) as ReviewRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export default function FtoReviewQueue({ applied, autoCount = 0, onAutoFtos }: { applied?: (batchIds: string[], autoFtos: string[]) => Promise<void>; autoCount?: number; onAutoFtos?: (ftos: string[]) => void }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [registerStatus, setRegisterStatus] = useState<Map<string, string>>(new Map());
  const [autoFtos, setAutoFtos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [error, setError] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const REVIEW_PAGE_SIZE = 10;

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      setRegisterError("");
      setApplyState("idle");
      setAutoFtos([]);
      try {
        const supabase = createClient();
        const { data: batches, error: batchesError } = await supabase
          .from("council_fto_import_batches")
          .select("id,status,created_at")
          .in("status", ["processing", "pending", "completed"])
          .order("created_at", { ascending: false });
        if (batchesError) throw batchesError;

        const seenFtos = new Set<string>();
        const reviewItems: ReviewItem[] = [];
        for (const batch of batches || []) {
          const batchId = String(batch.id);
          const rows = await loadBatchRows(supabase, batchId);
          for (const row of rows) {
            const ftoNumber = String(row.row_data?.fto_number || "");
            if (!ftoNumber || seenFtos.has(ftoNumber)) continue;
            seenFtos.add(ftoNumber);
            const scope = row.row_data?.scope;
            if (scope !== "IN_SCOPE" && scope !== "NEEDS_REVIEW") continue;
            for (const tx of row.row_data?.transactions || []) {
              if (String(tx.village || "").trim()) continue;
              const referenceNumber = String(tx.referenceNumber || "");
              reviewItems.push({
                key: itemKey(ftoNumber, referenceNumber),
                batchId,
                ftoNumber,
                referenceNumber,
                jobCardNumber: String(tx.jobCardNumber || ""),
                amount: String(tx.creditAmount || ""),
                status: String(tx.governmentStatus || "blank"),
                date: String(tx.transactionDate || ""),
              });
            }
          }
        }

        const { data: decisionRows, error: decisionError } = await supabase
          .from("council_fto_review_decisions")
          .select("fto_number,reference_number,decision");
        if (decisionError) throw decisionError;
        const decisionMap: Record<string, Decision> = {};
        for (const item of decisionRows || []) {
          decisionMap[itemKey(String(item.fto_number), String(item.reference_number))] = item.decision as Decision;
        }

        const jobCards = Array.from(new Set(reviewItems.map(item => normalizeJobCard(item.jobCardNumber)).filter(Boolean)));
        const registered = new Map<string, string>();
        let lookupError = "";
        for (let offset = 0; offset < jobCards.length; offset += 200) {
          const { data: cards, error: cardError } = await supabase
            .from("council_job_cards")
            .select("job_card_number,status")
            .in("job_card_number", jobCards.slice(offset, offset + 200));
          if (cardError) { lookupError = cardError.message; break; }
          for (const card of cards || []) {
            registered.set(normalizeJobCard(String(card.job_card_number || "")), String(card.status || ""));
          }
        }

        if (!active) return;
        setItems(reviewItems);
        setDecisions(decisionMap);
        setRegisterStatus(registered);
        setRegisterError(lookupError ? "Could not check the job card register: " + lookupError : "");
        const byCard = new Map<string, string>();
        for (const item of reviewItems) {
          if (!item.jobCardNumber || byCard.has(item.jobCardNumber)) continue;
          const alreadyDecided = decisionMap[item.key] === "in_village";
          const activeMatch = registerStatus.get(normalizeJobCard(item.jobCardNumber)) === "active";
          if (!alreadyDecided && activeMatch && !byCard.has(item.jobCardNumber)) byCard.set(item.jobCardNumber, item.ftoNumber);
          if (alreadyDecided) byCard.set(item.jobCardNumber, item.ftoNumber);
        }
        const suggested = [...byCard.values()];
        setAutoFtos(suggested);
        onAutoFtos?.(suggested);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load manual review rows.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [onAutoFtos]);

  const pendingCount = useMemo(() => items.filter(item => !decisions[item.key]).length, [items, decisions]);

  const suggestedItems = useMemo(
    () => items.filter(item => !decisions[item.key] && registerStatus.get(normalizeJobCard(item.jobCardNumber)) === "active"),
    [items, decisions, registerStatus],
  );
  const visibleSuggested = showAll || suggestedItems.length <= 1 ? suggestedItems : suggestedItems.slice(0, 1);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return items;
    return items.filter(item =>
      item.ftoNumber.toLowerCase().includes(term) ||
      item.jobCardNumber.toLowerCase().includes(term) ||
      item.referenceNumber.toLowerCase().includes(term) ||
      item.date.toLowerCase().includes(term) ||
      money(item.amount).toLowerCase().includes(term)
    );
  }, [items, search]);

  const reviewPageCount = Math.max(1, Math.ceil(filteredItems.length / REVIEW_PAGE_SIZE));
  const visible = filteredItems.slice((reviewPage - 1) * REVIEW_PAGE_SIZE, reviewPage * REVIEW_PAGE_SIZE);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setReviewPage(1);
  };

  async function decide(item: ReviewItem, decision: Decision) {
    setSaving(item.key);
    setError("");
    const { error: rpcError } = await createClient().rpc("set_council_fto_review_decision", {
      p_fto_number: item.ftoNumber,
      p_reference_number: item.referenceNumber,
      p_decision: decision,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setDecisions(current => ({ ...current, [item.key]: decision }));
    }
    setSaving("");
  }

  async function applyDecisions() {
    if (!applied || applyState !== "idle") return;
    setApplyState("applying");
    setError("");
    try {
      const autoBatchFtos = [...new Set(autoFtos.filter(number => !items.some(item => item.ftoNumber === number && decisions[item.key])))];
      await applied([...new Set(items.map(item => item.batchId))], autoBatchFtos);
      setApplyState("done");
    } catch {
      setApplyState("idle");
    }
  }

  if (!loading && items.length === 0 && !error) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--vc-shadow-card)]">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <h2 className="text-base font-bold tracking-tight text-slate-950">Manual review: Panchayat not shown</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Government did not show the Panchayat name for these transactions. Job Cards that are <span className="font-semibold text-slate-700">active</span> in your register are suggested. Any row can be decided manually.
        </p>
        {registerError && <p role="status" className="mt-2 text-[11px] text-amber-900">{registerError}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-800">{error}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">{loading ? "Loading…" : `${pendingCount.toLocaleString("en-IN")} of ${items.length.toLocaleString("en-IN")} awaiting decision`}</span>
          <label className="relative min-w-0 flex-1 md:max-w-2xl">
            <span className="sr-only">Search review rows</span>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" stroke="currentColor" strokeWidth="1.6"><circle cx="8.8" cy="8.8" r="5.8"/><path d="m13.2 13.2 4 4" strokeLinecap="round"/></svg>
            <input value={search} onChange={event => handleSearchChange(event.target.value)} placeholder="Search FTO, Job Card, reference or amount"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"/>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-emerald-800">{(visibleSuggested.length || autoFtos.length).toLocaleString("en-IN")} suggested from active Job Cards{autoCount ? ` · page total: ${autoCount.toLocaleString("en-IN")}` : ""}</span>
          <button type="button" onClick={() => setShowAll(current => !current)} aria-expanded={showAll} className="text-[10px] font-semibold text-slate-500 transition hover:text-slate-700">
            {showAll ? "Hide other rows" : "Show other rows"}
          </button>
        </div>
        {!loading && suggestedItems.length > 0 && (
          <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
            <button type="button" onClick={applyDecisions} disabled={applyState === "applying"}
              className="min-h-9 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50">
              {applyState === "applying" ? "Applying…" : applyState === "done" ? "Applied" : `Accept ${suggestedItems.length.toLocaleString("en-IN")} suggested as In village`}
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="divide-y divide-slate-100">
          {visible.map(item => {
            const decision = decisions[item.key];
            const busy = saving === item.key;
            const register = registerStatus.get(normalizeJobCard(item.jobCardNumber));
            return (
              <div key={rowKey(item)} className="px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-xs font-semibold text-slate-900">{item.jobCardNumber || "—"}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">FTO {item.ftoNumber} · REF {item.referenceNumber || "—"}</p>
                    <p className="mt-1 text-[10px] text-slate-600">{item.date || "—"} · {item.status}</p>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <span className="whitespace-nowrap text-xs font-semibold">{money(item.amount)}</span>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={() => decide(item, "in_village")} className={decisionButtonClasses(decision === "in_village", busy)}>
                        In village
                      </button>
                      <button type="button" disabled={busy} onClick={() => decide(item, "not_in_village")} className={decisionButtonClasses(decision === "not_in_village", busy)}>
                        Not in village
                      </button>
                      {!decision && register === "active" && <span className="text-[10px] font-semibold text-emerald-700">Suggested</span>}
                    </div>
                    <span className="text-[10px] text-slate-500">
                      {register === "active" ? "Active in register" : register ? `In register (${register})` : "Not in register"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
          <span className="text-[11px] text-slate-500">Page {reviewPage} of {reviewPageCount} · {REVIEW_PAGE_SIZE} rows per page</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setReviewPage(page => Math.max(1, page - 1))} disabled={reviewPage <= 1} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <button type="button" onClick={() => setReviewPage(page => Math.min(reviewPageCount, page + 1))} disabled={reviewPage >= reviewPageCount} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </section>
  );
}
