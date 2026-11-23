"use client";

import Link from "next/link";
import { useState } from "react";

const sections = [
  { id: "overview", label: "Overview", mark: "OV", active: true },
  { id: "councils", label: "Village Councils", mark: "VC" },
  { id: "requests", label: "Registration Requests", mark: "RQ" },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Superadmin navigation" className="space-y-1">
      {sections.map(item => (
        <a key={item.id} href={`#${item.id}`} onClick={onNavigate}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors ${item.active ? "bg-slate-950 font-semibold text-white shadow-sm" : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}>
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold tracking-wide ${item.active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-500"}`}>{item.mark}</span>
          <span>{item.label}</span>
          {item.active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white"/>}
        </a>
      ))}
      <div className="mt-5 border-t border-slate-100 pt-5">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400">Platform controls</p>
        {["Users & Administrators", "Access Control", "Audit Logs", "Platform Settings"].map(label => (
          <div key={label} aria-disabled="true" title="Planned for a later phase" className="flex min-h-10 cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-medium text-slate-300">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50 text-[9px] font-bold">—</span>{label}
            <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide">Soon</span>
          </div>
        ))}
      </div>
    </nav>
  );
}

export default function SuperadminShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-[var(--vc-background)] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--vc-sidebar-width)] flex-col border-r border-slate-200/80 bg-white lg:flex">
        <Link href="/superadmin" className="flex h-[76px] items-center gap-3 border-b border-slate-100 px-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white"><span className="text-[11px] font-bold tracking-wide">VC</span></span>
          <span><span className="block text-[14px] font-bold tracking-tight text-slate-950">Village Council</span><span className="mt-0.5 block text-[11px] text-slate-500">Platform administration</span></span>
        </Link>
        <div className="flex-1 overflow-y-auto px-3 py-6">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">Administration</p>
          <Navigation/>
        </div>
        <div className="border-t border-slate-100 p-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-800">SA</span><span><span className="block text-xs font-semibold text-slate-800">Platform Superadmin</span><span className="mt-0.5 block text-[10px] text-slate-500">Full platform access</span></span><span className="ml-auto h-2 w-2 rounded-full bg-emerald-500"/></div>
          </div>
          <Link href="/dashboard" className="mt-2 flex min-h-10 items-center justify-between rounded-xl px-3 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"><span>Open council workspace</span><span aria-hidden="true">↗</span></Link>
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden">
        <button aria-label="Close navigation" className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)}/>
        <aside className="relative flex h-full w-[min(19rem,88vw)] flex-col bg-white shadow-2xl">
          <div className="flex h-[76px] items-center justify-between border-b border-slate-100 px-5"><Link href="/superadmin" onClick={() => setMobileOpen(false)} className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-[10px] font-bold text-white">VC</span><span className="text-sm font-bold">Platform administration</span></Link><button onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100">Close</button></div>
          <div className="flex-1 overflow-y-auto px-3 py-6"><Navigation onNavigate={() => setMobileOpen(false)}/></div>
          <div className="border-t border-slate-100 p-4"><Link href="/dashboard" onClick={() => setMobileOpen(false)} className="block rounded-xl border border-slate-200 px-3 py-3 text-xs font-semibold text-slate-600">Open council workspace ↗</Link></div>
        </aside>
      </div>}

      <div className="lg:pl-[var(--vc-sidebar-width)]">
        <header className="sticky top-0 z-20 flex h-[var(--vc-topbar-height)] items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 lg:hidden"><span aria-hidden="true">☰</span> Menu</button>
            <div><p className="text-[10px] font-medium uppercase tracking-[.14em] text-slate-400">Platform administration</p><p className="text-[13px] font-semibold text-slate-800">Control center</p></div>
          </div>
          <span className="hidden rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-800 sm:inline-flex">Superadmin</span>
        </header>
        {children}
      </div>
    </div>
  );
}
