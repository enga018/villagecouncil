'use client';

import { useEffect } from 'react';
import { getProfile, getRoleRedirectUrl } from '@/lib/auth';
import { getSubdomainContext, redirectToVC } from '@/lib/subdomain';
import LoadingScreen from '@/components/ui/LoadingScreen';

export default function HomePage() {
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      window.location.href = '/login';
    }, 5000);

    async function checkAuth() {
      try {
        const subdomain = getSubdomainContext();

        // On main domain, redirect to landing page
        if (subdomain.isMainDomain) {
          window.location.href = '/landing';
          return;
        }

        // On VC subdomain, check authentication
        const ctx = await getProfile();

        if (ctx) {
          // Validate user's VC matches subdomain
          if (ctx.profile.vc_id === ctx.vc?.id) {
            window.location.href = getRoleRedirectUrl(ctx.profile.role);
          } else {
            // User's VC doesn't match subdomain, redirect to their VC
            redirectToVC(ctx.vc?.name || 'villagecouncil');
          }
        } else {
          window.location.href = '/login';
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        window.location.href = '/login';
      }
    }

    checkAuth();

    return () => clearTimeout(timeoutId);
  }, []);

  return <LoadingScreen message="Checking your session..." />;
}
