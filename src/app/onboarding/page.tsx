"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type LocationFields = { state: string; district: string; block: string; village: string };

export default function OnboardingPage() {
  const router = useRouter();
  const [councilId, setCouncilId] = useState("");
  const [councilName, setCouncilName] = useState("");
  const [fields, setFields] = useState<LocationFields>({ state: "", district: "", block: "", village: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadCouncil() {
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
          .select("id,name,state,district,block,village,onboarding_completed_at")
          .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
        if (councilError) throw councilError;
        if (!council) throw new Error("The assigned Village Council is unavailable.");

        if (active) {
          setCouncilId(council.id);
          setCouncilName(council.name);
          setFields({
            state: council.state ?? "",
            district: council.district ?? "",
            block: council.block ?? "",
            village: council.village ?? "",
          });
          if (council.onboarding_completed_at) router.replace("/dashboard");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load your Village Council profile.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadCouncil();
    return () => { active = false; };
  }, [router]);

  function updateField(field: keyof LocationFields, value: string) {
    setFields(current => ({ ...current, [field]: value }));
  }

  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!councilId) return;
    setSaving(true);
    setError("");
    try {
      const values = {
        state: fields.state.trim(),
        district: fields.district.trim(),
        block: fields.block.trim(),
        village: fields.village.trim(),
      };
      if (Object.values(values).some(value => !value)) throw new Error("Complete all four location fields to continue.");

      const { error: updateError } = await createClient()
        .from("village_councils")
        .update({ ...values, onboarding_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", councilId);
      if (updateError) throw updateError;
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the Village Council location.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Loading your Village Council setup…</p></main>;

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <div className="w-full max-w-2xl">
      <div className="mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-700 text-sm font-bold text-white">VC</div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-blue-700">First-time setup</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Set up your Village Council</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Welcome{councilName ? ` to ${councilName}` : ""}. Enter the administrative location for your council. You can update these details later in Settings.</p>
      </div>
      <form onSubmit={saveLocation} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          {([
            ["state", "State", "e.g. Mizoram"],
            ["district", "District", "e.g. Serchhip"],
            ["block", "Block", "Enter block name"],
            ["village", "Village", "Enter village name"],
          ] as const).map(([key, label, placeholder], index) => (
            <div key={key}>
              <label htmlFor={key} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
              <input id={key} required maxLength={key === "village" ? 120 : 100} value={fields[key]} onChange={event => updateField(key, event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50" />
              <p className="mt-1.5 text-xs text-slate-400">{["State or Union Territory", "District within the state", "Development or administrative block", "Village under the selected block"][index]}</p>
            </div>
          ))}
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">All four fields are required to activate your workspace.</p>
          <button type="submit" disabled={saving || !councilId} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Saving setup…" : "Complete setup"}</button>
        </div>
      </form>
    </div>
  </main>;
}
