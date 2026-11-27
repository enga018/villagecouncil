"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

type JobCard = {
  id: string;
  job_card_number: string;
  head_of_household: string;
  status: string;
};
type Fto = {
  id: string;
  fto_number: string;
  status: string;
  latest_co_calculation_id: string | null;
  current_co_tag_id: string | null;
};
type CalculationItem = {
  id: string;
  calculation_id: string;
  fto_transaction_id: string;
  job_card_number: string;
  applicant_name: string | null;
  co_amount: number | string;
  credit_amount: number | string;
  is_exempt: boolean;
  transaction_date: string | null;
};
type Transaction = { id: string; normalized_status: string };
type Tag = { id: string; name: string };
type Charge = CalculationItem & {
  fto_number: string;
  tag_name: string;
  normalized_status: string;
};
type Account = JobCard & { charges: Charge[]; total: number };

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}
function date(value: string | null) {
  if (!value) return "Date not recorded";
  const parsed = new Date(value + "T00:00:00");
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(parsed);
}
function statusStyle(status: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "inactive") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}
async function collect<T>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const result: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await load(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    result.push(...(page.data || []));
    if (!page.data || page.data.length < 1000) break;
  }
  return result;
}

export default function ContributionsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"outstanding" | "all">("outstanding");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    async function loadLedger() {
      setLoading(true);
      setError("");
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("Your session has expired. Please sign in again.");
        const { data: membership, error: membershipError } = await supabase.from("council_memberships")
          .select("village_council_id").eq("user_id", user.id).eq("is_active", true).maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) throw new Error("No active Village Council assignment was found.");
        const councilId = membership.village_council_id;

        const [jobCards, ftos, tags] = await Promise.all([
          collect<JobCard>((from, to) => supabase.from("council_job_cards")
            .select("id,job_card_number,head_of_household,status")
            .eq("village_council_id", councilId).order("job_card_number").range(from, to)),
          collect<Fto>((from, to) => supabase.from("council_ftos")
            .select("id,fto_number,status,latest_co_calculation_id,current_co_tag_id")
            .eq("village_council_id", councilId).eq("status", "active").range(from, to)),
          collect<Tag>((from, to) => supabase.from("council_co_tags")
            .select("id,name").eq("village_council_id", councilId).range(from, to)),
        ]);

        const ftoById = new Map(ftos.map(fto => [fto.id, fto]));
        const calculationIds = [...new Set(ftos.map(fto => fto.latest_co_calculation_id).filter((id): id is string => Boolean(id)))];
        const items: CalculationItem[] = [];
        for (let offset = 0; offset < calculationIds.length; offset += 500) {
          const batch = calculationIds.slice(offset, offset + 500);
          const { data, error: itemsError } = await supabase.from("council_fto_co_calculation_items")
            .select("id,calculation_id,fto_transaction_id,job_card_number,applicant_name,co_amount,credit_amount,is_exempt,transaction_date")
            .eq("village_council_id", councilId).in("calculation_id", batch);
          if (itemsError) throw itemsError;
          items.push(...(data || []));
        }

        const transactionIds = [...new Set(items.map(item => item.fto_transaction_id))];
        const transactions: Transaction[] = [];
        for (let offset = 0; offset < transactionIds.length; offset += 500) {
          const batch = transactionIds.slice(offset, offset + 500);
          const { data, error: txError } = await supabase.from("council_fto_transactions")
            .select("id,normalized_status").eq("village_council_id", councilId).in("id", batch);
          if (txError) throw txError;
          transactions.push(...(data || []));
        }

        const transactionById = new Map(transactions.map(tx => [tx.id, tx]));
        const tagById = new Map(tags.map(tag => [tag.id, tag.name]));
        const cardByNumber = new Map(jobCards.map(card => [card.job_card_number, card]));
        const chargesByCard = new Map<string, Charge[]>();
        for (const item of items) {
          const tx = transactionById.get(item.fto_transaction_id);
          const fto = ftoById.get(ftos.find(candidate => candidate.latest_co_calculation_id === item.calculation_id)?.id || "");
          if (!tx || tx.normalized_status !== "processed" || item.is_exempt || !fto || !cardByNumber.has(item.job_card_number)) continue;
          const charge: Charge = {
            ...item,
            fto_number: fto.fto_number,
            tag_name: tagById.get(fto.current_co_tag_id || "") || "Unassigned",
            normalized_status: tx.normalized_status,
          };
          const current = chargesByCard.get(item.job_card_number) || [];
          current.push(charge);
          chargesByCard.set(item.job_card_number, current);
        }

        const nextAccounts = jobCards.map(card => {
          const charges = (chargesByCard.get(card.job_card_number) || []).sort((a, b) =>
            (a.transaction_date || "").localeCompare(b.transaction_date || "") || a.fto_number.localeCompare(b.fto_number));
          return { ...card, charges, total: charges.reduce((sum, charge) => sum + Number(charge.co_amount), 0) };
        });
        if (current) {
          setAccounts(nextAccounts);
          setSelectedId(previous => previous && nextAccounts.some(account => account.id === previous) ? previous : "");
        }
      } catch (err) {
        if (current) setError(err instanceof Error ? err.message : "Unable to load the Contribution ledger.");
      } finally {
        if (current) setLoading(false);
      }
    }
    void loadLedger();
    return () => { current = false; };
  }, []);

  const filtered = useMemo(() => accounts.filter(account => {
    const matchesView = view === "all" || account.total > 0;
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || account.job_card_number.toLowerCase().includes(needle) || account.head_of_household.toLowerCase().includes(needle);
    return matchesView && matchesQuery;
  }), [accounts, query, view]);
  const selected = accounts.find(account => account.id === selectedId) || null;
  const chargeTotal = accounts.reduce((sum, account) => sum + account.total, 0);
  const cardsWithCharges = accounts.filter(account => account.total > 0).length;
  const chargeCount = accounts.reduce((sum, account) => sum + account.charges.length, 0);

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Financial operations</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Contributions</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Job Card contribution accounts and eligible Regular CO Charges.</p>
        </div>
        <div>
          <Link href="/contributions/batch-operations" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-700 px-5 text-xs font-semibold text-white hover:bg-blue-800">Batch Operations</Link>
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">{error}</p>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Job Cards with CO charges</p><p className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{loading ? "—" : cardsWithCharges.toLocaleString("en-IN")}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Eligible CO transactions</p><p className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{loading ? "—" : chargeCount.toLocaleString("en-IN")}</p></div>
        <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-1"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total eligible CO charges</p><p className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{loading ? "—" : money(chargeTotal)}</p></div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 ${selected ? "hidden lg:block" : "block"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-950">Job Card accounts</h2>
            <span className="text-[10px] text-slate-500">{filtered.length.toLocaleString("en-IN")} shown</span>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Job Card or household"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
            <div className="flex rounded-xl border border-slate-200 p-1">
              <button type="button" onClick={() => setView("outstanding")} className={`rounded-lg px-3 py-2 text-[11px] font-semibold ${view === "outstanding" ? "bg-blue-50 text-blue-800" : "text-slate-500"}`}>With charges</button>
              <button type="button" onClick={() => setView("all")} className={`rounded-lg px-3 py-2 text-[11px] font-semibold ${view === "all" ? "bg-blue-50 text-blue-800" : "text-slate-500"}`}>All</button>
            </div>
          </div>
          <div className="mt-3 max-h-[65vh] space-y-2 overflow-y-auto">
            {loading ? <p className="py-10 text-center text-xs text-slate-500">Loading Job Card accounts…</p>
              : filtered.length === 0 ? <p className="py-10 text-center text-xs text-slate-500">No matching Job Cards.</p>
              : filtered.map(account => (
                <button type="button" key={account.id} onClick={() => setSelectedId(account.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${selectedId === account.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="break-all text-xs font-bold text-slate-950">{account.job_card_number}</p><p className="mt-1 truncate text-[11px] text-slate-500">{account.head_of_household}</p></div>
                    <div className="shrink-0 text-right"><p className="text-xs font-bold tabular-nums text-slate-950">{money(account.total)}</p><p className="mt-1 text-[10px] text-slate-500">{account.charges.length} charge(s)</p></div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2"><span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${statusStyle(account.status)}`}>{account.status}</span><span className="text-[10px] font-semibold text-blue-700">View details →</span></div>
                </button>
              ))}
          </div>
        </div>

        <div className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 ${selected ? "block" : "hidden lg:block"}`}>
          {!selected ? <div className="flex min-h-64 items-center justify-center text-center"><div><p className="text-sm font-semibold text-slate-700">Select a Job Card</p><p className="mt-1 text-xs text-slate-500">Its eligible Regular CO Charges will appear here.</p></div></div>
            : <div>
              <div className="border-b border-slate-100 pb-4">
                <button type="button" onClick={() => setSelectedId("")} className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 lg:hidden">← Back to Job Card accounts</button>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Job Card contribution detail</p>
                <h2 className="mt-1 break-all text-lg font-bold text-slate-950">{selected.job_card_number}</h2>
                <p className="mt-1 text-xs text-slate-500">{selected.head_of_household}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusStyle(selected.status)}`}>{selected.status}</span><span className="text-xs text-slate-500">{selected.charges.length} eligible CO charge(s)</span></div>
                <p className="mt-3 text-2xl font-bold tabular-nums text-slate-950">{money(selected.total)}</p>
                <p className="text-[10px] text-slate-500">Total eligible Regular CO Charges · before payments</p>
              </div>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-900">Regular CO Charges</h3>
                  <span className="text-[10px] text-slate-500">{selected.charges.length.toLocaleString("en-IN")} records</span>
                </div>
                {selected.charges.length === 0 ? <p className="rounded-xl bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">No eligible CO charges for this Job Card.</p>
                  : <>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full min-w-[760px] table-auto text-left">
                        <thead>
                          <tr className="border-y border-slate-100 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            <th className="whitespace-nowrap px-3 py-3">FTO Number</th>
                            <th className="whitespace-nowrap px-3 py-3">Applicant</th>
                            <th className="whitespace-nowrap px-3 py-3">Transaction Date</th>
                            <th className="whitespace-nowrap px-3 py-3">Tag</th>
                            <th className="whitespace-nowrap px-3 py-3 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selected.charges.map(charge => (
                            <tr key={charge.id} className="text-xs text-slate-700">
                              <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900">{charge.fto_number}</td>
                              <td className="min-w-[150px] px-3 py-3">{charge.applicant_name || "Applicant not recorded"}</td>
                              <td className="whitespace-nowrap px-3 py-3">{date(charge.transaction_date)}</td>
                              <td className="px-3 py-3">{charge.tag_name}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{money(Number(charge.co_amount))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="space-y-2 md:hidden">
                      {selected.charges.map(charge => (
                        <article key={charge.id} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold text-slate-950">{charge.fto_number}</p><p className="mt-1 text-[11px] text-slate-500">{charge.applicant_name || "Applicant not recorded"}</p></div><p className="shrink-0 text-sm font-bold tabular-nums text-slate-950">{money(Number(charge.co_amount))}</p></div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-slate-500"><div><p>Transaction date</p><p className="mt-1 font-semibold text-slate-700">{date(charge.transaction_date)}</p></div><div><p>Tag</p><p className="mt-1 font-semibold text-slate-700">{charge.tag_name}</p></div></div>
                        </article>
                      ))}
                    </div>
                  </>}
              </div>
            </div>}
        </div>
      </section>
    </div>
  );
}
