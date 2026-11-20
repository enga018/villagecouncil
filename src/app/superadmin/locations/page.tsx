"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import SuperadminGate from "@/components/app/SuperadminGate";

type Counts = { states: number; districts: number; blocks: number; panchayats: number };

function LocationMaster() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadCounts() {
      setLoading(true);
      setError("");
      try {
        const supabase = createClient();
        const tables = ["location_states", "location_districts", "location_blocks", "location_panchayats"] as const;
        const results = await Promise.all(tables.map(table => supabase.from(table).select("id", { count: "exact", head: true })));
        const failed = results.find(result => result.error);
        if (failed?.error) throw failed.error;
        if (active) {
          setCounts({
            states: results[0].count ?? 0,
            districts: results[1].count ?? 0,
            blocks: results[2].count ?? 0,
            panchayats: results[3].count ?? 0,
          });
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load location master data.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadCounts();
    return () => { active = false; };
  }, []);

  const items = [
    { label: "States / UTs", value: counts?.states },
    { label: "Districts", value: counts?.districts },
    { label: "Blocks", value: counts?.blocks },
    { label: "Panchayats", value: counts?.panchayats },
  ];

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div>
          <Link href="/superadmin" className="text-xs font-semibold uppercase tracking-widest text-blue-700 hover:text-blue-800">Platform administration</Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight">Location Master</h1>
        </div>
        <Link href="/superadmin" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to Superadmin</Link>
      </div>
    </header>

    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <section>
        <h2 className="text-2xl font-bold tracking-tight">Official location directory</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">Manage the shared State, District, Block and Panchayat hierarchy used when Village Councils complete their location setup.</p>
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(item => <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">{item.label}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums">{loading ? "—" : (item.value ?? 0).toLocaleString("en-IN")}</p>
        </div>)}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">Import from VBGRAMG</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">The official website will be the source for the nationwide location directory. The import must follow its State → District → Block → Panchayat navigation and preserve every official name exactly as published.</p>
          </div>
          <span className="w-fit rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Importer not connected yet</span>
        </div>
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-800">Import safeguards</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Nationwide coverage across all States and Union Territories.</li>
            <li>Preserve exact official spelling, capitalization, spaces and source identifiers.</li>
            <li>Maintain the parent-child hierarchy at every level.</li>
            <li>Preview changes before applying an import; do not silently overwrite existing records.</li>
            <li>Deactivate obsolete locations instead of deleting locations already assigned to councils.</li>
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="font-semibold">Location hierarchy</h3>
        <p className="mt-1 text-sm text-slate-500">The directory is shared platform reference data. Village Council accounts can select active locations but cannot edit this master list.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ["01", "State / UT", "Top-level location"],
            ["02", "District", "Belongs to a State / UT"],
            ["03", "Block", "Belongs to a District"],
            ["04", "Panchayat", "Belongs to a Block"],
          ].map(([number, title, description]) => <div key={number} className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-blue-700">{number}</p>
            <p className="mt-2 font-semibold">{title}</p>
            <p className="mt-1 text-xs text-slate-500">{description}</p>
          </div>)}
        </div>
      </section>
    </div>
  </main>;
}

export default function SuperadminLocationsPage() {
  return <SuperadminGate><LocationMaster /></SuperadminGate>;
}
