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
  // FTO dates are stored as date-only text; avoid timezone shifts.
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

function governmentStatusClasses(status: string) {
  const normalized = String(status || "blank").toLowerCase();
  if (normalized === "processed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function normalizedStatusLabel(tx: Transaction) {
  const normalized = String(tx.normalized_status || "").toLowerCase();
  if (normalized === "processed") return "Processed";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "deferred") return "Deferred";
  return String(tx.government_status || "blank");
}

function statusBadgeClasses(tx: Transaction) {
  const normalized = String(tx.normalized_status || "").toLowerCase();
  if (normalized === "processed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  if (normalized === "deferred") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function statusSummaryClasses(transactions: Transaction[]) {
  const counts = { processed: 0, rejected: 0, deferred: 0, other: 0 };
  for (const tx of transactions) {
    if (tx.normalized_status === "processed" || tx.normalized_status === "rejected" || tx.normalized_status === "deferred") counts[tx.normalized_status]++;
    else counts.other++;
  }
  return {
    processed: counts.processed,
    deferred: counts.deferred,
    rejected: counts.rejected,
    other: counts.other,
  };
}

function statusClassName(key: string, count: number) {
  const base = count === 0 ? "text-slate-500" : key === "processed" ? "text-emerald-700" : key === "deferred" ? "text-amber-800" : key === "rejected" ? "text-rose-700" : "text-slate-600";
  return base + (count > 0 ? " font-semibold" : "");
}

function statusSummary(transactions: Transaction[]) {
  const counts = statusSummaryClasses(transactions);
  const items = [
    { key: "processed", value: counts.processed, label: "Processed" },
    { key: "deferred", value: counts.deferred, label: "Deferred" },
    { key: "rejected", value: counts.rejected, label: "Rejected" },
    { key: "other", value: counts.other, label: "Other" },
  ].filter(item => item.value > 0).map(item => <span key={item.key} className={statusClassName(item.key, item.value)}>{item.label} {number(item.value)}</span>);
  return items.length ? items.flatMap((item, index) => index === 0 ? [item] : [<span key={item.key + "-sep"} className="text-slate-400"> · </span>, item]) : [<span key="none" className="text-slate-500">No transactions</span>];
}

function dateTime(value: string | null | undefined) {
  if (!value) return "Not checked";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(parsed);
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
            <input id="fto-register-search" value={search} onChange={event => setSearch(event.target.value)}
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
        <div className="divide-y divide-slate-100">
          {filtered.map(item => {
            const expanded = selectedId === item.id;
            return (
              <div key={item.id}>
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-4 py-4 text-left sm:px-5">
                  <div className="min-w-0">
                    <p className="break-all text-sm font-bold text-slate-950">{item.fto_number}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{item.block || "Block not recorded"}{item.first_signatory ? " · " + item.first_signatory : ""}</p>
                    <p className="mt-2 text-[11px] font-semibold">{statusSummary(item.council_fto_transactions)}</p>
                    <p className="mt-1 text-[10px] text-slate-400">Last checked: {dateTime(inspections[item.fto_number]?.last_inspected_at)}</p>
                  </div>
                  <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="text-xs font-bold text-slate-800">{date(item.fto_date)}</p>
                    {(() => {
                      const newest = [...item.council_fto_transactions].sort((a, b) => Date.parse(b.transaction_date || "") - Date.parse(a.transaction_date || ""));
                      return <span className={`mt-2 inline-flex w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusBadgeClasses(newest[0] || { normalized_status: "", government_status: "Blank" } as Transaction)}`}>{item.council_fto_transactions.length} transactions</span>;
                    })()}
                  </div>
                  <button type="button" onClick={() => setSelectedId(expanded ? "" : item.id)}
                    aria-expanded={expanded}
                    className="mt-3 w-full justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 lg:mt-0 lg:w-auto">
                    {expanded ? "Close −" : "Details +"}
                  </button>
                </div>
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-6">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold text-slate-900">Transaction details</h3>
                        <p className="mt-1 text-[10px] text-slate-500">{number(item.council_fto_transactions.length)} imported transaction(s) · Last imported {dateTime(item.last_seen_in_import_at || item.first_imported_at)}</p>
                        <p className="mt-1 text-[10px] text-slate-500">Last Government check: {dateTime(inspections[item.fto_number]?.last_inspected_at)}</p>
                        {inspections[item.fto_number] && <p className="mt-1 text-[10px] text-slate-500">Inspection: {inspections[item.fto_number].inspection_result === "matched" ? "Transactions matched" : "No matching transactions"} · {number(inspections[item.fto_number].unresolved_transaction_count)} unresolved</p>}
                      </div>
                      {item.fto_status && <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600">{item.fto_status}</span>}
                    </div>
                    {item.council_fto_transactions.length === 0 ? (
                      <p className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">No transaction details are linked to this FTO.</p>
                    ) : (
                      <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                    )}
                    {item.council_fto_transactions.length > 0 && (
                      <div className="mt-3 grid gap-3 md:hidden rounded-xl border border-slate-200 bg-white p-3">
                        {item.council_fto_transactions.map(tx => (
                          <div key={tx.id} className="rounded-xl border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-all text-xs font-semibold text-slate-900">{tx.job_card_number}</p>
                                <p className="mt-0.5 text-[10px] text-slate-500">Ref: {tx.reference_number}</p>
                              </div>
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${governmentStatusClasses(tx.government_status)}`}>{normalizedStatusLabel(tx)}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-600">
                              <p><span className="font-semibold text-slate-700">Date:</span> {date(tx.transaction_date)}</p>
                              <p className="text-right"><span className="font-semibold text-slate-700">Amount:</span> <span className="tabular-nums">{money(tx.amount_to_be_credited)}</span></p>
                            </div>
                            {tx.applicant_name || tx.primary_account_holder ? <p className="mt-2 text-[10px] text-slate-700">Applicant: {tx.applicant_name || tx.primary_account_holder}</p> : null}
                            {tx.rejection_reason && (
                              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
                                <p className="text-[10px] font-semibold text-rose-800">Rejection reason</p>
                                <p className="mt-1 text-[10px] text-rose-700">{tx.rejection_reason}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
