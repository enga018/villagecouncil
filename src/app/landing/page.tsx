'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import type { VillageCouncil } from '@/types';
import Link from 'next/link';

export default function LandingPage() {
  const [vcs, setVcs] = useState<VillageCouncil[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVCs = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('village_councils')
        .select('*')
        .order('name');
      
      if (data) {
        setVcs(data);
      }
      setLoading(false);
    };

    fetchVCs();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="bg-white shadow">
        <nav className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-600">Village Council</h1>
          <Link
            href="/login"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Sign In
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h2 className="text-4xl font-bold text-gray-900 mb-4">
          Village Council Platform
        </h2>
        <p className="text-xl text-gray-600 mb-8">
          Unified platform for managing property and household surveys across all village councils
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/login"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Get Started
          </Link>
          <a
            href="#vcs"
            className="px-6 py-3 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 font-medium"
          >
            Browse Councils
          </a>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4">
          <h3 className="text-2xl font-bold text-gray-900 mb-8 text-center">Features</h3>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white p-6 rounded-lg shadow">
              <h4 className="text-lg font-bold mb-2">Property Survey</h4>
              <p className="text-gray-600">
                Collect property details including GPS location and photos
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <h4 className="text-lg font-bold mb-2">Household Survey</h4>
              <p className="text-gray-600">
                Record family and household data linked to properties
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <h4 className="text-lg font-bold mb-2">Data Management</h4>
              <p className="text-gray-600">
                Import/export data as CSV and view comprehensive dashboards
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Village Councils Section */}
      <section id="vcs" className="max-w-7xl mx-auto px-4 py-16">
        <h3 className="text-2xl font-bold text-gray-900 mb-8 text-center">
          Village Councils
        </h3>

        {loading ? (
          <div className="text-center py-8">
            <p className="text-gray-600">Loading councils...</p>
          </div>
        ) : vcs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600">No councils available</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {vcs.map((vc) => (
              <div
                key={vc.id}
                className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition"
                style={{ borderTop: `4px solid ${vc.brand_color || '#0E7490'}` }}
              >
                {vc.logo_url && (
                  <img
                    src={vc.logo_url}
                    alt={vc.name}
                    className="h-12 mb-4"
                  />
                )}
                <h4 className="text-lg font-bold text-gray-900 mb-2">{vc.name}</h4>
                <p className="text-gray-600 text-sm mb-4">
                  Access your council's property and household survey platform
                </p>
                <a
                  href={`https://${vc.name.toLowerCase().replace(/\s+/g, '-')}.villagecouncil.enga.in/login`}
                  className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                >
                  Sign In to {vc.name}
                </a>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p>&copy; 2024 Village Council Platform. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
