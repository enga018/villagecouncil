"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type SourceEntry = { name: string; url: string };
type SourceResult = { success?: boolean; entries?: SourceEntry[]; error?: string };

export default function OnboardingPage() {
  const router = useRouter();
  const [councilId, setCouncilId] = useState("");
  const [councilName, setCouncilName] = useState("");
  const [states, setStates] = useState<SourceEntry[]>([]);
  const [districts, setDistricts] = useState<SourceEntry[]>([]);
  const [blocks, setBlocks] = useState<SourceEntry[]>([]);
  const [panchayats, setPanchayats] = useState<SourceEntry[]>([]);
  const [stateUrl, setStateUrl] = useState("");
  const [districtUrl, setDistrictUrl] = useState("");
  const [blockUrl, setBlockUrl] = useState("");
  const [panchayatUrl, setPanchayatUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingStates, setLoadingStates] = useState(true);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [loadingPanchayats, setLoadingPanchayats] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function fetchLocations(action: "states" | "districts" | "blocks" | "panchayats", parentUrl?: string) {
    const { data, error: invokeError } = await createClient().functions.invoke<SourceResult>("location-master-source", {
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
      throw new Error(data?.error || "The official location list was empty or could not be parsed.");
    }
    return data.entries;
  }

  useEffect(() => {
    let active = true;
    async function loadCouncilAndStates() {
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) { router.replace("/login"); return; }

        const { data: membership, error: membershipError } = await supabase
          .from("memberships").select("village_council_id")
          .eq("user_id", user.id).eq("is_active", true).maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) throw new Error("This account has no active Village Council assignment.");

        const { data: council, error: councilError } = await supabase
          .from("village_councils")
          .select("id,name,onboarding_completed_at")
          .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
        if (councilError) throw councilError;
        if (!council) throw new Error("The assigned Village Council is unavailable.");
        if (council.onboarding_completed_at) { router.replace("/dashboard"); return; }
        if (active) { setCouncilId(council.id); setCouncilName(council.name); }

        const entries = await fetchLocations("states");
        if (active) setStates(entries);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load your Village Council setup.");
      } finally {
        if (active) { setLoading(false); setLoadingStates(false); }
      }
    }
    void loadCouncilAndStates();
    return () => { active = false; };
  }, [router]);

  async function selectState(url: string) {
    setStateUrl(url); setDistrictUrl(""); setBlockUrl(""); setPanchayatUrl("");
    setDistricts([]); setBlocks([]); setPanchayats([]); setError("");
    if (!url) return;
    setLoadingDistricts(true);
    try { setDistricts(await fetchLocations("districts", url)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to retrieve Districts."); }
    finally { setLoadingDistricts(false); }
  }

  async function selectDistrict(url: string) {
    setDistrictUrl(url); setBlockUrl(""); setPanchayatUrl("");
    setBlocks([]); setPanchayats([]); setError("");
    if (!url) return;
    setLoadingBlocks(true);
    try { setBlocks(await fetchLocations("blocks", url)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to retrieve Blocks."); }
    finally { setLoadingBlocks(false); }
  }

  async function selectBlock(url: string) {
    setBlockUrl(url); setPanchayatUrl(""); setPanchayats([]); setError("");
    if (!url) return;
    setLoadingPanchayats(true);
    try { setPanchayats(await fetchLocations("panchayats", url)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to retrieve Panchayats."); }
    finally { setLoadingPanchayats(false); }
  }

  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!councilId) return;
    const state = states.find(entry => entry.url === stateUrl);
    const district = districts.find(entry => entry.url === districtUrl);
    const block = blocks.find(entry => entry.url === blockUrl);
    const panchayat = panchayats.find(entry => entry.url === panchayatUrl);
    if (!state || !district || !block || !panchayat) {
      setError("Select a State / UT, District, Block and Panchayat before continuing.");
      return;
    }
    setSaving(true); setError("");
    try {
      const now = new Date().toISOString();
      const { error: updateError } = await createClient()
        .from("village_councils")
        .update({
          state: state.name,
          district: district.name,
          block: block.name,
          village: panchayat.name,
          onboarding_completed_at: now,
          updated_at: now,
        })
        .eq("id", councilId);
      if (updateError) throw updateError;
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the Village Council location.");
    } finally { setSaving(false); }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Loading your Village Council setup…</p></main>;

  const dropdownClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-100";

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <div className="w-full max-w-2xl">
      <div className="mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-700 text-sm font-bold text-white">VC</div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-blue-700">First-time setup</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Set up your Village Council</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Welcome{councilName ? ` to ${councilName}` : ""}. Select your official administrative location. You can update these details later in Settings.</p>
      </div>
      <form onSubmit={saveLocation} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">1. State / UT</span><select required value={stateUrl} onChange={event => void selectState(event.target.value)} disabled={loadingStates} className={dropdownClass}><option value="">{loadingStates ? "Loading States / UTs…" : "Select a State / UT"}</option>{states.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>
          {(stateUrl || loadingDistricts) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">2. District</span><select required value={districtUrl} onChange={event => void selectDistrict(event.target.value)} disabled={loadingDistricts || !districts.length} className={dropdownClass}><option value="">{loadingDistricts ? "Fetching Districts…" : "Select a District"}</option>{districts.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
          {(districtUrl || loadingBlocks) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">3. Block</span><select required value={blockUrl} onChange={event => void selectBlock(event.target.value)} disabled={loadingBlocks || !blocks.length} className={dropdownClass}><option value="">{loadingBlocks ? "Fetching Blocks…" : "Select a Block"}</option>{blocks.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
          {(blockUrl || loadingPanchayats) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">4. Panchayat / Village</span><select required value={panchayatUrl} onChange={event => setPanchayatUrl(event.target.value)} disabled={loadingPanchayats || !panchayats.length} className={dropdownClass}><option value="">{loadingPanchayats ? "Fetching Panchayats…" : "Select a Panchayat / Village"}</option>{panchayats.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">All four official location levels are required to activate your workspace.</p>
          <button type="submit" disabled={saving || !councilId || !stateUrl || !districtUrl || !blockUrl || !panchayatUrl || loadingDistricts || loadingBlocks || loadingPanchayats} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Saving setup…" : "Complete setup"}</button>
        </div>
      </form>
    </div>
  </main>;
}
