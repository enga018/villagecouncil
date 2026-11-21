"use client";

import Link from "next/link";

const steps = [
  { label: "Government location", short: "Location", href: "/onboarding" },
  { label: "Job Card register", short: "Job Cards", href: "/onboarding/job-cards" },
  { label: "FTO discovery", short: "FTOs", href: "/onboarding/ftos" },
  { label: "Review & activation", short: "Review", href: "/onboarding/review" },
];

export default function OnboardingShell({
  activeStep,
  children,
}: {
  activeStep: number;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-sm font-bold text-white">VC</span>
            <span>
              <span className="block text-sm font-semibold tracking-tight text-slate-950">Village Council</span>
              <span className="block text-xs text-slate-500">Village Council Platform</span>
            </span>
          </Link>
          <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">Onboarding</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">Workspace setup</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Set up your Village Council</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">Complete these steps to prepare your council workspace.</p>
          </div>

          <nav aria-label="Onboarding steps" className="mb-7 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <ol className="grid grid-cols-4 gap-1 sm:gap-3">
              {steps.map((step, index) => {
                const complete = index < activeStep;
                const current = index === activeStep;
                return (
                  <li key={step.href} className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${complete ? "bg-emerald-600 text-white" : current ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-400"}`}>
                        {complete ? "✓" : index + 1}
                      </span>
                      <span className={`hidden truncate text-xs font-semibold sm:block ${complete ? "text-emerald-700" : current ? "text-blue-700" : "text-slate-400"}`}>{step.label}</span>
                      <span className={`truncate text-[11px] font-semibold sm:hidden ${complete ? "text-emerald-700" : current ? "text-blue-700" : "text-slate-400"}`}>{step.short}</span>
                    </div>
                    <div className="mt-2 h-1 rounded-full bg-slate-100">
                      <div className={`h-1 rounded-full ${complete ? "w-full bg-emerald-500" : current ? "w-1/2 bg-blue-600" : "w-0"}`} />
                    </div>
                  </li>
                );
              })}
            </ol>
          </nav>

          {children}
        </div>
      </main>
    </div>
  );
}
