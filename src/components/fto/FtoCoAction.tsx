"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

type CoTag = { id: string; name: string; is_archived: boolean };
type CoRow = {
  id: string; job_card_number: string; reference_number: string; transaction_date: string | null;
  applicant_name: string | null; credit_amount: number | string; amount_to_be_credited: number | string | null;
  government_status: string; normalized_status: string; rejection_reason: string | null;
  co_amount: number; is_exempt: boolean;
};
type LatestItem = {
  fto_transaction_id: string; job_card_number: string; applicant_name: string | null;
  credit_amount: number | string; co_amount: number | string; is_exempt: boolean;
};
type Calculation = {
  id: string; version: number; tag_id: string; tag_name_snapshot: string; divisor: number; multiplier: number;
  transaction_count: number; total_credit_amount: number; total_co_amount: number;
  exempt_count: number; chargeable_count: number; created_at: string;
};
type PreviewData = {
  fto: { id: string; fto_number: string; current_co_tag_id: string | null; co_calculation_version: number };
  settings: { divisor: number; multiplier: number; updated_at: string };
  tags: CoTag[];
  suggested_tag_id: string | null;
  rows: CoRow[];
  summary: { transaction_count: number; total_credit_amount: number; total_co_amount: number; exempt_count: number; chargeable_count: number };
  snapshot: {
    transaction_count: number;
    latest_transaction_updated_at: string | null;
    exemption_interval_count: number;
    latest_exemption_updated_at: string | null;
    exempt_mark_count: number;
    latest_exempt_marked_at: string | null;
  };
  latest_calculation: Calculation | null;
  latest_items: LatestItem[];
};

function money(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value));
}
function statusLabel(status: string) {
  const value = String(status || "").toLowerCase();
  if (value === "processed") return "Processed";
  if (value === "deferred" || value === "blank") return "Deferred";
  if (value === "rejected") return "Rejected";
  return status || "Other";
}
function statusClass(status: string) {
  const value = String(status || "").toLowerCase();
  if (value === "processed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "deferred" || value === "blank") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}
function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(parsed);
}

export default function FtoCoAction({
  ftoId, ftoNumber, initialVersion,
}: { ftoId: string; ftoNumber: string; initialVersion: number }) {
  const [version, setVersion] = useState(initialVersion);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPreview, setShowPreview] = useState(initialVersion === 0);
  const [confirm, setConfirm] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState("");
  const [divisor, setDivisor] = useState(300);
  const [multiplier, setMultiplier] = useState(100);
  const [newTagName, setNewTagName] = useState("");

  const savedRows = useMemo(() => {
    if (!data) return [];
    const sourceById = new Map(data.rows.map(row => [row.id, row]));
    return data.latest_items.map(item => {
      const source = sourceById.get(item.fto_transaction_id);
      return { ...item, status: source?.normalized_status || "unknown", reference_number: source?.reference_number || "—" };
    });
  }, [data]);

  async function load() {
    setLoading(true);
    setError("");
    const { data: response, error: invokeError } = await createClient().functions.invoke("council-co-calculation", {
      body: { action: "preview", ftoId },
    });
    if (invokeError || response?.error) {
      setError(response?.error || invokeError?.message || "Could not load CO calculation details.");
      setLoading(false);
      return;
    }
    const result = response as PreviewData;
    setData(result);
    setDivisor(Number(result.settings.divisor) || 300);
    setMultiplier(Number(result.settings.multiplier) || 100);
    setVersion(result.fto.co_calculation_version || 0);
    setSelectedTagId(result.fto.current_co_tag_id || result.suggested_tag_id || "");
    setLoading(false);
  }

  async function openDialog() {
    setOpen(true);
    setConfirm(false);
    setNotice("");
    setShowPreview(version === 0);
    await load();
  }

  async function createTagIfNeeded() {
    if (!newTagName.trim()) return selectedTagId;
    const { data: response, error: invokeError } = await createClient().functions.invoke("council-co-calculation", {
      body: { action: "create_tag", name: newTagName.trim() },
    });
    if (invokeError || response?.error) throw new Error(response?.error || invokeError?.message || "Could not create the tag.");
    const tag = response.tag as CoTag;
    setData(current => current ? { ...current, tags: [tag, ...current.tags] } : current);
    setSelectedTagId(tag.id);
    setNewTagName("");
    return tag.id;
  }

  async function saveTag() {
    setSaving(true);
    setError("");
    try {
      const tagId = await createTagIfNeeded();
      if (!tagId) throw new Error("Select or create an FTO tag first.");
      const { data: response, error: invokeError } = await createClient().functions.invoke("council-co-calculation", {
        body: { action: "assign_tag", ftoId, tagId },
      });
      if (invokeError || response?.error) throw new Error(response?.error || invokeError?.message || "Could not update the FTO tag.");
      setNotice("FTO tag updated. CO amounts and calculation history were not changed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the FTO tag.");
    }
    setSaving(false);
  }

  async function applyCalculation() {
    if (!data) return;
    setSaving(true);
    setError("");
    try {
      const tagId = await createTagIfNeeded();
      if (!tagId) throw new Error("Select an FTO tag before applying the calculation.");
      const { data: response, error: invokeError } = await createClient().functions.invoke("council-co-calculation", {
        body: {
          action: "apply", ftoId, tagId,
          divisor,
          multiplier,
          transactionCount: data.snapshot.transaction_count,
          latestTransactionUpdatedAt: data.snapshot.latest_transaction_updated_at,
          exemptionIntervalCount: data.snapshot.exemption_interval_count,
          latestExemptionUpdatedAt: data.snapshot.latest_exemption_updated_at,
          exemptMarkCount: data.snapshot.exempt_mark_count,
          latestExemptMarkedAt: data.snapshot.latest_exempt_marked_at,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (invokeError || response?.error) throw new Error(response?.error || invokeError?.message || "CO calculation could not be saved.");
      setNotice(version === 0 ? "CO calculation saved successfully." : "CO recalculation saved as a new version.");
      setConfirm(false);
      setShowPreview(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "CO calculation could not be saved.");
    }
    setSaving(false);
  }

  const activeTags = data?.tags.filter(tag => !tag.is_archived) || [];
  const isRecalculation = version > 0;
  const rowsToShow = showPreview ? data?.rows || [] : savedRows;
  const previewRows = useMemo(() => (data?.rows || []).map(row => ({
    ...row,
    co_amount: Math.round(((Number(row.credit_amount) / divisor) * multiplier + Number.EPSILON) * 100) / 100,
  })), [data, divisor, multiplier]);
  const previewTotalCo = previewRows.reduce((sum, row) => sum + row.co_amount, 0);
  const formulaDivisor = showPreview ? divisor : data?.latest_calculation?.divisor;
  const formulaMultiplier = showPreview ? multiplier : data?.latest_calculation?.multiplier;
  const totalCredit = showPreview ? data?.summary.total_credit_amount : data?.latest_calculation?.total_credit_amount;
  const totalCo = showPreview ? data?.summary.total_co_amount : data?.latest_calculation?.total_co_amount;
  const exemptCount = showPreview ? data?.summary.exempt_count : data?.latest_calculation?.exempt_count;

  return (
    <>
      <button type="button" onClick={openDialog}
        className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-blue-700 px-3 py-2 text-[11px] font-semibold text-white shadow-sm transition hover:bg-blue-800 lg:w-auto">
        {version > 0 ? "View CO" : "Calculate CO"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="co-dialog-title"
            className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-blue-700">FTO CO calculation</p>
                <h2 id="co-dialog-title" className="mt-1 break-all text-base font-bold text-slate-950">{ftoNumber}</h2>
                <p className="mt-1 text-xs text-slate-500">{version > 0 ? `Calculation version ${version}` : "Not calculated yet"}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close CO calculation" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Close</button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {loading ? <div className="py-12 text-center text-sm text-slate-500">Loading FTO transactions…</div> : data ? (
                <div className="space-y-5">
                  {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
                  {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}

                  {!showPreview && data.latest_calculation && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-900">Latest saved calculation · Version {data.latest_calculation.version}</p>
                        <span className="text-[10px] text-slate-500">{date(data.latest_calculation.created_at)}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div><p className="text-[10px] text-slate-500">Divisor</p><p className="mt-1 text-sm font-bold text-slate-900">{data.latest_calculation.divisor}</p></div>
                        <div><p className="text-[10px] text-slate-500">Multiplier</p><p className="mt-1 text-sm font-bold text-slate-900">{data.latest_calculation.multiplier}</p></div>
                        <div><p className="text-[10px] text-slate-500">Total calculated CO</p><p className="mt-1 text-sm font-bold text-slate-900">{money(data.latest_calculation.total_co_amount)}</p></div>
                        <div><p className="text-[10px] text-slate-500">Tag at calculation</p><p className="mt-1 text-sm font-bold text-slate-900">{data.latest_calculation.tag_name_snapshot}</p></div>
                      </div>
                      <p className="mt-3 text-[11px] text-slate-500">Formula: ROUND((Credit Amount ÷ {data.latest_calculation.divisor}) × {data.latest_calculation.multiplier}, 2)</p>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><p className="text-xs font-bold text-slate-900">FTO tag</p><p className="mt-1 text-[10px] text-slate-500">One tag applies to the entire FTO. You can change it later.</p></div>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <select value={selectedTagId} onChange={event => { setSelectedTagId(event.target.value); setNewTagName(""); }}
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50">
                        <option value="">Select an FTO tag</option>
                        {activeTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                      </select>
                      <input value={newTagName} onChange={event => setNewTagName(event.target.value)} placeholder="Or create a new tag"
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/>
                      {!showPreview && <button type="button" onClick={saveTag} disabled={saving || (!newTagName.trim() && (!selectedTagId || selectedTagId === data.fto.current_co_tag_id))}
                        className="min-h-11 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Save tag</button>}
                    </div>
                    {!showPreview && newTagName.trim() && <p className="mt-2 text-[10px] text-slate-500">Save tag will create this tag and assign it to the FTO without recalculating CO.</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ["Transactions", data.summary.transaction_count],
                      ["Credit Amount", money(showPreview ? data.summary.total_credit_amount : totalCredit)],
                      ["Calculated CO", money(showPreview ? previewTotalCo : totalCo)],
                      ["Exempt", exemptCount ?? 0],
                    ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-[10px] text-slate-500">{label}</p><p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{value}</p>
                    </div>)}
                  </div>

                  {showPreview && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                      <p className="text-xs font-bold text-blue-950">{isRecalculation ? "Recalculation preview" : "Calculation preview"}</p>
                      <p className="mt-1 text-[11px] leading-5 text-blue-900">All transactions are included in the calculation, regardless of their current Government status. Exempt transactions are calculated and saved but excluded from Contribution.</p>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <label className="block text-[11px] font-semibold text-blue-950">Divisor
                          <input type="number" min="1" step="1" inputMode="numeric" value={divisor} onChange={event => setDivisor(Math.max(1, Math.floor(Number(event.target.value) || 1)))} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />
                        </label>
                        <label className="block text-[11px] font-semibold text-blue-950">Multiplier
                          <input type="number" min="1" step="1" inputMode="numeric" value={multiplier} onChange={event => setMultiplier(Math.max(1, Math.floor(Number(event.target.value) || 1)))} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />
                        </label>
                      </div>
                      <p className="mt-2 text-[11px] font-semibold text-blue-950">Formula: ROUND((Credit Amount ÷ {formulaDivisor}) × {formulaMultiplier}, 2)</p>
                    </div>
                  )}

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-3">
                      <p className="text-xs font-bold text-slate-900">{showPreview ? "All transaction preview" : "Saved calculation details"}</p>
                      <p className="text-[10px] text-slate-500">{rowsToShow.length} transactions · status shown from FTO Monitoring</p>
                    </div>

                    {/* Desktop: full transaction table */}
                    <div className="hidden overflow-x-auto md:block">
                      <table className="min-w-[760px] w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-white text-left text-[10px] font-bold uppercase tracking-wide text-slate-500"><tr>
                          <th className="px-3 py-3">Job Card / Applicant</th><th className="px-3 py-3">Credit Amount</th><th className="px-3 py-3">CO Amount</th><th className="px-3 py-3">Government status</th><th className="px-3 py-3">Calculation</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {showPreview ? previewRows.map(row => <tr key={row.id}>
                            <td className="px-3 py-3"><p className="font-bold text-slate-900">{row.job_card_number}</p><p className="mt-0.5 text-[10px] text-slate-500">{row.applicant_name || "—"}</p></td>
                            <td className="px-3 py-3 tabular-nums text-slate-700">{money(row.credit_amount)}</td>
                            <td className="px-3 py-3 tabular-nums font-semibold text-slate-900">{money(row.co_amount)}</td>
                            <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClass(row.normalized_status)}`}>{statusLabel(row.normalized_status)}</span></td>
                            <td className="px-3 py-3">{row.is_exempt ? <span className="font-semibold text-amber-700">Exempt</span> : <span className="font-semibold text-emerald-700">Non-exempt</span>}</td>
                          </tr>) : savedRows.map(row => <tr key={row.fto_transaction_id}>
                            <td className="px-3 py-3"><p className="font-bold text-slate-900">{row.job_card_number}</p><p className="mt-0.5 text-[10px] text-slate-500">{row.applicant_name || "—"}</p></td>
                            <td className="px-3 py-3 tabular-nums text-slate-700">{money(row.credit_amount)}</td>
                            <td className="px-3 py-3 tabular-nums font-semibold text-slate-900">{money(row.co_amount)}</td>
                            <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClass(row.status)}`}>{statusLabel(row.status)}</span></td>
                            <td className="px-3 py-3">{row.is_exempt ? <span className="font-semibold text-amber-700">Exempt</span> : <span className="font-semibold text-emerald-700">Non-exempt</span>}</td>
                          </tr>)}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile: readable transaction cards */}
                    <div className="divide-y divide-slate-100 md:hidden">
                      {showPreview ? previewRows.map(row => (
                        <article key={row.id} className="space-y-3 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-all text-xs font-bold text-slate-950">{row.job_card_number}</p>
                              <p className="mt-1 text-[11px] text-slate-500">{row.applicant_name || "Applicant not recorded"}</p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClass(row.normalized_status)}`}>{statusLabel(row.normalized_status)}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3">
                            <div><p className="text-[10px] text-slate-500">Credit Amount</p><p className="mt-1 text-xs font-semibold tabular-nums text-slate-800">{money(row.credit_amount)}</p></div>
                            <div><p className="text-[10px] text-slate-500">CO Amount</p><p className="mt-1 text-xs font-bold tabular-nums text-slate-950">{money(row.co_amount)}</p></div>
                          </div>
                          <p className={`text-[11px] font-semibold ${row.is_exempt ? "text-amber-700" : "text-emerald-700"}`}>{row.is_exempt ? "Exempt from Contribution" : "Non-exempt · Contribution applicable"}</p>
                        </article>
                      )) : savedRows.map(row => (
                        <article key={row.fto_transaction_id} className="space-y-3 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-all text-xs font-bold text-slate-950">{row.job_card_number}</p>
                              <p className="mt-1 text-[11px] text-slate-500">{row.applicant_name || "Applicant not recorded"}</p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClass(row.status)}`}>{statusLabel(row.status)}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3">
                            <div><p className="text-[10px] text-slate-500">Credit Amount</p><p className="mt-1 text-xs font-semibold tabular-nums text-slate-800">{money(row.credit_amount)}</p></div>
                            <div><p className="text-[10px] text-slate-500">CO Amount</p><p className="mt-1 text-xs font-bold tabular-nums text-slate-950">{money(row.co_amount)}</p></div>
                          </div>
                          <p className={`text-[11px] font-semibold ${row.is_exempt ? "text-amber-700" : "text-emerald-700"}`}>{row.is_exempt ? "Exempt from Contribution" : "Non-exempt · Contribution applicable"}</p>
                        </article>
                      ))}
                    </div>
                  </div>

                  {showPreview && !confirm && (
                    <div className="flex flex-wrap justify-between gap-2">
                      {isRecalculation && <button type="button" onClick={() => setShowPreview(false)} className="min-h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel preview</button>}
                      <button type="button" onClick={() => setConfirm(true)} disabled={!selectedTagId && !newTagName.trim()}
                        className="ml-auto min-h-10 rounded-xl bg-slate-950 px-5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                        Review and confirm
                      </button>
                    </div>
                  )}

                  {confirm && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-bold text-amber-950">Confirm {isRecalculation ? "CO recalculation" : "CO calculation"}?</p>
                      <p className="mt-1 text-xs leading-5 text-amber-900">This saves a new immutable calculation version for all {data.summary.transaction_count} transactions. Previous versions remain unchanged. The latest version will be used by Contribution.</p>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div><p className="text-[10px] text-amber-800">Credit Amount</p><p className="mt-1 text-sm font-bold text-amber-950">{money(data.summary.total_credit_amount)}</p></div>
                        <div><p className="text-[10px] text-amber-800">Total CO</p><p className="mt-1 text-sm font-bold text-amber-950">{money(previewTotalCo)}</p></div>
                        <div><p className="text-[10px] text-amber-800">Exempt</p><p className="mt-1 text-sm font-bold text-amber-950">{data.summary.exempt_count}</p></div>
                        <div><p className="text-[10px] text-amber-800">Non-exempt</p><p className="mt-1 text-sm font-bold text-amber-950">{data.summary.chargeable_count}</p></div>
                      </div>
                      <p className="mt-3 text-[10px] text-amber-900">Formula: divisor {divisor}, multiplier {multiplier}. Tag: {activeTags.find(tag => tag.id === selectedTagId)?.name || newTagName.trim()}.</p>
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => setConfirm(false)} disabled={saving} className="min-h-10 rounded-xl border border-amber-300 bg-white px-4 text-xs font-semibold text-amber-950">Back</button>
                        <button type="button" onClick={applyCalculation} disabled={saving} className="min-h-10 rounded-xl bg-amber-900 px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Confirm and save"}</button>
                      </div>
                    </div>
                  )}

                  {!showPreview && version > 0 && (
                    <div className="flex justify-end">
                      <button type="button" onClick={() => { setShowPreview(true); setConfirm(false); setError(""); setNotice(""); }}
                        className="min-h-10 rounded-xl bg-blue-700 px-5 text-xs font-semibold text-white hover:bg-blue-800">Recalculate CO</button>
                    </div>
                  )}
                </div>
              ) : <p className="py-10 text-center text-sm text-slate-500">No CO calculation data is available.</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
