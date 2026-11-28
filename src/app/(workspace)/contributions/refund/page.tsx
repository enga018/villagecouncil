"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type JobCard = { job_card_number: string; head_of_household: string; status: string };
type Payment = { id: string; amount: number | string; paid_at: string; receipt_reference: string | null; remarks: string | null };
type Refund = { payment_id: string; amount: number | string };
type Allocation = { payment_id: string; allocated_amount: number | string; allocation_type: string };

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to record the refund. Please try again.";
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function RefundPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [jobCardNumber, setJobCardNumber] = useState("");
  const [councilId, setCouncilId] = useState("");
  const [jobCard, setJobCard] = useState<JobCard | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
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
        const [cardResult, paymentsResult, refundsResult, allocationsResult] = await Promise.all([
          supabase.from("council_job_cards").select("job_card_number,head_of_household,status")
            .eq("village_council_id", id).eq("job_card_number", jobCardNumber).maybeSingle(),
          supabase.from("council_payments").select("id,amount,paid_at,receipt_reference,remarks")
            .eq("village_council_id", id).eq("job_card_number", jobCardNumber).order("paid_at", { ascending: false }),
          supabase.from("council_payment_refunds").select("payment_id,amount")
            .eq("village_council_id", id).eq("job_card_number", jobCardNumber),
          supabase.from("council_payment_allocations").select("payment_id,allocated_amount,allocation_type")
            .eq("village_council_id", id).eq("job_card_number", jobCardNumber),
        ]);
        if (cardResult.error) throw cardResult.error;
        if (paymentsResult.error) throw paymentsResult.error;
        if (refundsResult.error) throw refundsResult.error;
        if (allocationsResult.error) throw allocationsResult.error;
        if (!cardResult.data) throw new Error("This Job Card could not be found in your Village Council.");
        if (alive) {
          setCouncilId(id);
          setJobCard(cardResult.data);
          setPayments((paymentsResult.data || []) as Payment[]);
          setRefunds((refundsResult.data || []) as Refund[]);
          setAllocations((allocationsResult.data || []) as Allocation[]);
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

  const refundedTotal = refunds.reduce((sum, row) => sum + Number(row.amount), 0);
  const allocatedTotal = allocations.reduce((sum, row) => sum + Number(row.allocated_amount), 0);
  const paymentTotal = payments.reduce((sum, row) => sum + Number(row.amount), 0);
  const jobCardCredit = Math.max(0, paymentTotal - refundedTotal - allocatedTotal);
  const eligiblePayments = payments.map(payment => {
    const refunded = refunds.filter(row => row.payment_id === payment.id).reduce((sum, row) => sum + Number(row.amount), 0);
    const fixedAllocated = allocations.filter(row => row.payment_id === payment.id && row.allocation_type === "historical_fifo_reviewed")
      .reduce((sum, row) => sum + Number(row.allocated_amount), 0);
    return { ...payment, refundable: Math.max(0, Number(payment.amount) - refunded - fixedAllocated) };
  }).filter(payment => payment.refundable > 0);
  const selectedPayment = eligiblePayments.find(payment => payment.id === selectedPaymentId) || null;
  const maximumRefund = selectedPayment ? Math.min(jobCardCredit, selectedPayment.refundable) : 0;

  function updateField(setter: (value: string) => void, value: string) {
    setter(value);
    setIdempotencyKey("");
    setNotice("");
  }

  async function submitRefund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!councilId || !jobCard || !selectedPayment) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !/^\\d+(\\.\\d{1,2})?$/.test(amount.trim())) {
      setError("Enter a refund amount greater than zero, with no more than two decimal places.");
      return;
    }
    if (parsedAmount > maximumRefund) {
      setError(`Refund cannot exceed the available limit of ${money(maximumRefund)}.`);
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required for every refund.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const requestKey = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(requestKey);
    try {
      const { data, error: rpcError } = await supabase.rpc("refund_council_job_card_payment", {
        p_village_council_id: councilId,
        p_payment_id: selectedPayment.id,
        p_amount: parsedAmount,
        p_reason: reason.trim(),
        p_idempotency_key: requestKey,
      });
      if (rpcError) throw rpcError;
      if (!data?.success || !data?.refund_id) throw new Error("The refund was not confirmed by the server.");
      setNotice(data.duplicate_request ? "This refund had already been recorded. Returning to the Job Card." : "Refund recorded. FIFO allocations have been recalculated atomically.");
      router.replace(`/contributions?jobCardNumber=${encodeURIComponent(jobCard.job_card_number)}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const returnUrl = jobCardNumber ? `/contributions?jobCardNumber=${encodeURIComponent(jobCardNumber)}` : "/contributions";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link href={returnUrl} className="text-xs font-semibold text-blue-700 hover:text-blue-900">← Back to Contributions</Link>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Job Card financial action</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Refund Payment</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Refund overpaid credit against one original payment. The original payment remains unchanged.</p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        {loading ? <p className="py-8 text-center text-sm text-slate-500">Checking payment credit…</p>
          : jobCard ? <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Job Card</p>
              <p className="mt-1 break-all text-base font-bold text-slate-950">{jobCard.job_card_number}</p>
              <p className="mt-1 text-sm text-slate-600">{jobCard.head_of_household}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase text-slate-500">{jobCard.status}</p>
            </div>

            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-xs font-semibold text-amber-800">Available Job Card overpaid credit</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-amber-900">{money(jobCardCredit)}</p>
              <p className="mt-2 text-[11px] leading-5 text-amber-800">Calculated from payments less existing refunds and all current allocations. The server rechecks this balance and the selected payment capacity before recording.</p>
            </div>

            {jobCardCredit > 0 && eligiblePayments.length > 0 ? <form onSubmit={submitRefund} className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-700">Original payment <span className="text-rose-600">*</span></span>
                <select required value={selectedPaymentId} onChange={event => { updateField(setSelectedPaymentId, event.target.value); setAmount(""); }}
                  className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-50">
                  <option value="">Select a payment to refund</option>
                  {eligiblePayments.map(payment => <option key={payment.id} value={payment.id}>
                    {dateLabel(payment.paid_at)} · {money(Number(payment.amount))} · refundable {money(payment.refundable)}{payment.receipt_reference ? ` · ${payment.receipt_reference}` : ""}
                  </option>)}
                </select>
              </label>

              {selectedPayment && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p><span className="font-semibold text-slate-800">Original payment:</span> {money(Number(selectedPayment.amount))}</p>
                <p className="mt-1"><span className="font-semibold text-slate-800">Remaining refundable capacity:</span> {money(selectedPayment.refundable)}</p>
                {selectedPayment.receipt_reference && <p className="mt-1"><span className="font-semibold text-slate-800">Receipt / Reference:</span> {selectedPayment.receipt_reference}</p>}
                {selectedPayment.remarks && <p className="mt-1"><span className="font-semibold text-slate-800">Remarks:</span> {selectedPayment.remarks}</p>}
              </div>}

              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-700">Refund amount (₹) <span className="text-rose-600">*</span></span>
                <input type="number" inputMode="decimal" min="0.01" max={maximumRefund.toFixed(2)} step="0.01" required value={amount}
                  onChange={event => updateField(setAmount, event.target.value)} placeholder="Enter refund amount"
                  disabled={!selectedPayment}
                  className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-50 disabled:bg-slate-100" />
                <span className="mt-1 block text-[10px] text-slate-500">Maximum allowed: {money(maximumRefund)} (the lower of Job Card credit and selected payment capacity)</span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-700">Reason <span className="text-rose-600">*</span></span>
                <textarea rows={4} maxLength={1000} required value={reason}
                  onChange={event => updateField(setReason, event.target.value)}
                  placeholder="Enter the reason for this refund"
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-50" />
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-800">Refund and allocation handling</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-600">The original payment is preserved as an immutable historical entry. The refund is recorded separately. Automatic FIFO allocations are released and rebuilt newest-charge-first; fixed historical allocations are preserved. The entire operation is atomic.</p>
              </div>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <Link href={returnUrl} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link>
                <button type="submit" disabled={saving || !selectedPayment || !amount.trim() || !reason.trim()}
                  className="min-h-11 rounded-xl bg-amber-700 px-5 text-xs font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? "Recording refund…" : "Record refund"}
                </button>
              </div>
            </form> : <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">No refundable credit available</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">{jobCardCredit <= 0 ? "This Job Card has no positive overpaid credit." : "No payment has refundable capacity after existing refunds and fixed historical allocations."} A refund can be recorded only against available overpaid credit.</p>
              <Link href={returnUrl} className="mt-3 inline-flex min-h-10 items-center text-xs font-semibold text-blue-700">Return to Job Card</Link>
            </div>}
          </> : <div className="py-8 text-center"><p className="text-sm font-semibold text-slate-700">Job Card unavailable</p><Link href="/contributions" className="mt-3 inline-flex text-xs font-semibold text-blue-700">Return to Contributions</Link></div>}
      </section>
    </div>
  );
}
