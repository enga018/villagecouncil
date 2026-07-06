'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { getProfile, logout } from '@/lib/auth';
import type { UserProfile, SurveyTemplate, SurveyAssignment } from '@/types';

export default function AdminPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [surveys, setSurveys] = useState<SurveyTemplate[]>([]);
  const [workers, setWorkers] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [assignments, setAssignments] = useState<(SurveyAssignment & { survey_templates: SurveyTemplate; public_users: { full_name: string } })[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);

  useEffect(() => {
    async function loadData() {
      const profile = await getProfile();
      if (!profile || profile.profile.role !== 'admin') {
        window.location.href = '/login';
        return;
      }
      setCtx(profile);
      await Promise.all([loadSurveys(profile), loadWorkers(profile), loadAssignments(profile)]);
      setLoading(false);
    }

    loadData();
  }, []);

  async function loadSurveys(profile: UserProfile) {
    const supabase = createClient();
    const { data } = await supabase
      .from('survey_templates')
      .select('*')
      .in('id', (await supabase.from('vc_survey_access').select('survey_template_id').eq('vc_id', profile.vc?.id || '')).data?.map(a => a.survey_template_id) || [])
      .order('title');
    setSurveys(data || []);
  }

  async function loadWorkers(profile: UserProfile) {
    if (!profile.vc?.id) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('public_users')
      .select('id, full_name, email')
      .eq('vc_id', profile.vc.id)
      .in('role', ['worker', 'supervisor'])
      .eq('status', 'active')
      .order('full_name');
    setWorkers(data || []);
  }

  async function loadAssignments(profile: UserProfile) {
    if (!profile.vc?.id) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('survey_assignments')
      .select('*, survey_templates(title), public_users!assigned_to(full_name)')
      .eq('vc_id', profile.vc.id)
      .order('created_at', { ascending: false });
    setAssignments(data || []);
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
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="text-2xl font-bold text-gray-900">{workers.length}</div>
            <div className="text-xs text-gray-500 mt-1">Workers</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="text-2xl font-bold text-gray-900">{surveys.length}</div>
            <div className="text-xs text-gray-500 mt-1">Available Surveys</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="text-2xl font-bold text-gray-900">{assignments.length}</div>
            <div className="text-xs text-gray-500 mt-1">Assignments</div>
          </div>
        </div>

        {/* Create Assignment */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Survey Assignments</h2>
          <button
            onClick={() => setShowAssignModal(true)}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
          >
            + Create Assignment
          </button>
        </div>

        <div className="space-y-2">
          {assignments.length === 0 ? (
            <div className="text-sm text-gray-400 py-4 text-center">No assignments yet.</div>
          ) : (
              assignments.map(a => (
              <div key={a.id} className="bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{a.survey_templates?.title || 'Survey'}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Assigned to {a.public_users?.full_name || 'Worker'} · {a.status}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    a.status === 'completed' ? 'bg-green-100 text-green-700' :
                    a.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {a.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {showAssignModal && (
        <AssignModal
          surveys={surveys}
          workers={workers}
          vcId={ctx?.vc?.id || ''}
          assignedBy={ctx?.profile.id || ''}
          onClose={() => setShowAssignModal(false)}
          onSave={() => { setShowAssignModal(false); loadAssignments(ctx!); }}
        />
      )}
    </div>
  );
}

function AssignModal({ surveys, workers, vcId, assignedBy, onClose, onSave }: {
  surveys: SurveyTemplate[];
  workers: { id: string; full_name: string; email: string }[];
  vcId: string;
  assignedBy: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const [surveyId, setSurveyId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!surveyId) { setError('Select a survey'); return; }
    if (!workerId) { setError('Select a worker'); return; }

    setLoading(true);
    setError('');
    const supabase = createClient();

    const { error } = await supabase.from('survey_assignments').insert({
      survey_template_id: surveyId,
      vc_id: vcId,
      assigned_to: workerId,
      assigned_by: assignedBy,
      due_date: dueDate || null,
    });

    if (error) { setError(error.message); setLoading(false); return; }
    setLoading(false);
    onSave();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Create Assignment</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Survey Template</label>
            <select value={surveyId} onChange={(e) => setSurveyId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">Select survey...</option>
              {surveys.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Assign to Worker</label>
            <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">Select worker...</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Due Date (optional)</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
        <div className="p-5 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2.5 rounded-lg text-sm font-medium transition-colors">{loading ? 'Creating...' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}
