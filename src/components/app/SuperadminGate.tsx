"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type Status = "checking" | "allowed" | "denied" | "error";
type Result = { status: Status; message?: string };

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 12000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(label + " timed out. Please refresh and try again.")), timeoutMs)),
  ]);
}

export default function SuperadminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [result, setResult] = useState<Result>({ status: "checking" });

  useEffect(() => {
    let active = true;
    async function verify() {
      setResult({ status: "checking" });
      try {
        const supabase = createClient();

        // Read the persisted browser session first. The protected database query below
        // validates the JWT and the user's platform-superadmin assignment.
        const { data: { session }, error: sessionError } = await withTimeout(
          supabase.auth.getSession(),
          "Reading the saved login session",
        );
        if (sessionError) throw sessionError;
        if (!session?.user) {
          router.replace("/login");
          return;
        }

        const accessCheck = Promise.resolve(
          supabase
            .from("platform_superadmins")
            .select("id")
            .eq("user_id", session.user.id)
            .maybeSingle(),
        );
        const { data, error } = await withTimeout(
          accessCheck,
          "Checking platform administrator access",
        );
        if (error) throw error;
        if (active) setResult({ status: data ? "allowed" : "denied" });
      } catch (error) {
        if (active) setResult({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to verify platform administrator access.",
        });
      }
    }
    void verify();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (result.status !== "denied") return;
    let active = true;
    async function redirectToLogin() {
      try { await createClient().auth.signOut(); } finally {
        if (active) window.location.replace("/login/");
      }
    }
    void redirectToLogin();
    return () => { active = false; };
  }, [result.status]);

  if (result.status === "denied") return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><p className="text-sm text-slate-500">Access not authorised. Returning to login…</p></main>;
  if (result.status === "checking") return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><p className="text-sm text-slate-500">Verifying platform administrator access…</p></main>;
  if (result.status === "error") return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><div className="max-w-md rounded-2xl border border-red-200 bg-white p-7 text-center"><h1 className="text-xl font-semibold text-slate-900">Unable to verify access</h1><p role="alert" className="mt-2 text-sm text-red-700">{result.message}</p><button onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-blue-700 px-4 py-2 text-sm font-medium text-white">Try again</button></div></main>;
  return <>{children}</>;
}
