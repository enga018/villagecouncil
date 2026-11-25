import Link from "next/link";
import PublicShell from "@/components/app/PublicShell";

export default function HomePage() {
  return (
    <PublicShell>
      <main className="mx-auto flex min-h-[calc(100vh-8.5rem)] w-full max-w-[var(--vc-content-width)] flex-col justify-center px-5 py-16 sm:px-8 lg:py-24">
        <section className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-800"><span className="h-1.5 w-1.5 rounded-full bg-blue-600"/> Village Council Management Platform</span>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.12] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">A clearer way to manage Village Council work.</h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">A shared digital workspace for council operations, records and administration—built to make everyday work easier to manage.</p>
        </section>
        <section aria-label="Get started" className="mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
          <Link href="/login" className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-[var(--vc-shadow-card)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg sm:p-7">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white">↗</span>
            <h2 className="mt-5 text-lg font-bold tracking-tight text-slate-950">Sign in to your workspace</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Continue to your Village Council or platform administrator workspace.</p>
            <span className="mt-6 inline-flex items-center gap-2 text-xs font-bold text-slate-800">Continue <span className="transition-transform group-hover:translate-x-1">→</span></span>
          </Link>
          <Link href="/request-to-onboard" className="group rounded-2xl border border-blue-100 bg-blue-50/60 p-6 shadow-[var(--vc-shadow-card)] transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg sm:p-7">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-700 text-lg font-semibold text-white">+</span>
            <h2 className="mt-5 text-lg font-bold tracking-tight text-slate-950">Request to onboard</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Submit your Village Council details for platform administrator review.</p>
            <span className="mt-6 inline-flex items-center gap-2 text-xs font-bold text-blue-800">Start a request <span className="transition-transform group-hover:translate-x-1">→</span></span>
          </Link>
        </section>
      </main>
    </PublicShell>
  );
}
