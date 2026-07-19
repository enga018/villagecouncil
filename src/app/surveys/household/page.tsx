'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { getProfile } from '@/lib/auth';
import { validateVCAccess } from '@/lib/vcValidation';
import { HouseholdSurveyForm } from '@/modules/household-survey';
import type { UserProfile } from '@/types';
import type { HouseholdSurveyFormData } from '@/modules/household-survey/types';

export default function HouseholdSurveyPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [properties, setProperties] = useState<any[]>([]);

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

      // Load properties for this VC
      const supabase = createClient();
      const { data } = await supabase
        .from('survey_properties')
        .select('id, property_id, address')
        .eq('vc_id', profile.vc?.id)
        .order('property_id');

      setProperties(data || []);
      setLoading(false);
    }

    checkAuth();
  }, []);

  async function handleSubmit(data: HouseholdSurveyFormData) {
    if (!ctx) throw new Error('No user context');

    try {
      const supabase = createClient();

      // Generate family ID based on property
      const { count } = await supabase
        .from('survey_households')
        .select('*', { count: 'exact' })
        .eq('property_id', data.property_id);

      const familyNumber = ((count || 0) + 1).toString();
      
      // Get property_id to construct family_id
      const property = properties.find((p) => p.id === data.property_id);
      const familyId = `${property?.property_id}/${familyNumber}`;

      // Insert household record
      const { error: insertError } = await supabase
        .from('survey_households')
        .insert({
          property_id: data.property_id,
          vc_id: ctx.vc?.id,
          family_id: familyId,
          head_of_household: data.head_of_household,
          members: data.members,
          total_members: data.members.length,
          children_count: data.members.filter((m) => m.relation === 'child').length,
          created_by: ctx.user?.id,
        });

      if (insertError) throw insertError;

      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (err) {
      throw err;
    }
  }

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
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Household Survey</h1>
            <p className="text-gray-600 mt-2">
              Record family data for {ctx?.vc?.name}
            </p>
          </div>

          {submitted && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              ✓ Household recorded successfully. Ready for next household.
            </div>
          )}

          <HouseholdSurveyForm
            properties={properties}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </div>
  );
}
