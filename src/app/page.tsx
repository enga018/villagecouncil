import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-[#f5f7fb] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="text-base font-bold tracking-tight text-slate-950">Village Council</Link>
          <Link href="/login" className="text-sm font-semibold text-slate-600 hover:text-slate-950">Sign in</Link>
        </div>
      </header>
      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 py-16">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-700">Village Council Management Platform</p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">A shared digital workspace for Village Councils.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">Access your council workspace or submit a request to bring your Village Council onto the platform.</p>
        </div>
        <div className="mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
          <Link href="/login" className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg></span>
            <h2 className="mt-5 text-lg font-bold text-slate-950">Sign in</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Already have an administrator or council account? Continue to your workspace.</p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-800">Go to sign in <span aria-hidden="true">→</span></span>
          </Link>
          <Link href="/request-to-onboard" className="group rounded-2xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-700 text-white"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14"/><path d="M3 3h18v18H3z"/></svg></span>
            <h2 className="mt-5 text-lg font-bold text-slate-950">Request to Onboard</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Submit your Village Council details for Superadmin review and approval.</p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-800">Submit a request <span aria-hidden="true">→</span></span>
          </Link>
        </div>
      </section>
      <footer className="border-t border-slate-200 bg-white px-5 py-5 text-center text-xs text-slate-400">Village Council Management Platform</footer>
    </main>
  );
}
