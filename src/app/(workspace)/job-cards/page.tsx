"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

type StatusFilter = "all" | "active" | "inactive";
type JobCard = {
  id: string;
  job_card_number: string;
  head_of_household: string;
  status: string;
};
type Applicant = {
  id: string;
  job_card_id: string;
  applicant_number: string;
  applicant_name: string;
  official_unique_id: string | null;
  status: string;
  caste: string | null;
  father_husband_name: string | null;
  gender: string | null;
  age: string | null;
};

export default function JobCardsPage() {
  const [jobCards, setJobCards] = useState<JobCard[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [refetching, setRefetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [kpiChanges, setKpiChanges] = useState<{ totalCards: number; activeCards: number; totalApplicants: number; activeApplicants: number } | null>(null);
  const pageSize = 20;

  useEffect(() => {
    let active = true;
    async function loadRecords() {
      setLoading(true);
      setError("");
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("Your session has expired. Please sign in again.");

        const { data: membership, error: membershipError } = await supabase
          .from("council_memberships")
          .select("village_council_id")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) throw new Error("This account has no active Village Council assignment.");

        const councilId = membership.village_council_id;
        const cards: JobCard[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data, error: cardsError } = await supabase
            .from("council_job_cards")
            .select("id,job_card_number,head_of_household,status")
            .eq("village_council_id", councilId)
            .order("job_card_number", { ascending: true })
            .range(offset, offset + 999);
          if (cardsError) throw cardsError;
          cards.push(...(data || []));
          if (!data || data.length < 1000) break;
        }

        const people: Applicant[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data, error: applicantsError } = await supabase
            .from("council_applicants")
            .select("id,job_card_id,applicant_number,applicant_name,official_unique_id,status,caste,father_husband_name,gender,age")
            .eq("village_council_id", councilId)
            .order("job_card_id", { ascending: true })
            .order("source_sequence", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + 999);
          if (applicantsError) throw applicantsError;
          people.push(...(data || []));
          if (!data || data.length < 1000) break;
        }

        if (active) {
          setJobCards(cards);
          setApplicants(people);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load Job Card records.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadRecords();
    return () => { active = false; };
  }, []);

  async function refetchJobCards() {
    if (refetching) return;
    setRefetching(true);
    setFetchError("");
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Your session has expired. Please sign in again.");

      const { data: membership, error: membershipError } = await supabase
        .from("council_memberships")
        .select("village_council_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error("This account has no active Village Council assignment.");

      const { data, error: invokeError } = await supabase.functions.invoke<{
        success?: boolean;
        reportInspection?: { preview?: {
          batchId: string;
          stagedRows: number;
          validation?: {
            passed: boolean;
            stagedRowsMatch: boolean;
            checkedRows: number;
            activeJobCards: number;
            inactiveJobCards: number;
          };
          activeJobCards: number;
          inactiveJobCards: number;
          activeApplicants: number;
          deletedApplicants: number;
        }; error?: string };
        error?: string;
      }>("council-register-source", { body: { action: "prepare-preview" } });
      if (invokeError) {
        let message = invokeError.message || "Could not fetch the official Job Card register.";
        const context = invokeError.context as Response | undefined;
        if (context && typeof context.json === "function") {
          try {
            const detail = await context.json() as { error?: string };
            if (detail.error) message = detail.error;
          } catch {}
        }
        throw new Error(message);
      }
      const preview = data?.reportInspection?.preview;
      if (!data?.success || !preview?.batchId) {
        throw new Error(data?.reportInspection?.error || data?.error || "The official register could not be prepared.");
      }
      if (!preview.validation?.passed || !preview.validation.stagedRowsMatch) {
        throw new Error("The official register did not pass validation. Existing records were not changed.");
      }

      // Validate the complete result summary before activating the staged import.
      // Job Card counts are returned inside preview.validation by the Edge Function.
      const validation = preview.validation;
      const summaryValues = [
        validation.activeJobCards,
        validation.inactiveJobCards,
        validation.checkedRows,
        preview.activeApplicants,
      ];
      if (summaryValues.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        throw new Error("The official register returned incomplete summary counts. Existing records were not changed.");
      }

      let stagedCount = 0;
      for (let offset = 0; ; offset += 1000) {
        const { data: rows, error: rowsError } = await supabase
          .from("council_register_import_rows")
          .select("row_number")
          .eq("import_batch_id", preview.batchId)
          .order("row_number", { ascending: true })
          .range(offset, offset + 999);
        if (rowsError) throw rowsError;
        stagedCount += rows?.length || 0;
        if (!rows || rows.length < 1000) break;
      }
      if (stagedCount !== preview.stagedRows) {
        throw new Error("Register verification was incomplete. Existing records were not changed.");
      }

      const { data: activation, error: activationError } = await supabase
        .rpc("activate_council_register_import", { p_batch_id: preview.batchId });
      if (activationError) throw activationError;
      if (!activation?.success) throw new Error("The Job Card refetch did not complete successfully.");

      const councilId = membership.village_council_id;
      const cards: JobCard[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: rows, error } = await supabase
          .from("council_job_cards")
          .select("id,job_card_number,head_of_household,status")
          .eq("village_council_id", councilId)
          .order("job_card_number", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        cards.push(...(rows || []));
        if (!rows || rows.length < 1000) break;
      }

      const people: Applicant[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: rows, error } = await supabase
          .from("council_applicants")
          .select("id,job_card_id,applicant_number,applicant_name,official_unique_id,status,caste,father_husband_name,gender,age")
          .eq("village_council_id", councilId)
          .order("job_card_id", { ascending: true })
          .order("source_sequence", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        people.push(...(rows || []));
        if (!rows || rows.length < 1000) break;
      }

      const previousKpis = {
        totalCards: jobCards.length,
        activeCards: jobCards.filter(card => card.status === "active").length,
        totalApplicants: applicants.length,
        activeApplicants: applicants.filter(person => person.status === "active").length,
      };
      const nextKpis = {
        totalCards: cards.length,
        activeCards: cards.filter(card => card.status === "active").length,
        totalApplicants: people.length,
        activeApplicants: people.filter(person => person.status === "active").length,
      };
      setKpiChanges({
        totalCards: nextKpis.totalCards - previousKpis.totalCards,
        activeCards: nextKpis.activeCards - previousKpis.activeCards,
        totalApplicants: nextKpis.totalApplicants - previousKpis.totalApplicants,
        activeApplicants: nextKpis.activeApplicants - previousKpis.activeApplicants,
      });
      setJobCards(cards);
      setApplicants(people);
      setPage(1);
      setExpanded([]);
      setLastFetched(new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unable to refetch the Job Card register.");
    } finally {
      setRefetching(false);
    }
  }

  const applicantsByCard = useMemo(() => {
    const groups = new Map<string, Applicant[]>();
    for (const person of applicants) {
      const group = groups.get(person.job_card_id) || [];
      group.push(person);
      groups.set(person.job_card_id, group);
    }
    return groups;
  }, [applicants]);

  const activeCards = jobCards.filter(card => card.status === "active").length;
  const activeApplicants = applicants.filter(person => person.status === "active").length;
  const filteredCards = useMemo(() => {
    const term = query.trim().toLowerCase();
    return jobCards.filter(card => {
      const people = applicantsByCard.get(card.id) || [];
      const isActive = card.status === "active";
      const statusMatches = status === "all" || (status === "active" ? isActive : !isActive);
      const searchMatches = !term ||
        card.job_card_number.toLowerCase().includes(term) ||
        card.head_of_household.toLowerCase().includes(term) ||
        people.some(person => person.applicant_name.toLowerCase().includes(term) || (person.official_unique_id || "").toLowerCase().includes(term));
      return statusMatches && searchMatches;
    });
  }, [jobCards, applicantsByCard, query, status]);

  const pageCount = Math.max(1, Math.ceil(filteredCards.length / pageSize));
  const visibleCards = filteredCards.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-7">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">Core records</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Job Cards</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Households and their applicants for your Village Council.</p>
          {lastFetched && <p className="mt-2 text-xs text-slate-500">Last fetched: {lastFetched}</p>}
        </div>
        <button
          type="button"
          onClick={() => void refetchJobCards()}
          disabled={refetching || loading}
          aria-busy={refetching}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.7">
            <path d="M16.5 7.5A6.8 6.8 0 0 0 4.2 5.2L2.5 7M2.5 7V3.8M2.5 7h3.2M3.5 12.5a6.8 6.8 0 0 0 12.3 2.3l1.7-1.8m0 0v3.2m0-3.2h-3.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Refetch Job Cards
        </button>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {fetchError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{fetchError}</div>}
      <section aria-label="Job Card register summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ["totalCards", "Total Job Cards", jobCards.length],
          ["activeCards", "Active Job Cards", activeCards],
          ["totalApplicants", "Total Applicants", applicants.length],
          ["activeApplicants", "Active Applicants", activeApplicants],
        ] as const).map(([key, label, value]) => {
          const change = kpiChanges?.[key] ?? 0;
          return (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{label}</p>
              <div className="mt-2 flex items-center gap-2">
                <p className="text-2xl font-semibold tabular-nums text-slate-950">{loading ? "—" : value.toLocaleString()}</p>
                {!loading && kpiChanges !== null && change !== 0 && (
                  <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${change > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                    {change > 0 ? "+" : "−"}{Math.abs(change).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search Job Cards and applicants</span>
            <input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search Job Card No., household or applicant" className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" />
          </label>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {(["active", "inactive", "all"] as const).map(value => (
              <button key={value} type="button" onClick={() => { setStatus(value); setPage(1); }} aria-pressed={status === value} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${status === value ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>
                {value === "all" ? "All" : value}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>{loading ? "Loading records…" : `Showing ${filteredCards.length ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, filteredCards.length)} of ${filteredCards.length.toLocaleString()} Job Cards`}</span>
          <span>{applicants.length.toLocaleString()} applicants</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-slate-500">Loading Job Cards and applicants…</div>
        ) : (
          <div className="mt-3 space-y-2">
            {visibleCards.map(card => {
              const people = applicantsByCard.get(card.id) || [];
              const activePeople = people.filter(person => person.status === "active").length;
              const isExpanded = expanded.includes(card.id);
              return (
                <article key={card.id} className="overflow-hidden rounded-xl border border-slate-200">
                  <button type="button" onClick={() => setExpanded(current => isExpanded ? current.filter(id => id !== card.id) : [...current, card.id])} aria-expanded={isExpanded} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="break-all text-sm text-slate-950">{card.job_card_number}</strong>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${card.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{card.status}</span>
                      </span>
                      <span className="mt-1 block truncate text-sm text-slate-600">{card.head_of_household}</span>
                      <span className="mt-1 block text-xs text-slate-500">{people.length} applicants · {activePeople} active</span>
                    </span>
                    <span className="shrink-0 text-lg text-slate-400">{isExpanded ? "−" : "+"}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-white">
                      {people.map(person => (
                        <div key={person.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">{person.applicant_name}</p>
                            <p className="mt-0.5 text-xs text-slate-500">Applicant No. {person.applicant_number}{person.gender ? ` · ${person.gender}` : ""}{person.age ? ` · ${person.age} years` : ""}</p>
                            {person.father_husband_name && <p className="mt-0.5 text-xs text-slate-500">Father / Husband: {person.father_husband_name}</p>}
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${person.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{person.status}</span>
                        </div>
                      ))}
                      {people.length === 0 && <p className="px-3 py-5 text-center text-xs text-slate-500">No applicants linked to this Job Card.</p>}
                    </div>
                  )}
                </article>
              );
            })}
            {visibleCards.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-500">{jobCards.length ? "No matching Job Cards." : "No Job Card records found for this Village Council."}</div>}
          </div>
        )}

        {!loading && pageCount > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
            <p className="text-xs text-slate-500">Page {page} of {pageCount}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40">Previous</button>
              <button type="button" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={page >= pageCount} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
