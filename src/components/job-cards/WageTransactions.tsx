"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type WageTransaction = {
  id: string;
  fto_number: string;
  reference_number: string;
  transaction_date: string | null;
  processed_date: string | null;
  applicant_name: string | null;
  primary_account_holder: string | null;
  amount_to_be_credited: number | string | null;
  government_status: string;
  normalized_status: "processed" | "rejected" | "deferred";
  rejection_reason: string | null;
};

const PAGE_SIZE = 20;

function formatDate(value: string | null) {
  if (!value) return "Date not recorded";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "Date not recorded"
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatAmount(value: number | string | null) {
  if (value === null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function statusLabel(status: WageTransaction["normalized_status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: WageTransaction["normalized_status"]) {
  if (status === "processed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export default function WageTransactions({
  councilId,
  jobCardNumber,
}: {
  councilId: string;
  jobCardNumber: string;
}) {
  const [transactions, setTransactions] = useState<WageTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    const supabase = createClient();
    const { data, count, error: queryError } = await supabase
      .from("council_fto_transactions")
      .select(
        "id,fto_number,reference_number,transaction_date,processed_date,applicant_name,primary_account_holder,amount_to_be_credited,government_status,normalized_status,rejection_reason",
        { count: "exact" },
      )
      .eq("village_council_id", councilId)
      .eq("job_card_number", jobCardNumber)
      .order("transaction_date", { ascending: false, nullsFirst: false })
      .order("processed_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (queryError) throw queryError;
    const rows = (data || []) as WageTransaction[];
    setTransactions(current => append ? [...current, ...rows] : rows);
    setHasMore(offset + rows.length < (count ?? 0));
  }, [councilId, jobCardNumber]);

  useEffect(() => {
    let active = true;
    async function loadInitial() {
      setLoading(true);
      setError("");
      try {
        await loadPage(0, false);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load wage transactions.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadInitial();
    return () => { active = false; };
  }, [loadPage]);

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError("");
    try {
      await loadPage(transactions.length, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load more wage transactions.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="mt-4 border-t border-slate-100 pt-4" aria-label={`Wage transactions for ${jobCardNumber}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold text-slate-900">Wage Transactions</h3>
          <p className="mt-1 text-[10px] text-slate-500">Government-reported wage records for this Job Card</p>
        </div>
        {!loading && <span className="text-[10px] text-slate-400">{transactions.length.toLocaleString("en-IN")} shown</span>}
      </div>

      {loading ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">Loading wage transactions…</p>
      ) : error && transactions.length === 0 ? (
        <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">{error}</p>
      ) : transactions.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">No Government wage transactions are recorded for this Job Card.</p>
      ) : (
        <>
          <div className="mt-3 hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
            <table className="w-full min-w-[760px] divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Transaction date</th>
                  <th className="px-3 py-2.5">Applicant</th>
                  <th className="px-3 py-2.5">FTO number</th>
                  <th className="px-3 py-2.5">Reference</th>
                  <th className="px-3 py-2.5">Amount to be credited</th>
                  <th className="px-3 py-2.5">Government status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map(transaction => (
                  <tr key={transaction.id} className="text-xs text-slate-700">
                    <td className="whitespace-nowrap px-3 py-3">{formatDate(transaction.transaction_date)}</td>
                    <td className="px-3 py-3 font-medium text-slate-900">{transaction.applicant_name || transaction.primary_account_holder || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3">{transaction.fto_number}</td>
                    <td className="whitespace-nowrap px-3 py-3">{transaction.reference_number}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatAmount(transaction.amount_to_be_credited)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClass(transaction.normalized_status)}`}>
                        {statusLabel(transaction.normalized_status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 space-y-2 md:hidden">
            {transactions.map(transaction => (
              <article key={transaction.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-xs font-semibold text-slate-900">{transaction.applicant_name || transaction.primary_account_holder || "Applicant not recorded"}</p>
                    <p className="mt-1 break-all text-[10px] text-slate-500">{transaction.fto_number}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-semibold ${statusClass(transaction.normalized_status)}`}>
                    {statusLabel(transaction.normalized_status)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-[10px]">
                  <div><span className="text-slate-400">Transaction date</span><p className="mt-0.5 text-slate-700">{formatDate(transaction.transaction_date)}</p></div>
                  <div><span className="text-slate-400">Amount</span><p className="mt-0.5 font-semibold tabular-nums text-slate-900">{formatAmount(transaction.amount_to_be_credited)}</p></div>
                  <div className="col-span-2"><span className="text-slate-400">Reference number</span><p className="mt-0.5 break-all text-slate-700">{transaction.reference_number}</p></div>
                </div>
                {transaction.rejection_reason && (
                  <div className="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
                    <p className="text-[10px] font-semibold text-rose-800">Rejection reason</p>
                    <p className="mt-1 text-[10px] text-rose-700">{transaction.rejection_reason}</p>
                  </div>
                )}
              </article>
            ))}
          </div>

          {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
          {hasMore && (
            <div className="mt-3 text-center">
              <button type="button" onClick={() => void handleLoadMore()} disabled={loadingMore}
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50">
                {loadingMore ? "Loading…" : "Load more transactions"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
