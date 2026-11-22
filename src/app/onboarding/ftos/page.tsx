"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import OnboardingShell from "@/components/app/OnboardingShell";
import OnboardingActions from "@/components/app/OnboardingActions";

type FtoRecord = {
  fto_number: string;
  fto_date: string;
  fto_status: string;
  block: string;
  first_signatory: string;
  second_signatory: string;
  beneficiary_count: number;
  wage_amount: number;
  source_record_key: string;
  status: string;
  source_sequence: number;
};

type FtoPreview = {
  batchId: string;
  status: string;
  sourceRows: number;
  stagedRows: number;
  activeFtos: number;
  existingFtos: number;
  newFtos: number;
  changedFtos: number;
  missingFtos: number;
  sample: { fto_number: string; fto_date: string; fto_status: string }[];
  activation: string;
  validation?: { passed: boolean; stagedRowsMatch: boolean; uniqueSourceKeys: boolean; checkedRows: number };
};

type FtoSourceResult = {
  success?: boolean;
  reportInspection?: { preview?: FtoPreview; error?: string };
  error?: string;
};

function isAuthenticationFailure(error: unknown, response?: Response) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return response?.status === 401 || /auth session missing|authentication required|invalid or expired session|jwt expired|unauthorized|\b401\b/.test(message);
}

export default function FtoOnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [councilName, setCouncilName] = useState("");
  const [location, setLocation] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<FtoPreview | null>(null);
  const [stagedFtos, setStagedFtos] = useState<FtoRecord[]>([]);
  const [loadingFtos, setLoadingFtos] = useState(false);
  const [page, setPage] = useState(1);
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
  }, [router, returnToLogin]);

  async function preparePreview() {
    setFetching(true);
    setError("");
    setPreview(null);
    setStagedFtos([]);
    try {
      const { data, error: invokeError } = await createClient().functions.invoke<FtoSourceResult>(
        "council-fto-source",
        { body: { action: "prepare-preview" } },
      );
      if (invokeError) {
        let message = invokeError.message || "Could not fetch the official FTO register.";
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
        throw new Error(data?.reportInspection?.error || data?.error || "The official FTO register preview was not prepared.");
      }
      const prepared = data.reportInspection.preview;
      setPreview(prepared);
      setLoadingFtos(true);
      const supabase = createClient();
      const allRows: FtoRecord[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: rows, error: rowsError } = await supabase
          .from("council_fto_import_rows").select("row_data")
          .eq("import_batch_id", prepared.batchId)
          .order("row_number", { ascending: true }).range(offset, offset + 999);
        if (rowsError) throw rowsError;
        allRows.push(...(rows || []).map((item: { row_data: FtoRecord }) => item.row_data));
        if (!rows || rows.length < 1000) break;
      }
      setStagedFtos(allRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare the official FTO register preview.");
    } finally {
      setLoadingFtos(false);
      setFetching(false);
    }
  }

  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(stagedFtos.length / pageSize));
  const visibleFtos = stagedFtos.slice((page - 1) * pageSize, page * pageSize);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Loading onboarding…</p></main>;

  return (
    <OnboardingShell activeStep={2}>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-sm font-medium text-blue-700">FTO discovery · Step 3</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Discover your council&apos;s FTO records</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Discover and import Fund Transfer Orders for {councilName || "your Village Council"}.</p>
        </header>

        {pageError ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{pageError}</div> : (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-base font-semibold text-slate-950">Confirmed Government location</h2>
            <p className="mt-1 text-sm text-slate-500">The FTO register will be fetched using the location saved in Step 1.</p>
            <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 sm:grid-cols-2">
              {location.map((item, index) => <p key={index}><span className="text-xs text-slate-400">{["State", "District", "Block", "Panchayat"][index]}</span><br/><strong>{item}</strong></p>)}
            </div>
            <div className="mt-6 border-t border-slate-100 pt-5">
              <h2 className="text-base font-semibold text-slate-950">Official FTO register</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">Discover Fund Transfer Orders by navigating State → District → FTO Status → Block → First Signatory, then review the individual FTO records before activation.</p>
              <button type="button" onClick={() => void preparePreview()} disabled={fetching} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
                {fetching ? "Fetching and preparing preview…" : preview ? "Fetch FTO register again" : "Fetch official FTO register"}
              </button>
              {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
            </div>
          </section>
        )}

        {preview && (
          <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Preview ready · awaiting review</p><h2 className="mt-1 text-lg font-semibold text-slate-950">Official FTO register parsed successfully</h2></div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Not activated</span>
            </div>
            <p className="mt-2 break-all text-xs text-slate-500">Batch ID: {preview.batchId}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Total FTOs", preview.stagedRows],
                ["New FTOs", preview.newFtos],
                ["Changed FTOs", preview.changedFtos],
                ["Missing FTOs", preview.missingFtos],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{Number(value ?? 0).toLocaleString()}</p></div>)}
            </div>

            <div className="mt-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Complete FTO register</h3>
                  <p className="mt-1 text-xs text-slate-500">Individual Fund Transfer Orders discovered from the official portal.</p>
                </div>
                <span className="text-xs font-semibold text-slate-600">{stagedFtos.length.toLocaleString()} FTO records</span>
              </div>
              {loadingFtos ? <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Loading the complete FTO register…</p> : (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold">FTO Number</th>
                        <th className="px-3 py-2.5 font-semibold">Date</th>
                        <th className="px-3 py-2.5 font-semibold">Status</th>
                        <th className="px-3 py-2.5 font-semibold">First Signatory</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleFtos.map((fto) => (
                        <tr key={fto.source_record_key || fto.fto_number} className="border-t border-slate-100">
                          <td className="px-3 py-2.5 font-medium text-slate-900">{fto.fto_number}</td>
                          <td className="px-3 py-2.5 text-slate-600">{fto.fto_date}</td>
                          <td className="px-3 py-2.5 text-slate-600">{fto.fto_status}</td>
                          <td className="px-3 py-2.5 text-slate-600">{fto.first_signatory}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{Number(fto.wage_amount || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                      {visibleFtos.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">No FTO records loaded.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                <p className="text-xs text-slate-500">Page {page} of {pageCount}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                  <button type="button" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={page >= pageCount} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
                </div>
              </div>
            </div>

            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-5 text-amber-900">{preview.activation} No canonical FTO records have been changed. Import activation remains a separate, explicit step.</p>
          </section>
        )}

        <OnboardingActions
          back={{ label: "Back to Step 2", href: "/onboarding/job-cards" }}
          next={{ label: "Continue", disabled: true }}
          note="FTO discovery and import is the next implementation task."
        />
      </div>
    </OnboardingShell>
  );
}
