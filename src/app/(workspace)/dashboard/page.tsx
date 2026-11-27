"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { MiniKpi, ModuleCard } from "@/components/app/ModuleCard";

const plannedModules = [
  { title: "Register", description: "Official registration register tools", mark: "RG" },
  { title: "Payments", description: "Payment recording and tracking", mark: "PY" },
  { title: "Reports", description: "Council operational reports", mark: "RP" },
];

function displayNumber(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-IN");
}
function displayMoney(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}
async function collectRows<T>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await load(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    rows.push(...(page.data || []));
    if (!page.data || page.data.length < 1000) return rows;
  }
}

export default function DashboardPage() {
  const [activeJobCards, setActiveJobCards] = useState<number | null>(null);
  const [totalJobCards, setTotalJobCards] = useState<number | null>(null);
  const [activeApplicants, setActiveApplicants] = useState<number | null>(null);
  const [totalApplicants, setTotalApplicants] = useState<number | null>(null);
  const [ftoImported, setFtoImported] = useState<number | null>(null);
  const [ftoTransactions, setFtoTransactions] = useState<number | null>(null);
  const [ftoProcessed, setFtoProcessed] = useState<number | null>(null);
  const [ftoDeferred, setFtoDeferred] = useState<number | null>(null);
  const [ftoRejected, setFtoRejected] = useState<number | null>(null);
  const [contributionOutstanding, setContributionOutstanding] = useState<number | null>(null);
  const [ftoDataMissing, setFtoDataMissing] = useState(false);
  const [kpiError, setKpiError] = useState("");

  useEffect(() => {
    let current = true;

    async function loadDashboard() {
      const supabase = createClient();
      try {
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
        const [
          activeCards, allCards, activePeople, allPeople,
          importedFtos, transactions, processed, deferred, rejected,
        ] = await Promise.all([
          supabase.from("council_job_cards").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("status", "active"),
          supabase.from("council_job_cards").select("id", { count: "exact", head: true }).eq("village_council_id", councilId),
          supabase.from("council_applicants").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("status", "active"),
          supabase.from("council_applicants").select("id", { count: "exact", head: true }).eq("village_council_id", councilId),
          supabase.from("council_ftos").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("status", "active"),
          supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }).eq("village_council_id", councilId),
          supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("normalized_status", "processed"),
          supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("normalized_status", "deferred"),
          supabase.from("council_fto_transactions").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("normalized_status", "rejected"),
        ]);

        const [contributionCharges, contributionAllocations, contributionWaivers] = await Promise.all([
          collectRows<{ current_amount: number | string }>((from, to) => supabase.from("council_contribution_charges")
            .select("current_amount").eq("village_council_id", councilId).eq("is_active", true).range(from, to)),
          collectRows<{ allocated_amount: number | string }>((from, to) => supabase.from("council_payment_allocations")
            .select("allocated_amount").eq("village_council_id", councilId).range(from, to)),
          collectRows<{ amount: number | string }>((from, to) => supabase.from("council_contribution_waivers")
            .select("amount").eq("village_council_id", councilId).range(from, to)),
        ]);
        const contributionBalance = contributionCharges.reduce((total, row) => total + Number(row.current_amount), 0)
          - contributionAllocations.reduce((total, row) => total + Number(row.allocated_amount), 0)
          - contributionWaivers.reduce((total, row) => total + Number(row.amount), 0);

        const jobCardErrors = [activeCards.error, allCards.error, activePeople.error, allPeople.error].filter(Boolean);
        if (jobCardErrors.length) throw jobCardErrors[0];
        if (current) {
          setActiveJobCards(activeCards.count ?? 0);
          setTotalJobCards(allCards.count ?? 0);
          setActiveApplicants(activePeople.count ?? 0);
          setTotalApplicants(allPeople.count ?? 0);
          setContributionOutstanding(contributionBalance);
          setKpiError("");
        }

        const ftoResults = [importedFtos, transactions, processed, deferred, rejected];
        if (ftoResults.some(result => result.error)) {
          if (current) setFtoDataMissing(true);
        } else if (current) {
          setFtoImported(importedFtos.count ?? 0);
          setFtoTransactions(transactions.count ?? 0);
          setFtoProcessed(processed.count ?? 0);
          setFtoDeferred(deferred.count ?? 0);
          setFtoRejected(rejected.count ?? 0);
          setFtoDataMissing(false);
        }
      } catch (error) {
        if (current) setKpiError(error instanceof Error ? error.message : "Unable to load the dashboard summary.");
      }
    }

    void loadDashboard();
    return () => { current = false; };
  }, []);

  return (
    <div className="space-y-8">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Council workspace</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Your operational overview. Select a workspace module to continue.</p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700 sm:self-auto">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Council workspace
        </div>
      </section>

      {ftoDataMissing && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">FTO summary data is not available yet.</p>}
      {kpiError && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{kpiError}</p>}

      <section>
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-950">Available modules</h2>
            <p className="mt-1 text-xs text-slate-600">Tools currently available in this workspace</p>
          </div>
          <span className="text-[11px] font-medium text-slate-500">3 of 6 modules available</span>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ModuleCard
            title="Job Cards"
            description="Manage household job cards, applicant records and their current status."
            href="/job-cards"
            mark="JC"
            eyebrow="Household records"
            action="Open Job Cards"
            accent="blue"
          >
            <div className="grid grid-cols-2 gap-2">
              <MiniKpi label="Active Job Cards" value={activeJobCards} context={`of ${displayNumber(totalJobCards)} total Job Cards`} tone="blue" />
              <MiniKpi label="Active Applicants" value={activeApplicants} context={`of ${displayNumber(totalApplicants)} total applicants`} tone="blue" />
            </div>
          </ModuleCard>

          <ModuleCard
            title="FTO Monitoring"
            description="Review First Signatory FTOs and import transactions belonging to this Village Council."
            href="/fto-monitoring"
            mark="FTO"
            eyebrow="Payment monitoring"
            action="Open FTO Monitoring"
            accent="indigo"
          >
            <div className="grid grid-cols-2 gap-2">
              <MiniKpi label="Imported FTOs" value={ftoImported} context={`${displayNumber(ftoTransactions)} total transactions`} tone="indigo" />
              <MiniKpi label="Processed" value={ftoProcessed} context="Transactions processed" tone="success" />
              <MiniKpi label="Deferred" value={ftoDeferred} context="Awaiting final status" tone="warning" />
              <MiniKpi label="Rejected" value={ftoRejected} context="Rejected transactions" tone="danger" />
            </div>
          </ModuleCard>

          <ModuleCard
            title="Contributions"
            description="Review Job Card accounts and eligible Regular CO Charges."
            href="/contributions"
            mark="CN"
            eyebrow="Financial accounts"
            action="Open Contributions"
            accent="emerald"
          >
            <div className="grid grid-cols-1 gap-2">
              <MiniKpi label="Outstanding" value={displayMoney(contributionOutstanding)} context="Total unpaid contribution balance" tone="warning" />
            </div>
          </ModuleCard>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-base font-bold tracking-tight text-slate-950">Coming soon</h2>
          <p className="mt-1 text-xs text-slate-600">Additional council modules planned for later releases</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {plannedModules.map(module => (
            <div key={module.title} aria-disabled="true" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500">{module.mark}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-slate-700">{module.title}</span>
                <span className="mt-0.5 block truncate text-[10px] text-slate-500">{module.description}</span>
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Soon</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
