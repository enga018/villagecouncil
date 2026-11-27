"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import WageTransactions from "@/components/job-cards/WageTransactions";

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
  const [councilId, setCouncilId] = useState<string | null>(null);
  const [jobCards, setJobCards] = useState<JobCard[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [refetching, setRefetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [kpiChanges, setKpiChanges] = useState<{ totalCards: number; activeCards: number; totalApplicants: number; activeApplicants: number } | null>(null);
  const [previousCounts, setPreviousCounts] = useState<{ totalCards: number; activeCards: number; totalApplicants: number; activeApplicants: number } | null>(null);
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
          setCouncilId(councilId);
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
      setCouncilId(councilId);
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

      const previous = previousCounts
        ?? {
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
        totalCards: nextKpis.totalCards - previous.totalCards,
        activeCards: nextKpis.activeCards - previous.activeCards,
        totalApplicants: nextKpis.totalApplicants - previous.totalApplicants,
        activeApplicants: nextKpis.activeApplicants - previous.activeApplicants,
      });
      setPreviousCounts(nextKpis);
      setJobCards(cards);
      setApplicants(people);
      setPage(1);
      setSelectedCardId("");
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
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Council records</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">Job Cards</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Browse household records and review the applicants linked to each Job Card.</p>
          {lastFetched && <p className="mt-2 text-[11px] text-slate-400">Last successfully fetched {lastFetched}</p>}
        </div>
        <button
          type="button"
          onClick={() => void refetchJobCards()}
          disabled={refetching || loading}
          aria-busy={refetching}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={`h-4 w-4 ${refetching ? "animate-spin" : ""}`} stroke="currentColor" strokeWidth="1.7">
            <path d="M16.5 7.5A6.8 6.8 0 0 0 4.2 5.2L2.5 7M2.5 7V3.8M2.5 7h3.2M3.5 12.5a6.8 6.8 0 0 0 12.3 2.3l1.7-1.8m0 0v3.2m0-3.2h-3.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {refetching ? "Fetching…" : "Fetch Job Cards"}
        </button>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {fetchError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><p className="font-semibold">Register refetch failed</p><p className="mt-1">{fetchError}</p></div>}

      <section aria-label="Job Card register summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {([
          ["totalCards", "Total Job Cards", jobCards.length, "All household records", "JC"],
          ["activeCards", "Active Job Cards", activeCards, "Currently active records", "AC"],
          ["totalApplicants", "Total Applicants", applicants.length, "People in the register", "AP"],
          ["activeApplicants", "Active Applicants", activeApplicants, "Currently active applicants", "AA"],
        ] as const).map(([key, label, value, description, mark]) => {
          const change = kpiChanges?.[key] ?? 0;
          return (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--vc-shadow-card)] sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-[9px] font-bold text-slate-500">{mark}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-2xl font-bold tracking-tight tabular-nums text-slate-950 sm:text-[28px]">{loading ? "—" : value.toLocaleString("en-IN")}</p>
                {!loading && kpiChanges !== null && change !== 0 && (
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${change > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                    {change > 0 ? "+" : "−"}{Math.abs(change).toLocaleString("en-IN")}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-400">{description}</p>
            </div>
          );
        })}
      </section>


      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--vc-shadow-card)]">
        <div className="border-b border-slate-100 p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><h2 className="text-base font-bold tracking-tight text-slate-950">Household register</h2><p className="mt-1 text-xs text-slate-500">Select a Job Card to review its applicants and wage transactions</p></div>
            <span className="text-[11px] font-medium text-slate-400">{jobCards.length.toLocaleString("en-IN")} records loaded</span>
          </div>
          <div className="mt-4 flex flex-col gap-3 md:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search Job Cards and applicants</span>
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" stroke="currentColor" strokeWidth="1.6"><circle cx="8.8" cy="8.8" r="5.8"/><path d="m13.2 13.2 4 4" strokeLinecap="round"/></svg>
              <input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search Job Card No., household or applicant" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50" />
            </label>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              {(["active", "inactive", "all"] as const).map(value => (
                <button key={value} type="button" onClick={() => { setStatus(value); setPage(1); }} aria-pressed={status === value} className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold capitalize transition sm:flex-none ${status === value ? "bg-white text-blue-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                  {value === "all" ? "All" : value}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>{loading ? "Loading records…" : `Showing ${filteredCards.length ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, filteredCards.length)} of ${filteredCards.length.toLocaleString("en-IN")} matching Job Cards`}</span>
            <span>{applicants.length.toLocaleString("en-IN")} applicants in register</span>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center"><span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-700"/><p className="text-sm text-slate-500">Loading Job Cards and applicants…</p></div>
        ) : (
          <div className="grid min-h-[520px] grid-cols-1 md:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.5fr)]">
            <div className={`${selectedCardId ? "hidden md:block" : "block"} border-r-0 md:border-r md:border-slate-100`}>
              <div className="divide-y divide-slate-100">
                {visibleCards.map(card => {
                  const people = applicantsByCard.get(card.id) || [];
                  const activePeople = people.filter(person => person.status === "active").length;
                  const selected = selectedCardId === card.id;
                  return (
                    <button key={card.id} type="button" onClick={() => setSelectedCardId(card.id)} aria-pressed={selected}
                      className={`block min-h-[88px] w-full px-4 py-4 text-left transition hover:bg-slate-50 ${selected ? "bg-blue-50/70 md:border-l-4 md:border-l-blue-600" : "border-l-4 border-l-transparent"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-all text-[13px] font-bold text-slate-950">{card.job_card_number}</p>
                          <p className="mt-1 truncate text-xs font-medium text-slate-600">{card.head_of_household}</p>
                          <p className="mt-2 text-[10px] text-slate-400">{people.length} applicants · {activePeople} active</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase ${card.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{card.status}</span>
                      </div>
                    </button>
                  );
                })}
                {visibleCards.length === 0 && <div className="px-4 py-12 text-center"><p className="text-sm font-semibold text-slate-700">{jobCards.length ? "No matching Job Cards" : "No Job Card records found"}</p><p className="mt-1 text-xs text-slate-400">{jobCards.length ? "Try a different search term or status filter." : "There are currently no records for this Village Council."}</p></div>}
              </div>
              {pageCount > 1 && <div className="flex items-center justify-between gap-2 border-t border-slate-100 p-3">
                <span className="text-[10px] text-slate-400">Page {page} of {pageCount}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-40">Previous</button>
                  <button type="button" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={page >= pageCount} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-40">Next</button>
                </div>
              </div>}
            </div>

            <div className={`${selectedCardId ? "block" : "hidden md:block"} min-w-0 p-4 sm:p-5`}>
              {(() => {
                const card = visibleCards.find(item => item.id === selectedCardId) || filteredCards.find(item => item.id === selectedCardId);
                if (!card) return <div className="flex h-full min-h-[360px] items-center justify-center text-center"><div><p className="text-sm font-semibold text-slate-700">Select a Job Card</p><p className="mt-1 text-xs text-slate-400">Household and applicant details will appear here.</p></div></div>;
                const people = applicantsByCard.get(card.id) || [];
                return <div>
                  <div className="mb-5 flex items-start gap-3">
                    <button type="button" onClick={() => setSelectedCardId("")} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 md:hidden">← Back</button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[.13em] text-blue-700">Selected Job Card</p>
                      <h3 className="mt-1 break-all text-lg font-bold text-slate-950">{card.job_card_number}</h3>
                      <p className="mt-1 text-sm text-slate-600">{card.head_of_household}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${card.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{card.status}</span>
                  </div>
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Total applicants</p><p className="mt-1 text-lg font-bold text-slate-950">{people.length}</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Active applicants</p><p className="mt-1 text-lg font-bold text-slate-950">{people.filter(person => person.status === "active").length}</p></div>
                  </div>
                  <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Applicants</h4><span className="text-[10px] text-slate-400">{people.length} total</span></div>
                  {people.length > 0 ? <>
                    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
                      <table className="w-full min-w-[700px] text-left">
                        <thead><tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><th className="px-3 py-3">Applicant</th><th className="px-3 py-3">Applicant No.</th><th className="px-3 py-3">Gender / Age</th><th className="px-3 py-3">Caste</th><th className="px-3 py-3">Father / Husband</th><th className="px-3 py-3">Official ID</th><th className="px-3 py-3">Status</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{people.map(person => <tr key={person.id} className="text-xs text-slate-700"><td className="px-3 py-3 font-semibold text-slate-900">{person.applicant_name}</td><td className="px-3 py-3">{person.applicant_number}</td><td className="px-3 py-3">{person.gender || "—"} / {person.age || "—"}</td><td className="px-3 py-3">{person.caste || "—"}</td><td className="px-3 py-3">{person.father_husband_name || "—"}</td><td className="max-w-[140px] break-all px-3 py-3 font-mono text-[10px]">{person.official_unique_id || "—"}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${person.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{person.status}</span></td></tr>)}</tbody>
                      </table>
                    </div>
                    <div className="divide-y divide-slate-100 md:hidden">{people.map(person => <article key={person.id} className="py-3 first:pt-1">
                      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-900">{person.applicant_name}</p><p className="mt-1 text-[10px] text-slate-500">Applicant No. {person.applicant_number}</p></div><span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${person.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{person.status}</span></div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]"><div><span className="text-slate-400">Gender / Age</span><p>{person.gender || "—"} / {person.age || "—"}</p></div><div><span className="text-slate-400">Caste</span><p>{person.caste || "—"}</p></div><div><span className="text-slate-400">Father / Husband</span><p>{person.father_husband_name || "—"}</p></div></div>
                      {person.official_unique_id && <p className="mt-2 break-all font-mono text-[10px] text-slate-400">Official ID: {person.official_unique_id}</p>}
                    </article>)}</div>
                  </> : <p className="rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-400">No applicants linked to this Job Card.</p>}
                  {councilId && <WageTransactions councilId={councilId} jobCardNumber={card.job_card_number} />}
                </div>;
              })()}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
