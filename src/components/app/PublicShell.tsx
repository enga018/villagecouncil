import Link from "next/link";

export default function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--vc-background)] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[var(--vc-topbar-height)] max-w-[var(--vc-content-width)] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-[11px] font-bold tracking-wide text-white">VC</span>
            <span><span className="block text-sm font-bold tracking-tight text-slate-950">Village Council</span><span className="block text-[10px] text-slate-500">Management Platform</span></span>
          </Link>
          <Link href="/login" className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800">Sign in</Link>
        </div>
      </header>
      {children}
      <footer className="border-t border-slate-200/80 bg-white px-5 py-6 text-center text-[11px] text-slate-400">Village Council Management Platform</footer>
    </div>
  );
}
