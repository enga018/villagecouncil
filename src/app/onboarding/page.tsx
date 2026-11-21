"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type SourceEntry = { name: string; url: string };
type SourceResult = { success?: boolean; entries?: SourceEntry[]; error?: string };
type RegisterPreview = {
  batchId: string; status: string; sourceTable: number; sourceRows: number; stagedRows: number;
  activeApplicants: number; sourceDeletedApplicants: number; existingJobCards: number; newJobCards: number;
  changedJobCards: number; existingApplicants: number; newApplicants: number; changedApplicants: number;
  unchangedApplicants: number; missingApplicants: number; missingJobCards: number;
  sample: { jobCardNumber: string; headOfHousehold: string; applicantNumber: string; applicantName: string }[];
  activation: string;
};
type RegisterSourceResult = {
  success?: boolean;
  found?: boolean;
  jurisdictionKey?: string | null;
  reportPath?: string | null;
  candidates?: { kind: string; label: string; path: string }[];
  inspectedPages?: { path: string; status?: number; contentType?: string; error?: string }[];
  reportInspection?: {
    preview?: RegisterPreview;
    path?: string; status?: number; contentType?: string; error?: string;
    title?: string; htmlBytes?: number; tableCount?: number;
    hasRegisterTitle?: boolean; hasApplicantFields?: boolean;
    tableSummaries?: { index: number; rowCount: number; columnCounts: number[]; relevantColumnLabels: string[] }[];
    parserCompatibility?: {
      globalTrCount: number; globalTdCount: number; globalThCount: number;
      tableStats: { index: number; leadingCellCount: number; parsedRowCount: number; effectiveRowCount: number; maxColumns: number; rowsWith14PlusCells: number; rowsContainingJobCardPattern: number; headerCandidate: { rowIndex: number; headerSpan: number; headerColumnCount: number; headings: string[] } | null }[];
      headerCandidate: { tableIndex: number; rowIndex: number; headerSpan: number; headerColumnCount: number; headings: string[] } | null;
      likelyApplicantTableIndex: number | null;
    };
  } | null;
  error?: string;
};

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
  const [savedLocation, setSavedLocation] = useState<{ state: string; district: string; block: string; village: string } | null>(null);
  const [error, setError] = useState("");
  const [discoveringRegister, setDiscoveringRegister] = useState(false);
  const [registerDiscovery, setRegisterDiscovery] = useState<RegisterSourceResult | null>(null);
  const [registerDiscoveryError, setRegisterDiscoveryError] = useState("");
  const [preparingPreview, setPreparingPreview] = useState(false);
  const [registerPreview, setRegisterPreview] = useState<RegisterPreview | null>(null);
  const [registerPreviewError, setRegisterPreviewError] = useState("");

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

  async function discoverRegisterSource() {
    setDiscoveringRegister(true);
    setRegisterDiscovery(null);
    setRegisterDiscoveryError("");
    try {
      const { data, error: invokeError } = await createClient().functions.invoke<RegisterSourceResult>("council-register-source", { body: {} });
      if (invokeError) {
        let message = invokeError.message || "Could not inspect the official register source.";
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
      if (!data?.success) throw new Error(data?.error || "The official register source could not be identified.");
      setRegisterDiscovery(data);
    } catch (err) {
      setRegisterDiscoveryError(err instanceof Error ? err.message : "Unable to inspect the official register source.");
    } finally {
      setDiscoveringRegister(false);
    }
  }

  async function prepareRegisterPreview() {
    setPreparingPreview(true);
    setRegisterPreview(null);
    setRegisterPreviewError("");
    try {
      const { data, error: invokeError } = await createClient().functions.invoke<RegisterSourceResult>("council-register-source", { body: { action: "prepare-preview" } });
      if (invokeError) {
        let message = invokeError.message || "Could not prepare the MIS import preview.";
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
      if (!data?.success || !data.reportInspection?.preview) throw new Error(data?.error || "The official register preview was not prepared.");
      setRegisterPreview(data.reportInspection.preview);
    } catch (err) {
      setRegisterPreviewError(err instanceof Error ? err.message : "Unable to prepare the MIS import preview.");
    } finally {
      setPreparingPreview(false);
    }
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
        <p className="mt-2 text-sm leading-6 text-slate-600">Welcome{councilName ? ` to ${councilName}` : ""}. Select your official administrative location. You can update these details later in Settings.</p>
      </div>
      <form onSubmit={saveLocation} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">1. State / UT</span><select required value={stateUrl} onChange={event => void selectState(event.target.value, event.target.selectedOptions[0]?.text || "")} disabled={loadingStates} className={dropdownClass}><option value="">{loadingStates ? "Loading States / UTs…" : "Select a State / UT"}</option>{states.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>
          {(stateUrl || loadingDistricts) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">2. District</span><select required value={districtUrl} onChange={event => void selectDistrict(event.target.value, event.target.selectedOptions[0]?.text || "")} disabled={loadingDistricts || !districts.length} className={dropdownClass}><option value="">{loadingDistricts ? "Fetching Districts…" : "Select a District"}</option>{districts.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
          {(districtUrl || loadingBlocks) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">3. Block</span><select required value={blockUrl} onChange={event => void selectBlock(event.target.value, event.target.selectedOptions[0]?.text || "")} disabled={loadingBlocks || !blocks.length} className={dropdownClass}><option value="">{loadingBlocks ? "Fetching Blocks…" : "Select a Block"}</option>{blocks.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
          {(blockUrl || loadingPanchayats) && <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">4. Panchayat / Village</span><select required value={panchayatUrl} onChange={event => { setLocationSaved(false); setPanchayatUrl(event.target.value); }} disabled={loadingPanchayats || !panchayats.length} className={dropdownClass}><option value="">{loadingPanchayats ? "Fetching Panchayats…" : "Select a Panchayat / Village"}</option>{panchayats.map(entry => <option key={entry.url} value={entry.url}>{entry.name}</option>)}</select></label>}
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
        {locationSaved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><p className="font-semibold">Official location saved</p><p className="mt-1">Step 1 is complete. Your location is saved and will be restored when you return.</p>{savedLocation && <p className="mt-2 text-xs text-emerald-800">{savedLocation.state} · {savedLocation.district} · {savedLocation.block} · {savedLocation.village}</p>}<p className="mt-3 text-xs text-emerald-800">Next: Step 2 — Import Job Cards (MIS). Your workspace remains locked until all steps are completed.</p>
          <div className="mt-4 border-t border-emerald-200 pt-4">
            <p className="text-sm font-semibold text-emerald-950">Step 2 · Official register source</p>
            <p className="mt-1 text-xs leading-5 text-emerald-800">First, verify that Puitu can locate this Panchayat's Registration Application Register. This check is read-only and will not import or change records.</p>
            <button type="button" onClick={() => void discoverRegisterSource()} disabled={discoveringRegister} className="mt-3 rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">{discoveringRegister ? "Checking official source…" : "Check official register source"}</button>
            {registerDiscoveryError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{registerDiscoveryError}</p>}
            {registerDiscovery && <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3 text-xs text-slate-700">
              <p className="font-semibold">{registerDiscovery.found ? "Official register source identified" : "Panchayat reached; register link not identified yet"}</p>
              {registerDiscovery.jurisdictionKey && <p className="mt-1">Official jurisdiction key: <strong>{registerDiscovery.jurisdictionKey}</strong></p>}
              {registerDiscovery.reportPath && <p className="mt-1 break-all">Report path: {registerDiscovery.reportPath}</p>}
              {registerDiscovery.reportInspection && <div className="mt-2 rounded-md bg-slate-50 p-2">
                <p className="font-semibold">Register endpoint inspection</p>
                {registerDiscovery.reportInspection.error
                  ? <p className="mt-1 text-red-700">Fetch failed: {registerDiscovery.reportInspection.error}</p>
                  : <>
                    <p className="mt-1">HTTP: {registerDiscovery.reportInspection.status ?? "—"} · Content type: {registerDiscovery.reportInspection.contentType || "unknown"}</p>
                    <p>Page title: {registerDiscovery.reportInspection.title || "Not provided"} · HTML size: {registerDiscovery.reportInspection.htmlBytes ?? "—"} bytes</p>
                    <p>Tables: {registerDiscovery.reportInspection.tableCount ?? 0} · Register title detected: {registerDiscovery.reportInspection.hasRegisterTitle ? "Yes" : "No"} · Applicant columns detected: {registerDiscovery.reportInspection.hasApplicantFields ? "Yes" : "No"}</p>
                    {registerDiscovery.reportInspection.parserCompatibility && <div className="mt-2 border-t border-slate-200 pt-2">
                      <p className="font-semibold">Legacy parser compatibility</p>
                      <p>HTML rows: {registerDiscovery.reportInspection.parserCompatibility.globalTrCount} · TD cells: {registerDiscovery.reportInspection.parserCompatibility.globalTdCount} · TH cells: {registerDiscovery.reportInspection.parserCompatibility.globalThCount}</p>
                      <p>Likely applicant table: {registerDiscovery.reportInspection.parserCompatibility.likelyApplicantTableIndex === null ? "Not identified" : registerDiscovery.reportInspection.parserCompatibility.likelyApplicantTableIndex + 1}</p>
                      {registerDiscovery.reportInspection.parserCompatibility.headerCandidate && <p>Detected headings: {registerDiscovery.reportInspection.parserCompatibility.headerCandidate.headings.join(" · ")}</p>}
                      {registerDiscovery.reportInspection.parserCompatibility.tableStats.map(table => <p key={table.index}>Table {table.index + 1}: {table.effectiveRowCount} effective rows · {table.maxColumns} max columns · {table.rowsWith14PlusCells} wide rows · {table.rowsContainingJobCardPattern} Job Card rows · leading headings {table.leadingCellCount}</p>)}
                    </div>}
                    {registerDiscovery.reportInspection.tableSummaries?.map(table => <div key={table.index} className="mt-2">
                      <p className="font-medium">Table {table.index + 1}: {table.rowCount} rows · Column counts: {table.columnCounts.join(", ") || "—"}</p>
                      {table.relevantColumnLabels.length > 0 && <p className="mt-1 break-words">Relevant headings: {table.relevantColumnLabels.join(" · ")}</p>}
                    </div>)}
                  </>}
              </div>}
              {registerDiscovery.candidates?.length ? <div className="mt-2 space-y-1"><p className="font-medium">Detected source references</p>{registerDiscovery.candidates.map((item, index) => <p key={index} className="break-all"><span className="font-medium">{item.kind}:</span> {item.label || item.path} — {item.path}</p>)}</div> : <p className="mt-1 text-slate-500">No registration-report references were found in the inspected page.</p>}
              <p className="mt-2 text-slate-500">The source check is read-only. It does not import or modify records.</p>
              {registerDiscovery.found && <div className="mt-3 border-t border-emerald-100 pt-3">
                <p className="font-semibold text-slate-800">Prepare Job Card import preview</p>
                <p className="mt-1 text-slate-600">Fetch and parse the official register into a review-only staging batch. Existing Job Cards and applicants will not be changed or activated.</p>
                <button type="button" onClick={() => void prepareRegisterPreview()} disabled={preparingPreview} className="mt-2 rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white disabled:opacity-60">{preparingPreview ? "Preparing preview…" : "Prepare import preview"}</button>
                {registerPreviewError && <p role="alert" className="mt-2 rounded-md bg-red-50 p-2 text-red-700">{registerPreviewError}</p>}
                {registerPreview && <div className="mt-3 rounded-md bg-blue-50 p-3 text-slate-700">
                  <p className="font-semibold text-blue-950">Import preview staged — awaiting review</p>
                  <p className="mt-1">Batch: <code>{registerPreview.batchId}</code></p>
                  <p>Source table {registerPreview.sourceTable} · {registerPreview.sourceRows.toLocaleString()} source rows · {registerPreview.stagedRows.toLocaleString()} staged rows</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <p>Active applicants: <strong>{registerPreview.activeApplicants.toLocaleString()}</strong></p>
                    <p>New Job Cards: <strong>{registerPreview.newJobCards.toLocaleString()}</strong></p>
                    <p>New applicants: <strong>{registerPreview.newApplicants.toLocaleString()}</strong></p>
                    <p>Changed applicants: <strong>{registerPreview.changedApplicants.toLocaleString()}</strong></p>
                    <p>Unchanged applicants: <strong>{registerPreview.unchangedApplicants.toLocaleString()}</strong></p>
                    <p>Source-deleted applicants: <strong>{registerPreview.sourceDeletedApplicants.toLocaleString()}</strong></p>
                    <p>Missing existing applicants: <strong>{registerPreview.missingApplicants.toLocaleString()}</strong></p>
                    <p>Missing existing Job Cards: <strong>{registerPreview.missingJobCards.toLocaleString()}</strong></p>
                  </div>
                  <p className="mt-2 font-medium">Sample parsed records</p>
                  {registerPreview.sample.map((item,index) => <p key={index} className="mt-1">{item.jobCardNumber} · {item.applicantNumber} · {item.applicantName} · Household: {item.headOfHousehold}</p>)}
                  <p className="mt-2 font-semibold text-blue-950">{registerPreview.activation}</p>
                </div>}
              </div>}
            </div>}
          </div>
        </div>}
        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">Saving this location does not complete onboarding or activate the workspace.</p>
          <button type="submit" disabled={saving || !councilId || !stateUrl || !districtUrl || !blockUrl || !panchayatUrl || loadingDistricts || loadingBlocks || loadingPanchayats} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Saving location…" : locationSaved ? "Update saved location" : "Save & continue"}</button>
        </div>
      </form>
    </div>
  </main>;
}
