"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import OnboardingShell from "@/components/app/OnboardingShell";

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
  const [expandedCards, setExpandedCards] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");

  function returnToLogin() {
    router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }

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
        if (active) {
          setCouncilName(council.name);
          setLocation([council.state, council.district, council.block, council.village]);
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
  }, [router]);

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
        allRows.push(...(rows || []).map((item: any) => item.row_data as StagedApplicant));
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
            <button type="button" onClick={() => void preparePreview()} disabled={fetching} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
              {fetching ? "Fetching and preparing preview…" : preview ? "Fetch register again" : "Fetch official register"}
            </button>
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
              ["Job Cards", new Set(stagedApplicants.map(item => item.job_card_number)).size],
              ["Active applicants", preview.activeApplicants],
              ["Deleted applicants", preview.deletedApplicants ?? preview.sourceDeletedApplicants],
              ["Inactive Job Cards", preview.inactiveJobCards ?? 0],
              ["Total applicants", preview.stagedRows],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{Number(value).toLocaleString()}</p></div>)}
          </div>
          <div className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Complete Job Card register</h3>
                <p className="mt-1 text-xs text-slate-500">Complete source register, including Job Cards whose applicants are all deleted.</p>
              </div>
              <span className="text-xs font-semibold text-slate-600">{new Set(stagedApplicants.map(item => item.job_card_number)).size.toLocaleString()} Job Cards · {stagedApplicants.length.toLocaleString()} applicants</span>
            </div>
            {loadingRegister ? <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Loading the complete staged register…</p> : (
              <div className="mt-3 space-y-2">
                {Array.from(stagedApplicants.reduce((groups, applicant) => {
                  const key = applicant.job_card_number;
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(applicant);
                  return groups;
                }, new Map<string, StagedApplicant[]>()).entries()).map(([card, applicants]) => {
                  const expanded = expandedCards.includes(card);
                  const head = applicants.find(item => item.head_of_household)?.head_of_household || "Household head unavailable";
                  const activeCount = applicants.filter(item => item.status === "active").length;
                  const deletedCount = applicants.length - activeCount;
                  const cardInactive = activeCount === 0;
                  return <div key={card} className="overflow-hidden rounded-xl border border-slate-200">
                    <button type="button" onClick={() => setExpandedCards(current => expanded ? current.filter(item => item !== card) : [...current, card])} aria-expanded={expanded} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-slate-50">
                      <span className="min-w-0">
                        <strong className="block break-all text-sm text-slate-950">{card}</strong>
                        <span className="mt-1 block truncate text-xs text-slate-500">{head}</span>
                        <span className="mt-1 block text-xs text-slate-500">{applicants.length} applicants · {activeCount} active{deletedCount ? ` · ${deletedCount} deleted` : ""} · {cardInactive ? "Inactive Job Card" : "Active Job Card"}</span>
                      </span>
                      <span className="shrink-0 text-lg text-slate-400">{expanded ? "−" : "+"}</span>
                    </button>
                    {expanded && <div className="border-t border-slate-100">
                      {applicants.sort((a,b) => Number(a.source_sequence) - Number(b.source_sequence)).map((applicant, index) => <div key={applicant.official_unique_id || index} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{applicant.applicant_name}</p>
                          <p className="mt-0.5 break-all text-xs text-slate-500">Applicant No. {applicant.applicant_number} · {applicant.official_unique_id}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${applicant.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{applicant.status === "active" ? "Active" : "Deleted"}</span>
                      </div>)}
                    </div>}
                  </div>;
                })}
              </div>
            )}
          </div>
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-5 text-amber-900">{preview.activation} No canonical Job Card or applicant records have been changed. Import activation will be a separate step after review.</p>
          <p className="mt-3 text-xs text-slate-500">Review the complete Job Card register above. No records are activated at this stage.</p>
        </section>}
      </>}

      <footer className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={() => router.push("/onboarding")} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Step 1</button>
        <p className="text-xs text-slate-400">Your workspace remains locked until onboarding is completed.</p>
      </footer>
    </div>
  </OnboardingShell>;
}
