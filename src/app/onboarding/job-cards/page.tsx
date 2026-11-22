"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import OnboardingShell from "@/components/app/OnboardingShell";
import OnboardingActions from "@/components/app/OnboardingActions";

type RegisterPreview = {
  batchId: string;
  status: string;
  sourceTable: number;
  sourceRows: number;
  stagedRows: number;
  activeApplicants: number;
  deletedApplicants: number;
  inactiveJobCards: number;
  sourceDeletedApplicants: number;
  existingJobCards: number;
  newJobCards: number;
  changedJobCards: number;
  existingApplicants: number;
  newApplicants: number;
  changedApplicants: number;
  unchangedApplicants: number;
  missingApplicants: number;
  missingJobCards: number;
  sample: { jobCardNumber: string; headOfHousehold: string; applicantNumber: string; applicantName: string }[];
  activation: string;
  validation?: { passed: boolean; stagedRowsMatch: boolean; requiredFieldsPresent: boolean; uniqueSourceKeys: boolean; uniqueOfficialIds: boolean; applicantNumbering: boolean; activeJobCards: number; inactiveJobCards: number; checkedRows: number };
};

type StagedApplicant = { job_card_number: string; jc_number: string; head_of_household: string; applicant_number: string; official_unique_id: string; applicant_name: string; status: string; source_sequence: number };

type RegisterSourceResult = {
  success?: boolean;
  reportInspection?: { preview?: RegisterPreview; error?: string };
  error?: string;
};

function isAuthenticationFailure(error: unknown, response?: Response) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return response?.status === 401 || /auth session missing|authentication required|invalid or expired session|jwt expired|unauthorized|\\b401\\b/.test(message);
}

export default function JobCardOnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [councilName, setCouncilName] = useState("");
  const [location, setLocation] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<RegisterPreview | null>(null);
  const [stagedApplicants, setStagedApplicants] = useState<StagedApplicant[]>([]);
  const [loadingRegister, setLoadingRegister] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationResult, setActivationResult] = useState<Record<string, unknown> | null>(null);
  const [previousRegisterVillage, setPreviousRegisterVillage] = useState("");
  const [expandedCards, setExpandedCards] = useState<string[]>([]);
  const [cardSearch, setCardSearch] = useState("");
  const [cardStatus, setCardStatus] = useState<"active" | "inactive" | "all">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");

  const returnToLogin = useCallback(() => {
    router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [router]);

  useEffect(() => {
    let active = true;
    async function loadSetup() {
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) { returnToLogin(); return; }

        const { data: membership, error: membershipError } = await supabase
          .from("council_memberships").select("village_council_id")
          .eq("user_id", user.id).eq("is_active", true).maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) throw new Error("This account has no active Village Council assignment.");

        const { data: council, error: councilError } = await supabase
          .from("council_tenants")
          .select("name,state,district,block,village,onboarding_completed_at")
          .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
        if (councilError) throw councilError;
        if (!council) throw new Error("The assigned Village Council is unavailable.");
        if (council.onboarding_completed_at) { router.replace("/dashboard"); return; }
        if (!council.state || !council.district || !council.block || !council.village) {
          router.replace("/onboarding");
          return;
        }
        const { data: completedBatch, error: completedBatchError } = await supabase
          .from("council_register_import_batches")
          .select("id,total_rows,source_location_key,inserted_job_cards,updated_job_cards,inserted_applicants,updated_applicants,missing_records,completed_at")
          .eq("village_council_id", membership.village_council_id)
          .eq("source", "official_registration_register")
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (completedBatchError) throw completedBatchError;
        if (active) {
          setCouncilName(council.name);
          setLocation([council.state, council.district, council.block, council.village]);
          const importedVillage = String(completedBatch?.source_location_key || "").split(" | ").at(-1) || "";
          setPreviousRegisterVillage(importedVillage);
          if (completedBatch && importedVillage === council.village) {
            setActivationResult({
              alreadyActivated: true,
              activated_rows: Number(completedBatch.inserted_applicants || 0) + Number(completedBatch.updated_applicants || 0),
              job_cards_inserted: completedBatch.inserted_job_cards,
              job_cards_updated: completedBatch.updated_job_cards,
              applicants_inserted: completedBatch.inserted_applicants,
              applicants_updated: completedBatch.updated_applicants,
              missing_applicants_for_manual_review: completedBatch.missing_records,
              missing_job_cards_for_manual_review: 0,
              batch_id: completedBatch.id,
              total_rows: completedBatch.total_rows,
              completed_at: completedBatch.completed_at,
            });
          }
        }
      } catch (err) {
        if (active && isAuthenticationFailure(err)) { returnToLogin(); return; }
        if (active) setPageError(err instanceof Error ? err.message : "Unable to load onboarding.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadSetup();
    return () => { active = false; };
  }, [router, returnToLogin]);

  async function activateRegister() {
    if (!preview?.batchId || !preview.validation?.passed || stagedApplicants.length !== preview.stagedRows) return;
    const approved = window.confirm(
      `Activate this reviewed Government register for ${councilName}? This will write ${stagedApplicants.length.toLocaleString()} applicants and their Job Cards to the operational register. Missing existing records will be kept and flagged for manual review.`
    );
    if (!approved) return;
    setActivating(true);
    setError("");
    try {
      const { data, error: activationError } = await createClient()
        .rpc("activate_council_register_import", { p_batch_id: preview.batchId });
      if (activationError) throw activationError;
      if (!data?.success) throw new Error("The activation did not return a successful result.");
      setActivationResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to activate the reviewed register.");
    } finally {
      setActivating(false);
    }
  }

  async function preparePreview() {
    setFetching(true);
    setError("");
    setPreview(null);
    setStagedApplicants([]);
    setExpandedCards([]);
    try {
      const { data, error: invokeError } = await createClient().functions.invoke<RegisterSourceResult>(
        "council-register-source",
        { body: { action: "prepare-preview" } },
      );
      if (invokeError) {
        let message = invokeError.message || "Could not fetch the official applicant register.";
        const context = invokeError.context as Response | undefined;
        if (isAuthenticationFailure(invokeError, context)) {
          returnToLogin();
          throw new Error("Your session has expired. Returning you to sign in…");
        }
        if (context && typeof context.json === "function") {
          try {
            const detail = await context.json() as { error?: string };
            if (detail.error) message = detail.error;
          } catch {}
        }
        throw new Error(message);
      }
      if (!data?.success || !data.reportInspection?.preview) {
        throw new Error(data?.reportInspection?.error || data?.error || "The official register preview was not prepared.");
      }
      const prepared = data.reportInspection.preview;
      setPreview(prepared);
      setLoadingRegister(true);
      const supabase = createClient();
      const allRows: StagedApplicant[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: rows, error: rowsError } = await supabase
          .from("council_register_import_rows").select("row_data")
          .eq("import_batch_id", prepared.batchId)
          .order("row_number", { ascending: true }).range(offset, offset + 999);
        if (rowsError) throw rowsError;
        allRows.push(...(rows || []).map((item: { row_data: StagedApplicant }) => item.row_data));
        if (!rows || rows.length < 1000) break;
      }
      setStagedApplicants(allRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare the official register preview.");
    } finally {
      setLoadingRegister(false);
      setFetching(false);
    }
  }

  const groupedCards = useMemo(() => {
    const groups = new Map<string, StagedApplicant[]>();
    for (const applicant of stagedApplicants) {
      const key = applicant.job_card_number;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(applicant);
    }
    return Array.from(groups.entries()).map(([card, applicants]) => {
      const head = applicants.find(item => item.head_of_household)?.head_of_household || "Household head unavailable";
      const activeCount = applicants.filter(item => item.status === "active").length;
      return { card, applicants, head, activeCount, deletedCount: applicants.length - activeCount, inactive: activeCount === 0 };
    });
  }, [stagedApplicants]);

  const activeJobCards = groupedCards.filter(item => !item.inactive).length;
  const inactiveJobCards = groupedCards.length - activeJobCards;
  const filteredCards = groupedCards.filter(item => {
    const matchesStatus = cardStatus === "all" || (cardStatus === "active" ? !item.inactive : item.inactive);
    const term = cardSearch.trim().toLowerCase();
    const matchesSearch = !term || item.card.toLowerCase().includes(term) ||
      item.head.toLowerCase().includes(term) ||
      item.applicants.some(applicant => applicant.applicant_name.toLowerCase().includes(term));
    return matchesStatus && matchesSearch;
  });
  const pageCount = Math.max(1, Math.ceil(filteredCards.length / pageSize));
  const visibleCards = filteredCards.slice((page - 1) * pageSize, page * pageSize);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Loading onboarding…</p></main>;

  return <OnboardingShell activeStep={1}>
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-blue-700">Job Card register · Step 2</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Import Job Cards & applicants</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">Fetch the official Registration Application Register for {councilName || "your Village Council"}.</p>
      </header>

      {pageError ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{pageError}</div> : <>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-base font-semibold text-slate-950">Confirmed Government location</h2>
          <p className="mt-1 text-sm text-slate-500">The register will be fetched using the location saved in Step 1.</p>
          <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 sm:grid-cols-2">
            {location.map((item, index) => <p key={index}><span className="text-xs text-slate-400">{["State", "District", "Block", "Panchayat"][index]}</span><br/><strong>{item}</strong></p>)}
          </div>
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h2 className="text-base font-semibold text-slate-950">Official applicant register</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">We will read the Government register, calculate Applicant Numbers and Unique IDs in source order, and prepare a review-only import batch. All applicants are retained, including deleted records. Applicant Numbers and Unique IDs are calculated in the original Government source order. Job Cards with no active applicants remain in the register as inactive.</p>
            {activationResult ? (
              <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">The Government register for this village is already activated. To fetch again during onboarding, change the Panchayat / Village in Step 1. Routine updates belong in the operational Job Cards module.</p>
            ) : (
              <>
              {previousRegisterVillage && previousRegisterVillage !== location[3] && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">The saved village has changed from {previousRegisterVillage} to {location[3]}. You can fetch the register for this newly selected village.</p>}
              <button type="button" onClick={() => void preparePreview()} disabled={fetching} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
                {fetching ? "Fetching and preparing preview…" : preview ? "Fetch register again" : "Fetch official register"}
              </button>
              </>
            )}
            {fetching && <p className="mt-3 text-xs text-slate-500">This may take a little while while the Government site is contacted and the register is parsed.</p>}
            {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
          </div>
        </section>

        {preview && <section className="mt-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Preview ready · awaiting review</p><h2 className="mt-1 text-lg font-semibold text-slate-950">Official register parsed successfully</h2></div>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Not activated</span>
          </div>
          <p className="mt-2 break-all text-xs text-slate-500">Batch ID: {preview.batchId}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Active Job Cards", activeJobCards],
              ["Inactive Job Cards", inactiveJobCards],
              ["Active applicants", preview.activeApplicants],
              ["Deleted applicants", preview.deletedApplicants ?? preview.sourceDeletedApplicants],
              ["Total applicants", preview.stagedRows],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{Number(value).toLocaleString()}</p></div>)}
          </div>
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-950">Import reconciliation</h3>
            <p className="mt-0.5 text-xs text-slate-500">Comparison with records already activated for this Village Council.</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["New Job Cards", preview.newJobCards],
                ["Changed Job Cards", preview.changedJobCards],
                ["New applicants", preview.newApplicants],
                ["Changed applicants", preview.changedApplicants],
                ["Unchanged applicants", preview.unchangedApplicants],
                ["Existing applicants", preview.existingApplicants],
                ["Missing Job Cards", preview.missingJobCards],
                ["Missing applicants", preview.missingApplicants],
              ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 px-3 py-2.5"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{Number(value ?? 0).toLocaleString()}</p></div>)}
            </div>
            {(preview.missingJobCards > 0 || preview.missingApplicants > 0) && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Some previously active records are absent from this source snapshot. They will be flagged for manual review and will not be automatically deactivated.</p>}
          </div>
          {preview.validation && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-sm font-semibold text-emerald-950">Import validation</h3><p className="mt-0.5 text-xs text-emerald-800">Checked {preview.validation.checkedRows.toLocaleString()} staged applicant records before review.</p></div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">{preview.validation.passed ? "All checks passed" : "Review required"}</span>
            </div>
            <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Required fields", preview.validation.requiredFieldsPresent],
                ["Source identities unique", preview.validation.uniqueSourceKeys],
                ["Official IDs unique", preview.validation.uniqueOfficialIds],
                ["Applicant numbering", preview.validation.applicantNumbering],
                ["Staged row count", preview.validation.stagedRowsMatch],
              ].map(([label, passed]) => <div key={String(label)} className="flex items-center gap-2 text-xs"><span className={passed ? "text-emerald-700" : "text-red-700"}>{passed ? "✓" : "!"}</span><span className="text-slate-700">{label}</span></div>)}
            </div>
          </div>}
          <div className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Complete Job Card register</h3>
                <p className="mt-1 text-xs text-slate-500">Complete source register, including Job Cards whose applicants are all deleted.</p>
              </div>
              <span className="text-xs font-semibold text-slate-600">{new Set(stagedApplicants.map(item => item.job_card_number)).size.toLocaleString()} Job Cards · {stagedApplicants.length.toLocaleString()} applicants</span>
            </div>
            {loadingRegister ? <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Loading the complete staged register…</p> : (
              <div className="mt-3">
                <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Search Job Cards and applicants</span>
                    <input value={cardSearch} onChange={event => { setCardSearch(event.target.value); setPage(1); }} placeholder="Search Job Card, household head or applicant…" className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                  </label>
                  <div className="flex shrink-0 gap-1 rounded-lg bg-white p-1">
                    {(["active", "inactive", "all"] as const).map(status => <button key={status} type="button" onClick={() => { setCardStatus(status); setPage(1); }} aria-pressed={cardStatus === status} className={`rounded-md px-3 py-2 text-xs font-semibold capitalize transition ${cardStatus === status ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{status === "all" ? "All" : status}</button>)}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>Showing {filteredCards.length ? ((page - 1) * pageSize + 1).toLocaleString() : 0}–{Math.min(page * pageSize, filteredCards.length).toLocaleString()} of {filteredCards.length.toLocaleString()} Job Cards</span>
                  <label className="flex items-center gap-2">Rows per page
                    <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700">
                      <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
                    </select>
                  </label>
                </div>
                <div className="mt-2 space-y-2">
                  {visibleCards.map(({ card, applicants, head, activeCount, deletedCount, inactive }) => {
                    const expanded = expandedCards.includes(card);
                    return <div key={card} className="overflow-hidden rounded-xl border border-slate-200">
                      <button type="button" onClick={() => setExpandedCards(current => expanded ? current.filter(item => item !== card) : [...current, card])} aria-expanded={expanded} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2"><strong className="break-all text-sm text-slate-950">{card}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${inactive ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{inactive ? "Inactive" : "Active"}</span></span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">{head}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{applicants.length} applicants · {activeCount} active{deletedCount ? ` · ${deletedCount} deleted` : ""}</span>
                        </span>
                        <span className="shrink-0 text-lg text-slate-400">{expanded ? "−" : "+"}</span>
                      </button>
                      {expanded && <div className="border-t border-slate-100 bg-white">
                        {[...applicants].sort((a,b) => Number(a.source_sequence) - Number(b.source_sequence)).map((applicant, index) => <div key={applicant.official_unique_id || index} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">{applicant.applicant_name}</p>
                            <p className="mt-0.5 break-all text-xs text-slate-500">Applicant No. {applicant.applicant_number} · {applicant.official_unique_id}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${applicant.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{applicant.status === "active" ? "Active" : "Deleted"}</span>
                        </div>)}
                      </div>}
                    </div>;
                  })}
                  {visibleCards.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center"><p className="text-sm font-medium text-slate-700">No matching Job Cards</p><p className="mt-1 text-xs text-slate-500">Try another search or status filter.</p></div>}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                  <p className="text-xs text-slate-500">Page {page} of {pageCount}</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                    <button type="button" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={page >= pageCount} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {activationResult ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="text-sm font-semibold text-emerald-950">Register activated successfully</h3>
            <p className="mt-1 text-sm text-emerald-900">{Number(activationResult.activated_rows || 0).toLocaleString()} applicants activated.</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["New Job Cards", activationResult.job_cards_inserted],
                ["Updated Job Cards", activationResult.job_cards_updated],
                ["New applicants", activationResult.applicants_inserted],
                ["Updated applicants", activationResult.applicants_updated],
              ].map((item) => { const [label, value] = item as [string, unknown]; return <div key={label} className="rounded-lg bg-white/70 p-3"><p className="text-xs text-emerald-800">{label}</p><p className="mt-1 text-lg font-semibold text-emerald-950">{Number(value || 0).toLocaleString()}</p></div>; })}
            </div>
            <p className="mt-3 text-xs leading-5 text-emerald-900">Missing existing applicants: {Number(activationResult.missing_applicants_for_manual_review || 0).toLocaleString()} · Missing Job Cards: {Number(activationResult.missing_job_cards_for_manual_review || 0).toLocaleString()}. These records were not deactivated.</p>
          </div> : <>
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-5 text-amber-900">{preview.activation} No canonical Job Card or applicant records have been changed. Import activation remains a separate, explicit step.</p>
            <button type="button" onClick={() => void activateRegister()} disabled={activating || fetching || !preview.validation?.passed || stagedApplicants.length !== preview.stagedRows} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
              {activating ? "Activating register…" : "Activate reviewed register"}
            </button>
            <p className="mt-2 text-xs text-slate-500">Activation is atomic. If any record fails validation or conflicts with an existing identity, the entire transaction is rolled back.</p>
          </>}
          <p className="mt-3 text-xs text-slate-500">{activationResult ? "The Government register is now available in the operational Job Card tables." : "Review the complete Job Card register above before activation."}</p>
        </section>}
        {activationResult && !preview && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm sm:p-7">
          <h2 className="text-base font-semibold text-emerald-950">Register activated successfully</h2>
          <p className="mt-1 text-sm text-emerald-900">{Number(activationResult.activated_rows || 0).toLocaleString()} applicants activated.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["New Job Cards", activationResult.job_cards_inserted],
              ["Updated Job Cards", activationResult.job_cards_updated],
              ["New applicants", activationResult.applicants_inserted],
              ["Updated applicants", activationResult.applicants_updated],
            ].map((item) => { const [label, value] = item as [string, unknown]; return <div key={label} className="rounded-lg bg-white/70 p-3"><p className="text-xs text-emerald-800">{label}</p><p className="mt-1 text-lg font-semibold text-emerald-950">{Number(value || 0).toLocaleString()}</p></div>; })}
          </div>
          <p className="mt-3 text-xs leading-5 text-emerald-900">This initial register is already established. Future register updates must be imported from the operational Job Cards module.</p>
        </section>}
      </>}

      <OnboardingActions
        back={{ label: "Back to Step 1", href: "/onboarding" }}
        next={{ label: "Continue to Step 3", href: "/onboarding/ftos", disabled: !activationResult }}
        note={activationResult ? "Register activated. Continue to FTO discovery." : "Activate the reviewed register to continue."}
      />
    </div>
  </OnboardingShell>;
}
