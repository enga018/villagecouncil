"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase";

type Operation = "payment" | "manual_charge";

const subscribeToLocation = () => () => {};
const getOperationFromLocation = (): Operation =>
  new URLSearchParams(window.location.search).get("operation") === "manual_charge" ? "manual_charge" : "payment";
const getServerOperation = (): Operation => "payment";
type Tag = { id: string; name: string };
type PreviewLine = {
  line_number: number;
  original_line: string;
  job_card_number: string | null;
  description?: string | null;
  amount: number | null;
  status: string;
  issue: string | null;
};
type Preview = {
  line_count: number;
  valid_count: number;
  invalid_count: number;
  valid_total: number;
  lines: PreviewLine[];
};
type BatchAudit = { id: string; event: string; created_at: string; reason?: string | null; previous_amount?: number | string | null; new_amount?: number | string | null; amount_label?: string; actor_id?: string | null; change_source?: string | null };
type BatchDetail = { id: string; job_card_number: string; amount: number | string; payment_method?: string; description?: string | null; is_active?: boolean; allocated_amount?: number; refunded_amount?: number; audit: BatchAudit[] };
type FifoResult = { success: boolean; job_card_number: string; released_amount: number; allocated_amount: number; allocation_count: number };
type HistoryItem = {
  id: string;
  batch_reference: string;
  recorded_at: string;
  line_count: number;
  total_amount: number | string;
  kind: Operation;
  payment_method?: string;
  tag_id?: string;
  recorded_by: string;
};

function money(value: number | string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0));
}
function prettyDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function BatchOperationsPage() {
  const requestedOperation = useSyncExternalStore(subscribeToLocation, getOperationFromLocation, getServerOperation);
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null);
  const operation = selectedOperation ?? requestedOperation;
  const [councilId, setCouncilId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagId, setTagId] = useState("");
  const [description, setDescription] = useState("");
  const [pasted, setPasted] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastFifo, setLastFifo] = useState<FifoResult[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [expandedBatch, setExpandedBatch] = useState("");
  const [batchDetails, setBatchDetails] = useState<Record<string, BatchDetail[]>>({});
  const [detailLoading, setDetailLoading] = useState("");

  const supabase = useMemo(() => createClient(), []);

  async function loadHistory(id: string) {
    const [payments, charges] = await Promise.all([
      supabase.from("council_payment_batches")
        .select("id,batch_reference,recorded_at,line_count,total_amount,payment_method,recorded_by")
        .eq("village_council_id", id).order("recorded_at", { ascending: false }).limit(30),
      supabase.from("council_manual_charge_batches")
        .select("id,batch_reference,recorded_at,line_count,total_amount,tag_id,recorded_by")
        .eq("village_council_id", id).order("recorded_at", { ascending: false }).limit(30),
    ]);
    if (payments.error) throw payments.error;
    if (charges.error) throw charges.error;
    const combined: HistoryItem[] = [
      ...(payments.data || []).map(row => ({ ...row, kind: "payment" as const })),
      ...(charges.data || []).map(row => ({ ...row, kind: "manual_charge" as const })),
    ];
    combined.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
    setHistory(combined.slice(0, 30));
  }

  useEffect(() => {
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
        if (alive) setCurrentUserId(user.id);
        const { data: tagRows, error: tagError } = await supabase.from("council_co_tags")
          .select("id,name").eq("village_council_id", id).eq("is_archived", false).order("name");
        if (tagError) throw tagError;
        if (!alive) return;
        setCouncilId(id);
        setTags(tagRows || []);
        if (tagRows?.length) setTagId(tagRows[0].id);
        await loadHistory(id);
      } catch (err) {
        if (alive) setError(errorMessage(err));
      } finally {
        if (alive) setLoading(false);
      }
    }
    void initialise();
    return () => { alive = false; };
  }, [supabase]);

  function resetPreview() {
    setPreview(null);
    setNotice("");
    setLastFifo([]);
    setIdempotencyKey("");
  }

  async function runPreview() {
    if (!councilId || (operation === "manual_charge" && (!tagId || !description.trim())) || !pasted.trim()) {
      setError(operation === "manual_charge" ? "Choose a Tag, enter a description, and paste at least one line." : "Paste at least one line.");
      return;
    }
    if (operation === "manual_charge" && description.includes(",")) {
      setError("The shared description cannot contain a comma.");
      return;
    }
    setPreviewing(true);
    setError("");
    setNotice("");
    try {
      const rpc = operation === "payment"
        ? "preview_council_bulk_payment_batch"
        : "preview_council_bulk_manual_charge_batch";
      const manualLines = operation === "manual_charge"
        ? pasted.split(/\r?\n/).map(line => {
            const parts = line.split(",");
            return parts.length === 2 ? `${parts[0].trim()}, ${description.trim()}, ${parts[1].trim()}` : `${line}, ${description.trim()}`;
          }).join("\n")
        : pasted;
      const args = operation === "payment"
        ? { p_village_council_id: councilId, p_pasted_lines: pasted }
        : { p_village_council_id: councilId, p_tag_id: tagId, p_pasted_lines: manualLines };
      const { data, error: rpcError } = await supabase.rpc(rpc, args);
      if (rpcError) throw rpcError;
      setPreview(data as Preview);
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err));
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmBatch() {
    if (!preview || preview.valid_count === 0 || preview.invalid_count !== 0 || (operation === "manual_charge" && !tagId)) return;
    const accepted = window.confirm(
      `Confirm ${preview.valid_count} ${operation === "payment" ? "payment" : "Manual/Extra Charge"} record(s), totalling ${money(preview.valid_total)}? This action will update Job Card balances.`
    );
    if (!accepted) return;
    setSaving(true);
    setError("");
    setNotice("");
    const requestKey = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(requestKey);
    try {
      const lines = preview.lines.map(line => operation === "payment"
        ? { job_card_number: line.job_card_number, amount: Number(line.amount).toFixed(2) }
        : { job_card_number: line.job_card_number, description: line.description, amount: Number(line.amount).toFixed(2) });
      const rpc = operation === "payment"
        ? "record_council_bulk_payment_batch"
        : "record_council_bulk_manual_charge_batch";
      const args = operation === "payment"
        ? {
            p_village_council_id: councilId,
            p_payment_method: "bank",
            p_lines: lines,
            p_idempotency_key: requestKey,
          }
        : {
            p_village_council_id: councilId,
            p_tag_id: tagId,
            p_lines: lines,
            p_idempotency_key: requestKey,
          };
      const { data, error: rpcError } = await supabase.rpc(rpc, args);
      if (rpcError) throw rpcError;
      const result = data as { batch_reference?: string; line_count?: number; total_amount?: number; duplicate_request?: boolean; fifo?: FifoResult[] };
      setLastFifo(Array.isArray(result.fifo) ? result.fifo : []);
      setNotice(`Batch ${result.batch_reference || "recorded"} saved: ${result.line_count || lines.length} record(s), ${money(result.total_amount ?? preview.valid_total)}.${result.duplicate_request ? " This was an idempotent retry; no duplicate records were created." : ""}`);
      setPasted("");
      setDescription("");
      setPreview(null);
      setIdempotencyKey("");
      try {
        await loadHistory(councilId);
      } catch (historyError) {
        setError(`Batch saved successfully, but history could not be refreshed: ${errorMessage(historyError)}`);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleBatchDetails(item: HistoryItem) {
    if (expandedBatch === item.id) {
      setExpandedBatch("");
      return;
    }
    setExpandedBatch(item.id);
    if (batchDetails[item.id]) return;
    setDetailLoading(item.id);
    setError("");
    try {
      if (item.kind === "payment") {
        const result = await supabase.from("council_payments")
          .select("id,job_card_number,amount,payment_method")
          .eq("village_council_id", councilId).eq("batch_id", item.id).order("job_card_number");
        if (result.error) throw result.error;
        const paymentRows = result.data || [];
        const paymentIds = paymentRows.map(row => row.id);
        const [allocationResult, refundResult, paymentEventResult] = await Promise.all([
          paymentIds.length
            ? supabase.from("council_payment_allocations").select("payment_id,allocated_amount")
                .eq("village_council_id", councilId).in("payment_id", paymentIds)
            : Promise.resolve({ data: [], error: null }),
          paymentIds.length
            ? supabase.from("council_payment_refunds").select("id,payment_id,amount,reason,refunded_at,recorded_by")
                .eq("village_council_id", councilId).in("payment_id", paymentIds)
            : Promise.resolve({ data: [], error: null }),
          paymentIds.length
            ? supabase.from("council_payment_events").select("id,payment_id,event_type,previous_amount,new_amount,reason,actor_id,created_at")
                .eq("village_council_id", councilId).in("payment_id", paymentIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (allocationResult.error) throw allocationResult.error;
        if (refundResult.error) throw refundResult.error;
        if (paymentEventResult.error) throw paymentEventResult.error;
        const allocatedByPayment = new Map<string, number>();
        for (const allocation of allocationResult.data || []) {
          allocatedByPayment.set(allocation.payment_id, (allocatedByPayment.get(allocation.payment_id) || 0) + Number(allocation.allocated_amount));
        }
        const refundedByPayment = new Map<string, number>();
        for (const refund of refundResult.data || []) {
          refundedByPayment.set(refund.payment_id, (refundedByPayment.get(refund.payment_id) || 0) + Number(refund.amount));
        }
        const details: BatchDetail[] = paymentRows.map(row => {
          const allocated = allocatedByPayment.get(row.id) || 0;
          const refunded = refundedByPayment.get(row.id) || 0;
          const corrections: BatchAudit[] = (paymentEventResult.data || [])
            .filter(event => event.payment_id === row.id && event.event_type === "corrected")
            .map(event => ({ id: event.id, event: "Payment corrected", created_at: event.created_at, reason: event.reason, previous_amount: event.previous_amount, new_amount: event.new_amount, actor_id: event.actor_id }));
          const refunds: BatchAudit[] = (refundResult.data || [])
            .filter(refund => refund.payment_id === row.id)
            .map(refund => ({ id: refund.id, event: "Refund recorded", created_at: refund.refunded_at, reason: refund.reason, amount_label: "Refunded " + money(refund.amount), actor_id: refund.recorded_by }));
          return { id: row.id, job_card_number: row.job_card_number, amount: row.amount, payment_method: row.payment_method, allocated_amount: allocated, refunded_amount: refunded, audit: [...corrections, ...refunds].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) };
        });
        setBatchDetails(previous => ({ ...previous, [item.id]: details }));
      } else {
        const result = await supabase.from("council_contribution_charges")
          .select("id,job_card_number,current_amount,description,is_active")
          .eq("village_council_id", councilId).eq("manual_charge_batch_id", item.id).order("job_card_number");
        if (result.error) throw result.error;
        const chargeRows = result.data || [];
        const chargeIds = chargeRows.map(row => row.id);
        const [allocationResult, chargeEventResult, revisionResult] = await Promise.all([
          chargeIds.length
            ? supabase.from("council_payment_allocations").select("charge_id,allocated_amount")
                .eq("village_council_id", councilId).in("charge_id", chargeIds)
            : Promise.resolve({ data: [], error: null }),
          chargeIds.length
            ? supabase.from("council_manual_charge_events").select("id,charge_id,event_type,previous_amount,new_amount,reason,actor_id,created_at")
                .eq("village_council_id", councilId).in("charge_id", chargeIds)
            : Promise.resolve({ data: [], error: null }),
          chargeIds.length
            ? supabase.from("council_contribution_charge_revisions").select("id,charge_id,revision_number,previous_amount,new_amount,reason,actor_id,created_at,change_source")
                .eq("village_council_id", councilId).in("charge_id", chargeIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (allocationResult.error) throw allocationResult.error;
        if (chargeEventResult.error) throw chargeEventResult.error;
        if (revisionResult.error) throw revisionResult.error;
        const allocatedByCharge = new Map<string, number>();
        for (const allocation of allocationResult.data || []) {
          allocatedByCharge.set(allocation.charge_id, (allocatedByCharge.get(allocation.charge_id) || 0) + Number(allocation.allocated_amount));
        }
        const details: BatchDetail[] = chargeRows.map(row => {
          const allocated = allocatedByCharge.get(row.id) || 0;
          const chargeEvents: BatchAudit[] = (chargeEventResult.data || [])
            .filter(event => event.charge_id === row.id)
            .map(event => ({ id: event.id, event: event.event_type === "reversed" ? "Charge reversed" : event.event_type === "corrected" ? "Charge corrected" : "Charge created", created_at: event.created_at, reason: event.reason, previous_amount: event.previous_amount, new_amount: event.new_amount, actor_id: event.actor_id }));
          const revisions: BatchAudit[] = (revisionResult.data || [])
            .filter(revision => revision.charge_id === row.id)
            .map(revision => ({ id: revision.id, event: "Revision " + revision.revision_number + " · " + revision.change_source.replaceAll("_", " "), created_at: revision.created_at, reason: revision.reason, previous_amount: revision.previous_amount, new_amount: revision.new_amount, actor_id: revision.actor_id, change_source: revision.change_source }));
          return { id: row.id, job_card_number: row.job_card_number, amount: row.current_amount, description: row.description, is_active: row.is_active, allocated_amount: allocated, audit: [...chargeEvents, ...revisions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) };
        });
        setBatchDetails(previous => ({ ...previous, [item.id]: details }));
      }
    } catch (err) {
      setError(errorMessage(err));
      setExpandedBatch("");
    } finally {
      setDetailLoading("");
    }
  }

  const selectedTag = tags.find(tag => tag.id === tagId)?.name || "—";
  const validForConfirmation = Boolean(preview && preview.valid_count > 0 && preview.invalid_count === 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/contributions" className="text-xs font-semibold text-blue-700 hover:text-blue-900">← Contributions</Link>
          <p className="mt-4 text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Financial operations</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Batch Operations</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Record BANK payments or Manual/Extra Charges through one reviewed, all-or-nothing workflow.</p>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><p>{notice}</p>{lastFifo.length > 0 && <div className="mt-3 border-t border-emerald-200 pt-3"><p className="text-xs font-bold">FIFO allocation results</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{lastFifo.map(row => <div key={row.job_card_number} className="rounded-lg bg-white/70 px-3 py-2 text-xs"><p className="font-semibold">{row.job_card_number}</p><p className="mt-1 text-emerald-800">Allocated {money(row.allocated_amount)} · {row.allocation_count} allocation(s)</p>{row.released_amount > 0 && <p className="text-slate-600">Previous automatic allocation released: {money(row.released_amount)}</p>}</div>)}</div></div>}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-slate-700">Operation</span>
            <select value={operation} onChange={event => { setSelectedOperation(event.target.value as Operation); resetPreview(); }}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
              <option value="payment">Payments</option>
              <option value="manual_charge">Manual/Extra Charges</option>
            </select>
          </label>
          {operation === "manual_charge" && (
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-slate-700">Tag</span>
              <select value={tagId} onChange={event => { setTagId(event.target.value); resetPreview(); }}
                disabled={loading || tags.length === 0}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50">
                <option value="">Select a Tag</option>
                {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
          )}
        </div>

        {operation === "manual_charge" && (
          <label className="mt-5 block">
            <span className="mb-2 block text-xs font-semibold text-slate-700">Description</span>
            <input value={description} onChange={event => { setDescription(event.target.value); resetPreview(); }}
              placeholder="e.g. Registration correction" maxLength={200}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
            <span className="mt-1 block text-[10px] text-slate-500">This description will apply to every charge in the batch.</span>
          </label>
        )}

        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="batch-lines" className="text-xs font-semibold text-slate-700">Paste records</label>
            <span className="text-[10px] text-slate-500">{operation === "payment" ? "JOB-CARD-NUMBER, AMOUNT · BANK" : "JOB-CARD-NUMBER, AMOUNT"}</span>
          </div>
          <textarea id="batch-lines" value={pasted} onChange={event => { setPasted(event.target.value); resetPreview(); }}
            rows={8} spellCheck={false}
            placeholder={operation === "payment" ? "SER123456789, 500\nSER123456790, 250" : "SER123456789, 100\nSER123456790, 50"}
            className="mt-2 min-h-44 w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-xs leading-6 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
          <p className="mt-2 text-[11px] leading-5 text-slate-500">One Job Card per line. Duplicate Job Cards invalidate the entire batch. Every line must pass validation before confirmation.</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void runPreview()} disabled={loading || previewing || saving || (operation === "manual_charge" && (!tagId || !description.trim())) || !pasted.trim()}
            className="min-h-11 rounded-xl bg-blue-700 px-5 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
            {previewing ? "Validating…" : "Preview batch"}
          </button>
          <button type="button" onClick={() => { setPasted(""); setDescription(""); resetPreview(); setError(""); }}
            className="min-h-11 rounded-xl border border-slate-200 px-5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Clear</button>
        </div>
      </section>

      {preview && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-base font-bold text-slate-950">Validation preview</h2><p className="mt-1 text-xs text-slate-500">{operation === "payment" ? "Payment method: BANK" : `Tag: ${selectedTag} · ${description}`}</p></div>
            <div className="text-right"><p className="text-xl font-bold tabular-nums text-slate-950">{money(preview.valid_total)}</p><p className="text-[10px] text-slate-500">Valid line total</p></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Total lines</p><p className="mt-1 text-lg font-bold">{preview.line_count}</p></div>
            <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[10px] text-emerald-700">Valid</p><p className="mt-1 text-lg font-bold text-emerald-800">{preview.valid_count}</p></div>
            <div className="rounded-xl bg-rose-50 p-3"><p className="text-[10px] text-rose-700">Invalid</p><p className="mt-1 text-lg font-bold text-rose-800">{preview.invalid_count}</p></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Line</th><th className="px-3 py-3">Job Card</th>{operation === "manual_charge" && <th className="px-3 py-3">Description</th>}<th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3">Validation</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {preview.lines.map(line => <tr key={line.line_number}>
                  <td className="px-3 py-3 text-slate-500">{line.line_number}</td>
                  <td className="px-3 py-3 font-semibold text-slate-800">{line.job_card_number || "—"}</td>
                  {operation === "manual_charge" && <td className="px-3 py-3 text-slate-600">{line.description || "—"}</td>}
                  <td className="px-3 py-3 text-right tabular-nums">{line.amount == null ? "—" : money(line.amount)}</td>
                  <td className="px-3 py-3">{line.status === "valid" ? <span className="font-semibold text-emerald-700">Valid</span> : <span className="font-medium text-rose-700">{line.issue || line.status}</span>}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {preview.invalid_count > 0 && <p className="text-xs font-medium text-rose-700">Confirmation is disabled until every line is corrected and previewed again.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void confirmBatch()} disabled={!validForConfirmation || saving}
              className="min-h-11 rounded-xl bg-emerald-700 px-5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? "Saving batch…" : "Confirm and record batch"}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="min-h-11 rounded-xl border border-slate-200 px-5 text-xs font-semibold text-slate-600">Back to editing</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-base font-bold text-slate-950">Recent batch history</h2><p className="mt-1 text-xs text-slate-500">Latest 30 payment and Manual/Extra Charge batches</p></div>
          <button type="button" onClick={() => councilId && void loadHistory(councilId)} disabled={!councilId} className="text-xs font-semibold text-blue-700">Refresh</button>
        </div>
        {loading ? <p className="py-8 text-center text-xs text-slate-500">Loading history…</p>
          : history.length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No batches recorded yet.</p>
          : <div className="mt-4 divide-y divide-slate-100">
            {history.map(item => <div key={item.id} className="border-b border-slate-100 py-3 last:border-0">
              <button type="button" onClick={() => void toggleBatchDetails(item)} className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-900">{item.batch_reference}</span><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${item.kind === "payment" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>{item.kind === "payment" ? "PAYMENT" : "MANUAL CHARGE"}</span></div><p className="mt-1 text-[10px] text-slate-500">{prettyDate(item.recorded_at)} · Recorded by {item.recorded_by === currentUserId ? "You" : "Council admin"} · {item.line_count} record(s){item.payment_method ? ` · ${item.payment_method.toUpperCase()}` : ""}{item.kind === "manual_charge" ? ` · ${tags.find(tag => tag.id === item.tag_id)?.name || "Tag"}` : ""}</p></div>
                <span className="flex items-center justify-between gap-4 sm:justify-end"><span className="text-sm font-bold tabular-nums text-slate-900">{money(item.total_amount)}</span><span className="text-[10px] font-semibold text-blue-700">{detailLoading === item.id ? "Loading…" : expandedBatch === item.id ? "Hide details ↑" : "View details ↓"}</span></span>
              </button>
              {expandedBatch === item.id && <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                {detailLoading === item.id ? <p className="p-4 text-xs text-slate-500">Loading batch records…</p>
                  : <>
                    <div className="divide-y divide-slate-100 sm:hidden">
                      {(batchDetails[item.id] || []).map(line => <article key={line.id} className="space-y-3 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 break-words text-sm font-bold text-slate-950">{line.job_card_number}</p>
                          {item.kind === "payment" && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase text-blue-700">{line.payment_method || item.payment_method || "BANK"}</span>}
                          {item.kind === "manual_charge" && line.is_active === false && <span className="shrink-0 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">Reversed</span>}
                        </div>
                        {item.kind === "manual_charge" && <p className="text-xs text-slate-600">{line.description || "—"}</p>}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-slate-50 p-3">
                          <div><p className="text-[10px] text-slate-500">{item.kind === "payment" ? "Paid" : "Current amount"}</p><p className="mt-1 text-sm font-semibold tabular-nums">{money(line.amount)}</p></div>
                          {item.kind === "payment" && <div><p className="text-[10px] text-slate-500">Refunded</p><p className="mt-1 text-sm font-semibold tabular-nums">{money(line.refunded_amount || 0)}</p></div>}
                          {item.kind === "payment" && <div><p className="text-[10px] text-slate-500">Net payment</p><p className="mt-1 text-sm font-semibold tabular-nums">{money(Number(line.amount) - (line.refunded_amount || 0))}</p></div>}
                          <div><p className="text-[10px] text-slate-500">Currently allocated</p><p className="mt-1 text-sm font-semibold tabular-nums">{money(line.allocated_amount || 0)}</p></div>
                        </div>
                      </article>)}
                    </div>
                    <div className="hidden overflow-x-auto sm:block">
                      <table className="w-full min-w-[560px] text-left text-xs">
                        <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-3">Job Card</th>{item.kind === "manual_charge" && <th className="px-3 py-3">Description</th>}<th className="px-3 py-3 text-right">{item.kind === "payment" ? "Paid" : "Current amount"}</th>{item.kind === "payment" && <><th className="px-3 py-3 text-right">Refunded</th><th className="px-3 py-3 text-right">Net payment</th></>}<th className="px-3 py-3 text-right">Currently allocated</th>{item.kind === "payment" && <th className="px-3 py-3">Method</th>}</tr></thead>
                        <tbody className="divide-y divide-slate-100">{(batchDetails[item.id] || []).map(line => <tr key={line.id}><td className="px-3 py-3 font-semibold">{line.job_card_number}</td>{item.kind === "manual_charge" && <td className="px-3 py-3 text-slate-600">{line.description || "—"}{line.is_active === false ? " · Reversed" : ""}</td>}<td className="px-3 py-3 text-right tabular-nums">{money(line.amount)}</td>{item.kind === "payment" && <><td className="px-3 py-3 text-right tabular-nums">{money(line.refunded_amount || 0)}</td><td className="px-3 py-3 text-right tabular-nums">{money(Number(line.amount) - (line.refunded_amount || 0))}</td></>}<td className="px-3 py-3 text-right tabular-nums">{money(line.allocated_amount || 0)}</td>{item.kind === "payment" && <td className="px-3 py-3 uppercase text-slate-600">{line.payment_method || item.payment_method}</td>}</tr>)}</tbody>
                      </table>
                    </div>
                  </>}
                {detailLoading !== item.id && (batchDetails[item.id] || []).some(line => line.audit.length > 0) && <div className="border-t border-slate-200 bg-slate-50 p-3 sm:p-4"><h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Correction and refund history</h3><div className="mt-3 space-y-3">{(batchDetails[item.id] || []).flatMap(line => line.audit.map(event => ({ ...event, job_card_number: line.job_card_number }))).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(event => <div key={event.id} className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-900">{event.job_card_number} · {event.event}</p><span className="text-[10px] text-slate-500">{prettyDate(event.created_at)}</span></div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">{event.amount_label ? <span>{event.amount_label}</span> : (event.previous_amount != null || event.new_amount != null) && <span>{event.previous_amount == null ? "—" : money(event.previous_amount)} → {event.new_amount == null ? "—" : money(event.new_amount)}</span>}<span>{event.actor_id === currentUserId ? "You" : "Council admin"}</span></div>{event.reason && <p className="mt-2 text-[11px] leading-5 text-slate-600">Reason: {event.reason}</p>}</div>)}</div></div>}
              </div>}
            </div>)}
          </div>}
      </section>
    </div>
  );
}
