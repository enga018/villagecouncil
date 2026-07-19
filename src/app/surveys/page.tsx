'use client';

import { useEffect, useState } from 'react';
import { getProfile } from '@/lib/auth';
import { validateVCAccess } from '@/lib/vcValidation';
import type { UserProfile } from '@/types';
import Link from 'next/link';

export default function SurveysHubPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const profile = await getProfile();
      if (!profile) {
        window.location.href = '/login';
        return;
      }

      if (!validateVCAccess(profile)) {
        return;
      }

      setCtx(profile);
      setLoading(false);
    }

    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">Surveys</h1>
          <p className="text-gray-600 mt-1">{ctx?.vc?.name}</p>
        </div>
      </div>

      {/* Survey Modules */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Property Survey Card */}
          <Link href="/surveys/property" className="group">
            <div className="bg-white rounded-lg shadow-lg hover:shadow-xl transition p-8 border-t-4 border-blue-600">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 group-hover:text-blue-600 transition">
                    Property Survey
                  </h2>
                  <p className="text-gray-600 text-sm mt-1">Collect property details</p>
                </div>
                <div className="text-3xl">🏠</div>
              </div>

              <p className="text-gray-600 mb-4">
                Record property information including:
              </p>
              <ul className="space-y-2 text-sm text-gray-600 mb-6">
                <li>✓ Property type and details</li>
                <li>✓ Owner information</li>
                <li>✓ GPS location capture</li>
                <li>✓ Photo documentation</li>
              </ul>

              <div className="flex items-center text-blue-600 font-medium group-hover:gap-2 transition">
                Start Survey
                <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          {/* Household Survey Card */}
          <Link href="/surveys/household" className="group">
            <div className="bg-white rounded-lg shadow-lg hover:shadow-xl transition p-8 border-t-4 border-green-600">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 group-hover:text-green-600 transition">
                    Household Survey
                  </h2>
                  <p className="text-gray-600 text-sm mt-1">Collect family data</p>
                </div>
                <div className="text-3xl">👨‍👩‍👧‍👦</div>
              </div>

              <p className="text-gray-600 mb-4">
                Record household information including:
              </p>
              <ul className="space-y-2 text-sm text-gray-600 mb-6">
                <li>✓ Link to property</li>
                <li>✓ Family members</li>
                <li>✓ Demographics (age, gender, relation)</li>
                <li>✓ Household composition</li>
              </ul>

              <div className="flex items-center text-green-600 font-medium group-hover:gap-2 transition">
                Start Survey
                <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>
        </div>

        {/* Info Section */}
        <div className="mt-12 bg-blue-50 rounded-lg p-8 border border-blue-200">
          <h3 className="text-lg font-bold text-blue-900 mb-4">Survey Guidelines</h3>
          <ul className="space-y-2 text-blue-900 text-sm">
            <li>• Complete property survey first before household survey</li>
            <li>• Ensure GPS accuracy for location capture</li>
            <li>• Take clear, well-lit photos of properties</li>
            <li>• Verify all information before submitting</li>
            <li>• Data is automatically saved to the database</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
