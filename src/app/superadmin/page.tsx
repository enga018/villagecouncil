"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import SuperadminGate from "@/components/app/SuperadminGate";

type Council = { id: string; name: string; slug: string; is_active: boolean; created_at: string };
type Membership = { village_council_id: string; is_active: boolean };

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
      setRefreshKey(value => value + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to create the Village Council.");
    } finally {
      setCreating(false);
    }
  }

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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="mb-5"><h3 className="font-semibold">Create Village Council</h3><p className="mt-1 text-sm text-slate-500">Register a new council and invite its administrator. Each council receives one login account.</p></div>
        <form onSubmit={createCouncil} className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="council-name" className="mb-1.5 block text-sm font-medium text-slate-700">Village Council name</label><input id="council-name" required minLength={3} maxLength={120} value={name} onChange={e => { setName(e.target.value); setSlug(slugify(e.target.value)); }} placeholder="e.g. Serchhip Vengthar Village Council" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></div>
          <div><label htmlFor="council-slug" className="mb-1.5 block text-sm font-medium text-slate-700">Unique URL slug</label><input id="council-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={slug} onChange={e => setSlug(slugify(e.target.value))} placeholder="serchhip-vengthar" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></div>
          <div className="sm:col-span-2"><label htmlFor="council-admin-email" className="mb-1.5 block text-sm font-medium text-slate-700">VC administrator email</label><input id="council-admin-email" type="email" required maxLength={254} value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="administrator@example.com" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /><p className="mt-1.5 text-xs text-slate-400">An invitation email will be sent so the administrator can set their password.</p></div>
          {createError && <p role="alert" className="sm:col-span-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{createError}</p>}
          {success && <p role="status" className="sm:col-span-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">{success}</p>}
          <div className="sm:col-span-2"><button type="submit" disabled={creating} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">{creating ? "Creating council and sending invitation…" : "Create Village Council"}</button></div>
        </form>
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
      <p className="text-xs text-slate-400">Creating a council and inviting its first administrator is enabled. Tenant suspension and other privileged changes will be added with audited server-side operations.</p>
    </div>
  </main>;
}

export default function SuperadminPage() {
  return <SuperadminGate><SuperadminDashboard /></SuperadminGate>;
}
