"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import FtoCoAction from "@/components/fto/FtoCoAction";
import { SPLIT_GRID } from "@/lib/layout";

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
  current_co_tag_id: string | null;
  latest_co_calculation_id: string | null;
  co_calculation_version: number;
  council_fto_transactions: Transaction[];
};


const FTO_PAGE_SIZE = 20;

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


export type FtoAutoIncrement = { newFtos: number; newTransactions: number } | null;

export default function FtoImportedRegister({ autoIncrement = null }: { autoIncrement?: FtoAutoIncrement }) {
  const [records, setRecords] = useState<Fto[]>([]);
  const [inspections, setInspections] = useState<Record<string, Inspection>>({});
  const [inspectionError, setInspectionError] = useState("");
  const [search, setSearch] = useState("");
  const [coFilter, setCoFilter] = useState<"pending" | "all">("pending");
  const [selectedId, setSelectedId] = useState("");
  const [selectedTab, setSelectedTab] = useState<"details" | "co">("details");
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
          .select("id,fto_number,fto_date,fto_status,block,first_signatory,beneficiary_count,wage_amount,first_imported_at,last_seen_in_import_at,updated_at,current_co_tag_id,latest_co_calculation_id,co_calculation_version,council_fto_transactions(id,job_card_number,reference_number,transaction_date,processed_date,applicant_name,primary_account_holder,amount_to_be_credited,credit_amount,government_status,normalized_status,rejection_reason)")
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
    return records.filter(item => {
      const matchesCo = coFilter === "all" || item.co_calculation_version <= 0;
      const matchesSearch = !term ||
        [item.fto_number, item.fto_status, item.block, item.first_signatory]
          .some(value => String(value || "").toLocaleLowerCase().includes(term))
        || item.council_fto_transactions.some(tx =>
          [tx.job_card_number, tx.reference_number, tx.applicant_name, tx.government_status]
            .some(value => String(value || "").toLocaleLowerCase().includes(term))
        );
      return matchesCo && matchesSearch;
    });
  }, [records, search, coFilter]);

  const sortedFiltered = useMemo(() => [...filtered].sort((a, b) => {
    const aChecked = inspections[a.fto_number]?.last_inspected_at;
    const bChecked = inspections[b.fto_number]?.last_inspected_at;
    if (aChecked && bChecked) {
      const difference = new Date(bChecked).getTime() - new Date(aChecked).getTime();
      if (difference !== 0) return difference;
    } else if (aChecked) return -1;
    else if (bChecked) return 1;

    const aDate = a.fto_date ? new Date(a.fto_date).getTime() : 0;
    const bDate = b.fto_date ? new Date(b.fto_date).getTime() : 0;
    if (aDate !== bDate) return bDate - aDate;
    return b.fto_number.localeCompare(a.fto_number);
  }), [filtered, inspections]);

  const ftoPageCount = Math.max(1, Math.ceil(sortedFiltered.length / FTO_PAGE_SIZE));
  const visibleFtos = sortedFiltered.slice((ftoPage - 1) * FTO_PAGE_SIZE, ftoPage * FTO_PAGE_SIZE);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setFtoPage(1);
  };

  return (
    <section className="min-w-0">


      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500">Loading imported FTO records…</div>
      ) : error ? (
        <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{error}</div>
      ) : (
        <div className={`grid min-h-[560px] ${SPLIT_GRID}`}>
          <div className={`min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white ${selectedId ? "hidden md:block" : "block"}`}>
            <div className="space-y-3 border-b border-slate-200 p-4">
              <label htmlFor="fto-register-search" className="relative block w-full min-w-0">
                <span className="sr-only">Search imported FTOs</span>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" stroke="currentColor" strokeWidth="1.6"><circle cx="8.8" cy="8.8" r="5.8"/><path d="m13.2 13.2 4 4" strokeLinecap="round"/></svg>
                <input id="fto-register-search" value={search} onChange={event => handleSearchChange(event.target.value)} placeholder="Search FTO No., Job Card, or applicant"
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-600 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"/>
              </label>
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                  {(["pending", "all"] as const).map(value => <button key={value} type="button" onClick={() => { setCoFilter(value); setFtoPage(1); }} aria-pressed={coFilter === value} className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition ${coFilter === value ? "bg-white text-blue-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{value === "pending" ? "CO Pending" : "All"}</button>)}
                </div>
                <span className="shrink-0 text-[11px] text-slate-600">{number(filtered.length)} FTOs</span>
              </div>
              {autoIncrement && (autoIncrement.newFtos > 0 || autoIncrement.newTransactions > 0) && <p className="text-[10px] font-semibold text-emerald-700">+{number(autoIncrement.newFtos)} FTOs · +{number(autoIncrement.newTransactions)} transactions this fetch</p>}
              {inspectionError && !loading && <p role="status" className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">{inspectionError} Imported FTO data is still available; last-checked timestamps are hidden until the inspection service responds.</p>}
            </div>
            <div className="divide-y divide-slate-100">
              {visibleFtos.length === 0 && <div className="px-4 py-12 text-center"><p className="text-sm font-semibold text-slate-700">{records.length ? "No matching FTO records" : "No imported FTOs yet"}</p><p className="mt-1 text-xs text-slate-500">{records.length ? "Try a different search term or choose All." : "After you confirm an FTO import, activated records will appear here."}</p></div>}
              {visibleFtos.map(item => {
                const counts = statusSummaryClasses(item.council_fto_transactions);
                const selected = selectedId === item.id;
                return (
                  <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setSelectedTab("details"); }} aria-pressed={selected}
                    className={`block min-h-[88px] w-full border-l-[3px] px-4 py-4 text-left transition-colors cursor-pointer ${selected ? "border-l-blue-600 bg-blue-50/60" : "border-l-transparent bg-white hover:bg-slate-50/80"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="break-all text-[13px] font-bold text-slate-950">{item.fto_number}</p>
                      {coFilter === "all" && item.co_calculation_version <= 0 && <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-800">CO Pending</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {counts.processed > 0 && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Processed {number(counts.processed)}</span>}
                      {counts.deferred > 0 && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Deferred {number(counts.deferred)}</span>}
                      {counts.rejected > 0 && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Rejected {number(counts.rejected)}</span>}
                      {counts.other > 0 && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Other {number(counts.other)}</span>}
                    </div>
                    <p className="mt-2 text-[10px] text-slate-600">Checked {dateTime(inspections[item.fto_number]?.last_inspected_at)}</p>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
              <span className="text-[10px] text-slate-500">Page {ftoPage} of {ftoPageCount} · 20 FTOs per page</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setFtoPage(page => Math.max(1, page - 1))} disabled={ftoPage <= 1} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:opacity-40">Previous</button>
                <button type="button" onClick={() => setFtoPage(page => Math.min(ftoPageCount, page + 1))} disabled={ftoPage >= ftoPageCount} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:opacity-40">Next</button>
              </div>
            </div>
          </div>

          <div className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 ${selectedId ? "block" : "hidden md:block"}`}>
            {(() => {
              const item = visibleFtos.find(row => row.id === selectedId) || sortedFiltered.find(row => row.id === selectedId);
              if (!item) return <div className="flex min-h-[420px] items-center justify-center text-center"><div><p className="text-sm font-semibold text-slate-700">Select an FTO</p><p className="mt-1 text-xs text-slate-600">FTO transaction details and CO actions will appear here.</p></div></div>;
              const counts = statusSummaryClasses(item.council_fto_transactions);
              return <div>
                <div className="mb-4 flex items-start gap-3">
                  <button type="button" onClick={() => setSelectedId("")} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 md:hidden">← Back</button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[.13em] text-blue-700">Selected FTO</p>
                    <h3 className="mt-1 break-all text-lg font-bold text-slate-950">{item.fto_number}</h3>
                    <p className="mt-1 text-[10px] text-slate-500">Last Government check: {dateTime(inspections[item.fto_number]?.last_inspected_at)}</p>
                  </div>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([["Transactions", item.council_fto_transactions.length], ["Processed", counts.processed], ["Deferred", counts.deferred], ["Rejected", counts.rejected]] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums text-slate-950">{number(value)}</p></div>)}
                </div>
                <div className="mb-4 flex gap-2 border-b border-slate-200">
                  <button type="button" onClick={() => setSelectedTab("details")} className={`border-b-2 px-3 py-2 text-xs font-semibold ${selectedTab === "details" ? "border-blue-700 text-blue-800" : "border-transparent text-slate-500"}`}>Details</button>
                  <button type="button" onClick={() => setSelectedTab("co")} className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${selectedTab === "co" ? "border-blue-700 text-blue-800" : "border-transparent text-slate-500"}`}>{item.co_calculation_version > 0 ? "View CO" : "Calculate CO"}{item.co_calculation_version > 0 && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">CO Done</span>}</button>
                </div>
                {selectedTab === "co" ? (
                  <FtoCoAction key={item.id} ftoId={item.id} ftoNumber={item.fto_number} initialVersion={item.co_calculation_version || 0} embedded />
                ) : (
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-bold text-slate-900">Transaction details</h4><span className="text-[10px] text-slate-600">{number(item.council_fto_transactions.length)} imported</span></div>
                    {item.council_fto_transactions.length === 0 ? <p className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">No transaction details are linked to this FTO.</p> : <>
                      <div className="mt-3 hidden min-w-0 overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                        <table className="min-w-[1000px] divide-y divide-slate-200 text-xs">
                          <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Job Card</th><th className="px-3 py-3">Reference</th><th className="px-3 py-3">Applicant</th><th className="px-3 py-3">Transaction date</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Government status</th><th className="px-3 py-3">Rejection reason</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">{item.council_fto_transactions.map(tx => <tr key={tx.id}><td className="whitespace-nowrap px-3 py-3 font-bold text-slate-900">{tx.job_card_number}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{tx.reference_number}</td><td className="px-3 py-3 text-slate-700">{tx.applicant_name || tx.primary_account_holder || "—"}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{date(tx.transaction_date)}</td><td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-700">{money(tx.amount_to_be_credited)}</td><td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${governmentStatusClasses(tx.government_status)}`}>{normalizedStatusLabel(tx)}</span></td><td className="max-w-[220px] whitespace-normal px-3 py-3 text-slate-600">{tx.rejection_reason || "—"}</td></tr>)}</tbody>
                        </table>
                      </div>
                      <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white p-3 md:hidden">{item.council_fto_transactions.map(tx => <article key={tx.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-all text-xs font-bold text-slate-900">{tx.job_card_number}</p><p className="mt-1 text-[11px] text-slate-600">{tx.applicant_name || tx.primary_account_holder || "Applicant not recorded"}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${governmentStatusClasses(tx.government_status)}`}>{normalizedStatusLabel(tx)}</span></div>
                        <p className="mt-1 break-all text-[10px] text-slate-500">Ref: {tx.reference_number}</p><div className="mt-2 flex justify-between gap-2 text-[10px] text-slate-600"><span>{money(tx.amount_to_be_credited)}</span><span>{date(tx.transaction_date)}</span></div>
                        {tx.rejection_reason && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-[10px] text-rose-700"><strong>Rejection reason:</strong> {tx.rejection_reason}</p>}
                      </article>)}</div>
                    </>}
                  </div>
                )}
              </div>;
            })()}
          </div>
        </div>
      )}
    </section>
  );
}