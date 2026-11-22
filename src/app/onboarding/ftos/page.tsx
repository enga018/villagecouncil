"use client";

import OnboardingShell from "@/components/app/OnboardingShell";

export default function FtoOnboardingPage() {
  return (
    <OnboardingShell activeStep={2}>
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-sm font-medium text-blue-700">FTO discovery · Step 3</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Discover your council&apos;s FTO records</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          The Job Card register has been established. The next step is to discover and import FTO records for your Government location.
        </p>
        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4">
          <h3 className="text-sm font-semibold text-blue-950">Discovery sequence</h3>
          <p className="mt-2 text-sm leading-6 text-blue-900">
            State → District → FTO Status → Block → First Signatory → individual FTO records.
          </p>
          <p className="mt-2 text-xs leading-5 text-blue-800">
            This discovery process uses the public Government navigation flow and does not require CAPTCHA.
          </p>
        </div>
        <p className="mt-5 text-sm text-slate-500">
          FTO discovery and import controls are the next implementation task. No FTO records have been imported from this screen.
        </p>
      </section>
    </OnboardingShell>
  );
}
