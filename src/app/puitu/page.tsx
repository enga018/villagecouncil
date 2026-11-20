const modules = [
  { title: "Job Cards", description: "Manage households, job cards and applicants.", href: "/puitu/job-cards", mark: "JC" },
  { title: "Register", description: "Maintain the official registration register.", href: "/puitu/register", mark: "RG" },
  { title: "FTO Monitoring", description: "Monitor FTO progress from First Signatory onward.", href: "/puitu/fto-monitoring", mark: "FTO" },
  { title: "Contributions", description: "Review contribution charges and outstanding balances.", href: "/puitu/contributions", mark: "CN" },
  { title: "CO Calculation", description: "Prepare and review CO calculations.", href: "/puitu/co-calculation", mark: "CO" },
  { title: "Payments", description: "Record and review payments.", href: "/puitu/payments", mark: "PY" },
  { title: "Reports", description: "View and export council reports.", href: "/puitu/reports", mark: "RP" },
  { title: "Settings", description: "Configure the council workspace.", href: "/puitu/settings", mark: "ST" },
];

export default function PuituDashboardPage() {
  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm font-medium text-blue-700">Overview</p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Your Village Council workspace. Choose a module to get started.</p>
          </div>
          <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">Initial application shell</span>
        </div>
      </section>

      <section aria-label="Dashboard summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {["Total Job Cards", "Active Applicants", "FTOs Pending", "Contribution Outstanding"].map((label) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-300">—</div>
            <div className="mt-1 text-xs text-slate-400">Data connection not configured</div>
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
          {modules.map((module) => (
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

      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 sm:p-6">
        <h2 className="font-semibold text-slate-900">Workspace status</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">The navigation and page structure are in place. Authentication, village selection from the protected account mapping, and live module data will be connected in subsequent implementation steps.</p>
      </section>
    </div>
  );
}
