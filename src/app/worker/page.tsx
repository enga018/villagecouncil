'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { getProfile, logout } from '@/lib/auth';
import type { UserProfile, SurveyAssignment, SurveyTemplate } from '@/types';
import SurveyForm from '@/components/surveys/SurveyForm';

export default function WorkerPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<(SurveyAssignment & { survey_templates: SurveyTemplate })[]>([]);
  const [activeAssignment, setActiveAssignment] = useState<string | null>(null);
  const [activeSurvey, setActiveSurvey] = useState<SurveyTemplate | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const profile = await getProfile();
    if (!profile || !['worker', 'supervisor'].includes(profile.profile.role)) {
      window.location.href = '/login';
      return;
    }
    setCtx(profile);
    await loadAssignments(profile.profile.id);
    setLoading(false);
  }

  async function loadAssignments(userId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from('survey_assignments')
      .select('*, survey_templates(*)')
      .eq('assigned_to', userId)
      .order('created_at', { ascending: false });
    setAssignments((data || []) as (SurveyAssignment & { survey_templates: SurveyTemplate })[]);
  }

  function openSurvey(assignment: SurveyAssignment & { survey_templates: SurveyTemplate }) {
    setActiveAssignment(assignment.id);
    setActiveSurvey(assignment.survey_templates);
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

  if (activeSurvey && activeAssignment) {
    return (
      <SurveyForm
        survey={activeSurvey}
        assignmentId={activeAssignment}
        onBack={() => { setActiveAssignment(null); setActiveSurvey(null); loadAssignments(ctx!.profile.id); }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-800 text-white shadow-lg" style={{ backgroundColor: ctx?.vc?.brand_color || '#1e40af' }}>
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-sm leading-none">{ctx?.vc?.name || 'Council'}</div>
              <div className="text-blue-300 text-xs mt-0.5">{ctx?.profile.full_name}</div>
            </div>
          </div>
          <button onClick={logout} className="text-blue-200 hover:text-white text-sm transition-colors">Logout</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="text-2xl font-bold text-gray-900">{assignments.length}</div>
            <div className="text-xs text-gray-500 mt-1">Total Assignments</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="text-2xl font-bold text-gray-900">{assignments.filter(a => a.status === 'completed').length}</div>
            <div className="text-xs text-gray-500 mt-1">Completed</div>
          </div>
        </div>

        {/* Assignments */}
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Your Assignments</h2>
        <div className="space-y-2">
          {assignments.length === 0 ? (
            <div className="text-sm text-gray-400 py-4 text-center">No assignments yet.</div>
          ) : (
            assignments.map(a => (
              <div key={a.id} className="bg-white rounded-lg px-4 py-4 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{a.survey_templates.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {a.survey_templates.description || 'No description'}
                    </div>
                    {a.due_date && (
                      <div className="text-xs text-gray-400 mt-1">
                        Due: {new Date(a.due_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      a.status === 'completed' ? 'bg-green-100 text-green-700' :
                      a.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {a.status}
                    </span>
                    <button
                      onClick={() => openSurvey(a)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {a.status === 'completed' ? 'View' : 'Start'} →
                    </button>
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
