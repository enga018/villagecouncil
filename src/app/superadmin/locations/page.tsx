"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import SuperadminGate from "@/components/app/SuperadminGate";

type Counts = { states: number; districts: number; blocks: number; panchayats: number };
type StateEntry = { name: string; url: string };
type SourceResult = { success?: boolean; entries?: StateEntry[]; error?: string };

function LocationMaster() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fetchingStates, setFetchingStates] = useState(false);
  const [states, setStates] = useState<StateEntry[]>([]);
  const [sourceMessage, setSourceMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function loadCounts() {
      try {
        const supabase = createClient();
        const tables = ["location_states", "location_districts", "location_blocks", "location_panchayats"] as const;
        const results = await Promise.all(tables.map(table => supabase.from(table).select("id", { count: "exact", head: true })));
        const failed = results.find(result => result.error);
        if (failed?.error) throw failed.error;
        if (active) setCounts({ states: results[0].count ?? 0, districts: results[1].count ?? 0, blocks: results[2].count ?? 0, panchayats: results[3].count ?? 0 });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load location master data.");
      } finally { if (active) setLoading(false); }
    }
    void loadCounts();
    return () => { active = false; };
  }, []);

  async function loadOfficialStates() {
    setFetchingStates(true); setError(""); setSourceMessage("");
    try {
      const supabase = createClient();
      const { data, error: invokeError } = await supabase.functions.invoke<SourceResult>("location-master-source", { body: { action: "states" } });
      if (invokeError) {
        let message = invokeError.message || "Could not contact the location source.";
        const context = invokeError.context as Response | undefined;
        if (context && typeof context.json === "function") {
          try { const detail = await context.json() as { error?: string }; if (detail.error) message = detail.error; } catch {}
        }
        throw new Error(message);
      }
      if (!data?.success || !Array.isArray(data.entries) || !data.entries.length) throw new Error(data?.error || "The official State list was empty or could not be parsed.");
      setStates(data.entries);
      setSourceMessage(`Retrieved ${data.entries.length} State/UT entries from VBGRAMG. Nothing has been imported yet.`);
    } catch (err) {
      setStates([]);
      setError(err instanceof Error ? err.message : "Unable to retrieve the official State list.");
    } finally { setFetchingStates(false); }
  }

  const items = [
    { label: "States / UTs", value: counts?.states }, { label: "Districts", value: counts?.districts },
    { label: "Blocks", value: counts?.blocks }, { label: "Panchayats", value: counts?.panchayats },
  ];

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div><Link href="/superadmin" className="text-xs font-semibold uppercase tracking-widest text-blue-700 hover:text-blue-800">Platform administration</Link><h1 className="mt-1 text-xl font-bold tracking-tight">Location Master</h1></div>
        <Link href="/superadmin" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to Superadmin</Link>
      </div>
    </header>
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <section><h2 className="text-2xl font-bold tracking-tight">Official location directory</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">Manage the shared State, District, Block and Panchayat hierarchy used when Village Councils complete their location setup.</p></section>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(item => <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading ? "—" : (item.value ?? 0).toLocaleString("en-IN")}</p></div>)}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold">Import from VBGRAMG</h3><p className="mt-1 max-w-2xl text-sm text-slate-500">Retrieve the official nationwide State and Union Territory list. Names and payload links are extracted from the Government page; this step does not write location records.</p></div><span className="w-fit rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Read-only source fetch</span></div>
        <button type="button" onClick={loadOfficialStates} disabled={fetchingStates} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">{fetchingStates ? "Loading official State list…" : states.length ? "Refresh State list" : "Load State List"}</button>
        {sourceMessage && <p role="status" className="mt-3 text-sm text-emerald-700">{sourceMessage}</p>}
        {states.length > 0 && <div className="mt-5"><div className="mb-3 flex items-center justify-between gap-3"><h4 className="font-semibold">States and Union Territories</h4><span className="text-xs text-slate-500">{states.length} entries</span></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{states.map(state => <a key={state.url} href={state.url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 hover:border-blue-300 hover:bg-blue-50"><span>{state.name}</span><span aria-hidden="true" className="text-blue-700">↗</span></a>)}</div>
          <p className="mt-3 text-xs text-slate-500">Selecting an entry opens its official VBGRAMG payload link in a new tab. The list is not yet saved to Location Master.</p>
        </div>}
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-medium text-slate-800">Import safeguards</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600"><li>Nationwide coverage across all States and Union Territories.</li><li>Preserve exact official spelling, capitalization, spaces and source identifiers.</li><li>Maintain the parent-child hierarchy at every level.</li><li>Preview changes before applying an import; do not silently overwrite existing records.</li><li>Deactivate obsolete locations instead of deleting locations already assigned to councils.</li></ul></div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h3 className="font-semibold">Location hierarchy</h3><p className="mt-1 text-sm text-slate-500">The directory is shared platform reference data. Village Council accounts can select active locations but cannot edit this master list.</p><div className="mt-4 grid gap-3 md:grid-cols-4">{[["01","State / UT","Top-level location"],["02","District","Belongs to a State / UT"],["03","Block","Belongs to a District"],["04","Panchayat","Belongs to a Block"]].map(([number,title,description]) => <div key={number} className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold text-blue-700">{number}</p><p className="mt-2 font-semibold">{title}</p><p className="mt-1 text-xs text-slate-500">{description}</p></div>)}</div></section>
    </div>
  </main>;
}
export default function SuperadminLocationsPage() { return <SuperadminGate><LocationMaster /></SuperadminGate>; }
