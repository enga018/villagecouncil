'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { getProfile } from '@/lib/auth';
import { validateVCAccess } from '@/lib/vcValidation';
import { PropertySurveyForm } from '@/modules/property-survey';
import type { UserProfile } from '@/types';
import type { PropertySurveyFormData } from '@/modules/property-survey/types';

export default function PropertySurveyPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);

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

  async function handleSubmit(data: PropertySurveyFormData) {
    if (!ctx) throw new Error('No user context');

    try {
      const supabase = createClient();

      // Upload photo if provided
      let photoUrl: string | undefined;
      if (data.photo_file) {
        const fileName = `${ctx.vc?.id}/${Date.now()}-${data.photo_file.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('property-photos')
          .upload(fileName, data.photo_file);

        if (uploadError) throw uploadError;
        photoUrl = uploadData.path;
      }

      // Generate property ID based on VC prefix
      const { count } = await supabase
        .from('survey_properties')
        .select('*', { count: 'exact' })
        .eq('vc_id', ctx.vc?.id);

      const propertyNumber = ((count || 0) + 1).toString().padStart(4, '0');
      const propertyId = `${ctx.vc?.property_prefix || 'PROP'}-${propertyNumber}`;

      // Insert property record
      const { error: insertError } = await supabase
        .from('survey_properties')
        .insert({
          vc_id: ctx.vc?.id,
          property_id: propertyId,
          property_type: data.property_type,
          owner_name: data.owner_name,
          owner_contact: data.owner_contact,
          address: data.address,
          latitude: data.latitude,
          longitude: data.longitude,
          photo_url: photoUrl,
          occupancy_status: data.occupancy_status,
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
            <h1 className="text-2xl font-bold text-gray-900">Property Survey</h1>
            <p className="text-gray-600 mt-2">
              Collect property details for {ctx?.vc?.name}
            </p>
          </div>

          {submitted && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              ✓ Property recorded successfully. Ready for next property.
            </div>
          )}

          <PropertySurveyForm
            vcId={ctx?.vc?.id || ''}
            propertyPrefix={ctx?.vc?.property_prefix || 'PROP'}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </div>
  );
}
