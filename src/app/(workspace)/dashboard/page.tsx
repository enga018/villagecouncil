"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

const availableModules = [
  {
    title: "Job Cards",
    description: "Manage household job cards, applicant records and their current status.",
    href: "/job-cards",
    mark: "JC",
    eyebrow: "Household records",
    action: "Open Job Cards",
  },
  {
    title: "FTO Monitoring",
    description: "Review First Signatory FTOs and import transactions belonging to this Village Council.",
    href: "/fto-monitoring",
    mark: "FTO",
    eyebrow: "Payment monitoring",
    action: "Open FTO Monitoring",
  },
];

const plannedModules = [
  { title: "Register", description: "Official registration register tools", mark: "RG" },
  { title: "Contributions", description: "Contribution ledger and outstanding balances", mark: "CN" },
  { title: "CO Calculation", description: "Council calculation tools", mark: "CO" },
  { title: "Payments", description: "Payment recording and tracking", mark: "PY" },
  { title: "Reports", description: "Council operational reports", mark: "RP" },
  { title: "Settings", description: "Workspace preferences and configuration", mark: "ST" },
];

export default function DashboardPage() {
  const [activeJobCards, setActiveJobCards] = useState<number | null>(null);
  const [activeApplicants, setActiveApplicants] = useState<number | null>(null);
  const [ftoImported, setFtoImported] = useState<number | null>(null);
  const [ftoTransactions, setFtoTransactions] = useState<number | null>(null);
  const [ftoTotal, setFtoTotal] = useState<number | null>(null);
  const [ftoProcessed, setFtoProcessed] = useState<number | null>(null);
  const [ftoDeferred, setFtoDeferred] = useState<number | null>(null);
  const [ftoRejected, setFtoRejected] = useState<number | null>(null);
  const [ftoDataMissing, setFtoDataMissing] = useState(false);
  const [kpiError, setKpiError] = useState("");

  async function loadFtoSummary(councilId: string) {
    try {
      const supabase = createClient();
      const [ftosResult, transactionsResult, statusRowsResult] = await Promise.all([
        supabase.from("council_ftos").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("status", "active"),
        supabase.from("council_fto_transactions").select("normalized_status").eq("village_council_id", councilId),
        supabase.from("council_ftos").select("id", { count: "exact", head: true }).eq("village_council_id", councilId),
      ]);
      if (ftosResult.error || transactionsResult.error || statusRowsResult.error) {
        setFtoDataMissing(true);
        return;
      }
      const rows = Array.isArray(transactionsResult.data) ? transactionsResult.data as Array<{ normalized_status: string }> : [];
      setFtoImported(ftosResult.count ?? 0);
      setFtoTransactions(transactionsResult.count ?? 0);
      setFtoTotal(statusRowsResult.count ?? 0);
      setFtoProcessed(rows.filter(row => row.normalized_status === "processed").length);
      setFtoDeferred(rows.filter(row => row.normalized_status === "deferred").length);
      setFtoRejected(rows.filter(row => row.normalized_status === "rejected").length);
    } catch {
      setFtoDataMissing(true);
    }
  }

  useEffect(() => {
    let current = true;

    async function loadJobCardSummary() {
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
        if (!membership) throw new Error("No active Village Council assignment was found.");

        const councilId = membership.village_council_id;
        void loadFtoSummary(councilId);
        const [cardsResult, applicantsResult] = await Promise.all([
          supabase
            .from("council_job_cards")
            .select("id", { count: "exact", head: true })
            .eq("village_council_id", councilId)
            .eq("status", "active"),
          supabase
            .from("council_applicants")
            .select("id", { count: "exact", head: true })
            .eq("village_council_id", councilId)
            .eq("status", "active"),
        ]);

        if (cardsResult.error) throw cardsResult.error;
        if (applicantsResult.error) throw applicantsResult.error;
        if (current) {
          setActiveJobCards(cardsResult.count ?? 0);
          setActiveApplicants(applicantsResult.count ?? 0);
          setKpiError("");
        }
      } catch (error) {
        if (current) {
          setKpiError(error instanceof Error ? error.message : "Unable to load Job Cards summary.");
        }
      }
    }

    void loadJobCardSummary();
    return () => { current = false; };
  }, []);

  return (
    <div className="space-y-9">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Council workspace</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Your operational overview. Select a workspace module to continue.</p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-full border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800 sm:self-auto">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/> Council workspace
        </div>
      </section>

      <section aria-label="Job Card summary" className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium text-slate-500">Active Job Cards</p><p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-slate-950">{activeJobCards === null ? "—" : activeJobCards.toLocaleString("en-IN")}</p></div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[11px] font-bold text-blue-800">JC</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Current active household records</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium text-slate-500">Active Applicants</p><p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-slate-950">{activeApplicants === null ? "—" : activeApplicants.toLocaleString("en-IN")}</p></div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-[11px] font-bold text-violet-800">AP</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Applicants across active Job Cards</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium text-slate-500">FTO Register</p><p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-slate-950">{ftoImported === null ? "—" : ftoImported.toLocaleString("en-IN")}</p></div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[11px] font-bold text-blue-800">FTO</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Imported FTOs for this Council</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium text-slate-500">Transactions</p><p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-slate-950">{ftoTransactions === null ? "—" : ftoTransactions.toLocaleString("en-IN")}</p></div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[11px] font-bold text-blue-800">TX</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Imported transaction rows</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium text-slate-500">Processed</p><p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-emerald-950">{ftoProcessed === null ? "—" : ftoProcessed.toLocaleString("en-IN")}</p></div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[11px] font-bold text-emerald-800">PT</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Transactions with Government status Processed</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium text-slate-500">Deferred</p><p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-amber-900">{ftoDeferred === null ? "—" : ftoDeferred.toLocaleString("en-IN")}</p></div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-[11px] font-bold text-amber-900">DR</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Transactions with a deferred status</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium text-slate-500">Rejected</p><p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-rose-950">{ftoRejected === null ? "—" : ftoRejected.toLocaleString("en-IN")}</p></div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-[11px] font-bold text-rose-900">RJ</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Transactions with Government status Rejected</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium text-slate-500">All FTOs</p><p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-slate-950">{ftoTotal === null ? "—" : ftoTotal.toLocaleString("en-IN")}</p></div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-[11px] font-bold text-slate-500">AL</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Total FTOs in the register</p>
        </div>
      </section>

      {ftoDataMissing && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">FTO summary data is not available yet.</p>}

      {kpiError && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{kpiError}</p>}

      <section>
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div><h2 className="text-lg font-bold tracking-tight text-slate-950">Available modules</h2><p className="mt-1 text-xs text-slate-500">Tools currently available in this workspace</p></div>
          <span className="text-[11px] font-medium text-slate-400">2 of 8 modules available</span>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {availableModules.map(module => (
            <Link key={module.title} href={module.href} className="group flex min-h-[220px] flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-xs font-bold tracking-wide text-blue-800">{module.mark}</div>
                <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">Available</span>
              </div>
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">{module.eyebrow}</p>
              <h3 className="mt-1 text-base font-bold tracking-tight text-slate-950">{module.title}</h3>
              <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">{module.description}</p>
              <span className="mt-auto inline-flex items-center gap-2 pt-5 text-xs font-bold text-blue-800">{module.action}<span className="transition-transform group-hover:translate-x-1">→</span></span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4"><h2 className="text-base font-bold tracking-tight text-slate-950">Coming soon</h2><p className="mt-1 text-xs text-slate-500">Additional council modules planned for later releases</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {plannedModules.map(module => (
            <div key={module.title} aria-disabled="true" className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/70 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500">{module.mark}</span>
              <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-700">{module.title}</span><span className="mt-0.5 block truncate text-[10px] text-slate-400">{module.description}</span></span>
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Soon</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
