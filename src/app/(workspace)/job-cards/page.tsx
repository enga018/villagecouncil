"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import WageTransactions from "@/components/job-cards/WageTransactions";
import { MiniKpi } from "@/components/app/ModuleCard";
import { LIST_PAGE_SIZE, ListPagination } from "@/components/app/ListPagination";
import { SPLIT_GRID } from "@/lib/layout";

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
  const pageSize = LIST_PAGE_SIZE;

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

  const visibleCards = filteredCards.slice((page - 1) * pageSize, page * pageSize);

    return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Council records</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">Job Cards</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Browse household records and review the applicants linked to each Job Card.</p>
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section aria-label="Job Card register summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MiniKpi label="Total Job Cards" value={loading ? null : jobCards.length} context="All household records"  />
        <MiniKpi label="Active Job Cards" value={loading ? null : activeCards} context="Currently active records"  tone="blue" />
        <MiniKpi label="Total Applicants" value={loading ? null : applicants.length} context="People in the register"  />
        <MiniKpi label="Active Applicants" value={loading ? null : activeApplicants} context="Currently active applicants"  tone="blue" />
      </section>


      <section className="min-w-0">
  

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center"><span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-700"/><p className="text-sm text-slate-500">Loading Job Cards and applicants…</p></div>
        ) : (
          <div className={`grid min-h-[520px] ${selectedCardId ? SPLIT_GRID : "grid-cols-1"}`}>
            <div className={`min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white ${selectedCardId ? "hidden lg:block" : "block"}`}>
              <div className="space-y-3 border-b border-slate-200 p-4">
                <label className="relative block w-full min-w-0">
                  <span className="sr-only">Search Job Cards and applicants</span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" stroke="currentColor" strokeWidth="1.6"><circle cx="8.8" cy="8.8" r="5.8"/><path d="m13.2 13.2 4 4" strokeLinecap="round"/></svg>
                  <input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search Job Card No., household or applicant" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50" />
                </label>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                    {(["active", "inactive", "all"] as const).map(value => (
                      <button key={value} type="button" onClick={() => { setStatus(value); setPage(1); }} aria-pressed={status === value} className={`min-h-9 rounded-lg px-3 text-xs font-semibold capitalize transition ${status === value ? "bg-white text-blue-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                        {value === "all" ? "All" : value}
                      </button>
                    ))}
                  </div>
                  <span className="shrink-0 text-right text-[11px] text-slate-600">{loading ? "Loading…" : `Showing ${filteredCards.length ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, filteredCards.length)} of ${filteredCards.length.toLocaleString("en-IN")}`}</span>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {visibleCards.map(card => {
                  const people = applicantsByCard.get(card.id) || [];
                  const activePeople = people.filter(person => person.status === "active").length;
                  const selected = selectedCardId === card.id;
                  return (
                    <button key={card.id} type="button" onClick={() => setSelectedCardId(card.id)} aria-pressed={selected}
                      className={`block min-h-[88px] w-full border-l-[3px] px-4 py-4 text-left transition-colors cursor-pointer ${selected ? "border-l-blue-600 bg-blue-50/60" : "border-l-transparent bg-white hover:bg-slate-50/80"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-all text-[13px] font-bold text-slate-950">{card.job_card_number}</p>
                          <p className="mt-1 truncate text-xs font-medium text-slate-600">{card.head_of_household}</p>
                          <p className="mt-2 text-[10px] text-slate-600">{people.length} applicants · {activePeople} active</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase ${card.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{card.status}</span>
                      </div>
                    </button>
                  );
                })}
                {visibleCards.length === 0 && <div className="px-4 py-12 text-center"><p className="text-sm font-semibold text-slate-700">{jobCards.length ? "No matching Job Cards" : "No Job Card records found"}</p><p className="mt-1 text-xs text-slate-600">{jobCards.length ? "Try a different search term or status filter." : "There are currently no records for this Village Council."}</p></div>}
              </div>
              <ListPagination page={page} total={filteredCards.length} onPage={setPage} label="Job Cards" />
            </div>

            <div className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 ${selectedCardId ? "block" : "hidden"}`}>
              {(() => {
                const card = visibleCards.find(item => item.id === selectedCardId) || filteredCards.find(item => item.id === selectedCardId);
                if (!card) return <div className="flex h-full min-h-[360px] items-center justify-center text-center"><div><p className="text-sm font-medium text-slate-600">Select a Job Card to review its applicants and wage transactions</p></div></div>;
                const people = applicantsByCard.get(card.id) || [];
                return <div>
                  <div className="mb-5 flex items-start gap-3">
                    <button type="button" onClick={() => setSelectedCardId("")} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 lg:hidden">← Back</button>
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
                  <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Applicants</h4><span className="text-[10px] text-slate-600">{people.length} total</span></div>
                  {people.length > 0 ? <>
                    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
                      <table className="w-full min-w-[700px] text-left">
                        <thead><tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><th className="px-3 py-3">Applicant</th><th className="px-3 py-3">Applicant No.</th><th className="px-3 py-3">Gender / Age</th><th className="px-3 py-3">Caste</th><th className="px-3 py-3">Father / Husband</th><th className="px-3 py-3">Official ID</th><th className="px-3 py-3">Status</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{people.map(person => <tr key={person.id} className="text-xs text-slate-700"><td className="px-3 py-3 font-semibold text-slate-900">{person.applicant_name}</td><td className="px-3 py-3">{person.applicant_number}</td><td className="px-3 py-3">{person.gender || "—"} / {person.age || "—"}</td><td className="px-3 py-3">{person.caste || "—"}</td><td className="px-3 py-3">{person.father_husband_name || "—"}</td><td className="max-w-[140px] break-all px-3 py-3 font-mono text-[10px]">{person.official_unique_id || "—"}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${person.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{person.status}</span></td></tr>)}</tbody>
                      </table>
                    </div>
                    <div className="divide-y divide-slate-100 md:hidden">{people.map(person => <article key={person.id} className="py-3 first:pt-1">
                      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-900">{person.applicant_name}</p><p className="mt-1 text-[10px] text-slate-500">Applicant No. {person.applicant_number}</p></div><span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${person.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{person.status}</span></div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]"><div><span className="text-slate-600">Gender / Age</span><p>{person.gender || "—"} / {person.age || "—"}</p></div><div><span className="text-slate-600">Caste</span><p>{person.caste || "—"}</p></div><div><span className="text-slate-600">Father / Husband</span><p>{person.father_husband_name || "—"}</p></div></div>
                      {person.official_unique_id && <p className="mt-2 break-all font-mono text-[10px] text-slate-600">Official ID: {person.official_unique_id}</p>}
                    </article>)}</div>
                  </> : <p className="rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-600">No applicants linked to this Job Card.</p>}
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
