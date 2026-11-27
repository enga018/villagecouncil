"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";

type Operation = "payment" | "manual_charge";
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
type HistoryItem = {
  id: string;
  batch_reference: string;
  recorded_at: string;
  line_count: number;
  total_amount: number | string;
  kind: Operation;
  payment_method?: string;
  tag_id: string;
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
  const searchParams = useSearchParams();
  const [operation, setOperation] = useState<Operation>(searchParams.get("operation") === "manual_charge" ? "manual_charge" : "payment");
  const [councilId, setCouncilId] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagId, setTagId] = useState("");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [pasted, setPasted] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const supabase = useMemo(() => createClient(), []);

  async function loadHistory(id: string) {
    const [payments, charges] = await Promise.all([
      supabase.from("council_payment_batches")
        .select("id,batch_reference,recorded_at,line_count,total_amount,payment_method,tag_id")
        .eq("village_council_id", id).order("recorded_at", { ascending: false }).limit(30),
      supabase.from("council_manual_charge_batches")
        .select("id,batch_reference,recorded_at,line_count,total_amount,tag_id")
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
    setIdempotencyKey("");
  }

  async function runPreview() {
    if (!councilId || !tagId || !pasted.trim()) {
      setError("Choose a Tag and paste at least one line.");
      return;
    }
    setPreviewing(true);
    setError("");
    setNotice("");
    try {
      const rpc = operation === "payment"
        ? "preview_council_bulk_payment_batch"
        : "preview_council_bulk_manual_charge_batch";
      const { data, error: rpcError } = await supabase.rpc(rpc, {
        p_village_council_id: councilId,
        p_tag_id: tagId,
        p_pasted_lines: pasted,
      });
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
    if (!preview || preview.valid_count === 0 || preview.invalid_count !== 0 || !tagId) return;
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
            p_payment_method: method,
            p_tag_id: tagId,
            p_lines: lines,
            p_idempotency_key: requestKey,
          }
        : {
            p_village_council_id: councilId,
            p_tag_id: tagId,
            p_lines: lines,
            p_idempotency_key: crypto.randomUUID(),
          };
      const { data, error: rpcError } = await supabase.rpc(rpc, args);
      if (rpcError) throw rpcError;
      const result = data as { batch_reference?: string; line_count?: number; total_amount?: number; duplicate_request?: boolean };
      setNotice(`Batch ${result.batch_reference || "recorded"} saved: ${result.line_count || lines.length} record(s), ${money(result.total_amount || preview.valid_total)}.`);
      setPasted("");
      setPreview(null);
      setIdempotencyKey("");
      await loadHistory(councilId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
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
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Record multiple payments or Manual/Extra Charges through one reviewed, all-or-nothing workflow.</p>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-slate-700">Operation</span>
            <select value={operation} onChange={event => { setOperation(event.target.value as Operation); resetPreview(); }}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
              <option value="payment">Payments</option>
              <option value="manual_charge">Manual/Extra Charges</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-slate-700">Tag</span>
            <select value={tagId} onChange={event => { setTagId(event.target.value); resetPreview(); }}
              disabled={loading || tags.length === 0}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50">
              <option value="">Select a Tag</option>
              {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>
        </div>

        {operation === "payment" && (
          <fieldset className="mt-5">
            <legend className="mb-2 text-xs font-semibold text-slate-700">Payment method</legend>
            <div className="flex gap-2">
              {(["cash", "bank"] as const).map(value => (
                <button type="button" key={value} onClick={() => setMethod(value)}
                  className={`min-h-10 rounded-xl border px-5 text-xs font-semibold uppercase ${method === value ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-600"}`}>
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="batch-lines" className="text-xs font-semibold text-slate-700">Paste records</label>
            <span className="text-[10px] text-slate-500">{operation === "payment" ? "JOB-CARD-NUMBER, AMOUNT" : "JOB-CARD-NUMBER, DESCRIPTION, AMOUNT"}</span>
          </div>
          <textarea id="batch-lines" value={pasted} onChange={event => { setPasted(event.target.value); resetPreview(); }}
            rows={8} spellCheck={false}
            placeholder={operation === "payment" ? "SER123456789, 500\nSER123456790, 250" : "SER123456789, Registration correction, 100\nSER123456790, Late document fee, 50"}
            className="mt-2 min-h-44 w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-xs leading-6 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
          <p className="mt-2 text-[11px] leading-5 text-slate-500">One Job Card per line. Duplicate Job Cards invalidate the entire batch. Every line must pass validation before confirmation.</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void runPreview()} disabled={loading || previewing || saving || !tagId || !pasted.trim()}
            className="min-h-11 rounded-xl bg-blue-700 px-5 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
            {previewing ? "Validating…" : "Preview batch"}
          </button>
          <button type="button" onClick={() => { setPasted(""); resetPreview(); setError(""); }}
            className="min-h-11 rounded-xl border border-slate-200 px-5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Clear</button>
        </div>
      </section>

      {preview && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-base font-bold text-slate-950">Validation preview</h2><p className="mt-1 text-xs text-slate-500">Tag: {selectedTag}{operation === "payment" ? ` · ${method.toUpperCase()}` : ""}</p></div>
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
            {history.map(item => <div key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-900">{item.batch_reference}</span><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${item.kind === "payment" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>{item.kind === "payment" ? "PAYMENT" : "MANUAL CHARGE"}</span></div><p className="mt-1 text-[10px] text-slate-500">{prettyDate(item.recorded_at)} · {item.line_count} record(s){item.payment_method ? ` · ${item.payment_method.toUpperCase()}` : ""} · {tags.find(tag => tag.id === item.tag_id)?.name || "Tag"}</p></div>
              <p className="text-sm font-bold tabular-nums text-slate-900">{money(item.total_amount)}</p>
            </div>)}
          </div>}
      </section>
    </div>
  );
}
