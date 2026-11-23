"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

const modules = [
  { title: "Job Cards", description: "Manage households, job cards and applicants.", href: "/job-cards", mark: "JC", available: true },
  { title: "Register", description: "Official registration register tools are not available yet.", mark: "RG", available: false },
  { title: "FTO Monitoring", description: "Fetch First Signatory FTOs and import only this Village Council's matching Job Cards.", href: "/fto-monitoring", mark: "FTO", available: true },
  { title: "Contributions", description: "Contribution ledger is not available yet.", mark: "CN", available: false },
  { title: "CO Calculation", description: "CO calculation tools are not available yet.", mark: "CO", available: false },
  { title: "Payments", description: "Payment recording is not available yet.", mark: "PY", available: false },
  { title: "Reports", description: "Council reports are not available yet.", mark: "RP", available: false },
  { title: "Settings", description: "Workspace settings are not available yet.", mark: "ST", available: false },
];

export default function DashboardPage() {
  const [activeJobCards, setActiveJobCards] = useState<number | null>(null);
  const [activeApplicants, setActiveApplicants] = useState<number | null>(null);
  const [kpiError, setKpiError] = useState("");

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
    <div className="space-y-8">
      <section>
        <p className="text-sm font-medium text-blue-700">Overview</p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Your Village Council workspace. Choose a module to get started.</p>
          </div>
        </div>
      </section>

      {kpiError && <p role="status" className="text-xs text-slate-500">{kpiError}</p>}

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Modules</h2>
            <p className="mt-1 text-sm text-slate-500">Core Village Council operations</p>
          </div>
          <span className="text-xs text-slate-400">2 available · 6 coming soon</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map(module => {
            const content = (
              <>
                <div className="flex items-start justify-between">
                  <div className={`flex h-11 min-w-11 items-center justify-center rounded-xl px-2 text-xs font-bold ${module.available ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{module.mark}</div>
                  {module.available
                    ? <span className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600">→</span>
                    : <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">Coming soon</span>}
                </div>
                <h3 className="mt-4 font-semibold text-slate-900">{module.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">{module.description}</p>
                {module.title === "Job Cards" && (
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                    <div>
                      <p className="text-xl font-semibold tabular-nums text-slate-950">{activeJobCards === null ? "—" : activeJobCards.toLocaleString("en-IN")}</p>
                      <p className="mt-0.5 text-xs text-slate-500">Active Job Cards</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold tabular-nums text-slate-950">{activeApplicants === null ? "—" : activeApplicants.toLocaleString("en-IN")}</p>
                      <p className="mt-0.5 text-xs text-slate-500">Active Applicants</p>
                    </div>
                  </div>
                )}
              </>
            );
            const className = `group rounded-2xl border bg-white p-5 shadow-sm ${module.available ? "border-slate-200 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md" : "border-slate-100 opacity-75"}`;
            return module.available && module.href
              ? <Link key={module.title} href={module.href} className={className}>{content}</Link>
              : <div key={module.title} aria-disabled="true" className={className}>{content}</div>;
          })}
        </div>
      </section>
    </div>
  );
}
