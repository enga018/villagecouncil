"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

type Transaction = {
  id: string;
  job_card_number: string;
  reference_number: string;
  transaction_date: string | null;
  processed_date: string | null;
  applicant_name: string | null;
  primary_account_holder: string | null;
  amount_to_be_credited: number | null;
  credit_amount: number | null;
  government_status: string;
  normalized_status: string;
  rejection_reason: string | null;
};

type Inspection = {
  fto_number: string;
  last_inspected_at: string;
  inspection_result: "matched" | "no_match";
  matching_transaction_count: number;
  unresolved_transaction_count: number;
  last_error: string | null;
  import_activated_at: string | null;
};

type Fto = {
  id: string;
  fto_number: string;
  fto_date: string | null;
  fto_status: string | null;
  block: string | null;
  first_signatory: string | null;
  beneficiary_count: number | null;
  wage_amount: number | null;
  first_imported_at: string;
  last_seen_in_import_at: string | null;
  updated_at: string;
  council_fto_transactions: Transaction[];
};

type AutoIncrement = { newFtos: number; newTransactions: number } | null;

const FTO_PAGE_SIZE = 5;

function number(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("en-IN").format(value);
}

function money(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 2,
  }).format(value);
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  }).format(parsed);
}

function dateTime(value: string | null | undefined) {
  if (!value) return "Not checked";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(parsed);
}

function governmentStatusClasses(status: string) {
  const normalized = String(status || "blank").toLowerCase();
  if (normalized === "processed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  if (normalized === "deferred") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function normalizedStatusLabel(tx: Transaction) {
  const normalized = String(tx.normalized_status || "").toLowerCase();
  if (normalized === "processed") return "Processed";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "deferred") return "Deferred";
  return String(tx.government_status || "blank");
}

function statusSummaryClasses(transactions: Transaction[]) {
  const counts = { processed: 0, deferred: 0, rejected: 0, other: 0 };
  for (const tx of transactions) {
    if (tx.normalized_status === "processed" || tx.normalized_status === "rejected" || tx.normalized_status === "deferred") counts[tx.normalized_status]++;
    else counts.other++;
  }
  return counts;
}

function statusSummary(transactions: Transaction[]) {
  const counts = statusSummaryClasses(transactions);
  const items = [
    counts.processed > 0 && <span key="processed" className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-emerald-200 bg-emerald-50 text-emerald-700">Processed {number(counts.processed)}</span>,
    counts.deferred > 0 && <span key="deferred" className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-amber-200 bg-amber-50 text-amber-700">Deferred {number(counts.deferred)}</span>,
    counts.rejected > 0 && <span key="rejected" className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-rose-200 bg-rose-50 text-rose-700">Rejected {number(counts.rejected)}</span>,
    counts.other > 0 && <span key="other" className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-slate-200 bg-slate-100 text-slate-600">Other {number(counts.other)}</span>,
  ].filter(Boolean) as React.ReactNode[];
  return items.length ? <div className="mt-2 flex flex-wrap items-center gap-2">{items}</div> : <div className="mt-2 text-[11px] text-slate-500">No transactions</div>;
}

export type FtoAutoIncrement = { newFtos: number; newTransactions: number } | null;

export default function FtoImportedRegister({ autoIncrement = null }: { autoIncrement?: FtoAutoIncrement }) {
  const [records, setRecords] = useState<Fto[]>([]);
  const [inspections, setInspections] = useState<Record<string, Inspection>>({});
  const [inspectionError, setInspectionError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ftoPage, setFtoPage] = useState(1);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      const supabase = createClient();
      const [ftoResult, inspectionResult] = await Promise.all([
        supabase
          .from("council_ftos")
          .select("id,fto_number,fto_date,fto_status,block,first_signatory,beneficiary_count,wage_amount,first_imported_at,last_seen_in_import_at,updated_at,council_fto_transactions(id,job_card_number,reference_number,transaction_date,processed_date,applicant_name,primary_account_holder,amount_to_be_credited,credit_amount,government_status,normalized_status,rejection_reason)")
          .eq("status", "active")
          .order("fto_date", { ascending: false, nullsFirst: false })
          .order("fto_number", { ascending: false }),
        supabase.functions.invoke<{ inspections?: Inspection[]; error?: string }>("council-fto-inspection-register", { body: {} }),
      ]);
      if (!active) return;
      if (ftoResult.error) {
        setError(ftoResult.error.message || "Could not load imported FTO records.");
        setRecords([]);
      } else {
        const rows = (ftoResult.data || []) as unknown as Fto[];
        setRecords(rows);
      }
      if (inspectionResult.error || inspectionResult.data?.error) {
        setInspectionError(inspectionResult.data?.error || inspectionResult.error?.message || "Inspection history is temporarily unavailable.");
        setInspections({});
      } else {
        const map: Record<string, Inspection> = {};
        for (const item of inspectionResult.data?.inspections || []) map[item.fto_number] = item;
        setInspections(map);
        setInspectionError("");
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return records;
    return records.filter(item =>
      [item.fto_number, item.fto_status, item.block, item.first_signatory]
        .some(value => String(value || "").toLocaleLowerCase().includes(term))
      || item.council_fto_transactions.some(tx =>
        [tx.job_card_number, tx.reference_number, tx.applicant_name, tx.government_status]
          .some(value => String(value || "").toLocaleLowerCase().includes(term))
      )
    );
  }, [records, search]);

  const transactionCount = records.reduce((sum, item) => sum + item.council_fto_transactions.length, 0);
  const ftoPageCount = Math.max(1, Math.ceil(filtered.length / FTO_PAGE_SIZE));
  const visibleFtos = filtered.slice((ftoPage - 1) * FTO_PAGE_SIZE, ftoPage * FTO_PAGE_SIZE);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setFtoPage(1);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--vc-shadow-card)]">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-950">Imported FTO register</h2>
            <p className="mt-1 text-xs text-slate-500">FTOs activated for this Village Council and their imported transaction details</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {autoIncrement && (autoIncrement.newFtos > 0 || autoIncrement.newTransactions > 0) && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">+{number(autoIncrement.newFtos)} FTOs · +{number(autoIncrement.newTransactions)} transactions (this fetch)</span>
            )}
            <span className="font-medium text-slate-400">{number(records.length)} FTOs · {number(transactionCount)} transactions</span>
          </div>
        </div>
        <div className="mt-4 w-full">
          <label htmlFor="fto-register-search" className="relative block">
            <span className="sr-only">Search imported FTOs</span>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" stroke="currentColor" strokeWidth="1.6"><circle cx="8.8" cy="8.8" r="5.8"/><path d="m13.2 13.2 4 4" strokeLinecap="round"/></svg>
            <input id="fto-register-search" value={search} onChange={event => handleSearchChange(event.target.value)}
              placeholder="Search FTO No., Job Card, reference number or applicant"
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"/>
          </label>
        </div>
      </div>

      {inspectionError && !loading && <div role="status" className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[10px] text-amber-900">{inspectionError} Imported FTO data is still available; last-checked timestamps are hidden until the inspection service responds.</div>}

      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500">Loading imported FTO records…</div>
      ) : error ? (
        <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-800">{records.length ? "No matching FTO records" : "No imported FTOs yet"}</p>
          <p className="mt-1 text-xs text-slate-500">{records.length ? "Try a different search term." : "After you confirm an FTO import, the activated records will appear here."}</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-slate-100">
            {visibleFtos.map(item => {
              const expanded = selectedId === item.id;
              return (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-left sm:px-5">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-bold text-slate-950">{item.fto_number}</p>
                      {statusSummary(item.council_fto_transactions)}
                      <p className="mt-2 text-[10px] text-slate-400">Last checked: {dateTime(inspections[item.fto_number]?.last_inspected_at)}</p>
                    </div>
                    <button type="button" onClick={() => setSelectedId(expanded ? "" : item.id)}
                      aria-expanded={expanded}
                      className="mt-3 w-full justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 lg:mt-0 lg:w-auto">
                      {expanded ? "Close" : "Details"}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-4 border-t border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-bold text-slate-900">Transaction details</h3>
                        <span className="text-[10px] text-slate-400">{number(item.council_fto_transactions.length)} imported</span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">Last Government check: {dateTime(inspections[item.fto_number]?.last_inspected_at)}</p>
                      {item.council_fto_transactions.length === 0 ? (
                        <p className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">No transaction details are linked to this FTO.</p>
                      ) : (
                        <>
                        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                          <table className="min-w-[900px] divide-y divide-slate-200 text-xs">
                            <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500"><tr>
                              <th className="px-3 py-3">Job Card</th><th className="px-3 py-3">Reference</th><th className="px-3 py-3">Applicant</th><th className="px-3 py-3">Transaction date</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Government status</th><th className="px-3 py-3">Rejection reason</th>
                            </tr></thead>
                            <tbody className="divide-y divide-slate-100">
                              {item.council_fto_transactions.map(tx => <tr key={tx.id}>
                                <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-900">{tx.job_card_number}</td>
                                <td className="whitespace-nowrap px-3 py-3 text-slate-600">{tx.reference_number}</td>
                                <td className="px-3 py-3 text-slate-700">{tx.applicant_name || tx.primary_account_holder || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-3 text-slate-600">{date(tx.transaction_date)}</td>
                                <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-700">{money(tx.amount_to_be_credited)}</td>
                                <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${governmentStatusClasses(tx.government_status)}`}>{normalizedStatusLabel(tx)}</span></td>
                                <td className="max-w-[240px] whitespace-normal px-3 py-3 text-slate-600">{tx.rejection_reason || "—"}</td>
                              </tr>)}
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-white p-2.5 sm:p-4 md:hidden">
                          {item.council_fto_transactions.map(tx => (
                            <div key={tx.id} className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 break-all text-xs font-semibold text-slate-900">{tx.applicant_name || tx.primary_account_holder || tx.job_card_number}</p>
                                <span className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${governmentStatusClasses(tx.government_status)}`}>{normalizedStatusLabel(tx)}</span>
                              </div>
                              <p className="mt-1 text-[10px] text-slate-500 break-all">{tx.job_card_number} · Ref: {tx.reference_number}</p>
                              <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[10px] text-slate-600">
                                <span className="tabular-nums">{money(tx.amount_to_be_credited)}</span>
                                <span>{date(tx.transaction_date)}</span>
                              </div>
                              {tx.rejection_reason && (
                                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
                                  <p className="text-[10px] font-semibold text-rose-800">Rejection reason</p>
                                  <p className="mt-1 text-[10px] text-rose-700">{tx.rejection_reason}</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
            <span className="text-[11px] text-slate-500">Page {ftoPage} of {ftoPageCount} · 5 FTOs per page</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setFtoPage(page => Math.max(1, page - 1)); }} disabled={ftoPage <= 1} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
              <button type="button" onClick={() => { setFtoPage(page => Math.min(ftoPageCount, page + 1)); }} disabled={ftoPage >= ftoPageCount} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}