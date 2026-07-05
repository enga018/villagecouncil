'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { getProfile, logout } from '@/lib/auth';
import type { UserProfile, VillageCouncil, SurveyTemplate } from '@/types';
import SurveyBuilder from '@/components/surveys/SurveyBuilder';

export default function SuperAdminPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [vcs, setVcs] = useState<VillageCouncil[]>([]);
  const [surveys, setSurveys] = useState<SurveyTemplate[]>([]);
  const [showSurveyBuilder, setShowSurveyBuilder] = useState(false);
  const [showVcModal, setShowVcModal] = useState(false);
  const [editingVc, setEditingVc] = useState<VillageCouncil | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const profile = await getProfile();
    if (!profile || profile.profile.role !== 'superadmin') {
      window.location.href = '/login';
      return;
    }
    setCtx(profile);
    await Promise.all([loadVcs(), loadSurveys()]);
    setLoading(false);
  }

  async function loadVcs() {
    const supabase = createClient();
    const { data } = await supabase.from('village_councils').select('*').order('name');
    setVcs(data || []);
  }

  async function loadSurveys() {
    const supabase = createClient();
    const { data } = await supabase.from('survey_templates').select('*').order('created_at', { ascending: false });
    setSurveys(data || []);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (showSurveyBuilder) {
    return <SurveyBuilder onBack={() => { setShowSurveyBuilder(false); loadSurveys(); }} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-indigo-900 text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-700 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-sm leading-none">Village Council</div>
              <div className="text-indigo-300 text-xs mt-0.5">Super Admin</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-indigo-200 text-sm">{ctx?.profile.full_name}</span>
            <button onClick={logout} className="text-indigo-300 hover:text-white text-sm transition-colors">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Village Councils Section */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Village Councils ({vcs.length})
            </h2>
            <button
              onClick={() => { setEditingVc(null); setShowVcModal(true); }}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              + Add VC
            </button>
          </div>
          <div className="space-y-2">
            {vcs.length === 0 ? (
              <div className="text-sm text-gray-400 py-4 text-center">No village councils yet.</div>
            ) : (
              vcs.map(vc => (
                <div key={vc.id} className="bg-white rounded-lg px-4 py-4 shadow-sm border border-gray-100">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        {vc.logo_url ? (
                          <img src={vc.logo_url} className="w-5 h-5 object-contain rounded flex-shrink-0" alt="" />
                        ) : (
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: vc.brand_color }}></div>
                        )}
                        <div className="text-sm font-semibold text-gray-900">{vc.name}</div>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">Prefix: {vc.property_prefix || '—'}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { setEditingVc(vc); setShowVcModal(true); }}
                        className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteVc(vc.id, vc.name)}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Survey Templates Section */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Survey Templates ({surveys.length})
            </h2>
            <button
              onClick={() => setShowSurveyBuilder(true)}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              + Create Survey
            </button>
          </div>
          <div className="space-y-2">
            {surveys.length === 0 ? (
              <div className="text-sm text-gray-400 py-4 text-center">No survey templates yet.</div>
            ) : (
              surveys.map(survey => (
                <div key={survey.id} className="bg-white rounded-lg px-4 py-4 shadow-sm border border-gray-100">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{survey.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{survey.description || 'No description'}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        {survey.fields?.length || 0} fields
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => deleteSurvey(survey.id, survey.title)}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* VC Modal */}
      {showVcModal && (
        <VcModal
          vc={editingVc}
          onClose={() => setShowVcModal(false)}
          onSave={() => { setShowVcModal(false); loadVcs(); }}
        />
      )}
    </div>
  );

  async function deleteVc(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"? This will delete all data. This cannot be undone.`)) return;
    const supabase = createClient();
    await supabase.from('village_councils').delete().eq('id', id);
    loadVcs();
  }

  async function deleteSurvey(id: string, title: string) {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
    const supabase = createClient();
    await supabase.from('survey_templates').delete().eq('id', id);
    loadSurveys();
  }
}

function VcModal({ vc, onClose, onSave }: { vc: VillageCouncil | null; onClose: () => void; onSave: () => void }) {
  const [name, setName] = useState(vc?.name || '');
  const [prefix, setPrefix] = useState(vc?.property_prefix || '');
  const [brandColor, setBrandColor] = useState(vc?.brand_color || '#1e40af');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!name.trim()) { setError('Enter VC name'); return; }
    if (!vc && (!email || !password)) { setError('Enter admin email and password'); return; }

    setLoading(true);
    setError('');
    const supabase = createClient();

    if (vc) {
      const { error } = await supabase.from('village_councils').update({ name, property_prefix: prefix, brand_color: brandColor }).eq('id', vc.id);
      if (error) { setError(error.message); setLoading(false); return; }
    } else {
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) { setError(authError.message); setLoading(false); return; }

      const { data: vcData, error: vcError } = await supabase.from('village_councils').insert({ name, property_prefix: prefix, brand_color: brandColor }).select().single();
      if (vcError) { setError(vcError.message); setLoading(false); return; }

      const { error: profileError } = await supabase.from('public_users').insert({ id: authData.user!.id, email, full_name: name + ' Admin', role: 'admin', vc_id: vcData.id, status: 'active' });
      if (profileError) { setError(profileError.message); setLoading(false); return; }
    }

    setLoading(false);
    onSave();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{vc ? 'Edit' : 'Add'} Village Council</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">VC Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Village Council" className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Property Prefix</label>
            <input type="text" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="e.g. NSN" maxLength={6} className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Brand Color</label>
            <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-12 h-10 rounded-lg border border-gray-200 cursor-pointer" />
          </div>
          {!vc && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Admin Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Admin Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </>
          )}
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
        <div className="p-5 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white py-2.5 rounded-lg text-sm font-medium transition-colors">{loading ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
