"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase";

const navigation = [
  { href: "/puitu", label: "Dashboard", mark: "D" },
  { href: "/puitu/job-cards", label: "Job Cards", mark: "J" },
  { href: "/puitu/register", label: "Register", mark: "R" },
  { href: "/puitu/fto-monitoring", label: "FTO Monitoring", mark: "F" },
  { href: "/puitu/contributions", label: "Contributions", mark: "C" },
  { href: "/puitu/co-calculation", label: "CO Calculation", mark: "CO" },
  { href: "/puitu/payments", label: "Payments", mark: "P" },
  { href: "/puitu/reports", label: "Reports", mark: "R" },
  { href: "/puitu/settings", label: "Settings", mark: "S" },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav aria-label="Main navigation" className="space-y-1">
    {navigation.map(item => {
      const active = item.href === "/puitu" ? pathname === "/puitu" : pathname === item.href || pathname.startsWith(item.href + "/");
      return <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${active ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{item.mark}</span>
        <span>{item.label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-600" />}
      </Link>;
    })}
  </nav>;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const { error } = await createClient().auth.signOut();
    if (error) {
      setSigningOut(false);
      return;
    }
    router.replace("/login");
  }

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
      <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-5"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-sm font-bold text-white">VP</div><div><div className="font-semibold tracking-tight">Village Council</div><div className="text-xs text-slate-500">Village Council Platform</div></div></div>
      <div className="flex-1 overflow-y-auto px-3 py-5"><div className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Workspace</div><Navigation /></div>
      <div className="border-t border-slate-100 p-4"><button onClick={handleSignOut} disabled={signingOut} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">{signingOut ? "Signing out…" : "Sign out"}</button></div>
    </aside>
    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Close navigation" className="absolute inset-0 bg-slate-950/40" onClick={() => setMobileOpen(false)} />
      <aside className="relative flex h-full w-[min(19rem,85vw)] flex-col bg-white shadow-2xl"><div className="flex h-20 items-center justify-between border-b border-slate-100 px-5"><div className="font-semibold">Village Council</div><button onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Close</button></div>
        <div className="flex-1 overflow-y-auto px-3 py-5"><Navigation onNavigate={() => setMobileOpen(false)} /></div>
        <div className="border-t border-slate-100 p-4"><button onClick={handleSignOut} disabled={signingOut} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm font-medium text-slate-600 disabled:opacity-50">{signingOut ? "Signing out…" : "Sign out"}</button></div></aside>
    </div>}
    <div className="lg:pl-64"><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex items-center gap-3"><button onClick={() => setMobileOpen(true)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 lg:hidden" aria-label="Open navigation">Menu</button><div className="text-sm font-medium text-slate-700">Village Council Workspace</div></div><div className="text-xs font-medium text-slate-500">Village Council</div>
    </header><main className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8">{children}</main></div>
  </div>;
}
