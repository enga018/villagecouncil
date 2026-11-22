"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import OnboardingShell from "@/components/app/OnboardingShell";
import OnboardingActions from "@/components/app/OnboardingActions";

type RegisterSummary = {
  id: string;
  total_rows: number;
  inserted_job_cards: number;
  updated_job_cards: number;
  inserted_applicants: number;
  updated_applicants: number;
  missing_records: number;
  completed_at: string | null;
};

function isAuthenticationFailure(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return /auth session missing|invalid or expired session|jwt expired|unauthorized|\b401\b/.test(message);
}

export default function ReviewOnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [councilName, setCouncilName] = useState("");
  const [councilId, setCouncilId] = useState("");
  const [location, setLocation] = useState<string[]>([]);
  const [register, setRegister] = useState<RegisterSummary | null>(null);
  const [pageError, setPageError] = useState("");
  const [error, setError] = useState("");

  const returnToLogin = useCallback(() => {
    router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [router]);

  useEffect(() => {
    let active = true;
    async function loadReview() {
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
          .select("id,name,state,district,block,village,onboarding_completed_at")
          .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
        if (councilError) throw councilError;
        if (!council) throw new Error("The assigned Village Council is unavailable.");
        if (council.onboarding_completed_at) { router.replace("/dashboard"); return; }
        if (!council.state || !council.district || !council.block || !council.village) {
          router.replace("/onboarding");
          return;
        }

        const { data: batch, error: batchError } = await supabase
          .from("council_register_import_batches")
          .select("id,total_rows,inserted_job_cards,updated_job_cards,inserted_applicants,updated_applicants,missing_records,completed_at,source_location_key")
          .eq("village_council_id", council.id)
          .eq("source", "official_registration_register")
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (batchError) throw batchError;

        const importedVillage = String(batch?.source_location_key || "").split(" | ").at(-1) || "";
        if (!batch || importedVillage !== council.village) {
          router.replace("/onboarding/job-cards");
          return;
        }

        if (active) {
          setCouncilId(council.id);
          setCouncilName(council.name);
          setLocation([council.state, council.district, council.block, council.village]);
          setRegister(batch);
        }
      } catch (err) {
        if (active && isAuthenticationFailure(err)) { returnToLogin(); return; }
        if (active) setPageError(err instanceof Error ? err.message : "Unable to load the review.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadReview();
    return () => { active = false; };
  }, [router, returnToLogin]);

  async function completeOnboarding() {
    setCompleting(true);
    setError("");
    try {
      const { error: completeError } = await createClient().rpc("complete_council_onboarding", { p_council_id: councilId });
      if (completeError) throw completeError;
      router.replace("/dashboard");
    } catch (err) {
      if (isAuthenticationFailure(err)) { returnToLogin(); return; }
      setError(err instanceof Error ? err.message : "Unable to complete onboarding.");
    } finally {
      setCompleting(false);
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Loading review…</p></main>;

  return (
    <OnboardingShell activeStep={3}>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-sm font-medium text-blue-700">Review &amp; activation · Step 4</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Review your council setup</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Confirm the details below to finish onboarding for {councilName || "your Village Council"}.</p>
        </header>

        {pageError ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{pageError}</div> : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <h3 className="text-sm font-semibold text-slate-950">Government location</h3>
              <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 sm:grid-cols-2">
                {location.map((item, index) => <p key={index}><span className="text-xs text-slate-400">{["State", "District", "Block", "Panchayat"][index]}</span><br/><strong>{item}</strong></p>)}
              </div>
            </section>

            {register && (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm sm:p-7">
                <h3 className="text-sm font-semibold text-emerald-950">Job Card register activated</h3>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Total rows", register.total_rows],
                    ["New Job Cards", register.inserted_job_cards],
                    ["New applicants", register.inserted_applicants],
                    ["Missing records", register.missing_records],
                  ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-white/70 p-3"><p className="text-xs text-emerald-800">{label}</p><p className="mt-1 text-lg font-semibold text-emerald-950">{Number(value || 0).toLocaleString()}</p></div>)}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <h3 className="text-sm font-semibold text-slate-950">FTO discovery</h3>
              <p className="mt-2 text-sm text-slate-600">FTO import is not connected yet. It can be added later from the operational module.</p>
            </section>

            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
          </>
        )}

        <OnboardingActions
          back={{ label: "Back to Step 3", href: "/onboarding/ftos" }}
          next={{ label: completing ? "Completing onboarding…" : "Complete onboarding", onClick: () => void completeOnboarding(), disabled: completing || !!pageError }}
          note="Completing onboarding opens your workspace."
        />
      </div>
    </OnboardingShell>
  );
}
