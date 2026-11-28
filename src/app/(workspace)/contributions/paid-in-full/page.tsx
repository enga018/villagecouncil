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
  return error instanceof Error ? error.message : "Unable to settle this Job Card. Please try again.";
}

export default function PaidInFullPage() {
  const router = useRouter();
  const [jobCardNumber, setJobCardNumber] = useState("");
  const supabase = useMemo(() => createClient(), []);
  const [councilId, setCouncilId] = useState("");
  const [jobCard, setJobCard] = useState<JobCard | null>(null);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [receiptReference, setReceiptReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const requestedNumber = new URLSearchParams(window.location.search).get("jobCardNumber")?.trim() || "";
    setJobCardNumber(requestedNumber);
    if (!requestedNumber) {
      setError("No Job Card was supplied. Return to Contributions and select a Job Card.");
      setLoading(false);
    }
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

  async function submitSettlement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!councilId || !jobCard || outstanding === null || outstanding <= 0) return;
    setSaving(true);
    setError("");
    setNotice("");
    const requestKey = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(requestKey);
    try {
      const { data, error: rpcError } = await supabase.rpc("record_council_job_card_paid_in_full", {
        p_village_council_id: councilId,
        p_job_card_number: jobCard.job_card_number,
        p_idempotency_key: requestKey,
        p_receipt_reference: receiptReference.trim() || null,
        p_remarks: remarks.trim() || null,
      });
      if (rpcError) throw rpcError;
      if (!data?.success || !data?.payment_id) throw new Error("The settlement was not confirmed by the server.");
      const settledAmount = Number(data.paid_in_full_amount ?? outstanding);
      setNotice(`Paid in Full recorded: ${money(settledAmount)}. Returning to the Job Card.`);
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
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Paid in Full</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Settle the complete current outstanding balance with one CASH payment. The amount is calculated automatically.</p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        {loading ? <p className="py-8 text-center text-sm text-slate-500">Calculating current balance…</p>
          : jobCard && outstanding !== null ? <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Job Card</p>
              <p className="mt-1 break-all text-base font-bold text-slate-950">{jobCard.job_card_number}</p>
              <p className="mt-1 text-sm text-slate-600">{jobCard.head_of_household}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase text-slate-500">{jobCard.status}</p>
            </div>

            {outstanding > 0 ? <>
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-xs font-semibold text-emerald-800">Current outstanding · CASH payment</p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-emerald-900">{money(outstanding)}</p>
                <p className="mt-2 text-[11px] leading-5 text-emerald-800">This is a preview of the current balance. The database recalculates it under a Job Card lock when you confirm, so a changed balance cannot be settled using a stale amount.</p>
              </div>

              <form onSubmit={submitSettlement} className="mt-5 space-y-4">
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                  <p className="text-xs font-semibold text-blue-900">Payment method: CASH</p>
                  <p className="mt-1 text-[11px] leading-5 text-blue-800">Payment date, time and recording administrator will be captured automatically. FIFO allocation runs in the same database transaction.</p>
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-slate-700">Receipt / Reference <span className="font-normal text-slate-400">(optional)</span></span>
                  <input type="text" maxLength={120} value={receiptReference}
                    onChange={event => { setReceiptReference(event.target.value); setIdempotencyKey(""); setNotice(""); }}
                    placeholder="Receipt number or reference"
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-slate-700">Remarks <span className="font-normal text-slate-400">(optional)</span></span>
                  <textarea rows={3} maxLength={500} value={remarks}
                    onChange={event => { setRemarks(event.target.value); setIdempotencyKey(""); setNotice(""); }}
                    placeholder="Additional settlement details"
                    className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
                </label>

                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                  <Link href={returnUrl} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link>
                  <button type="submit" disabled={saving}
                    className="min-h-11 rounded-xl bg-emerald-700 px-5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                    {saving ? "Settling balance…" : `Confirm Paid in Full · ${money(outstanding)}`}
                  </button>
                </div>
              </form>
            </> : <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">No positive outstanding balance</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">Paid in Full is unavailable because this Job Card has no amount to settle. Return to its Contribution Detail to review the current balance.</p>
              <Link href={returnUrl} className="mt-3 inline-flex min-h-10 items-center text-xs font-semibold text-blue-700">Return to Job Card</Link>
            </div>}
          </> : <div className="py-8 text-center"><p className="text-sm font-semibold text-slate-700">Job Card unavailable</p><Link href="/contributions" className="mt-3 inline-flex text-xs font-semibold text-blue-700">Return to Contributions</Link></div>}
      </section>
    </div>
  );
}
