import { createClient } from '@/lib/supabase';
import type { UserProfile, VillageCouncil } from '@/types';

export async function getUser(): Promise<{ id: string; email?: string } | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email };
}

export async function requireAuth(): Promise<{ id: string; email?: string } | null> {
  const user = await getUser();
  if (!user) {
    window.location.href = '/login?from=dashboard';
    return null;
  }
  return user;
}

export async function getProfile(): Promise<UserProfile | null> {
  const supabase = createClient();
  const user = await getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('public_users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !profile) return null;

  let vc: VillageCouncil | null = null;
  if (profile.vc_id) {
    const { data: vcData } = await supabase
      .from('village_councils')
      .select('*')
      .eq('id', profile.vc_id)
      .single();
    vc = vcData;
  }

  return { user, profile, vc };
}

export async function logout(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.href = '/login';
}

export function getRoleRedirectUrl(role: string): string {
  switch (role) {
    case 'superadmin':
      return '/superadmin';
    case 'admin':
      return '/admin';
    case 'worker':
      return '/worker';
    case 'supervisor':
      return '/supervisor';
    default:
      return '/login';
  }
}
