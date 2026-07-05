'use client';

import { useEffect } from 'react';
import { getProfile, getRoleRedirectUrl } from '@/lib/auth';

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

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
}
