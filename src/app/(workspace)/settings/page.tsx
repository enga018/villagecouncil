"use client";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Preferences</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">CO calculation parameters are now managed separately for each FTO.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--vc-shadow-card)] sm:p-6">
        <h2 className="text-base font-bold text-slate-950">FTO-specific CO formula</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Open an FTO in FTO Monitoring and choose Calculate CO or Recalculate CO. You can edit the divisor and multiplier directly in its calculation preview.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Initial divisor</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">300</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Initial multiplier</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">100</p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">After an FTO has a saved calculation, its latest divisor and multiplier are used as the starting values for that FTO&apos;s next recalculation. Changing one FTO never changes another FTO. Every saved version retains the exact parameters used.</p>
      </section>
    </div>
  );
}
