'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { createClient } from '@/lib/supabase';
import type { UserProfile } from '@/types';

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthContextType>({
    user: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const supabase = createClient();

    async function loadUser() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session?.user) {
          setState({ user: null, isLoading: false, error: null });
          return;
        }

        const { data: profile } = await supabase
          .from('public_users')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (!profile) {
          setState({ user: null, isLoading: false, error: null });
          return;
        }

        let vc = null;
        if (profile.vc_id) {
          const { data: vcData } = await supabase
            .from('village_councils')
            .select('*')
            .eq('id', profile.vc_id)
            .single();
          vc = vcData;
        }

        setState({
          user: {
            user: { id: session.user.id, email: session.user.email },
            profile,
            vc,
          },
          isLoading: false,
          error: null,
        });
      } catch (err) {
        setState({
          user: null,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load user',
        });
      }
    }

    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => subscription?.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
