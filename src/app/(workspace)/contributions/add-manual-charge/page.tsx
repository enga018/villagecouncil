"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type JobCard = { job_card_number: string; head_of_household: string; status: string };
type Tag = { id: string; name: string };

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to add the Manual/Extra Charge. Please try again.";
}

export default function AddManualChargePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [jobCardNumber, setJobCardNumber] = useState("");
  const [councilId, setCouncilId] = useState("");
  const [jobCard, setJobCard] = useState<JobCard | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagId, setTagId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
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
        const [cardResult, tagsResult] = await Promise.all([
          supabase.from("council_job_cards").select("job_card_number,head_of_household,status")
            .eq("village_council_id", id).eq("job_card_number", jobCardNumber).maybeSingle(),
          supabase.from("council_co_tags").select("id,name")
            .eq("village_council_id", id).eq("is_archived", false).order("name"),
        ]);
        if (cardResult.error) throw cardResult.error;
        if (tagsResult.error) throw tagsResult.error;
        if (!cardResult.data) throw new Error("This Job Card could not be found in your Village Council.");
        if (alive) {
          setCouncilId(id);
          setJobCard(cardResult.data);
          setTags((tagsResult.data || []) as Tag[]);
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

  async function submitCharge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!councilId || !jobCard) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !/^\\d{1,12}(\\.\\d{1,2})?$/.test(amount.trim())) {
      setError("Enter a charge amount greater than zero, with no more than two decimal places.");
      return;
    }
    if (!description.trim()) {
      setError("A description is required for every Manual/Extra Charge.");
      return;
    }
    if (!tagId) {
      setError("Select an active Tag for this charge.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const requestKey = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(requestKey);
    try {
      const { data, error: rpcError } = await supabase.rpc("create_council_tagged_manual_charge", {
        p_village_council_id: councilId,
        p_job_card_number: jobCard.job_card_number,
        p_description: description.trim(),
        p_amount: parsedAmount,
        p_tag_id: tagId,
        p_idempotency_key: requestKey,
      });
      if (rpcError) throw rpcError;
      if (!data?.success || !data?.charge_id) throw new Error("The Manual/Extra Charge was not confirmed by the server.");
      setNotice(data.duplicate_request ? "This charge had already been recorded. Returning to the Job Card." : "Manual/Extra Charge recorded successfully. FIFO allocations have been recalculated.");
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
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Add Manual/Extra Charge</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Add one charge directly to this Job Card. Use Batch Operations for charges across multiple Job Cards.</p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading Job Card and Tags…</p>
          : jobCard ? <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Job Card</p>
              <p className="mt-1 break-all text-base font-bold text-slate-950">{jobCard.job_card_number}</p>
              <p className="mt-1 text-sm text-slate-600">{jobCard.head_of_household}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase text-slate-500">{jobCard.status}</p>
            </div>

            {tags.length > 0 ? <form onSubmit={submitCharge} className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-700">Description <span className="text-rose-600">*</span></span>
                <input type="text" maxLength={200} required value={description}
                  onChange={event => updateField(setDescription, event.target.value)}
                  placeholder="What is this charge for?"
                  className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-700">Amount (₹) <span className="text-rose-600">*</span></span>
                <input type="number" inputMode="decimal" min="0.01" max="999999999999.99" step="0.01" required value={amount}
                  onChange={event => updateField(setAmount, event.target.value)}
                  placeholder="Enter charge amount"
                  className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-700">Tag <span className="text-rose-600">*</span></span>
                <select required value={tagId} onChange={event => updateField(setTagId, event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50">
                  <option value="">Select a Tag</option>
                  {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </select>
              </label>

              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                <p className="text-xs font-semibold text-blue-900">Charge handling</p>
                <p className="mt-1 text-[11px] leading-5 text-blue-800">The charge will be recorded as a Manual/Extra Charge with the selected Tag. The administrator and timestamp are recorded automatically. FIFO allocation is recalculated in the same database transaction.</p>
              </div>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <Link href={returnUrl} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link>
                <button type="submit" disabled={saving || !description.trim() || !amount.trim() || !tagId}
                  className="min-h-11 rounded-xl bg-blue-700 px-5 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? "Recording charge…" : "Add Manual/Extra Charge"}
                </button>
              </div>
            </form> : <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">No active Tags available</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">Create or unarchive a Tag in the Council’s Tag settings before adding a Manual/Extra Charge. A Tag is required for every Manual/Extra Charge.</p>
              <Link href={returnUrl} className="mt-3 inline-flex min-h-10 items-center text-xs font-semibold text-blue-700">Return to Job Card</Link>
            </div>}
          </> : <div className="py-8 text-center"><p className="text-sm font-semibold text-slate-700">Job Card unavailable</p><Link href="/contributions" className="mt-3 inline-flex text-xs font-semibold text-blue-700">Return to Contributions</Link></div>}
      </section>
    </div>
  );
}
