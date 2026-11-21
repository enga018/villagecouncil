"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { Membership, VillageCouncil } from "@/types/village-council";

type TenantContext = { membership: Membership; council: VillageCouncil };
type GateState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "no_membership" }
  | { status: "onboarding" }
  | { status: "ready"; tenant: TenantContext }
  | { status: "error"; message: string };

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GateState>({ status: "loading" });

  const resolveTenant = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setState({ status: "signed_out" });
        router.replace("/login");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("council_memberships")
        .select("id,user_id,village_council_id,is_active,created_at")
        .eq("user_id", user.id).eq("is_active", true).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { setState({ status: "no_membership" }); return; }

      const { data: council, error: councilError } = await supabase
        .from("council_tenants")
        .select("id,name,slug,is_active,created_at,updated_at,state,district,block,village,block_url,panchayat_url,onboarding_completed_at")
        .eq("id", membership.village_council_id).eq("is_active", true).maybeSingle();
      if (councilError) throw councilError;
      if (!council) { setState({ status: "no_membership" }); return; }

      if (!council.onboarding_completed_at) {
        setState({ status: "onboarding" });
        router.replace("/onboarding");
        return;
      }

      setState({ status: "ready", tenant: { membership, council } });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Unable to verify your council access." });
    }
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    void resolveTenant();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (["SIGNED_OUT", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
        window.setTimeout(() => void resolveTenant(), 0);
      }
    });
    return () => subscription.unsubscribe();
  }, [resolveTenant]);

  if (state.status === "loading" || state.status === "signed_out" || state.status === "onboarding") {
    return <div className="flex min-h-[60vh] items-center justify-center"><p className="text-sm text-slate-500">Checking council setup…</p></div>;
  }
  if (state.status === "no_membership") {
    return <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
      <h1 className="text-xl font-semibold text-slate-900">No council access assigned</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">Your account is signed in, but it is not linked to an active Village Council. Contact the platform administrator.</p>
      <button className="mt-5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={async () => { await createClient().auth.signOut(); router.replace("/login"); }}>Sign out</button>
    </div>;
  }
  if (state.status === "error") {
    return <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
      <h1 className="text-xl font-semibold text-slate-900">Unable to verify access</h1><p className="mt-2 text-sm leading-6 text-slate-500">{state.message}</p>
      <button className="mt-5 rounded-xl bg-blue-700 px-4 py-2 text-sm font-medium text-white" onClick={() => void resolveTenant()}>Try again</button>
    </div>;
  }
  return <>{children}</>;
}
