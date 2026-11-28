"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type JobCard = { job_card_number: string; head_of_household: string; status: string };

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to record the payment. Please try again.";
}

export default function RecordPaymentPage() {
  const router = useRouter();
  const [jobCardNumber, setJobCardNumber] = useState("");
  const supabase = useMemo(() => createClient(), []);
  const [councilId, setCouncilId] = useState("");
  const [jobCard, setJobCard] = useState<JobCard | null>(null);
  const [amount, setAmount] = useState("");
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
        if (!jobCardNumber) throw new Error("No Job Card was supplied. Return to Contributions and select a Job Card.");
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("Your session has expired. Sign in again.");
        const { data: membership, error: membershipError } = await supabase.from("council_memberships")
          .select("village_council_id").eq("user_id", user.id).eq("is_active", true).maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) throw new Error("No active Village Council assignment was found.");
        const id = membership.village_council_id;
        const { data: card, error: cardError } = await supabase.from("council_job_cards")
          .select("job_card_number,head_of_household,status")
          .eq("village_council_id", id).eq("job_card_number", jobCardNumber).maybeSingle();
        if (cardError) throw cardError;
        if (!card) throw new Error("This Job Card could not be found in your Village Council.");
        if (alive) {
          setCouncilId(id);
          setJobCard(card);
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

  function updateField(setter: (value: string) => void, value: string) {
    setter(value);
    setIdempotencyKey("");
    setNotice("");
  }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!councilId || !jobCard) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
      setError("Enter a payment amount greater than zero, with no more than two decimal places.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    const requestKey = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(requestKey);
    try {
      const { data, error: rpcError } = await supabase.rpc("record_council_job_card_payment", {
        p_village_council_id: councilId,
        p_job_card_number: jobCard.job_card_number,
        p_amount: parsedAmount,
        p_idempotency_key: requestKey,
        p_receipt_reference: receiptReference.trim() || null,
        p_remarks: remarks.trim() || null,
      });
      if (rpcError) throw rpcError;
      if (!data?.success || !data?.payment_id) throw new Error("The payment was not confirmed by the server.");
      setNotice(data.duplicate_request ? "This payment had already been recorded. Returning to the Job Card." : "Payment recorded successfully. Returning to the Job Card.");
      router.replace(`/contributions?jobCardNumber=${encodeURIComponent(jobCard.job_card_number)}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link href={jobCardNumber ? `/contributions?jobCardNumber=${encodeURIComponent(jobCardNumber)}` : "/contributions"}
          className="text-xs font-semibold text-blue-700 hover:text-blue-900">← Back to Contributions</Link>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Job Card financial action</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Record Payment</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Record an individual CASH payment against this Job Card. Excess payment remains as unallocated credit.</p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading Job Card…</p>
          : jobCard ? <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Job Card</p>
              <p className="mt-1 break-all text-base font-bold text-slate-950">{jobCard.job_card_number}</p>
              <p className="mt-1 text-sm text-slate-600">{jobCard.head_of_household}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase text-slate-500">{jobCard.status}</p>
            </div>

            <form onSubmit={submitPayment} className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-700">Payment amount (₹) <span className="text-rose-600">*</span></span>
                <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={amount}
                  onChange={event => updateField(setAmount, event.target.value)}
                  placeholder="Enter amount"
                  className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
              </label>

              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                <p className="text-xs font-semibold text-blue-900">Payment method: CASH</p>
                <p className="mt-1 text-[11px] leading-5 text-blue-800">Payment date, time and recording administrator will be captured automatically.</p>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-700">Receipt / Reference <span className="font-normal text-slate-400">(optional)</span></span>
                <input type="text" maxLength={120} value={receiptReference}
                  onChange={event => updateField(setReceiptReference, event.target.value)}
                  placeholder="Receipt number or reference"
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-700">Remarks <span className="font-normal text-slate-400">(optional)</span></span>
                <textarea rows={3} maxLength={500} value={remarks}
                  onChange={event => updateField(setRemarks, event.target.value)}
                  placeholder="Additional payment details"
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
              </label>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <Link href={`/contributions?jobCardNumber=${encodeURIComponent(jobCard.job_card_number)}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link>
                <button type="submit" disabled={saving || !amount.trim()}
                  className="min-h-11 rounded-xl bg-blue-700 px-5 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? "Recording payment…" : "Record CASH payment"}
                </button>
              </div>
            </form>
          </> : <div className="py-8 text-center"><p className="text-sm font-semibold text-slate-700">Job Card unavailable</p><Link href="/contributions" className="mt-3 inline-flex text-xs font-semibold text-blue-700">Return to Contributions</Link></div>}
      </section>
    </div>
  );
}
