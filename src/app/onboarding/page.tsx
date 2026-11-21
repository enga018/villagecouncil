"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type SourceEntry = { name: string; url: string };
type SourceResult = { success?: boolean; entries?: SourceEntry[]; error?: string };
function isAuthenticationFailure(error: unknown, response?: Response) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return response?.status === 401 || /auth session missing|authentication required|invalid or expired session|jwt expired|unauthorized|\b401\b/.test(message);
}

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
  const [locationSaved, setLocationSaved] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const [savedLocation, setSavedLocation] = useState<{ state: string; district: string; block: string; village: string } | null>(null);
  const [error, setError] = useState("");

  function returnToLogin() {
    const requestedPath = window.location.pathname + window.location.search;
    router.replace(`/login?next=${encodeURIComponent(requestedPath)}`);
  }

  async function fetchLocations(action: "states" | "districts" | "blocks" | "panchayats", selectedNames: string[] = []) {
    const { data, error: invokeError } = await createClient().functions.invoke<SourceResult>("location-master-source", {
      body: { action, selectedNames },
    });
    if (invokeError) {
      let message = invokeError.message || "Could not contact the official location source.";
      const context = invokeError.context as Response | undefined;
      if (isAuthenticationFailure(invokeError, context)) {
        returnToLogin();
        throw new Error("Your session has expired. Returning you to sign in…");
      }
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
        if (!user) { returnToLogin(); return; }

        const { data: membership, error: membershipError } = await supabase
          .from("council_memberships").select("village_council_id")
          .eq("user_id", user.id).eq("is_active", true).maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) throw new Error("This account has no active Village Council assignment.");

        const { data: council, error: councilError } = await supabase
          .from("council_tenants")
          .select("id,name,onboarding_completed_at,state,district,block,village,block_url,panchayat_url")
          .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
        if (councilError) throw councilError;
        if (!council) throw new Error("The assigned Village Council is unavailable.");
        if (council.onboarding_completed_at) { router.replace("/dashboard"); return; }
        if (active) {
          setCouncilId(council.id);
          setCouncilName(council.name);
          if (council.state && council.district && council.block && council.village) {
            setLocationSaved(true);
            setSavedLocation({ state: council.state, district: council.district, block: council.block, village: council.village });
          }
        }

        const entries = await fetchLocations("states");
        if (active) setStates(entries);
        if (active && council.state && council.district && council.block && council.village) {
          const selectedState = entries.find(entry => entry.name === council.state);
          if (selectedState) {
            setStateUrl(selectedState.url);
            const districtEntries = await fetchLocations("districts", [selectedState.name]);
            if (!active) return;
            setDistricts(districtEntries);
            const selectedDistrict = districtEntries.find(entry => entry.name === council.district);
            if (selectedDistrict) {
              setDistrictUrl(selectedDistrict.url);
              const blockEntries = await fetchLocations("blocks", [selectedState.name, selectedDistrict.name]);
              if (!active) return;
              setBlocks(blockEntries);
              const selectedBlock = blockEntries.find(entry => entry.name === council.block);
              if (selectedBlock) {
                setBlockUrl(selectedBlock.url);
                const panchayatEntries = await fetchLocations("panchayats", [selectedState.name, selectedDistrict.name, selectedBlock.name]);
                if (!active) return;
                setPanchayats(panchayatEntries);
                const selectedPanchayat = panchayatEntries.find(entry => entry.name === council.village);
                if (selectedPanchayat) setPanchayatUrl(selectedPanchayat.url);
              }
            }
          }
        }
      } catch (err) {
        if (active && isAuthenticationFailure(err)) { returnToLogin(); return; }
        if (active) setError(err instanceof Error ? err.message : "Unable to load your Village Council setup.");
      } finally {
        if (active) { setLoading(false); setLoadingStates(false); }
      }
    }
    void loadCouncilAndStates();
    return () => { active = false; };
  }, [router]);

  async function selectState(url: string, name: string) {
    setLocationSaved(false);
    setStateUrl(url); setDistrictUrl(""); setBlockUrl(""); setPanchayatUrl("");
    setDistricts([]); setBlocks([]); setPanchayats([]); setError("");
    if (!url) return;
    setLoadingDistricts(true);
    try { setDistricts(await fetchLocations("districts", [name])); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to retrieve Districts."); }
    finally { setLoadingDistricts(false); }
  }

  async function selectDistrict(url: string, name: string) {
    setLocationSaved(false);
    setDistrictUrl(url); setBlockUrl(""); setPanchayatUrl("");
    setBlocks([]); setPanchayats([]); setError("");
    if (!url) return;
    setLoadingBlocks(true);
    try { setBlocks(await fetchLocations("blocks", [states.find(entry => entry.url === stateUrl)?.name || "", name])); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to retrieve Blocks."); }
    finally { setLoadingBlocks(false); }
  }

  async function selectBlock(url: string, name: string) {
    setLocationSaved(false);
    setBlockUrl(url); setPanchayatUrl(""); setPanchayats([]); setError("");
    if (!url) return;
    setLoadingPanchayats(true);
    try { setPanchayats(await fetchLocations("panchayats", [states.find(entry => entry.url === stateUrl)?.name || "", districts.find(entry => entry.url === districtUrl)?.name || "", name])); }
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
        .from("council_tenants")
        .update({
          state: state.name,
          district: district.name,
          block: block.name,
          village: panchayat.name,
          block_url: block.url,
          panchayat_url: panchayat.url,
          updated_at: now,
        })
        .eq("id", councilId);
      if (updateError) throw updateError;
      setLocationSaved(true);
      setSavedLocation({ state: state.name, district: district.name, block: block.name, village: panchayat.name });
      router.push("/onboarding/job-cards");
    } catch (err) {
      if (isAuthenticationFailure(err)) { returnToLogin(); return; }
      setError(err instanceof Error ? err.message : "Unable to save the Village Council location.");
    } finally { setSaving(false); }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Loading your Village Council setup…</p></main>;

  const dropdownClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-100";

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <div className="w-full max-w-2xl">
      <div className="mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-700 text-sm font-bold text-white">VC</div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-blue-700">First-time setup · 4 steps</p>
        <ol className="mt-4 grid grid-cols-4 gap-2 text-center">
          {["Location", "Job Cards", "FTOs", "Review"].map((step, index) => <li key={step} className="min-w-0">
            <div className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${index === 0 && locationSaved ? "bg-emerald-600 text-white" : index === 0 ? "bg-blue-700 text-white" : "bg-slate-200 text-slate-500"}`}>{index === 0 && locationSaved ? "✓" : index + 1}</div>
            <p className={`mt-1 truncate text-[11px] font-medium ${index === 0 && locationSaved ? "text-emerald-700" : index === 0 ? "text-blue-700" : "text-slate-400"}`}>{step}</p>
          </li>)}
        </ol>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Set up your Village Council</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{locationSaved && !editingLocation ? "Your official administrative location is confirmed. Continue with the next setup step." : `Welcome${councilName ? ` to ${councilName}` : ""}. Select your official administrative location.`}</p>
      </div>
      <form onSubmit={saveLocation} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {locationSaved && !editingLocation && savedLocation ? <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Government location</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600"/>Saved</span>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-950">{savedLocation.village}</h2>
            <p className="mt-1 text-sm text-slate-600">{savedLocation.district} District · {savedLocation.block} Block</p>
            <p className="mt-1 text-xs text-slate-500">{savedLocation.state}</p>
          </div>
          <button type="button" onClick={() => setEditingLocation(true)} className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Change location</button>
          <button type="button" onClick={() => router.push("/onboarding/job-cards")} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800">Continue to Step 2 <span aria-hidden="true">→</span></button>
          <p className="text-center text-xs text-slate-400">Your workspace remains inactive until all onboarding steps are complete.</p>
        </> : <>
          {editingLocation && <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-900">Update Government location</p><button type="button" onClick={() => { setEditingLocation(false); setError(""); }} className="text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</button></div>}
          <div className="space-y-4">
            <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">1. State / UT</span><select required value={stateUrl} onChange={event => void selectState(event.target.value, event.target.selectedOptions[0]?.text || "")} disabled={loadingStates} className={dropdownClass}><option value="">{loadingStates ? "Loading States / UTs…" : "Select a State / UT"}</option>{states.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>
            {(stateUrl || loadingDistricts) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">2. District</span><select required value={districtUrl} onChange={event => void selectDistrict(event.target.value, event.target.selectedOptions[0]?.text || "")} disabled={loadingDistricts || !districts.length} className={dropdownClass}><option value="">{loadingDistricts ? "Fetching Districts…" : "Select a District"}</option>{districts.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
            {(districtUrl || loadingBlocks) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">3. Block</span><select required value={blockUrl} onChange={event => void selectBlock(event.target.value, event.target.selectedOptions[0]?.text || "")} disabled={loadingBlocks || !blocks.length} className={dropdownClass}><option value="">{loadingBlocks ? "Fetching Blocks…" : "Select a Block"}</option>{blocks.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
            {(blockUrl || loadingPanchayats) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">4. Panchayat / Village</span><select required value={panchayatUrl} onChange={event => { setLocationSaved(false); setPanchayatUrl(event.target.value); }} disabled={loadingPanchayats || !panchayats.length} className={dropdownClass}><option value="">{loadingPanchayats ? "Fetching Panchayats…" : "Select a Panchayat / Village"}</option>{panchayats.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
          <div className="border-t border-slate-100 pt-4">
            <button type="submit" disabled={saving || !councilId || !stateUrl || !districtUrl || !blockUrl || !panchayatUrl || loadingDistricts || loadingBlocks || loadingPanchayats} className="w-full rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Saving location…" : editingLocation ? "Save & Continue" : "Save & Continue"}</button>
            <p className="mt-3 text-center text-xs text-slate-400">Saving this location does not complete onboarding or activate the workspace.</p>
          </div>
        </>}
      </form>
    </div>
  </main>;
}
