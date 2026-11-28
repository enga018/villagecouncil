"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { MiniKpi } from "@/components/app/ModuleCard";

type JobCard = {
  job_card_number: string;
  head_of_household: string | null;
  status: string;
};
type Exemption = {
  id: string;
  job_card_number: string;
  head_of_household: string | null;
  job_card_status: string | null;
  started_at: string;
  ended_at: string | null;
  add_reason: string;
  remove_reason: string | null;
  added_by: string;
  removed_by: string | null;
  created_at: string;
  updated_at: string;
};

function displayDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
function displayDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date);
}
function shortActor(value: string | null) {
  return value ? value.slice(0, 8) + "…" : "—";
}

export default function ExemptionsPage() {
  const [jobCards, setJobCards] = useState<JobCard[]>([]);
  const [intervals, setIntervals] = useState<Exemption[]>([]);
  const [actorLabels, setActorLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [jobCardNumber, setJobCardNumber] = useState("");
  const [startDate, setStartDate] = useState("");
  const [addReason, setAddReason] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [removeReason, setRemoveReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: requestError } = await createClient().functions.invoke("council-co-calculation", {
        body: { action: "exemptions" },
      });
      if (requestError) throw requestError;
      setJobCards((data?.job_cards || []) as JobCard[]);
      setIntervals((data?.intervals || []) as Exemption[]);
      setActorLabels((data?.actor_labels || {}) as Record<string, string>);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load exemption records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    async function initialLoad() {
      await Promise.resolve();
      if (!current) return;
      setStartDate(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
      try {
        const { data, error: requestError } = await createClient().functions.invoke("council-co-calculation", {
          body: { action: "exemptions" },
        });
        if (requestError) throw requestError;
        if (!current) return;
        setJobCards((data?.job_cards || []) as JobCard[]);
        setIntervals((data?.intervals || []) as Exemption[]);
        setActorLabels((data?.actor_labels || {}) as Record<string, string>);
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : "Could not load exemption records.");
      } finally {
        if (current) setLoading(false);
      }
    }
    void initialLoad();
    return () => { current = false; };
  }, []);

  const active = useMemo(() => intervals.filter(item => !item.ended_at), [intervals]);
  const history = useMemo(() => intervals.filter(item => item.ended_at), [intervals]);
  const availableCards = useMemo(() => {
    const activeNumbers = new Set(active.map(item => item.job_card_number));
    return jobCards.filter(card => !activeNumbers.has(card.job_card_number));
  }, [active, jobCards]);
  const filteredActive = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return active;
    return active.filter(item =>
      item.job_card_number.toLowerCase().includes(needle) ||
      (item.head_of_household || "").toLowerCase().includes(needle)
    );
  }, [active, query]);
  const filteredHistory = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return history;
    return history.filter(item =>
      item.job_card_number.toLowerCase().includes(needle) ||
      (item.head_of_household || "").toLowerCase().includes(needle)
    );
  }, [history, query]);

  async function addExemption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jobCardNumber || addReason.trim().length < 3) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: requestError } = await createClient().functions.invoke("council-co-calculation", {
        body: { action: "add_exemption", jobCardNumber, startDate, reason: addReason.trim() },
      });
      if (requestError) throw requestError;
      setJobCardNumber("");
      setAddReason("");
      setNotice("Exemption added. The interval and administrator audit have been recorded.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the exemption.");
    } finally {
      setSaving(false);
    }
  }

  async function removeExemption(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!removingId || removeReason.trim().length < 3) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: requestError } = await createClient().functions.invoke("council-co-calculation", {
        body: { action: "remove_exemption", intervalId: removingId, reason: removeReason.trim() },
      });
      if (requestError) throw requestError;
      setRemovingId("");
      setRemoveReason("");
      setNotice("Exemption removed. Its history has been retained.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the exemption.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium text-slate-500">
            <Link href="/contributions" className="hover:text-blue-700">Contributions</Link>
            <span className="px-2">/</span><span>Exemptions</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Job Card Exemptions</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Manage temporary exemption intervals. CO eligibility is evaluated using each FTO transaction’s Government transaction date.
          </p>
        </div>
        <Link href="/contributions" className="text-sm font-semibold text-blue-700 hover:text-blue-900">Back to Contributions</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniKpi label="Currently exempt" value={active.length} context="Job Cards with an active exemption" tone="blue" />
        <MiniKpi label="Previous intervals" value={history.length} context="Ended exemption periods" />
        <MiniKpi label="Job Cards in register" value={jobCards.length} context="All household records" />
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-950">Add an exemption</h2>
          <p className="mt-1 text-sm text-slate-500">Choose a Job Card, set the effective start date and provide a reason. Actor and timestamp are recorded automatically.</p>
        </div>
        <form onSubmit={addExemption} className="grid gap-4 lg:grid-cols-[minmax(14rem,1.2fr)_12rem_minmax(16rem,2fr)_auto] lg:items-end">
          <label className="block text-sm font-medium text-slate-700">
            Job Card
            <input required list="exemption-job-cards" value={jobCardNumber} onChange={event => setJobCardNumber(event.target.value)}
              placeholder="Type Job Card Number or select a suggestion"
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            <datalist id="exemption-job-cards">
              {availableCards.map(card => <option key={card.job_card_number} value={card.job_card_number}
                label={card.head_of_household || ""} />)}
            </datalist>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Effective start date
            <input required type="date" value={startDate} onChange={event => setStartDate(event.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Reason
            <textarea required minLength={3} maxLength={1000} rows={2} value={addReason} onChange={event => setAddReason(event.target.value)}
              placeholder="Why is this Job Card exempt?"
              className="mt-1.5 min-h-11 w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </label>
          <button type="submit" disabled={saving || !jobCardNumber || addReason.trim().length < 3}
            className="min-h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Saving…" : "Add exemption"}
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Active exemptions</h2>
            <p className="text-sm text-slate-500">These Job Cards are currently within an open exemption interval.</p>
          </div>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Job Card or household"
            className="min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm sm:max-w-xs" />
        </div>
        {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading exemption records…</div>
          : filteredActive.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No active exemptions match this search.</div>
          : <div className="grid gap-3">
            {filteredActive.map(item => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-950">{item.job_card_number}</p>
                  <p className="mt-0.5 text-sm text-slate-600">{item.head_of_household || "Household name not available"}</p>
                  <p className="mt-2 text-xs text-slate-500">Effective from <strong className="font-semibold text-slate-700">{displayDate(item.started_at)}</strong></p>
                  <p className="mt-2 text-sm text-slate-700">{item.add_reason}</p>
                  <p className="mt-2 text-xs text-slate-400">Added by {actorLabels[item.added_by] || shortActor(item.added_by)} · {displayDateTime(item.created_at)}</p>
                </div>
                {removingId === item.id ? (
                  <form onSubmit={removeExemption} className="w-full space-y-2 sm:max-w-sm">
                    <label className="block text-xs font-semibold text-slate-700">Reason for removal
                      <textarea required minLength={3} maxLength={1000} rows={2} value={removeReason}
                        onChange={event => setRemoveReason(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" />
                    </label>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => { setRemovingId(""); setRemoveReason(""); }}
                        className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700">Cancel</button>
                      <button type="submit" disabled={saving || removeReason.trim().length < 3}
                        className="min-h-9 rounded-lg bg-rose-700 px-3 text-xs font-semibold text-white disabled:opacity-50">
                        {saving ? "Saving…" : "Confirm removal"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={() => { setRemovingId(item.id); setRemoveReason(""); }}
                    className="min-h-10 shrink-0 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50">
                    Remove exemption
                  </button>
                )}
              </div>
            </article>)}
          </div>}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Exemption history</h2>
          <p className="text-sm text-slate-500">Every previous interval and its add/remove reasons remains available for audit.</p>
        </div>
        {filteredHistory.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No previous exemption intervals.</div>
          : <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {filteredHistory.map(item => <article key={item.id} className="border-b border-slate-100 p-4 last:border-0 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-950">{item.job_card_number} <span className="font-normal text-slate-500">· {item.head_of_household || "Household name not available"}</span></p>
                <span className="text-xs text-slate-500">{displayDate(item.started_at)} – {displayDate(item.ended_at)}</span>
              </div>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Added</p><p className="mt-1 text-slate-700">{item.add_reason}</p><p className="mt-1 text-xs text-slate-400">{actorLabels[item.added_by] || shortActor(item.added_by)} · {displayDateTime(item.created_at)}</p></div>
                <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Removed</p><p className="mt-1 text-slate-700">{item.remove_reason || "—"}</p><p className="mt-1 text-xs text-slate-400">{item.removed_by ? (actorLabels[item.removed_by] || shortActor(item.removed_by)) : "—"} · {item.ended_at ? displayDateTime(item.updated_at) : "—"}</p></div>
              </div>
            </article>)}
          </div>}
      </section>
    </main>
  );
}
