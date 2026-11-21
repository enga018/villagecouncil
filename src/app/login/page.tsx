"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

async function getDestination(userId: string) {
  const supabase = createClient();
  const { data: admin, error: adminError } = await supabase
    .from("platform_superadmins").select("id").eq("user_id", userId).maybeSingle();
  if (adminError) throw adminError;
  if (admin) return "/superadmin";

  const { data: membership, error: membershipError } = await supabase
    .from("council_memberships").select("id").eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error("This account has no active Village Council assignment. Contact the platform administrator.");
  return "/dashboard";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function checkExistingUser() {
      try {
        const { data: { user } } = await createClient().auth.getUser();
        if (user && active) router.replace(await getDestination(user.id));
      } catch {
        if (active) setError("Unable to verify your account access. Please sign in again.");
      } finally {
        if (active) setChecking(false);
      }
    }
    void checkExistingUser();
    return () => { active = false; };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      if (!data.user) throw new Error("Sign-in did not return a user.");
      router.replace(await getDestination(data.user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Checking sign-in…</p></main>;

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <div className="w-full max-w-md">
      <div className="mb-8 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-700 text-lg font-bold text-white">VC</div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-950">Village Council</h1><p className="mt-2 text-sm text-slate-500">Sign in to your Village Council workspace</p></div>
      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div><label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
          <input id="login-email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></div>
        <div><label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
          <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="mt-6 text-center text-xs text-slate-400">Accounts are provisioned by the platform administrator. Public registration is disabled.</p>
    </div>
  </main>;
}
