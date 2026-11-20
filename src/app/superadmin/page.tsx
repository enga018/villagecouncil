"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import SuperadminGate from "@/components/app/SuperadminGate";

type Council = { id: string; name: string; slug: string; is_active: boolean; created_at: string };
type Membership = { village_council_id: string; is_active: boolean };

function SuperadminDashboard() {
  const [councils, setCouncils] = useState<Council[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const [councilResult, membershipResult] = await Promise.all([
          supabase.from("village_councils").select("id,name,slug,is_active,created_at").order("name"),
          supabase.from("memberships").select("village_council_id,is_active"),
        ]);
        if (councilResult.error) throw councilResult.error;
        if (membershipResult.error) throw membershipResult.error;
        setCouncils(councilResult.data ?? []);
        setMemberships(membershipResult.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load platform data.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const activeCouncils = councils.filter(c => c.is_active).length;
  const activeAccounts = memberships.filter(m => m.is_active).length;

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-blue-700">Platform administration</p><h1 className="mt-1 text-xl font-bold tracking-tight">Village Council</h1></div>
        <Link href="/dashboard" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Open VC workspace</Link>
      </div>
    </header>
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <section><h2 className="text-2xl font-bold tracking-tight">Superadmin dashboard</h2><p className="mt-1 text-sm text-slate-500">Manage Village Council tenants and platform access from one place.</p></section>
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Total Village Councils</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading ? "—" : councils.length}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Active Village Councils</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading ? "—" : activeCouncils}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Active VC Accounts</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading ? "—" : activeAccounts}</p></div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-semibold">Village Councils</h3><p className="mt-1 text-xs text-slate-500">Tenant registry across the platform</p></div>
        {loading ? <p className="p-5 text-sm text-slate-500">Loading Village Councils…</p> : error ? <p role="alert" className="p-5 text-sm text-red-700">{error}</p> : councils.length === 0 ? <p className="p-5 text-sm text-slate-500">No Village Councils have been registered.</p> :
          <div className="divide-y divide-slate-100">{councils.map(council => {
            const count = memberships.filter(m => m.village_council_id === council.id && m.is_active).length;
            return <div key={council.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-medium text-slate-900">{council.name}</p><p className="mt-1 text-xs text-slate-500">{council.slug} · {count} active account{count === 1 ? "" : "s"}</p></div>
              <span className={council.is_active ? "w-fit rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700" : "w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"}>{council.is_active ? "Active" : "Suspended"}</span>
            </div>;
          })}</div>}
      </section>
      <p className="text-xs text-slate-400">Platform-level changes are not enabled in this initial dashboard. Tenant creation, account provisioning and suspension will be added with audited server-side operations.</p>
    </div>
  </main>;
}

export default function SuperadminPage() {
  return <SuperadminGate><SuperadminDashboard /></SuperadminGate>;
}
