'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { createClient } from '@/lib/supabase';
import type { VillageCouncil } from '@/types';
import { useVCContext } from '@/hooks/useVCContext';

interface BrandingContextType {
  vc: VillageCouncil | null;
  isLoading: boolean;
  primaryColor: string;
  secondaryColor: string;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { vcId } = useVCContext();
  const [state, setState] = useState<BrandingContextType>({
    vc: null,
    isLoading: true,
    primaryColor: '#0E7490',
    secondaryColor: '#06B6D4',
  });

  useEffect(() => {
    if (!vcId) {
      setState({
        vc: null,
        isLoading: false,
        primaryColor: '#0E7490',
        secondaryColor: '#06B6D4',
      });
      return;
    }

    const supabase = createClient();

    async function loadVCBranding() {
      try {
        const { data: vc } = await supabase
          .from('village_councils')
          .select('*')
          .eq('id', vcId)
          .single();

        if (vc) {
          setState({
            vc,
            isLoading: false,
            primaryColor: vc.brand_color || '#0E7490',
            secondaryColor: '#06B6D4',
          });
        } else {
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      } catch (err) {
        console.error('Failed to load VC branding:', err);
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    }

    loadVCBranding();
  }, [vcId]);

  return (
    <BrandingContext.Provider value={state}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useVCBranding(): BrandingContextType {
  const context = useContext(BrandingContext);
  if (context === undefined) {
    throw new Error('useVCBranding must be used within BrandingProvider');
  }
  return context;
}
