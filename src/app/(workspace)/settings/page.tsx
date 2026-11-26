"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type Settings = { divisor: number; multiplier: number; updated_at: string; updated_by: string | null };
type HistoryItem = {
  previous_divisor: number; previous_multiplier: number; new_divisor: number; new_multiplier: number;
  reason: string; changed_at: string; changed_by: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  }).format(date);
}
function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [divisor, setDivisor] = useState("300");
  const [multiplier, setMultiplier] = useState("100");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const { data, error: invokeError } = await createClient().functions.invoke("council-co-calculation", { body: { action: "settings" } });
    if (invokeError || !data?.settings) {
      setError(invokeError?.message || data?.error || "Could not load CO formula settings.");
      setLoading(false);
      return;
    }
    const current = data.settings as Settings;
    setSettings(current);
    setDivisor(String(current.divisor));
    setMultiplier(String(current.multiplier));
    setHistory((data.history || []) as HistoryItem[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const nextDivisor = Number(divisor), nextMultiplier = Number(multiplier);
    if (!Number.isSafeInteger(nextDivisor) || nextDivisor <= 0 || !Number.isSafeInteger(nextMultiplier) || nextMultiplier <= 0) {
      setError("Divisor and multiplier must be positive whole numbers.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Please provide a reason for changing the formula.");
      return;
    }
    setSaving(true);
    const { data, error: invokeError } = await createClient().functions.invoke("council-co-calculation", {
      body: { action: "save_settings", divisor: nextDivisor, multiplier: nextMultiplier, reason: reason.trim() },
    });
    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || "Could not save formula settings.");
      setSaving(false);
      return;
    }
    setReason("");
    setNotice(data?.result?.changed ? "CO formula settings updated. New calculations will use this formula; existing calculations remain unchanged." : "The formula is already set to these values.");
    await load();
    setSaving(false);
  }

  const validFormula = Number(divisor) > 0 && Number(multiplier) > 0;
  const example = validFormula ? (1000 / Number(divisor)) * Number(multiplier) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Preferences</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Configure the CO formula used when calculating FTO transactions.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-950">CO calculation formula</h2>
            <p className="mt-1 text-xs text-slate-500">These settings apply to future calculations and recalculations only.</p>
          </div>
          <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[10px] font-semibold text-blue-700">Council-wide</span>
        </div>

        {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading formula settings…</p> : (
          <form onSubmit={save} className="mt-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Divisor</span>
                <input type="number" min="1" step="1" inputMode="numeric" required value={divisor}
                  onChange={event => setDivisor(event.target.value)}
                  className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Multiplier</span>
                <input type="number" min="1" step="1" inputMode="numeric" required value={multiplier}
                  onChange={event => setMultiplier(event.target.value)}
                  className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/>
              </label>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Formula preview</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">ROUND((Credit Amount ÷ {divisor || "—"}) × {multiplier || "—"}, 2)</p>
              <p className="mt-1 text-xs text-slate-500">Example: {money(1000)} Credit Amount = <strong className="text-slate-800">{money(example)}</strong> CO</p>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-slate-700">Reason for change</span>
              <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} maxLength={1000}
                placeholder="Explain why the CO formula is being changed…"
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/>
            </label>

            {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
            {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[10px] text-slate-400">{settings ? `Last updated ${formatDate(settings.updated_at)}` : "Default formula: divisor 300, multiplier 100"}</p>
              <button type="submit" disabled={saving || !validFormula}
                className="min-h-11 rounded-xl bg-slate-950 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? "Saving…" : "Save formula"}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
        <h2 className="text-base font-bold text-slate-950">Formula change history</h2>
        <p className="mt-1 text-xs text-slate-500">Previous formula values are retained for audit. Each FTO calculation also stores its own divisor and multiplier.</p>
        {history.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-4 text-xs text-slate-500">No formula changes recorded.</p> : (
          <div className="mt-4 divide-y divide-slate-100">
            {history.map((item, index) => (
              <div key={item.changed_at + index} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900">{item.previous_divisor} / {item.previous_multiplier} → {item.new_divisor} / {item.new_multiplier}</p>
                  <time className="text-[10px] text-slate-400">{formatDate(item.changed_at)}</time>
                </div>
                <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
