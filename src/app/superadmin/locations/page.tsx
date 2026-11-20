"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import SuperadminGate from "@/components/app/SuperadminGate";

type Counts = { states: number; districts: number; blocks: number; panchayats: number };
type SourceEntry = { name: string; url: string };
type SourceResult = { success?: boolean; entries?: SourceEntry[]; error?: string };

function LocationMaster() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [error, setError] = useState("");
  const [states, setStates] = useState<SourceEntry[]>([]);
  const [districts, setDistricts] = useState<SourceEntry[]>([]);
  const [blocks, setBlocks] = useState<SourceEntry[]>([]);
  const [panchayats, setPanchayats] = useState<SourceEntry[]>([]);
  const [selectedStateUrl, setSelectedStateUrl] = useState("");
  const [selectedDistrictUrl, setSelectedDistrictUrl] = useState("");
  const [selectedBlockUrl, setSelectedBlockUrl] = useState("");
  const [selectedPanchayatUrl, setSelectedPanchayatUrl] = useState("");
  const [loadingStates, setLoadingStates] = useState(true);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [loadingPanchayats, setLoadingPanchayats] = useState(false);

  async function invokeSource(action: "states" | "districts" | "blocks" | "panchayats", parentUrl?: string) {
    const supabase = createClient();
    const { data, error: invokeError } = await supabase.functions.invoke<SourceResult>("location-master-source", {
      body: action === "states" ? { action } : { action, parentUrl },
    });
    if (invokeError) {
      let message = invokeError.message || "Could not contact the official location source.";
      const context = invokeError.context as Response | undefined;
      if (context && typeof context.json === "function") {
        try { const detail = await context.json() as { error?: string }; if (detail.error) message = detail.error; } catch {}
      }
      throw new Error(message);
    }
    if (!data?.success || !Array.isArray(data.entries) || !data.entries.length) {
      throw new Error(data?.error || "The official list was empty or could not be parsed.");
    }
    return data.entries;
  }

  useEffect(() => {
    let active = true;
    async function loadInitialData() {
      try {
        const supabase = createClient();
        const tables = ["location_states", "location_districts", "location_blocks", "location_panchayats"] as const;
        const results = await Promise.all(tables.map(table => supabase.from(table).select("id", { count: "exact", head: true })));
        const failed = results.find(result => result.error);
        if (failed?.error) throw failed.error;
        if (active) setCounts({
          states: results[0].count ?? 0,
          districts: results[1].count ?? 0,
          blocks: results[2].count ?? 0,
          panchayats: results[3].count ?? 0,
        });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load location master data.");
      } finally {
        if (active) setLoadingCounts(false);
      }
      try {
        const entries = await invokeSource("states");
        if (active) setStates(entries);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to retrieve the official State / UT list.");
      } finally {
        if (active) setLoadingStates(false);
      }
    }
    void loadInitialData();
    return () => { active = false; };
  }, []);

  async function selectState(url: string) {
    setSelectedStateUrl(url);
    setSelectedDistrictUrl(""); setSelectedBlockUrl(""); setSelectedPanchayatUrl("");
    setDistricts([]); setBlocks([]); setPanchayats([]);
    setError("");
    if (!url) return;
    setLoadingDistricts(true);
    try { setDistricts(await invokeSource("districts", url)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to retrieve Districts."); }
    finally { setLoadingDistricts(false); }
  }

  async function selectDistrict(url: string) {
    setSelectedDistrictUrl(url);
    setSelectedBlockUrl(""); setSelectedPanchayatUrl("");
    setBlocks([]); setPanchayats([]);
    setError("");
    if (!url) return;
    setLoadingBlocks(true);
    try { setBlocks(await invokeSource("blocks", url)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to retrieve Blocks."); }
    finally { setLoadingBlocks(false); }
  }

  async function selectBlock(url: string) {
    setSelectedBlockUrl(url);
    setSelectedPanchayatUrl("");
    setPanchayats([]);
    setError("");
    if (!url) return;
    setLoadingPanchayats(true);
    try { setPanchayats(await invokeSource("panchayats", url)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to retrieve Panchayats."); }
    finally { setLoadingPanchayats(false); }
  }

  const items = [
    { label: "States / UTs", value: counts?.states },
    { label: "Districts", value: counts?.districts },
    { label: "Blocks", value: counts?.blocks },
    { label: "Panchayats", value: counts?.panchayats },
  ];

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8"><div><Link href="/superadmin" className="text-xs font-semibold uppercase tracking-widest text-blue-700 hover:text-blue-800">Platform administration</Link><h1 className="mt-1 text-xl font-bold tracking-tight">Location Master</h1></div><Link href="/superadmin" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to Superadmin</Link></div></header>
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <section><h2 className="text-2xl font-bold tracking-tight">Official location directory</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">Choose each level in sequence. Every next dropdown is populated from the official VBGRAMG website after its parent is selected.</p></section>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{items.map(item => <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{loadingCounts ? "—" : (item.value ?? 0).toLocaleString("en-IN")}</p></div>)}</section>
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold">Browse official locations</h3><p className="mt-1 max-w-2xl text-sm text-slate-500">The State / UT list loads automatically when this page opens. Select a location to reveal the next dropdown.</p></div><span className="w-fit rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Read-only preview</span></div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">1. State / UT</span><select value={selectedStateUrl} onChange={event => void selectState(event.target.value)} disabled={loadingStates} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"><option value="">{loadingStates ? "Loading States / UTs…" : "Select a State / UT"}</option>{states.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>
          {(selectedStateUrl || loadingDistricts) && <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">2. District</span><select value={selectedDistrictUrl} onChange={event => void selectDistrict(event.target.value)} disabled={loadingDistricts || !districts.length} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"><option value="">{loadingDistricts ? "Fetching Districts…" : "Select a District"}</option>{districts.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
          {(selectedDistrictUrl || loadingBlocks) && <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">3. Block</span><select value={selectedBlockUrl} onChange={event => void selectBlock(event.target.value)} disabled={loadingBlocks || !blocks.length} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"><option value="">{loadingBlocks ? "Fetching Blocks…" : "Select a Block"}</option>{blocks.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
          {(selectedBlockUrl || loadingPanchayats) && <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">4. Panchayat</span><select value={selectedPanchayatUrl} onChange={event => setSelectedPanchayatUrl(event.target.value)} disabled={loadingPanchayats || !panchayats.length} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"><option value="">{loadingPanchayats ? "Fetching Panchayats…" : "Select a Panchayat"}</option>{panchayats.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-medium text-slate-800">Import safeguards</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600"><li>Preserve exact official spelling, capitalization, spaces and source payloads.</li><li>Each child list is fetched only after selecting its parent.</li><li>Browsing does not write anything to the database.</li><li>Obsolete assigned locations will be deactivated, not deleted.</li></ul></div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h3 className="font-semibold">Location hierarchy</h3><div className="mt-4 grid gap-3 md:grid-cols-4">{[["01","State / UT","Top-level location"],["02","District","Belongs to a State / UT"],["03","Block","Belongs to a District"],["04","Panchayat","Belongs to a Block"]].map(([number,title,description]) => <div key={number} className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold text-blue-700">{number}</p><p className="mt-2 font-semibold">{title}</p><p className="mt-1 text-xs text-slate-500">{description}</p></div>)}</div></section>
    </div>
  </main>;
}
export default function SuperadminLocationsPage() { return <SuperadminGate><LocationMaster /></SuperadminGate>; }
