"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type JobCard = { job_card_number: string; head_of_household: string; status: string };
type Charge = { current_amount: number | string; is_active: boolean };
type Allocation = { allocated_amount: number | string };
type Waiver = { amount: number | string };

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to record the waiver. Please try again.";
}

export default function WaivePage() {
  const router = useRouter();
  const [jobCardNumber, setJobCardNumber] = useState("");
  const supabase = useMemo(() => createClient(), []);
  const [councilId, setCouncilId] = useState("");
  const [jobCard, setJobCard] = useState<JobCard | null>(null);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    async function initialiseJobCardNumber() {
      await Promise.resolve();
      if (!alive) return;
      const requestedNumber = new URLSearchParams(window.location.search).get("jobCardNumber")?.trim() || "";
      setJobCardNumber(requestedNumber);
      if (!requestedNumber) {
        setError("No Job Card was supplied. Return to Contributions and select a Job Card.");
        setLoading(false);
      }
    }
    void initialiseJobCardNumber();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!jobCardNumber) return;
    let alive = true;
    async function initialise() {
      setLoading(true);
      setError("");
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("Your session has expired. Sign in again.");
        const { data: membership, error: membershipError } = await supabase.from("council_memberships")
          .select("village_council_id").eq("user_id", user.id).eq("is_active", true).maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) throw new Error("No active Village Council assignment was found.");
        const id = membership.village_council_id;
        const [cardResult, chargesResult, allocationsResult, waiversResult] = await Promise.all([
          supabase.from("council_job_cards").select("job_card_number,head_of_household,status")
            .eq("village_council_id", id).eq("job_card_number", jobCardNumber).maybeSingle(),
          supabase.from("council_contribution_charges").select("current_amount,is_active")
            .eq("village_council_id", id).eq("job_card_number", jobCardNumber),
          supabase.from("council_payment_allocations").select("allocated_amount")
            .eq("village_council_id", id).eq("job_card_number", jobCardNumber),
          supabase.from("council_contribution_waivers").select("amount")
            .eq("village_council_id", id).eq("job_card_number", jobCardNumber),
        ]);
        if (cardResult.error) throw cardResult.error;
        if (chargesResult.error) throw chargesResult.error;
        if (allocationsResult.error) throw allocationsResult.error;
        if (waiversResult.error) throw waiversResult.error;
        if (!cardResult.data) throw new Error("This Job Card could not be found in your Village Council.");
        const charges = (chargesResult.data || []) as Charge[];
        const allocations = (allocationsResult.data || []) as Allocation[];
        const waivers = (waiversResult.data || []) as Waiver[];
        const currentOutstanding =
          charges.filter(row => row.is_active).reduce((total, row) => total + Number(row.current_amount), 0)
          - allocations.reduce((total, row) => total + Number(row.allocated_amount), 0)
          - waivers.reduce((total, row) => total + Number(row.amount), 0);
        if (alive) {
          setCouncilId(id);
          setJobCard(cardResult.data);
          setOutstanding(currentOutstanding);
        }
      } catch (err) {
        if (alive) setError(errorMessage(err));
      } finally {
        if (alive) setLoading(false);
      }
    }
    void initialise();
    return () => { alive = false; };
  }, [jobCardNumber, supabase]);

  async function submitWaiver(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!councilId || !jobCard || outstanding === null || outstanding <= 0) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
      setError("Enter a waiver amount greater than zero, with no more than two decimal places.");
      return;
    }
    if (parsedAmount > outstanding) {
      setError(`Waiver cannot exceed the current outstanding balance of ${money(outstanding)}.`);
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required for every waiver.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    const requestKey = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(requestKey);
    try {
      const { data, error: rpcError } = await supabase.rpc("record_council_job_card_waiver", {
        p_village_council_id: councilId,
        p_job_card_number: jobCard.job_card_number,
        p_amount: parsedAmount,
        p_reason: reason.trim(),
        p_idempotency_key: requestKey,
      });
      if (rpcError) throw rpcError;
      if (!data?.success || !data?.waiver_id) throw new Error("The waiver was not confirmed by the server.");
      setNotice(data.duplicate_request ? "This waiver had already been recorded. Returning to the Job Card." : "Waiver recorded and approved successfully. Returning to the Job Card.");
      router.replace(`/contributions?jobCardNumber=${encodeURIComponent(jobCard.job_card_number)}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const returnUrl = jobCardNumber
    ? `/contributions?jobCardNumber=${encodeURIComponent(jobCardNumber)}`
    : "/contributions";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link href={returnUrl} className="text-xs font-semibold text-blue-700 hover:text-blue-900">← Back to Contributions</Link>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Job Card financial action</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Waive Contribution</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Record a partial or full waiver of the current outstanding balance. A waiver is an adjustment, not a payment.</p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading current balance…</p>
          : jobCard && outstanding !== null ? <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Job Card</p>
              <p className="mt-1 break-all text-base font-bold text-slate-950">{jobCard.job_card_number}</p>
              <p className="mt-1 text-sm text-slate-600">{jobCard.head_of_household}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase text-slate-500">{jobCard.status}</p>
            </div>

            {outstanding > 0 ? <>
              <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-5">
                <p className="text-xs font-semibold text-violet-800">Current outstanding balance</p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-violet-900">{money(outstanding)}</p>
                <p className="mt-2 text-[11px] leading-5 text-violet-800">You may waive all or part of this amount. The database checks the latest balance again before saving.</p>
              </div>

              <form onSubmit={submitWaiver} className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-slate-700">Waiver amount (₹) <span className="text-rose-600">*</span></span>
                  <input type="number" inputMode="decimal" min="0.01" max={outstanding.toFixed(2)} step="0.01" required value={amount}
                    onChange={event => { setAmount(event.target.value); setIdempotencyKey(""); setNotice(""); }}
                    placeholder="Enter amount to waive"
                    className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50" />
                  <span className="mt-1 block text-[10px] text-slate-500">Maximum allowed: {money(outstanding)}</span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-slate-700">Reason <span className="text-rose-600">*</span></span>
                  <textarea rows={4} maxLength={1000} required value={reason}
                    onChange={event => { setReason(event.target.value); setIdempotencyKey(""); setNotice(""); }}
                    placeholder="Enter the reason for this waiver"
                    className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50" />
                </label>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-800">Recording and approval</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-600">One active Council administrator records and approves this waiver in the same operation. Administrator identity and timestamp are captured automatically. The waiver becomes an immutable financial record and FIFO is recalculated atomically.</p>
                </div>

                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                  <Link href={returnUrl} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link>
                  <button type="submit" disabled={saving || !amount.trim() || !reason.trim()}
                    className="min-h-11 rounded-xl bg-violet-700 px-5 text-xs font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
                    {saving ? "Recording waiver…" : "Record and approve waiver"}
                  </button>
                </div>
              </form>
            </> : <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">No positive outstanding balance</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">A waiver is available only when this Job Card has a positive outstanding balance.</p>
              <Link href={returnUrl} className="mt-3 inline-flex min-h-10 items-center text-xs font-semibold text-blue-700">Return to Job Card</Link>
            </div>}
          </> : <div className="py-8 text-center"><p className="text-sm font-semibold text-slate-700">Job Card unavailable</p><Link href="/contributions" className="mt-3 inline-flex text-xs font-semibold text-blue-700">Return to Contributions</Link></div>}
      </section>
    </div>
  );
}
