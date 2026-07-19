'use client';

import { useContext, useEffect, useState } from 'react';
import { getSubdomainContext } from '@/lib/subdomain';
import { useAuth } from './useAuth';

export interface VCContextData {
  vcId: string | null;
  vcName: string | null;
  isMainDomain: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useVCContext(): VCContextData {
  const { user } = useAuth();
  const [context, setContext] = useState<VCContextData>({
    vcId: null,
    vcName: null,
    isMainDomain: true,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const subdomain = getSubdomainContext();
    
    // If on VC subdomain, use that
    if (!subdomain.isMainDomain && subdomain.vcName) {
      setContext({
        vcId: null, // Will be fetched from DB via vcName
        vcName: subdomain.vcName,
        isMainDomain: false,
        isLoading: false,
        error: null,
      });
      return;
    }

    // If on main domain and user is authenticated, use user's VC
    if (subdomain.isMainDomain && user?.profile?.vc_id) {
      setContext({
        vcId: user.profile.vc_id,
        vcName: null, // Will be fetched from DB via vcId
        isMainDomain: true,
        isLoading: false,
        error: null,
      });
      return;
    }

    // Main domain, not authenticated
    setContext({
      vcId: null,
      vcName: null,
      isMainDomain: true,
      isLoading: false,
      error: null,
    });
  }, [user]);

  return context;
}

export function useVCNameFromSubdomain(): string | null {
  const subdomain = getSubdomainContext();
  return subdomain.isMainDomain ? null : subdomain.vcName;
}

export function useIsMainDomain(): boolean {
  const subdomain = getSubdomainContext();
  return subdomain.isMainDomain;
}
