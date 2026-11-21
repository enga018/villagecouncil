"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import SuperadminGate from "@/components/app/SuperadminGate";

type Council = { id: string; name: string; slug: string; is_active: boolean; created_at: string };
type Membership = { village_council_id: string; is_active: boolean };

const navigation = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "councils", label: "Village Councils", icon: "landmark" },
  { id: "requests", label: "Registration Requests", icon: "inbox", upcoming: true },
  { id: "users", label: "Users & Administrators", icon: "users", upcoming: true },
  { id: "access", label: "Access Control", icon: "shield", upcoming: true },
  { id: "audit", label: "Audit Logs", icon: "activity", upcoming: true },
  { id: "settings", label: "Platform Settings", icon: "settings", upcoming: true },
] as const;

function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></>,
    landmark: <><path d="M3 9h18L12 4 3 9Z"/><path d="M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18"/></>,
    inbox: <><path d="M4 4h16l1 11h-5l-2 3h-4l-2-3H3L4 4Z"/><path d="M3 15h5m8 0h5"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.5.9L16 21h-8l-.3-2.1a8 8 0 0 1-1.5-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.5-.9L8 3h8l.3 2.1a8 8 0 0 1 1.5.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.8l1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.5.9"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    building: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2m2 0h2M9 11h2m2 0h2M9 15h2m2 0h2M10 21v-3h4v3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function SuperadminDashboard() {
  const [councils, setCouncils] = useState<Council[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [success, setSuccess] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">("all");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const supabase = createClient();
        const [councilResult, membershipResult] = await Promise.all([
          supabase.from("council_tenants").select("id,name,slug,is_active,created_at").order("name"),
          supabase.from("council_memberships").select("village_council_id,is_active"),
        ]);
        if (councilResult.error) throw councilResult.error;
        if (membershipResult.error) throw membershipResult.error;
        if (active) {
          setCouncils(councilResult.data ?? []);
          setMemberships(membershipResult.data ?? []);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load platform data.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [refreshKey]);

  async function createCouncil(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError("");
    setSuccess("");
    try {
      const { data, error } = await createClient().functions.invoke("create-village-council", {
        body: { name, slug, adminEmail },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSuccess(`Created ${data.villageCouncil.name}. An invitation has been sent to ${data.invitedEmail}.`);
      setName("");
      setSlug("");
      setAdminEmail("");
      setCreateOpen(false);
      setRefreshKey(value => value + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to create the Village Council.");
    } finally {
      setCreating(false);
    }
  }

  const activeCouncils = councils.filter(c => c.is_active).length;
  const suspendedCouncils = councils.length - activeCouncils;
  const filteredCouncils = useMemo(() => councils.filter(council => {
    const matchesSearch = `${council.name} ${council.slug}`.toLowerCase().includes(search.toLowerCase().trim());
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? council.is_active : !council.is_active);
    return matchesSearch && matchesStatus;
  }), [councils, search, statusFilter]);

  return <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-slate-200/80 bg-white lg:flex">
      <div className="flex h-[76px] items-center gap-3 border-b border-slate-100 px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white"><Icon name="building" className="h-5 w-5"/></div>
        <div><p className="text-[15px] font-bold tracking-tight text-slate-950">Village Council</p><p className="mt-0.5 text-[11px] font-medium text-slate-400">Platform administration</p></div>
      </div>
      <div className="px-4 pt-7"><p className="px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Workspace</p>
        <nav aria-label="Superadmin navigation" className="mt-3 space-y-1">
          {navigation.map(item => <div key={item.id} title={item.upcoming ? "This section will be implemented in a later stage." : undefined}>
            {item.id === "overview" || item.id === "councils" ?
              <a href={item.id === "overview" ? "#overview" : "#councils"} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition ${item.id === "overview" ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}>
                <Icon name={item.icon} className="h-[18px] w-[18px]"/><span>{item.label}</span>{item.id === "councils" && <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{councils.length}</span>}
              </a> :
              <div aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-slate-300">
                <Icon name={item.icon} className="h-[18px] w-[18px]"/><span>{item.label}</span><span className="ml-auto text-[9px] font-semibold uppercase tracking-wide text-slate-300">Soon</span>
              </div>}
          </div>)}
        </nav>
      </div>
      <div className="mt-auto border-t border-slate-100 p-4">
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">SA</div>
          <div className="min-w-0"><p className="text-xs font-semibold text-slate-800">Platform Superadmin</p><p className="mt-0.5 text-[10px] text-slate-400">Full platform access</p></div>
          <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500"/>
        </div>
        <Link href="/dashboard" className="mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><span>Open my council workspace</span><Icon name="arrow" className="h-4 w-4"/></Link>
      </div>
    </aside>

    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden">
      <button aria-label="Close navigation" className="absolute inset-0 bg-slate-950/40" onClick={() => setMobileOpen(false)}/>
      <aside className="relative flex h-full w-[min(19rem,86vw)] flex-col bg-white shadow-2xl">
        <div className="flex h-[72px] items-center justify-between border-b border-slate-100 px-5"><div className="flex items-center gap-2 font-bold"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-white"><Icon name="building" className="h-4 w-4"/></span>Village Council</div><button aria-label="Close menu" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Icon name="close"/></button></div>
        <nav className="space-y-1 p-4" aria-label="Mobile Superadmin navigation">
          {navigation.map(item => <div key={item.id}>{item.id === "overview" || item.id === "councils" ? <a onClick={() => setMobileOpen(false)} href={item.id === "overview" ? "#overview" : "#councils"} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${item.id === "overview" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}><Icon name={item.icon}/>{item.label}</a> : <div className="flex items-center gap-3 px-3 py-3 text-sm text-slate-300"><Icon name={item.icon}/>{item.label}<span className="ml-auto text-[9px] uppercase">Soon</span></div>}</div>)}
        </nav>
      </aside>
    </div>}

    <div className="lg:pl-[264px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
        <div className="flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden"><Icon name="menu"/></button>
          <div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400">Platform</p><p className="text-sm font-semibold text-slate-800">Overview</p></div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700 sm:inline-flex">Superadmin</span>
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"><Icon name="users" className="h-[17px] w-[17px]"/></div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-7 px-4 py-7 sm:px-7 sm:py-8 lg:px-9 lg:py-9">
        <section id="overview" className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="text-xs font-semibold text-blue-700">PLATFORM CONTROL CENTER</p><h1 className="mt-2 text-[26px] font-bold tracking-tight text-slate-950 sm:text-[30px]">Good to see you</h1><p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-500">Monitor your Village Council network and manage platform operations from one place.</p></div>
          <button onClick={() => { setCreateOpen(true); setCreateError(""); }} className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-slate-950 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-slate-800 sm:self-auto"><Icon name="plus" className="h-4 w-4"/> Create Village Council</button>
        </section>

        {success && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0"/>{success}<button onClick={() => setSuccess("")} className="ml-auto text-emerald-700" aria-label="Dismiss message"><Icon name="close" className="h-4 w-4"/></button></div>}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Platform statistics">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]"><div className="flex items-center justify-between"><p className="text-xs font-medium text-slate-500">Total councils</p><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Icon name="landmark" className="h-[18px] w-[18px]"/></span></div><p className="mt-4 text-[28px] font-bold tracking-tight tabular-nums text-slate-950">{loading ? "—" : councils.length}</p><p className="mt-1 text-[11px] text-slate-400">Registered on the platform</p></div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]"><div className="flex items-center justify-between"><p className="text-xs font-medium text-slate-500">Active councils</p><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon name="check" className="h-[18px] w-[18px]"/></span></div><p className="mt-4 text-[28px] font-bold tracking-tight tabular-nums text-slate-950">{loading ? "—" : activeCouncils}</p><p className="mt-1 text-[11px] text-slate-400">Currently enabled</p></div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]"><div className="flex items-center justify-between"><p className="text-xs font-medium text-slate-500">Suspended councils</p><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Icon name="clock" className="h-[18px] w-[18px]"/></span></div><p className="mt-4 text-[28px] font-bold tracking-tight tabular-nums text-slate-950">{loading ? "—" : suspendedCouncils}</p><p className="mt-1 text-[11px] text-slate-400">Temporarily unavailable</p></div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]"><div className="flex items-center justify-between"><p className="text-xs font-medium text-slate-500">Platform access</p><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Icon name="shield" className="h-[18px] w-[18px]"/></span></div><p className="mt-4 text-[28px] font-bold tracking-tight text-slate-950">Full</p><p className="mt-1 text-[11px] text-slate-400">Superadmin privileges enabled</p></div>
        </section>

        <section id="councils" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div><div className="flex items-center gap-2"><h2 className="text-base font-bold tracking-tight text-slate-950">Village Councils</h2><span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{councils.length}</span></div><p className="mt-1 text-xs text-slate-500">All registered tenants across the platform.</p></div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative"><Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search councils" placeholder="Search councils..." className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50 sm:w-52"/></div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter councils by status" className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
            </div>
          </div>
          {error && <div role="alert" className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {loading ? <div className="space-y-3 p-6"><div className="h-12 animate-pulse rounded-lg bg-slate-100"/><div className="h-12 animate-pulse rounded-lg bg-slate-100"/><div className="h-12 animate-pulse rounded-lg bg-slate-100"/></div> :
            filteredCouncils.length === 0 ? <div className="px-5 py-14 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><Icon name="landmark"/></div><p className="mt-3 text-sm font-semibold text-slate-700">{councils.length ? "No matching councils" : "No Village Councils yet"}</p><p className="mt-1 text-xs text-slate-400">{councils.length ? "Try changing your search or filters." : "Create the first tenant to get started."}</p></div> :
            <><div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(120px,.7fr)_minmax(110px,.6fr)_minmax(110px,.6fr)] gap-4 bg-slate-50/80 px-6 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-slate-400 md:grid"><span>Council</span><span>Membership</span><span>Status</span><span className="text-right">Created</span></div>
            <div className="divide-y divide-slate-100">{filteredCouncils.map(council => {
              const isMember = memberships.some(m => m.village_council_id === council.id && m.is_active);
              return <div key={council.id} className="grid gap-3 px-5 py-4 transition hover:bg-slate-50/70 md:grid-cols-[minmax(0,1.7fr)_minmax(120px,.7fr)_minmax(110px,.6fr)_minmax(110px,.6fr)] md:items-center md:gap-4 md:px-6">
                <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><Icon name="landmark" className="h-[18px] w-[18px]"/></div><div className="min-w-0"><p className="truncate text-[13px] font-semibold text-slate-800">{council.name}</p><p className="mt-0.5 truncate text-[11px] text-slate-400">{council.slug}</p></div></div>
                <div className="flex items-center gap-2 md:block">{isMember ? <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-blue-700"><span className="h-1.5 w-1.5 rounded-full bg-blue-500"/>Your council membership</span> : <span className="text-[11px] text-slate-400">Platform access</span>}</div>
                <div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${council.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${council.is_active ? "bg-emerald-500" : "bg-slate-400"}`}/>{council.is_active ? "Active" : "Suspended"}</span></div>
                <div className="flex items-center justify-between gap-3 md:justify-end"><span className="text-[11px] text-slate-400">{new Date(council.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span><span title="Tenant workspace access will be added in a later stage" className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300">Open <Icon name="chevron" className="h-3.5 w-3.5"/></span></div>
              </div>;
            })}</div></>}
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-[11px] text-slate-400 sm:px-6"><span>Showing {filteredCouncils.length} of {councils.length} councils</span><span>Tenant registry</span></div>
        </section>
      </main>
    </div>

    {createOpen && <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !creating) setCreateOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="create-council-title" className="my-auto w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-blue-700">Tenant onboarding</p><h2 id="create-council-title" className="mt-1 text-xl font-bold tracking-tight text-slate-950">Create Village Council</h2><p className="mt-1 text-xs leading-5 text-slate-500">Register a new council and invite its initial administrator.</p></div><button onClick={() => setCreateOpen(false)} disabled={creating} aria-label="Close dialog" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-40"><Icon name="close"/></button></div>
        <form onSubmit={createCouncil} className="mt-6 space-y-4">
          <div><label htmlFor="council-name" className="mb-1.5 block text-xs font-semibold text-slate-700">Village Council name</label><input id="council-name" required minLength={3} maxLength={120} value={name} onChange={e => { setName(e.target.value); setSlug(slugify(e.target.value)); }} placeholder="e.g. Serchhip Vengthar Village Council" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"/></div>
          <div><label htmlFor="council-slug" className="mb-1.5 block text-xs font-semibold text-slate-700">Unique URL slug</label><input id="council-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={slug} onChange={e => setSlug(slugify(e.target.value))} placeholder="serchhip-vengthar" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"/></div>
          <div><label htmlFor="council-admin-email" className="mb-1.5 block text-xs font-semibold text-slate-700">Initial administrator email</label><input id="council-admin-email" type="email" required maxLength={254} value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="administrator@example.com" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"/><p className="mt-1.5 text-[11px] text-slate-400">An invitation will be sent so the administrator can set their password.</p></div>
          {createError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">{createError}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" disabled={creating} onClick={() => setCreateOpen(false)} className="h-10 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button><button type="submit" disabled={creating} className="h-10 rounded-lg bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">{creating ? "Creating council…" : "Create council & invite admin"}</button></div>
        </form>
      </section>
    </div>}
  </div>;
}

export default function SuperadminPage() {
  return <SuperadminGate><SuperadminDashboard /></SuperadminGate>;
}
