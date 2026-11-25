"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import OnboardingShell from "@/components/app/OnboardingShell";
import OnboardingActions from "@/components/app/OnboardingActions";

type SourceEntry = { name: string; url: string; available?: boolean };
type SourceResult = { success?: boolean; entries?: SourceEntry[]; error?: string };
function isAuthenticationFailure(error: unknown, response?: Response) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return response?.status === 401 || /auth session missing|authentication required|invalid or expired session|jwt expired|unauthorized|\b401\b/.test(message);
}

async function readCachedLocations(
  supabase: ReturnType<typeof createClient>,
  action: "states" | "districts" | "blocks" | "panchayats",
  selectedNames: string[],
): Promise<SourceEntry[]> {
  const mapRows = (rows: { official_name: string; navigation_url: string | null }[] | null): SourceEntry[] =>
    (rows || []).filter((row) => row.navigation_url).map((row) => ({ name: row.official_name, url: row.navigation_url as string }));

  try {
    if (action === "states") {
      const { data } = await supabase.from("location_states").select("official_name,navigation_url").order("official_name");
      return mapRows(data);
    }

    const stateName = selectedNames[0];
    const { data: state } = await supabase.from("location_states").select("id").eq("official_name", stateName).maybeSingle();
    if (!state) return [];

    if (action === "districts") {
      const { data } = await supabase.from("location_districts").select("official_name,navigation_url").eq("state_id", state.id).order("official_name");
      return mapRows(data);
    }

    const districtName = selectedNames[1];
    const { data: district } = await supabase.from("location_districts").select("id").eq("state_id", state.id).eq("official_name", districtName).maybeSingle();
    if (!district) return [];

    if (action === "blocks") {
      const { data } = await supabase.from("location_blocks").select("official_name,navigation_url").eq("district_id", district.id).order("official_name");
      return mapRows(data);
    }

    const blockName = selectedNames[2];
    const { data: block } = await supabase.from("location_blocks").select("id").eq("district_id", district.id).eq("official_name", blockName).maybeSingle();
    if (!block) return [];

    const { data } = await supabase.from("location_panchayats").select("official_name,navigation_url").eq("block_id", block.id).order("official_name");
    return mapRows(data);
  } catch {
    return [];
  }
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

  const returnToLogin = useCallback(() => {
    const requestedPath = window.location.pathname + window.location.search;
    router.replace(`/login?next=${encodeURIComponent(requestedPath)}`);
  }, [router]);

  const fetchLocations = useCallback(async (action: "states" | "districts" | "blocks" | "panchayats", selectedNames: string[] = [], availabilityCouncilId?: string) => {
    const supabase = createClient();
    let entries = await readCachedLocations(supabase, action, selectedNames);
    if (!entries.length) {
      const { data, error: invokeError } = await supabase.functions.invoke<SourceResult>("location-master-source", {
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
      entries = data.entries;
    }

    if (action === "panchayats" && availabilityCouncilId) {
      const { data: unavailableIds, error: unavailableError } = await supabase.rpc("get_unavailable_panchayat_ids", { p_council_id: availabilityCouncilId });
      if (unavailableError) throw unavailableError;
      const [stateName, districtName, blockName] = selectedNames;
      const { data: stateRow, error: stateError } = await supabase.from("location_states").select("id").eq("official_name", stateName).maybeSingle();
      if (stateError || !stateRow) throw stateError || new Error("The selected State is unavailable.");
      const { data: districtRow, error: districtError } = await supabase.from("location_districts").select("id").eq("state_id", stateRow.id).eq("official_name", districtName).maybeSingle();
      if (districtError || !districtRow) throw districtError || new Error("The selected District is unavailable.");
      const { data: blockRow, error: blockError } = await supabase.from("location_blocks").select("id").eq("district_id", districtRow.id).eq("official_name", blockName).maybeSingle();
      if (blockError || !blockRow) throw blockError || new Error("The selected Block is unavailable.");
      const { data: panchayatRows, error: panchayatError } = await supabase.from("location_panchayats").select("id,official_name").eq("block_id", blockRow.id);
      if (panchayatError) throw panchayatError;
      const unavailable = new Set((unavailableIds || []) as string[]);
      const unavailableNames = new Set((panchayatRows || []).filter(row => unavailable.has(row.id)).map(row => row.official_name));
      entries = entries.map(entry => ({ ...entry, available: !unavailableNames.has(entry.name) }));
    }
    return entries;
  }, [returnToLogin]);

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
          .select("id,name,onboarding_completed_at,state,district,block,village,panchayat_url")
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
                const panchayatEntries = await fetchLocations("panchayats", [selectedState.name, selectedDistrict.name, selectedBlock.name], council.id);
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
  }, [router, returnToLogin, fetchLocations]);

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
    try { setPanchayats(await fetchLocations("panchayats", [states.find(entry => entry.url === stateUrl)?.name || "", districts.find(entry => entry.url === districtUrl)?.name || "", name], councilId)); }
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
    const locationChanged = Boolean(savedLocation) && (savedLocation!.state !== state.name || savedLocation!.district !== district.name || savedLocation!.block !== block.name || savedLocation!.village !== panchayat.name);
    if (locationChanged && !window.confirm("Changing the village will permanently delete this council’s previously imported Job Cards, applicants, Register import history, FTO records and FTO import history. This cannot be undone. Continue?")) return;
    setSaving(true); setError("");
    try {
      const supabase = createClient();
      const { error: saveError } = await supabase.rpc("save_council_location", {
        p_council_id: councilId,
        p_state: state.name,
        p_district: district.name,
        p_block: block.name,
        p_village: panchayat.name,
        p_state_url: state.url,
        p_district_url: district.url,
        p_block_url: block.url,
        p_panchayat_url: panchayat.url,
      });
      if (saveError) throw saveError;
      setLocationSaved(true);
      setSavedLocation({ state: state.name, district: district.name, block: block.name, village: panchayat.name });
      const { error: completeError } = await supabase.rpc("complete_council_onboarding", { p_council_id: councilId });
      if (completeError) throw completeError;
      router.replace("/dashboard");
    } catch (err) {
      if (isAuthenticationFailure(err)) { returnToLogin(); return; }
      setError(err instanceof Error ? err.message : "Unable to save the Village Council location.");
    } finally { setSaving(false); }
  }

  async function completeSavedLocation() {
    if (!councilId || saving) return;
    setSaving(true);
    setError("");
    try {
      const { error: completeError } = await createClient().rpc("complete_council_onboarding", { p_council_id: councilId });
      if (completeError) throw completeError;
      router.replace("/dashboard");
    } catch (err) {
      if (isAuthenticationFailure(err)) { returnToLogin(); return; }
      setError(err instanceof Error ? err.message : "Unable to complete onboarding.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Loading your Village Council setup…</p></main>;

  const dropdownClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-100";

  return <OnboardingShell activeStep={0}>
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium text-blue-700">Government location</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Confirm your Government location</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{locationSaved && !editingLocation ? "Your official location is saved. Complete onboarding to open your workspace." : `Welcome${councilName ? ` to ${councilName}` : ""}. Select your official administrative location.`}</p>
      </div>
      <form id="location-form" onSubmit={saveLocation} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
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
        </> : <>
          {editingLocation && <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-900">Update Government location</p><button type="button" onClick={() => { setEditingLocation(false); setError(""); }} className="text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</button></div>}
          <div className="space-y-4">
            <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">1. State / UT</span><select required value={stateUrl} onChange={event => void selectState(event.target.value, event.target.selectedOptions[0]?.text || "")} disabled={loadingStates} className={dropdownClass}><option value="">{loadingStates ? "Loading States / UTs…" : "Select a State / UT"}</option>{states.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>
            {(stateUrl || loadingDistricts) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">2. District</span><select required value={districtUrl} onChange={event => void selectDistrict(event.target.value, event.target.selectedOptions[0]?.text || "")} disabled={loadingDistricts || !districts.length} className={dropdownClass}><option value="">{loadingDistricts ? "Fetching Districts…" : "Select a District"}</option>{districts.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
            {(districtUrl || loadingBlocks) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">3. Block</span><select required value={blockUrl} onChange={event => void selectBlock(event.target.value, event.target.selectedOptions[0]?.text || "")} disabled={loadingBlocks || !blocks.length} className={dropdownClass}><option value="">{loadingBlocks ? "Fetching Blocks…" : "Select a Block"}</option>{blocks.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
            {(blockUrl || loadingPanchayats) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">4. Panchayat / Village</span><select required value={panchayatUrl} onChange={event => { setLocationSaved(false); setPanchayatUrl(event.target.value); }} disabled={loadingPanchayats || !panchayats.length} className={dropdownClass}><option value="">{loadingPanchayats ? "Fetching Panchayats…" : "Select a Panchayat / Village"}</option>{panchayats.map(entry => <option key={entry.url} value={entry.url} disabled={entry.available === false}>{entry.name}{entry.available === false ? " (Already assigned)" : ""}</option>)}</select></label>}
          </div>
        </>}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
      </form>
      <OnboardingActions
        next={
          locationSaved && !editingLocation && savedLocation
            ? { label: saving ? "Completing onboarding…" : "Complete onboarding", onClick: () => void completeSavedLocation(), disabled: saving }
            : { label: saving ? "Saving location…" : "Save & Complete", type: "submit", form: "location-form", disabled: saving || !councilId || !stateUrl || !districtUrl || !blockUrl || !panchayatUrl || loadingDistricts || loadingBlocks || loadingPanchayats }
        }
        note="Saving your Government location completes onboarding. You can import Job Cards and FTOs later from their respective modules."
      />
    </div>
  </OnboardingShell>;
}
