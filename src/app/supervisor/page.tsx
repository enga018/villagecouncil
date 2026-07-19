'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { getProfile, logout } from '@/lib/auth';
import { validateVCAccess } from '@/lib/vcValidation';
import type { UserProfile, SurveyResponse, SurveyTemplate } from '@/types';

export default function SupervisorPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState<(SurveyResponse & { survey_templates: SurveyTemplate; public_users: { full_name: string } })[]>([]);

  useEffect(() => {
    async function loadData() {
      const profile = await getProfile();
      if (!profile || profile.profile.role !== 'supervisor') {
        window.location.href = '/login';
        return;
      }

      if (!validateVCAccess(profile)) {
        return;
      }

      setCtx(profile);
      await loadResponses(profile.vc?.id || '');
      setLoading(false);
    }
    loadData();
  }, []);

  async function loadResponses(vcId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from('survey_responses')
      .select('*, survey_templates(title), public_users!submitted_by(full_name)')
      .in('assignment_id', (await supabase.from('survey_assignments').select('id').eq('vc_id', vcId)).data?.map(a => a.id) || [])
      .order('created_at', { ascending: false });
    setResponses((data || []) as (SurveyResponse & { survey_templates: SurveyTemplate; public_users: { full_name: string } })[]);
  }

  async function approveResponse(id: string) {
    const supabase = createClient();
    await supabase.from('survey_responses').update({ status: 'approved' }).eq('id', id);
    loadResponses(ctx!.vc!.id);
  }

  async function rejectResponse(id: string) {
    const note = prompt('Reason for rejection:');
    if (!note) return;
    const supabase = createClient();
    await supabase.from('survey_responses').update({ status: 'rejected', rejection_note: note }).eq('id', id);
    loadResponses(ctx!.vc!.id);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  const total = responses.length;
  const submitted = responses.filter(r => r.status === 'submitted').length;
  const approved = responses.filter(r => r.status === 'approved').length;
  const rejected = responses.filter(r => r.status === 'rejected').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-teal-800 text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-teal-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-sm leading-none">{ctx?.vc?.name || 'Council'}</div>
              <div className="text-teal-300 text-xs mt-0.5">{ctx?.profile.full_name} · Supervisor</div>
            </div>
          </div>
          <button onClick={logout} className="text-teal-200 hover:text-white text-sm transition-colors">Logout</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <p className="text-xs text-gray-400 mb-6">Review and manage survey submissions from workers.</p>

        <div className="grid grid-cols-4 gap-3 mb-8">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="text-2xl font-bold text-gray-900">{total}</div>
            <div className="text-xs text-gray-500 mt-1">Total</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="text-2xl font-bold text-gray-900">{submitted}</div>
            <div className="text-xs text-gray-500 mt-1">Submitted</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="text-2xl font-bold text-gray-900">{approved}</div>
            <div className="text-xs text-gray-500 mt-1">Approved</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="text-2xl font-bold text-gray-900">{rejected}</div>
            <div className="text-xs text-gray-500 mt-1">Rejected</div>
          </div>
        </div>

        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">All Submissions</h2>
        <div className="space-y-2">
          {responses.length === 0 ? (
            <div className="text-sm text-gray-400 py-4 text-center">No submissions yet.</div>
          ) : (
            responses.map(r => (
              <div key={r.id} className="bg-white rounded-lg px-4 py-4 shadow-sm border border-gray-100">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{r.survey_templates?.title || 'Survey'}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      By {r.public_users?.full_name || 'Unknown'} · {new Date(r.created_at).toLocaleDateString()}
                    </div>
                    {r.rejection_note && (
                      <div className="text-xs text-red-600 mt-2 bg-red-50 rounded px-2 py-1.5">{r.rejection_note}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      r.status === 'approved' ? 'bg-green-100 text-green-700' :
                      r.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      r.status === 'draft' ? 'bg-gray-100 text-gray-600' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {r.status}
                    </span>
                    {r.status === 'submitted' && (
                      <div className="flex gap-2">
                        <button onClick={() => approveResponse(r.id)} className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-lg font-medium transition-colors">Approve</button>
                        <button onClick={() => rejectResponse(r.id)} className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg font-medium transition-colors">Reject</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
