"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { MiniKpi } from "@/components/app/ModuleCard";
import { LIST_PAGE_SIZE, ListPagination } from "@/components/app/ListPagination";
import { SPLIT_GRID } from "@/lib/layout";

type JobCard = { id: string; job_card_number: string; head_of_household: string; status: string };
type Charge = {
  id: string; job_card_number: string; charge_type: "regular_co" | "manual_extra";
  current_amount: number | string; is_active: boolean; description: string | null;
  fto_transaction_id: string | null; tag_id: string | null; original_created_at: string;
};
type Payment = {
  id: string; job_card_number: string; amount: number | string; payment_method: string;
  receipt_reference: string | null; remarks: string | null; paid_at: string;
};
type Allocation = {
  id: string; job_card_number: string; payment_id: string; charge_id: string;
  allocated_amount: number | string; allocation_type: string;
};
type Refund = { id: string; job_card_number: string; payment_id: string; amount: number | string; reason: string; refunded_at: string };
type Waiver = { id: string; job_card_number: string; amount: number | string; reason: string; recorded_at: string };
type Transaction = {
  id: string; fto_number: string; applicant_name: string | null;
  transaction_date: string | null; processed_date: string | null;
};
type Tag = { id: string; name: string };
type Account = JobCard & {
  charges: Charge[]; payments: Payment[]; allocations: Allocation[];
  refunds: Refund[]; waivers: Waiver[];
  chargeTotal: number; allocatedTotal: number; paymentTotal: number;
  refundTotal: number; waiverTotal: number; outstanding: number; credit: number;
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}
function date(value: string | null) {
  if (!value) return "Date not recorded";
  const parsed = new Date(value);
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
function sum<T>(rows: T[], value: (row: T) => number) {
  return rows.reduce((total, row) => total + value(row), 0);
}

export default function ContributionsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactionLookup, setTransactionLookup] = useState<Map<string, Transaction>>(new Map());
  const [tagLookup, setTagLookup] = useState<Map<string, string>>(new Map());
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

        const [jobCards, charges, payments, allocations, refunds, waivers, tags] = await Promise.all([
          collect<JobCard>((from, to) => supabase.from("council_job_cards")
            .select("id,job_card_number,head_of_household,status").eq("village_council_id", councilId)
            .order("job_card_number").range(from, to)),
          collect<Charge>((from, to) => supabase.from("council_contribution_charges")
            .select("id,job_card_number,charge_type,current_amount,is_active,description,fto_transaction_id,tag_id,original_created_at")
            .eq("village_council_id", councilId).range(from, to)),
          collect<Payment>((from, to) => supabase.from("council_payments")
            .select("id,job_card_number,amount,payment_method,receipt_reference,remarks,paid_at")
            .eq("village_council_id", councilId).order("paid_at").range(from, to)),
          collect<Allocation>((from, to) => supabase.from("council_payment_allocations")
            .select("id,job_card_number,payment_id,charge_id,allocated_amount,allocation_type")
            .eq("village_council_id", councilId).range(from, to)),
          collect<Refund>((from, to) => supabase.from("council_payment_refunds")
            .select("id,job_card_number,payment_id,amount,reason,refunded_at")
            .eq("village_council_id", councilId).range(from, to)),
          collect<Waiver>((from, to) => supabase.from("council_contribution_waivers")
            .select("id,job_card_number,amount,reason,recorded_at")
            .eq("village_council_id", councilId).range(from, to)),
          collect<Tag>((from, to) => supabase.from("council_co_tags")
            .select("id,name").eq("village_council_id", councilId).range(from, to)),
        ]);

        const transactionIds = [...new Set(charges.map(charge => charge.fto_transaction_id).filter((id): id is string => Boolean(id)))];
        const transactions: Transaction[] = [];
        for (let offset = 0; offset < transactionIds.length; offset += 500) {
          const batch = transactionIds.slice(offset, offset + 500);
          const { data, error: txError } = await supabase.from("council_fto_transactions")
            .select("id,fto_number,applicant_name,transaction_date,processed_date")
            .eq("village_council_id", councilId).in("id", batch);
          if (txError) throw txError;
          transactions.push(...(data || []));
        }

        const cardNumbers = new Set(jobCards.map(card => card.job_card_number));
        const transactionById = new Map(transactions.map(tx => [tx.id, tx]));
        const tagById = new Map(tags.map(tag => [tag.id, tag.name]));
        const chargesByCard = new Map<string, Charge[]>();
        const paymentsByCard = new Map<string, Payment[]>();
        const allocationsByCard = new Map<string, Allocation[]>();
        const refundsByCard = new Map<string, Refund[]>();
        const waiversByCard = new Map<string, Waiver[]>();
        const add = <T,>(map: Map<string, T[]>, key: string, row: T) => map.set(key, [...(map.get(key) || []), row]);
        charges.forEach(row => { if (cardNumbers.has(row.job_card_number)) add(chargesByCard, row.job_card_number, row); });
        payments.forEach(row => { if (cardNumbers.has(row.job_card_number)) add(paymentsByCard, row.job_card_number, row); });
        allocations.forEach(row => { if (cardNumbers.has(row.job_card_number)) add(allocationsByCard, row.job_card_number, row); });
        refunds.forEach(row => { if (cardNumbers.has(row.job_card_number)) add(refundsByCard, row.job_card_number, row); });
        waivers.forEach(row => { if (cardNumbers.has(row.job_card_number)) add(waiversByCard, row.job_card_number, row); });

        const nextAccounts = jobCards.map(card => {
          const cardCharges = (chargesByCard.get(card.job_card_number) || []).sort((a, b) => {
            const at = a.charge_type === "regular_co" && a.fto_transaction_id
              ? transactionById.get(a.fto_transaction_id)?.processed_date || transactionById.get(a.fto_transaction_id)?.transaction_date || a.original_created_at
              : a.original_created_at;
            const bt = b.charge_type === "regular_co" && b.fto_transaction_id
              ? transactionById.get(b.fto_transaction_id)?.processed_date || transactionById.get(b.fto_transaction_id)?.transaction_date || b.original_created_at
              : b.original_created_at;
            return at.localeCompare(bt) || a.id.localeCompare(b.id);
          });
          const cardPayments = paymentsByCard.get(card.job_card_number) || [];
          const cardAllocations = allocationsByCard.get(card.job_card_number) || [];
          const cardRefunds = refundsByCard.get(card.job_card_number) || [];
          const cardWaivers = waiversByCard.get(card.job_card_number) || [];
          const chargeTotal = sum(cardCharges.filter(row => row.is_active), row => Number(row.current_amount));
          const allocatedTotal = sum(cardAllocations, row => Number(row.allocated_amount));
          const paymentTotal = sum(cardPayments, row => Number(row.amount));
          const refundTotal = sum(cardRefunds, row => Number(row.amount));
          const waiverTotal = sum(cardWaivers, row => Number(row.amount));
          const outstanding = chargeTotal - allocatedTotal - waiverTotal;
          const credit = paymentTotal - refundTotal - allocatedTotal;
          return {
            ...card, charges: cardCharges, payments: cardPayments, allocations: cardAllocations,
            refunds: cardRefunds, waivers: cardWaivers, chargeTotal, allocatedTotal,
            paymentTotal, refundTotal, waiverTotal, outstanding, credit,
          };
        });
        if (current) {
          setAccounts(nextAccounts);
          setTransactionLookup(transactionById);
          setTagLookup(tagById);
          const requestedJobCardNumber = new URLSearchParams(window.location.search).get("jobCardNumber");
          const requestedAccount = requestedJobCardNumber
            ? nextAccounts.find(account => account.job_card_number === requestedJobCardNumber)
            : null;
          if (requestedAccount) {
            setSelectedId(requestedAccount.id);
            setView("all");
          } else {
            setSelectedId(previous => previous && nextAccounts.some(account => account.id === previous) ? previous : "");
          }
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
    const matchesView = view === "all" || account.outstanding > 0;
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || account.job_card_number.toLowerCase().includes(needle) || account.head_of_household.toLowerCase().includes(needle);
    return matchesView && matchesQuery;
  }), [accounts, query, view]);
  const selected = accounts.find(account => account.id === selectedId) || null;
  const activeCharges = accounts.flatMap(account => account.charges.filter(charge => charge.is_active));
  const chargeTotal = sum(activeCharges, charge => Number(charge.current_amount));
  const allocatedTotal = sum(accounts, account => account.allocatedTotal);
  const paymentTotal = sum(accounts, account => account.paymentTotal);
  const refundTotal = sum(accounts, account => account.refundTotal);
  const waiverTotal = sum(accounts, account => account.waiverTotal);
  const outstandingTotal = sum(accounts, account => account.outstanding);
  const creditTotal = sum(accounts, account => account.credit);
  const cardsWithOutstanding = accounts.filter(account => account.outstanding > 0).length;

  const allocationByCharge = (account: Account, chargeId: string) =>
    sum(account.allocations.filter(row => row.charge_id === chargeId), row => Number(row.allocated_amount));
  const refundsByPayment = (account: Account, paymentId: string) =>
    sum(account.refunds.filter(row => row.payment_id === paymentId), row => Number(row.amount));
  const [contribPage, setContribPage] = useState(1);
  const visibleAccounts = filtered.slice((contribPage - 1) * LIST_PAGE_SIZE, contribPage * LIST_PAGE_SIZE);
  const selectedJobCardQuery = selected ? `?jobCardNumber=${encodeURIComponent(selected.job_card_number)}` : "";

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Financial operations</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Contributions</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Job Card contribution accounts, charges, payments and outstanding balances.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/contributions/exemptions" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">Exemptions</Link>
          <Link href="/contributions/batch-operations" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-700 px-5 text-xs font-semibold text-white hover:bg-blue-800">Batch Operations</Link>
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">{error}</p>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniKpi label="Active charges" value={loading ? null : money(chargeTotal)} context="Total charges" tone="blue" />
        <MiniKpi label="Allocated payments" value={loading ? null : money(allocatedTotal)} context="Payments applied to charges" tone="success" />
        <MiniKpi label="Waived" value={loading ? null : money(waiverTotal)} context="Charges waived" tone="indigo" />
        <MiniKpi label="Outstanding" value={loading ? null : money(outstandingTotal)} context="Total unpaid balance" tone="warning" />
      </section>
      {!loading && <p className="text-[11px] text-slate-500">Payments recorded: {money(paymentTotal)} · Refunds: {money(refundTotal)} · Unallocated credit: {money(creditTotal)} · Job Cards with outstanding balance: {cardsWithOutstanding.toLocaleString("en-IN")}</p>}

      <section className={`grid gap-4 ${SPLIT_GRID}`}>
        <div className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 ${selected ? "hidden md:block" : "block"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-950">Job Card accounts</h2>
            <span className="text-[10px] text-slate-500">{filtered.length.toLocaleString("en-IN")} Job Cards</span>
          </div>
          <div className="mt-3">
            <input value={query} onChange={event => { setQuery(event.target.value); setContribPage(1); }} placeholder="Search Job Card or household"
              className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-xl border border-slate-200 p-1">
              <button type="button" onClick={() => { setView("outstanding"); setContribPage(1); }} className={`rounded-lg px-3 py-2 text-[11px] font-semibold ${view === "outstanding" ? "bg-blue-50 text-blue-800" : "text-slate-500"}`}>Outstanding</button>
              <button type="button" onClick={() => { setView("all"); setContribPage(1); }} className={`rounded-lg px-3 py-2 text-[11px] font-semibold ${view === "all" ? "bg-blue-50 text-blue-800" : "text-slate-500"}`}>All</button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {loading ? <p className="py-10 text-center text-xs text-slate-500">Loading Job Card accounts…</p>
              : filtered.length === 0 ? <p className="py-10 text-center text-xs text-slate-500">No matching Job Cards.</p>
              : visibleAccounts.map(account => (
                <button type="button" key={account.id} onClick={() => setSelectedId(account.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${selectedId === account.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="break-all text-xs font-bold text-slate-950">{account.job_card_number}</p><p className="mt-1 truncate text-[11px] text-slate-500">{account.head_of_household}</p></div>
                    <div className="shrink-0 text-right"><p className="text-xs font-bold tabular-nums text-slate-950">{money(account.outstanding)}</p><p className="mt-1 text-[10px] text-slate-500">Outstanding</p></div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2"><span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${statusStyle(account.status)}`}>{account.status}</span><span className="text-[10px] font-semibold text-blue-700">View details →</span></div>
                </button>
              ))}
          </div>
          <ListPagination page={contribPage} total={filtered.length} onPage={setContribPage} label="Job Cards" className="-mx-4 -mb-4 mt-3 rounded-b-2xl sm:-mx-5 sm:-mb-5" />
        </div>

        <div className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 ${selected ? "block" : "hidden md:block"}`}>
          {!selected ? <div className="flex min-h-64 items-center justify-center text-center"><div><p className="text-sm font-semibold text-slate-700">Select a Job Card</p><p className="mt-1 text-xs text-slate-500">Its charges, payments and balance history will appear here.</p></div></div>
            : <div>
              <div className="border-b border-slate-100 pb-4">
                <button type="button" onClick={() => setSelectedId("")} className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 md:hidden">← Back to Job Card accounts</button>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Job Card contribution detail</p>
                <h2 className="mt-1 break-all text-lg font-bold text-slate-950">{selected.job_card_number}</h2>
                <p className="mt-1 text-xs text-slate-500">{selected.head_of_household}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusStyle(selected.status)}`}>{selected.status}</span><span className="text-xs text-slate-500">{selected.charges.length} charge record(s) · {selected.payments.length} payment(s)</span></div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3"><p className="text-[10px] text-blue-700">Active charges</p><p className="mt-1 text-sm font-bold tabular-nums text-blue-700">{money(selected.chargeTotal)}</p></div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3"><p className="text-[10px] text-emerald-700">Allocated</p><p className="mt-1 text-sm font-bold tabular-nums text-emerald-700">{money(selected.allocatedTotal)}</p></div>
                  <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3"><p className="text-[10px] text-violet-700">Waived</p><p className="mt-1 text-sm font-bold tabular-nums text-violet-700">{money(selected.waiverTotal)}</p></div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3"><p className="text-[10px] text-amber-700">Outstanding</p><p className="mt-1 text-sm font-bold tabular-nums text-amber-700">{money(selected.outstanding)}</p></div>
                </div>
                {selected.credit > 0 && <p className="mt-2 text-xs font-semibold text-emerald-700">Unallocated payment credit: {money(selected.credit)}</p>}
              </div>

              <section aria-label="Job Card financial actions" className="border-b border-slate-100 py-4">
                <h3 className="text-xs font-bold text-slate-900">Financial actions</h3>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Link href={`/contributions/record-payment${selectedJobCardQuery}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-blue-800">
                    Record Payment
                  </Link>
                  {selected.outstanding > 0 && <>
                    <Link href={`/contributions/paid-in-full${selectedJobCardQuery}`}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                      Paid in Full
                    </Link>
                    <Link href={`/contributions/waive${selectedJobCardQuery}`}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-center text-xs font-semibold text-violet-800 hover:bg-violet-100">
                      Waive
                    </Link>
                  </>}
                  {selected.credit > 0 && <Link href={`/contributions/refund${selectedJobCardQuery}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-800 hover:bg-amber-100">
                    Refund
                  </Link>}
                  <Link href={`/contributions/add-manual-charge${selectedJobCardQuery}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Add Manual/Extra Charge
                  </Link>
                </div>
              </section>

              <div className="mt-5 space-y-5">
                <section>
                  <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-bold text-slate-900">Regular CO Charges</h3><span className="text-[10px] text-slate-500">{selected.charges.filter(row => row.charge_type === "regular_co" && row.is_active).length} active</span></div>
                  {selected.charges.filter(row => row.charge_type === "regular_co").length === 0
                    ? <p className="rounded-xl bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">No Regular CO Charges.</p>
                    : <div className="space-y-2">{selected.charges.filter(row => row.charge_type === "regular_co").map(charge => {
                      const tx = charge.fto_transaction_id ? transactionLookup.get(charge.fto_transaction_id) || null : null;
                      return <article key={charge.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold text-slate-950">{tx?.fto_number || "FTO not recorded"}</p><p className="mt-1 text-[11px] text-slate-500">{tx?.applicant_name || "Applicant not recorded"}</p></div><p className="shrink-0 text-sm font-bold tabular-nums">{money(Number(charge.current_amount))}</p></div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>Date: {date(tx?.processed_date || tx?.transaction_date || null)}</span><span>Tag: {charge.tag_id ? tagLookup.get(charge.tag_id) || "Archived tag" : "Unassigned"}</span><span>Allocated: {money(allocationByCharge(selected, charge.id))}</span>{!charge.is_active && <span className="font-semibold text-rose-700">Reversed</span>}</div>
                      </article>;
                    })}</div>}
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-bold text-slate-900">Manual/Extra Charges</h3><span className="text-[10px] text-slate-500">{selected.charges.filter(row => row.charge_type === "manual_extra" && row.is_active).length} active</span></div>
                  {selected.charges.filter(row => row.charge_type === "manual_extra").length === 0
                    ? <p className="rounded-xl bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">No Manual/Extra Charges.</p>
                    : <div className="space-y-2">{selected.charges.filter(row => row.charge_type === "manual_extra").map(charge => <article key={charge.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3"><p className="min-w-0 text-xs font-semibold text-slate-900">{charge.description || "No description"}</p><p className="shrink-0 text-sm font-bold tabular-nums">{money(Number(charge.current_amount))}</p></div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>Created: {date(charge.original_created_at)}</span><span>Tag: {charge.tag_id ? tagLookup.get(charge.tag_id) || "Archived tag" : "Unassigned"}</span><span>Allocated: {money(allocationByCharge(selected, charge.id))}</span>{!charge.is_active && <span className="font-semibold text-rose-700">Reversed</span>}</div>
                    </article>)}</div>}
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-bold text-slate-900">Payment History</h3><span className="text-[10px] text-slate-500">{selected.payments.length} records</span></div>
                  {selected.payments.length === 0 ? <p className="rounded-xl bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">No payments recorded.</p>
                    : <div className="space-y-2">{selected.payments.map(payment => {
                      const refunded = refundsByPayment(selected, payment.id);
                      const allocated = sum(selected.allocations.filter(row => row.payment_id === payment.id), row => Number(row.allocated_amount));
                      return <article key={payment.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-slate-950">{date(payment.paid_at)}</p><p className="mt-1 text-[10px] uppercase text-slate-500">{payment.payment_method} · {payment.receipt_reference || "No reference"}</p></div><p className="text-sm font-bold tabular-nums">{money(Number(payment.amount))}</p></div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>Allocated: {money(allocated)}</span><span>Refunded: {money(refunded)}</span><span>Unallocated: {money(Number(payment.amount) - refunded - allocated)}</span></div>
                        {payment.remarks && <p className="mt-2 text-[11px] text-slate-600">{payment.remarks}</p>}
                      </article>;
                    })}</div>}
                </section>

                {(selected.waivers.length > 0 || selected.refunds.length > 0) && <section>
                  <h3 className="mb-2 text-xs font-bold text-slate-900">Waivers and Refunds</h3>
                  <div className="space-y-2">
                    {selected.waivers.map(row => <article key={row.id} className="rounded-xl border border-slate-200 p-3"><div className="flex justify-between gap-3"><span className="text-xs font-semibold">Waiver · {date(row.recorded_at)}</span><span className="text-xs font-bold">{money(Number(row.amount))}</span></div><p className="mt-1 text-[11px] text-slate-500">{row.reason}</p></article>)}
                    {selected.refunds.map(row => <article key={row.id} className="rounded-xl border border-slate-200 p-3"><div className="flex justify-between gap-3"><span className="text-xs font-semibold">Refund · {date(row.refunded_at)}</span><span className="text-xs font-bold">{money(Number(row.amount))}</span></div><p className="mt-1 text-[11px] text-slate-500">{row.reason}</p></article>)}
                  </div>
                </section>}
              </div>
            </div>}
        </div>
      </section>
    </div>
  );
}
