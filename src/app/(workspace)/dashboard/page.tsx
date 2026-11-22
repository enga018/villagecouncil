"use client";

import Link from "next/link";

const modules = [
  { title: "Job Cards", description: "Manage households, job cards and applicants.", href: "/job-cards", mark: "JC", available: true },
  { title: "Register", description: "Official registration register tools are not available yet.", mark: "RG", available: false },
  { title: "FTO Monitoring", description: "FTO discovery and monitoring are being prepared.", mark: "FTO", available: false },
  { title: "Contributions", description: "Contribution ledger is not available yet.", mark: "CN", available: false },
  { title: "CO Calculation", description: "CO calculation tools are not available yet.", mark: "CO", available: false },
  { title: "Payments", description: "Payment recording is not available yet.", mark: "PY", available: false },
  { title: "Reports", description: "Council reports are not available yet.", mark: "RP", available: false },
  { title: "Settings", description: "Workspace settings are not available yet.", mark: "ST", available: false },
];

export default function DashboardPage() {
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

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Modules</h2>
            <p className="mt-1 text-sm text-slate-500">Core Village Council operations</p>
          </div>
          <span className="text-xs text-slate-400">1 available · 7 coming soon</span>
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
