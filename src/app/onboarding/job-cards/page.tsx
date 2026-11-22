"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import OnboardingShell from "@/components/app/OnboardingShell";

type RegisterPreview = {
  batchId: string;
  stagedRows: number;
  validation?: { passed: boolean; stagedRowsMatch: boolean; checkedRows: number };
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
  const started = useRef(false);
  const [councilId, setCouncilId] = useState("");
  const [councilName, setCouncilName] = useState("");
  const [location, setLocation] = useState<string[]>([]);
  const [phase, setPhase] = useState("Checking your Village Council setup…");
  const [error, setError] = useState("");
  const [readyToRetry, setReadyToRetry] = useState(false);

  const returnToLogin = useCallback(() => {
    router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [router]);

  const importRegister = useCallback(async (targetCouncilId: string, targetCouncilName: string) => {
    setReadyToRetry(false);
    setError("");
    try {
      setPhase("Fetching the official Job Card register…");
      const supabase = createClient();
      const { data, error: invokeError } = await supabase.functions.invoke<RegisterSourceResult>(
        "council-register-source",
        { body: { action: "prepare-preview" } },
      );
      if (invokeError) {
        let message = invokeError.message || "Could not fetch the official Job Card register.";
        const context = invokeError.context as Response | undefined;
        if (isAuthenticationFailure(invokeError, context)) {
          returnToLogin();
          return;
        }
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
      if (!preview.validation?.passed) {
        throw new Error("The official register was fetched, but its validation did not pass. The workspace has not been activated. Please retry later or contact support.");
      }

      setPhase("Verifying the staged records…");
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
        throw new Error(`Register verification was incomplete: expected ${preview.stagedRows.toLocaleString()} rows but found ${stagedCount.toLocaleString()}. No records were activated.`);
      }

      setPhase("Importing Job Cards and applicants…");
      const { data: activation, error: activationError } = await supabase
        .rpc("activate_council_register_import", { p_batch_id: preview.batchId });
      if (activationError) throw activationError;
      if (!activation?.success) throw new Error("The Job Card import did not complete successfully.");

      setPhase("Finishing your Village Council setup…");
      const { error: completeError } = await supabase
        .rpc("complete_council_onboarding", { p_council_id: targetCouncilId });
      if (completeError) throw completeError;

      setPhase("Your workspace is ready. Opening Dashboard…");
      router.replace("/dashboard");
    } catch (err) {
      if (isAuthenticationFailure(err)) {
        returnToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : "Unable to finish automatic Job Card setup.");
      setPhase("Setup needs attention");
      setReadyToRetry(true);
    }
  }, [returnToLogin, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;

    async function startSetup() {
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) {
          returnToLogin();
          return;
        }

        const { data: membership, error: membershipError } = await supabase
          .from("council_memberships")
          .select("village_council_id")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) throw new Error("This account has no active Village Council assignment.");

        const { data: council, error: councilError } = await supabase
          .from("council_tenants")
          .select("id,name,state,district,block,village,onboarding_completed_at")
          .eq("id", membership.village_council_id)
          .eq("is_active", true)
          .maybeSingle();
        if (councilError) throw councilError;
        if (!council) throw new Error("The assigned Village Council is unavailable.");
        if (council.onboarding_completed_at) {
          router.replace("/dashboard");
          return;
        }
        if (!council.state || !council.district || !council.block || !council.village) {
          router.replace("/onboarding");
          return;
        }

        const { data: completedBatch, error: batchError } = await supabase
          .from("council_register_import_batches")
          .select("id,source_location_key")
          .eq("village_council_id", council.id)
          .eq("source", "official_registration_register")
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (batchError) throw batchError;

        const importedVillage = String(completedBatch?.source_location_key || "").split(" | ").at(-1)?.trim().toLowerCase();
        if (completedBatch && importedVillage === council.village.trim().toLowerCase()) {
          setPhase("Finalising your existing Job Card setup…");
          const { error: completeError } = await supabase.rpc("complete_council_onboarding", { p_council_id: council.id });
          if (completeError) throw completeError;
          router.replace("/dashboard");
          return;
        }

        if (!active) return;
        setCouncilId(council.id);
        setCouncilName(council.name);
        setLocation([council.state, council.district, council.block, council.village]);
        await importRegister(council.id, council.name);
      } catch (err) {
        if (!active) return;
        if (isAuthenticationFailure(err)) {
          returnToLogin();
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to load your Village Council setup.");
        setPhase("Setup needs attention");
        setReadyToRetry(true);
      }
    }

    void startSetup();
    return () => { active = false; };
  }, [importRegister, returnToLogin, router]);

  return (
    <OnboardingShell activeStep={0}>
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <p className="text-sm font-medium text-blue-700">Automatic setup</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Preparing your workspace</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Your Government location is saved. We are now fetching and importing the official Job Card register. You do not need to review or import it manually.</p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          {location.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-500">{councilName}</p>
              <h3 className="mt-1 text-lg font-bold text-slate-950">{location[3]}</h3>
              <p className="mt-1 text-sm text-slate-600">{location[1]} District · {location[2]} Block</p>
              <p className="mt-1 text-xs text-slate-500">{location[0]}</p>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3" aria-live="polite">
            {!error && <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />}
            <p className="text-sm font-semibold text-slate-800">{phase}</p>
          </div>

          {error && (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm leading-6 text-red-800">{error}</p>
              {readyToRetry && councilId && (
                <button type="button" onClick={() => void importRegister(councilId, councilName)} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
                  Retry automatic setup
                </button>
              )}
            </div>
          )}

          <p className="mt-5 text-xs leading-5 text-slate-500">FTO discovery is optional and is not part of onboarding. You can use FTO Monitoring later from your Dashboard.</p>
        </section>
      </div>
    </OnboardingShell>
  );
}
