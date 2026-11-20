"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type Status = "checking" | "allowed" | "denied" | "error";

export default function SuperadminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let active = true;
    async function verify() {
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) {
          router.replace("/login");
          return;
        }
        const { data, error } = await supabase
          .from("platform_superadmins")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) throw error;
        if (active) setStatus(data ? "allowed" : "denied");
      } catch {
        if (active) setStatus("error");
      }
    }
    void verify();
    return () => { active = false; };
  }, [router]);

  if (status === "checking") return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Verifying platform administrator access…</p></main>;
  if (status === "denied") return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center"><h1 className="text-xl font-semibold text-slate-900">Access not authorised</h1><p className="mt-2 text-sm text-slate-600">This account is not assigned platform administrator privileges.</p><button onClick={async () => { await createClient().auth.signOut(); router.replace("/login"); }} className="mt-5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium">Sign out</button></div></main>;
  if (status === "error") return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-red-700">Unable to verify platform administrator access. Refresh to try again.</p></main>;
  return <>{children}</>;
}
