"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type LocationEntry = { id: string; name: string; url: string; available?: boolean };
type SourceResult = { success: boolean; entries: LocationEntry[]; error?: string; cached?: boolean };

async function fetchLocations(action: "states" | "districts" | "blocks" | "panchayats", selectedNames: string[] = []) {
  const { data, error } = await createClient().functions.invoke<SourceResult>("location-master-source", {
    body: { action, selectedNames, publicRequest: true },
  });
  if (error) {
    const context = error.context as Response | undefined;
    if (context && typeof context.json === "function") {
      try {
        const detail = await context.json() as { error?: string };
        if (detail.error) throw new Error(detail.error);
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== "Unexpected end of JSON input") throw parseError;
      }
    }
    throw new Error(error.message || "Unable to retrieve the official Government location list.");
  }
  if (!data?.success || !Array.isArray(data.entries)) {
    throw new Error(data?.error || "The official location list could not be loaded.");
  }
  return data.entries;
}

export default function RequestToOnboardPage() {
  const [states, setStates] = useState<LocationEntry[]>([]);
  const [districts, setDistricts] = useState<LocationEntry[]>([]);
  const [blocks, setBlocks] = useState<LocationEntry[]>([]);
  const [panchayats, setPanchayats] = useState<LocationEntry[]>([]);
  const [stateId, setStateId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [panchayatId, setPanchayatId] = useState("");
  const [councilName, setCouncilName] = useState("");
  const [administratorEmail, setAdministratorEmail] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterDesignation, setRequesterDesignation] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [reason, setReason] = useState("");
  const [loadingStates, setLoadingStates] = useState(true);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [loadingPanchayats, setLoadingPanchayats] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ requestId: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetchLocations("states")
      .then(entries => { if (active) setStates(entries); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Unable to load States / UTs."); })
      .finally(() => { if (active) setLoadingStates(false); });
    return () => { active = false; };
  }, []);

  async function chooseState(id: string) {
    const selected = states.find(entry => entry.id === id);
    setStateId(id); setDistrictId(""); setBlockId(""); setPanchayatId("");
    setDistricts([]); setBlocks([]); setPanchayats([]); setError("");
    if (!selected) return;
    setLoadingDistricts(true);
    try { setDistricts(await fetchLocations("districts", [selected.name])); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load Districts."); }
    finally { setLoadingDistricts(false); }
  }

  async function chooseDistrict(id: string) {
    const state = states.find(entry => entry.id === stateId);
    const selected = districts.find(entry => entry.id === id);
    setDistrictId(id); setBlockId(""); setPanchayatId("");
    setBlocks([]); setPanchayats([]); setError("");
    if (!state || !selected) return;
    setLoadingBlocks(true);
    try { setBlocks(await fetchLocations("blocks", [state.name, selected.name])); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load Blocks."); }
    finally { setLoadingBlocks(false); }
  }

  async function chooseBlock(id: string) {
    const state = states.find(entry => entry.id === stateId);
    const district = districts.find(entry => entry.id === districtId);
    const selected = blocks.find(entry => entry.id === id);
    setBlockId(id); setPanchayatId(""); setPanchayats([]); setError("");
    if (!state || !district || !selected) return;
    setLoadingPanchayats(true);
    try { setPanchayats(await fetchLocations("panchayats", [state.name, district.name, selected.name])); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load Panchayats / Villages."); }
    finally { setLoadingPanchayats(false); }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { data, error: invokeError } = await createClient().functions.invoke("submit-council-onboarding-request", {
        body: {
          councilName,
          stateId,
          districtId,
          blockId,
          panchayatId,
          administratorEmail,
          requesterName,
          requesterDesignation,
          requesterPhone,
          reason,
        },
      });
      if (invokeError) {
        const context = invokeError.context as Response | undefined;
        if (context && typeof context.json === "function") {
          try {
            const detail = await context.json() as { error?: string };
            if (detail.error) throw new Error(detail.error);
          } catch (parseError) {
            if (parseError instanceof Error && parseError.message !== "Unexpected end of JSON input") throw parseError;
          }
        }
        throw new Error(invokeError.message || "Unable to submit your request.");
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.success || !data?.requestId) throw new Error("The request could not be confirmed. Please contact the platform administrator.");
      setSuccess({ requestId: data.requestId, message: data.message || "Your request has been submitted." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit your onboarding request.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectClass = "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50 disabled:text-slate-400";
  const inputClass = "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50";
  const fieldLabel = "block text-xs font-semibold text-slate-700";

  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm font-semibold text-slate-500 hover:text-slate-900">← Village Council</Link>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          {success ? (
            <div className="py-5 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6"/></svg></span>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">Request submitted</h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{success.message}</p>
              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-left"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Request reference</p><p className="mt-1 break-all font-mono text-sm text-slate-800">{success.requestId}</p></div>
              <p className="mt-4 text-xs leading-5 text-slate-500">The platform Superadmin will review the request. If approved, an administrator invitation will be sent to the email address you provided.</p>
              <Link href="/" className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white">Return to home</Link>
            </div>
          ) : (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[.16em] text-blue-700">Council registration</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Request to Onboard</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">Provide your Village Council details and official Government location. Your request will be reviewed before an account is created.</p>
              <form onSubmit={submitRequest} className="mt-7 space-y-5">
                <section className="space-y-4">
                  <h2 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">Village Council details</h2>
                  <label className={fieldLabel}>Official Village Council name<input required minLength={3} maxLength={120} value={councilName} onChange={e => setCouncilName(e.target.value)} placeholder="Enter the official Council name" className={inputClass}/></label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className={fieldLabel}>State / UT<select required value={stateId} onChange={e => void chooseState(e.target.value)} disabled={loadingStates} className={selectClass}><option value="">{loadingStates ? "Loading States / UTs…" : "Select State / UT"}</option>{states.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className={fieldLabel}>District<select required value={districtId} onChange={e => void chooseDistrict(e.target.value)} disabled={!stateId || loadingDistricts || !districts.length} className={selectClass}><option value="">{loadingDistricts ? "Loading Districts…" : "Select District"}</option>{districts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className={fieldLabel}>Block<select required value={blockId} onChange={e => void chooseBlock(e.target.value)} disabled={!districtId || loadingBlocks || !blocks.length} className={selectClass}><option value="">{loadingBlocks ? "Loading Blocks…" : "Select Block"}</option>{blocks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className={fieldLabel}>Panchayat / Village<select required value={panchayatId} onChange={e => setPanchayatId(e.target.value)} disabled={!blockId || loadingPanchayats || !panchayats.length} className={selectClass}><option value="">{loadingPanchayats ? "Loading Panchayats…" : "Select Panchayat / Village"}</option>{panchayats.map(item => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name}{item.available === false ? " (Already registered or request pending)" : ""}</option>)}</select></label>
                  </div>
                  <p className="text-[11px] leading-5 text-slate-400">Location options are checked against the shared official location master first. If a level is not cached, the platform retrieves it from the Government source and saves it for reuse.</p>
                </section>
                <section className="space-y-4">
                  <h2 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">Initial administrator</h2>
                  <label className={fieldLabel}>Administrator email<input required type="email" maxLength={254} value={administratorEmail} onChange={e => setAdministratorEmail(e.target.value)} placeholder="administrator@example.com" className={inputClass}/><span className="mt-1 block text-[11px] font-normal text-slate-400">This email will receive the administrator invitation if the request is approved.</span></label>
                </section>
                <section className="space-y-4">
                  <h2 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">Requester details</h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className={fieldLabel}>Full name<input required minLength={2} maxLength={120} value={requesterName} onChange={e => setRequesterName(e.target.value)} className={inputClass}/></label>
                    <label className={fieldLabel}>Designation<input required minLength={2} maxLength={80} value={requesterDesignation} onChange={e => setRequesterDesignation(e.target.value)} placeholder="Secretary, President, etc." className={inputClass}/></label>
                  </div>
                  <label className={fieldLabel}>Mobile number<input required type="tel" minLength={6} maxLength={30} value={requesterPhone} onChange={e => setRequesterPhone(e.target.value)} className={inputClass}/></label>
                  <label className={fieldLabel}>Reason for request <span className="font-normal text-slate-400">(optional)</span><textarea maxLength={1000} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Any additional information for the platform administrator" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"/></label>
                </section>
                {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
                <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <Link href="/" className="text-center text-sm font-semibold text-slate-500 hover:text-slate-900">Cancel</Link>
                  <button type="submit" disabled={submitting || loadingStates || !stateId || !districtId || !blockId || !panchayatId || panchayats.find(item => item.id === panchayatId)?.available === false} className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? "Submitting request…" : "Submit onboarding request"}</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
