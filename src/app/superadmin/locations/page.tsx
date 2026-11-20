"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import SuperadminGate from "@/components/app/SuperadminGate";

type Counts = { states: number; districts: number; blocks: number; panchayats: number };
type SourceEntry = { name: string; url: string };
type SourceResult = { success?: boolean; entries?: SourceEntry[]; error?: string; diagnostic?: Record<string, unknown> };

function LocationMaster() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fetchingStates, setFetchingStates] = useState(false);
  const [fetchingDistricts, setFetchingDistricts] = useState(false);
  const [states, setStates] = useState<SourceEntry[]>([]);
  const [selectedStateUrl, setSelectedStateUrl] = useState("");
  const [districts, setDistricts] = useState<SourceEntry[]>([]);
  const [selectedDistrictUrl, setSelectedDistrictUrl] = useState("");
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

  async function invokeSource<T extends SourceResult>(body: Record<string, unknown>) {
    const supabase = createClient();
    const { data, error: invokeError } = await supabase.functions.invoke<T>("location-master-source", { body });
    if (invokeError) {
      let message = invokeError.message || "Could not contact the location source.";
      const context = invokeError.context as Response | undefined;
      if (context && typeof context.json === "function") {
        try { const detail = await context.json() as { error?: string }; if (detail.error) message = detail.error; } catch {}
      }
      throw new Error(message);
    }
    if (!data?.success || !Array.isArray(data.entries) || !data.entries.length) throw new Error(data?.error || "The official list was empty or could not be parsed.");
    return data.entries;
  }

  async function loadOfficialStates() {
    setFetchingStates(true); setError(""); setSourceMessage(""); setDistricts([]); setSelectedDistrictUrl("");
    try {
      const entries = await invokeSource({ action: "states" });
      setStates(entries);
      setSourceMessage(`Retrieved ${entries.length} State/UT entries from VBGRAMG. Nothing has been imported.`);
      if (!selectedStateUrl || !entries.some(entry => entry.url === selectedStateUrl)) setSelectedStateUrl("");
    } catch (err) {
      setStates([]); setSelectedStateUrl("");
      setError(err instanceof Error ? err.message : "Unable to retrieve the official State list.");
    } finally { setFetchingStates(false); }
  }

  async function fetchDistricts() {
    const selected = states.find(entry => entry.url === selectedStateUrl);
    if (!selected) return;
    // Open the selected official State link directly from the user gesture.
    window.open(selected.url, "_blank", "noopener,noreferrer");
    setFetchingDistricts(true); setError(""); setSourceMessage(""); setDistricts([]); setSelectedDistrictUrl("");
    try {
      const entries = await invokeSource({ action: "districts", stateUrl: selected.url });
      setDistricts(entries);
      setSourceMessage(`Retrieved ${entries.length} District entries for ${selected.name}. Nothing has been imported.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to retrieve the District list.");
    } finally { setFetchingDistricts(false); }
  }

  const items = [
    { label: "States / UTs", value: counts?.states }, { label: "Districts", value: counts?.districts },
    { label: "Blocks", value: counts?.blocks }, { label: "Panchayats", value: counts?.panchayats },
  ];

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8"><div><Link href="/superadmin" className="text-xs font-semibold uppercase tracking-widest text-blue-700 hover:text-blue-800">Platform administration</Link><h1 className="mt-1 text-xl font-bold tracking-tight">Location Master</h1></div><Link href="/superadmin" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to Superadmin</Link></div></header>
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <section><h2 className="text-2xl font-bold tracking-tight">Official location directory</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">Retrieve the official State, District, Block and Panchayat hierarchy before importing it into the shared directory.</p></section>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{items.map(item => <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading ? "—" : (item.value ?? 0).toLocaleString("en-IN")}</p></div>)}</section>
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold">Import from VBGRAMG</h3><p className="mt-1 max-w-2xl text-sm text-slate-500">Choose a location level, fetch its child list from the official website, and review the results in the next dropdown. This is a read-only preview.</p></div><span className="w-fit rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">No database writes</span></div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">State / UT</span><select value={selectedStateUrl} onChange={event => { setSelectedStateUrl(event.target.value); setDistricts([]); setSelectedDistrictUrl(""); setSourceMessage(""); }} disabled={!states.length || fetchingStates || fetchingDistricts} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"><option value="">{states.length ? "Select a State / UT" : "Load the State list first"}</option>{states.map(state => <option key={state.url} value={state.url}>{state.name}</option>)}</select></label>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={loadOfficialStates} disabled={fetchingStates || fetchingDistricts} className="min-h-12 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{fetchingStates ? "Loading…" : states.length ? "Refresh States" : "Load States"}</button><button type="button" onClick={fetchDistricts} disabled={!selectedStateUrl || fetchingDistricts || fetchingStates} className="min-h-12 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">{fetchingDistricts ? "Fetching Districts…" : "Open & Fetch Districts"}</button></div>
        </div>
        {districts.length > 0 && <label className="block max-w-2xl"><span className="mb-2 block text-sm font-medium text-slate-700">District</span><select value={selectedDistrictUrl} onChange={event => setSelectedDistrictUrl(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"><option value="">Select a District</option>{districts.map(district => <option key={district.url} value={district.url}>{district.name}</option>)}</select></label>}
        {sourceMessage && <p role="status" className="text-sm text-emerald-700">{sourceMessage}</p>}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-medium text-slate-800">Import safeguards</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600"><li>Preserve exact official spelling, capitalization, spaces and source payloads.</li><li>Each child list is fetched only after selecting its parent.</li><li>Review every level before any database import.</li><li>Obsolete assigned locations will be deactivated, not deleted.</li></ul></div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h3 className="font-semibold">Location hierarchy</h3><div className="mt-4 grid gap-3 md:grid-cols-4">{[["01","State / UT","Top-level location"],["02","District","Belongs to a State / UT"],["03","Block","Belongs to a District"],["04","Panchayat","Belongs to a Block"]].map(([number,title,description]) => <div key={number} className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold text-blue-700">{number}</p><p className="mt-2 font-semibold">{title}</p><p className="mt-1 text-xs text-slate-500">{description}</p></div>)}</div></section>
    </div>
  </main>;
}
export default function SuperadminLocationsPage() { return <SuperadminGate><LocationMaster /></SuperadminGate>; }
