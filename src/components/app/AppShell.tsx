"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase";

const navigation = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", mark: "OV" },
      { href: "/job-cards", label: "Job Cards", mark: "JC" },
      { href: "/register", label: "Register", mark: "RG" },
    ],
  },
  {
    label: "Financial operations",
    items: [
      { href: "/fto-monitoring", label: "FTO Monitoring", mark: "FT" },
      { href: "/contributions", label: "Contributions", mark: "CN" },
      { href: "/contributions/exemptions", label: "Exemptions", mark: "EX" },
      { href: "/payments", label: "Payments", mark: "PY" },
      { href: "/reports", label: "Reports", mark: "RP" },
    ],
  },
  {
    label: "Preferences",
    items: [{ href: "/settings", label: "Settings", mark: "ST" }],
  },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Council workspace navigation" className="space-y-6">
      {navigation.map(group => (
        <section key={group.label}>
          <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{group.label}</h2>
          <div className="space-y-1">
            {group.items.map(item => {
              const active = item.href === "/dashboard" || item.href === "/contributions" ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                  className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-colors ${active ? "bg-blue-50 font-semibold text-blue-800" : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold tracking-wide ${active ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-500 group-hover:bg-white"}`}>{item.mark}</span>
                  <span>{item.label}</span>
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-700" />}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex h-[76px] items-center gap-3 border-b border-slate-100 px-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-xs font-bold tracking-wide text-white shadow-sm">VC</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-bold tracking-tight text-slate-950">Village Council</span>
        <span className="mt-0.5 block text-[11px] text-slate-500">Council workspace</span>
      </span>
    </Link>
  );
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

  const signOutButton = (
    <button onClick={handleSignOut} disabled={signingOut}
      className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:opacity-50">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold">↗</span>
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );

  return (
    <div className="min-h-screen bg-[var(--vc-background)] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--vc-sidebar-width)] flex-col border-r border-slate-200/80 bg-white lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto px-3 py-6"><Navigation /></div>
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 rounded-xl bg-slate-50 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Signed in area</p>
            <p className="mt-1 text-xs font-semibold text-slate-700">Village Council</p>
          </div>
          {signOutButton}
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close navigation" className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-[min(19rem,88vw)] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between"><Brand /><button onClick={() => setMobileOpen(false)} className="mr-3 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100">Close</button></div>
            <div className="flex-1 overflow-y-auto px-3 py-6"><Navigation onNavigate={() => setMobileOpen(false)} /></div>
            <div className="border-t border-slate-100 p-3">{signOutButton}</div>
          </aside>
        </div>
      )}

      <div className="lg:pl-[var(--vc-sidebar-width)]">
        <header className="sticky top-0 z-20 flex h-[var(--vc-topbar-height)] items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 lg:hidden" aria-label="Open navigation"><span aria-hidden="true">☰</span> Menu</button>
            <div><p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">Village Council Platform</p><p className="text-[13px] font-semibold text-slate-800">Council workspace</p></div>
          </div>
          <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500 sm:inline-flex">Workspace</span>
        </header>
        <main className="mx-auto min-h-[calc(100vh-var(--vc-topbar-height))] w-full p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
