'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { getProfile } from '@/lib/auth';
import { validateVCAccess } from '@/lib/vcValidation';
import { SurveyDataTable } from '@/components/surveys/SurveyDataTable';
import { ImportExportPanel } from '@/components/surveys/ImportExportPanel';
import { exportPropertiesToCSV, downloadCSV, importPropertiesFromCSV } from '@/modules/property-survey/utils/csvUtils';
import type { Property } from '@/modules/property-survey/types';
import type { UserProfile } from '@/types';

export default function DashboardPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'properties' | 'households'>('properties');
  const [properties, setProperties] = useState<Property[]>([]);
  const [stats, setStats] = useState({
    totalProperties: 0,
    totalHouseholds: 0,
    occupiedProperties: 0,
  });

  useEffect(() => {
    async function loadData() {
      const profile = await getProfile();
      if (!profile) {
        window.location.href = '/login';
        return;
      }

      if (!validateVCAccess(profile)) {
        return;
      }

      setCtx(profile);
      await loadSurveyData(profile.vc?.id || '');
      setLoading(false);
    }

    loadData();
  }, []);

  async function loadSurveyData(vcId: string) {
    const supabase = createClient();

    // Load properties
    const { data: propertiesData } = await supabase
      .from('survey_properties')
      .select('*')
      .eq('vc_id', vcId)
      .order('created_at', { ascending: false });

    const props = propertiesData || [];
    setProperties(props as Property[]);

    // Calculate stats
    const occupiedCount = props.filter((p: any) => p.occupancy_status === 'occupied').length;

    // Load households count
    const { count: householdsCount } = await supabase
      .from('survey_households')
      .select('*', { count: 'exact' })
      .eq('vc_id', vcId);

    setStats({
      totalProperties: props.length,
      totalHouseholds: householdsCount || 0,
      occupiedProperties: occupiedCount,
    });
  }

  async function handleExport() {
    const csv = exportPropertiesToCSV(properties, ctx?.vc?.name || 'vc');
    downloadCSV(csv, `properties-${new Date().toISOString().split('T')[0]}.csv`);
  }

  async function handleImport(file: File) {
    try {
      const importedData = await importPropertiesFromCSV(file);

      // Validate and insert data
      const supabase = createClient();
      const dataToInsert = importedData.map((p) => ({
        vc_id: ctx?.vc?.id,
        property_id: p.property_id,
        property_type: p.property_type,
        owner_name: p.owner_name,
        owner_contact: p.owner_contact,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        occupancy_status: p.occupancy_status,
        created_by: ctx?.user?.id,
      }));

      const { error } = await supabase
        .from('survey_properties')
        .insert(dataToInsert);

      if (error) throw error;

      // Reload data
      await loadSurveyData(ctx?.vc?.id || '');
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : 'Failed to import data'
      );
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-gray-600 mt-1">{ctx?.vc?.name}</p>
            </div>
            <a
              href="/admin"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Back to Admin
            </a>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-600 text-sm mb-2">Total Properties</p>
            <p className="text-3xl font-bold text-gray-900">{stats.totalProperties}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-600 text-sm mb-2">Occupied</p>
            <p className="text-3xl font-bold text-green-600">{stats.occupiedProperties}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-600 text-sm mb-2">Total Households</p>
            <p className="text-3xl font-bold text-blue-600">{stats.totalHouseholds}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('properties')}
              className={`flex-1 px-6 py-4 font-medium border-b-2 transition ${
                activeTab === 'properties'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Properties
            </button>
            <button
              onClick={() => setActiveTab('households')}
              className={`flex-1 px-6 py-4 font-medium border-b-2 transition ${
                activeTab === 'households'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Households
            </button>
          </div>

          <div className="p-6">
            {activeTab === 'properties' ? (
              <div className="space-y-6">
                <SurveyDataTable properties={properties} />
                <ImportExportPanel
                  fileName="properties"
                  onExport={handleExport}
                  onImport={handleImport}
                />
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-600">Household data view coming soon</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
