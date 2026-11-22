"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

const modules = [
  { title: "Job Cards", description: "Manage households, job cards and applicants.", href: "/job-cards", mark: "JC" },
  { title: "Register", description: "Maintain the official registration register.", href: "/register", mark: "RG" },
  { title: "FTO Monitoring", description: "Monitor FTO progress from First Signatory onward.", href: "/fto-monitoring", mark: "FTO" },
  { title: "Contributions", description: "Review contribution charges and outstanding balances.", href: "/contributions", mark: "CN" },
  { title: "CO Calculation", description: "Prepare and review CO calculations.", href: "/co-calculation", mark: "CO" },
  { title: "Payments", description: "Record and review payments.", href: "/payments", mark: "PY" },
  { title: "Reports", description: "View and export council reports.", href: "/reports", mark: "RP" },
  { title: "Settings", description: "Configure the council workspace.", href: "/settings", mark: "ST" },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<{ totalCards: number; activeCards: number; totalApplicants: number; activeApplicants: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadStats() {
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

        const councilId = membership.village_council_id;
        const [totalCards, activeCards, totalApplicants, activeApplicants] = await Promise.all([
          supabase.from("council_job_cards").select("id", { count: "exact", head: true }).eq("village_council_id", councilId),
          supabase.from("council_job_cards").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("status", "active"),
          supabase.from("council_applicants").select("id", { count: "exact", head: true }).eq("village_council_id", councilId),
          supabase.from("council_applicants").select("id", { count: "exact", head: true }).eq("village_council_id", councilId).eq("status", "active"),
        ]);
        const failure = totalCards.error || activeCards.error || totalApplicants.error || activeApplicants.error;
        if (failure) throw failure;
        if (active) setStats({
          totalCards: totalCards.count || 0,
          activeCards: activeCards.count || 0,
          totalApplicants: totalApplicants.count || 0,
          activeApplicants: activeApplicants.count || 0,
        });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load Dashboard statistics.");
      }
    }
    void loadStats();
    return () => { active = false; };
  }, []);

  const metrics = [
    ["Total Job Cards", stats?.totalCards],
    ["Active Job Cards", stats?.activeCards],
    ["Total Applicants", stats?.totalApplicants],
    ["Active Applicants", stats?.activeApplicants],
  ];

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

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      <section aria-label="Dashboard summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-slate-950">{value === undefined ? "—" : value.toLocaleString()}</div>
            <div className="mt-1 text-xs text-slate-400">{stats ? "Live council records" : "Loading council records…"}</div>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Modules</h2>
            <p className="mt-1 text-sm text-slate-500">Core Village Council operations</p>
          </div>
          <span className="text-xs text-slate-400">8 modules</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map(module => (
            <a key={module.href} href={module.href} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className="flex h-11 min-w-11 items-center justify-center rounded-xl bg-slate-100 px-2 text-xs font-bold text-slate-600 group-hover:bg-blue-50 group-hover:text-blue-700">{module.mark}</div>
                <span className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600">→</span>
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{module.title}</h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">{module.description}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
