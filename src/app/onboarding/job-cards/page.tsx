"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type RegisterPreview = {
  batchId: string;
  status: string;
  sourceTable: number;
  sourceRows: number;
  stagedRows: number;
  activeApplicants: number;
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
      setPreview(data.reportInspection.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare the official register preview.");
    } finally {
      setFetching(false);
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Loading onboarding…</p></main>;

  const steps = ["Location", "Job Cards", "FTOs", "Review"];
  return <main className="min-h-screen bg-slate-50 px-4 py-10">
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-700 text-sm font-bold text-white">VC</div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-blue-700">First-time setup · 4 steps</p>
        <ol className="mt-4 grid grid-cols-4 gap-2 text-center">
          {steps.map((step, index) => <li key={step} className="min-w-0">
            <div className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${index < 2 ? "bg-emerald-600 text-white" : index === 2 ? "bg-slate-200 text-slate-500" : "bg-slate-200 text-slate-500"}`}>{index < 2 ? "✓" : index + 1}</div>
            <p className={`mt-1 truncate text-[11px] font-medium ${index === 1 ? "text-blue-700" : index === 0 ? "text-emerald-700" : "text-slate-400"}`}>{step}</p>
          </li>)}
        </ol>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Import Job Cards & applicants</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Step 2 · Fetch the official Registration Application Register for {councilName || "your Village Council"}.</p>
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
            <p className="mt-1 text-sm leading-6 text-slate-600">We will read the Government register, calculate Applicant Numbers and Unique IDs in source order, and prepare a review-only import batch. Deleted source rows are retained in the review batch so numbering remains consistent, but they will not become active applicants.</p>
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
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Source rows", preview.sourceRows],
              ["Staged rows", preview.stagedRows],
              ["Active applicants", preview.activeApplicants],
              ["Deleted source rows", preview.sourceDeletedApplicants],
              ["New Job Cards", preview.newJobCards],
              ["New applicants", preview.newApplicants],
              ["Changed applicants", preview.changedApplicants],
              ["Unchanged applicants", preview.unchangedApplicants],
              ["Missing existing applicants", preview.missingApplicants],
              ["Missing existing Job Cards", preview.missingJobCards],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{Number(value).toLocaleString()}</p></div>)}
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-slate-900">Sample applicant records</h3>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Job Card</th><th className="px-3 py-2">Applicant No.</th><th className="px-3 py-2">Applicant</th><th className="px-3 py-2">Head of Household</th></tr></thead>
                <tbody>{preview.sample.map((item, index) => <tr key={index} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold text-slate-900">{item.jobCardNumber}</td><td className="px-3 py-2">{item.applicantNumber}</td><td className="px-3 py-2">{item.applicantName}</td><td className="px-3 py-2">{item.headOfHousehold}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-5 text-amber-900">{preview.activation} No canonical Job Card or applicant records have been changed. Import activation will be a separate step after review.</p>
          <p className="mt-3 text-xs text-slate-500">Next: verify the preview counts and sample records before we implement the activation confirmation.</p>
        </section>}
      </>}

      <footer className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={() => router.push("/onboarding")} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Step 1</button>
        <p className="text-xs text-slate-400">Your workspace remains locked until onboarding is completed.</p>
      </footer>
    </div>
  </main>;
}
