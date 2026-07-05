'use client';

import { useEffect } from 'react';
import { getProfile, getRoleRedirectUrl } from '@/lib/auth';
import LoadingScreen from '@/components/ui/LoadingScreen';

export default function HomePage() {
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      window.location.href = '/login';
    }, 5000);

    async function checkAuth() {
      try {
        const ctx = await getProfile();
        if (ctx) {
          window.location.href = getRoleRedirectUrl(ctx.profile.role);
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
