"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";

type Preview = {
  batchId: string;
  stagedRows: number;
  validation?: {
    passed: boolean;
    stagedRowsMatch: boolean;
    checkedRows: number;
    activeJobCards: number;
    inactiveJobCards: number;
  };
  activeApplicants: number;
  deletedApplicants: number;
};

export default function JobCardRegisterImport() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ active: number; inactive: number; applicants: number } | null>(null);

  async function importRegister() {
    if (loading) return;
    setLoading(true);
    setError("");
    setMessage("");
    setResult(null);

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
        reportInspection?: { preview?: Preview; error?: string };
        error?: string;
      }>("council-register-source", { body: { action: "prepare-preview" } });

      if (invokeError) {
        let detailMessage = invokeError.message || "Could not fetch the official Job Card register.";
        const context = invokeError.context as Response | undefined;
        if (context && typeof context.json === "function") {
          try {
            const detail = await context.json() as { error?: string };
            if (detail.error) detailMessage = detail.error;
          } catch {}
        }
        throw new Error(detailMessage);
      }

      const preview = data?.reportInspection?.preview;
      if (!data?.success || !preview?.batchId) {
        throw new Error(data?.reportInspection?.error || data?.error || "The official register could not be prepared.");
      }
      if (!preview.validation?.passed || !preview.validation.stagedRowsMatch) {
        throw new Error("The official register did not pass validation. Existing records were not changed.");
      }

      const validation = preview.validation;
      const summaryValues = [validation.activeJobCards, validation.inactiveJobCards, validation.checkedRows, preview.activeApplicants];
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
      if (!activation?.success) throw new Error("The Job Card import did not complete successfully.");

      setResult({
        active: validation.activeJobCards,
        inactive: validation.inactiveJobCards,
        applicants: preview.activeApplicants,
      });
      setMessage("The official Job Card register was successfully imported and activated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import the official Job Card register.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-blue-700">Government data import</p>
          <h2 className="mt-2 text-lg font-bold text-slate-950">Job Card Register</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Fetch the official register, validate the staged records and activate the verified import for this Village Council.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void importRegister()}
          disabled={loading}
          aria-busy={loading}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Fetching and validating…" : "Fetch Job Card Register"}
        </button>
      </div>

      {loading && <p role="status" className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">The official register is being fetched and checked. Existing records will only be activated after validation succeeds.</p>}
      {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><p className="font-semibold">Import not completed</p><p className="mt-1">{error}</p></div>}
      {message && <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><p className="font-semibold">{message}</p></div>}
      {result && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Active Job Cards</p><p className="mt-1 text-xl font-bold text-slate-950">{result.active.toLocaleString("en-IN")}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Inactive Job Cards</p><p className="mt-1 text-xl font-bold text-slate-950">{result.inactive.toLocaleString("en-IN")}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Active Applicants</p><p className="mt-1 text-xl font-bold text-slate-950">{result.applicants.toLocaleString("en-IN")}</p></div>
        </div>
      )}
    </section>
  );
}
