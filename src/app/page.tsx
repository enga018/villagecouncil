'use client';

import { useEffect } from 'react';
import { getProfile, getRoleRedirectUrl } from '@/lib/auth';
import LoadingScreen from '@/components/ui/LoadingScreen';

export default function HomePage() {
  useEffect(() => {
    async function checkAuth() {
      const ctx = await getProfile();
      if (ctx) {
        window.location.href = getRoleRedirectUrl(ctx.profile.role);
      } else {
        window.location.href = '/login';
      }
    }
    checkAuth();
  }, []);

  return <LoadingScreen message="Checking your session..." />;
}
