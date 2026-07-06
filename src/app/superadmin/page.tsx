"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { getProfile, logout } from "@/lib/auth";
import Sidebar from "@/components/ui/Sidebar";
import Tabs from "@/components/ui/Tabs";
import InfoCard from "@/components/ui/InfoCard";
import ListCard from "@/components/ui/ListCard";
import Modal from "@/components/ui/Modal";
import SurveyBuilder from "@/components/surveys/SurveyBuilder";
import type { UserProfile, VillageCouncil, SurveyTemplate } from "@/types";

export default function SuperAdminPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [vcs, setVcs] = useState<VillageCouncil[]>([]);
  const [surveys, setSurveys] = useState<SurveyTemplate[]>([]);
  const [activeTab, setActiveTab] = useState("vcs");
  const [showSurveyBuilder, setShowSurveyBuilder] = useState(false);
  const [showVcModal, setShowVcModal] = useState(false);
  const [editingVc, setEditingVc] = useState<VillageCouncil | null>(null);

  useEffect(() => {
    async function loadData() {
      const profile = await getProfile();
      if (!profile || profile.profile.role !== "superadmin") {
        window.location.href = "/login";
        return;
      }
      setCtx(profile);
      await Promise.all([loadVcs(), loadSurveys()]);
      setLoading(false);
    }

    loadData();
  }, []);

  async function loadVcs() {
    const supabase = createClient();
    const { data } = await supabase.from("village_councils").select("*").order("name");
    setVcs(data || []);
  }

  async function loadSurveys() {
    const supabase = createClient();
    const { data } = await supabase
      .from("survey_templates")
      .select("*")
      .order("created_at", { ascending: false });
    setSurveys(data || []);
  }

  async function deleteVc(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"? This will delete all data. This cannot be undone.`)) return;
    const supabase = createClient();
    await supabase.from("village_councils").delete().eq("id", id);
    loadVcs();
  }

  async function deleteSurvey(id: string, title: string) {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
    const supabase = createClient();
    await supabase.from("survey_templates").delete().eq("id", id);
    loadSurveys();
  }

  const tabs = [
    { id: "vcs", label: "Village Councils", count: vcs.length },
    { id: "surveys", label: "Survey Templates", count: surveys.length },
  ];

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
    <div className="min-h-screen bg-white flex">
      <Sidebar
        brand={{ name: "Village Council", subtitle: "Super Admin" }}
        items={[
          {
            id: "vcs",
            label: "Village Councils",
            active: activeTab === "vcs",
            badge: vcs.length,
            onClick: () => setActiveTab("vcs"),
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            ),
          },
          {
            id: "surveys",
            label: "Survey Templates",
            active: activeTab === "surveys",
            badge: surveys.length,
            onClick: () => setActiveTab("surveys"),
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
          },
        ]}
        footer={{
          userName: ctx?.profile.full_name || "",
          userRole: "superadmin",
          onLogout: () => logout(),
        }}
      />

      <main className="flex-1 p-6 lg:p-8 pt-20 lg:pt-8 overflow-x-auto min-w-0">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6 flex-wrap">
          <span className="hover:text-gray-700 cursor-pointer transition-colors">Dashboard</span>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-900 font-medium">
            {activeTab === "vcs" ? "Village Councils" : "Survey Templates"}
          </span>
        </nav>

        {/* Title */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            {activeTab === "vcs" ? "Village Councils" : "Survey Templates"}
          </h1>
          <p className="text-sm text-gray-500">
            {activeTab === "vcs"
              ? "Manage village councils and their tenant settings."
              : "Create and manage reusable survey templates."}
          </p>
        </div>

        {/* Info Card */}
        <InfoCard
          items={[
            { label: "Village Councils", value: vcs.length },
            { label: "Survey Templates", value: surveys.length },
            { label: "GPS-enabled Surveys", value: surveys.filter((s) => s.settings.auto_capture_gps).length },
            { label: "Photo-required Surveys", value: surveys.filter((s) => s.settings.require_photos).length },
          ]}
          className="mb-6"
        />

        {/* Tabs + Create button */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
          {activeTab === "vcs" ? (
            <button
              onClick={() => { setEditingVc(null); setShowVcModal(true); }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              + Add VC
            </button>
          ) : (
            <button
              onClick={() => setShowSurveyBuilder(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              + Create Survey
            </button>
          )}
        </div>

        {/* Village Councils list */}
        {activeTab === "vcs" && (
          <div className="space-y-2">
            {vcs.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-lg">
                No village councils yet.
              </div>
            ) : (
              vcs.map((vc) => (
                <ListCard
                  key={vc.id}
                  title={vc.name}
                  subtitle={`Prefix: ${vc.property_prefix || "—"}`}
                  meta={`${vc.id_digit_length || 4} digit property IDs`}
                  actions={
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
                  }
                />
              ))
            )}
          </div>
        )}

        {/* Survey Templates list */}
        {activeTab === "surveys" && (
          <div className="space-y-2">
            {surveys.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-lg">
                No survey templates yet.
              </div>
            ) : (
              surveys.map((survey) => (
                <ListCard
                  key={survey.id}
                  title={survey.title}
                  subtitle={survey.description || "No description"}
                  meta={`${survey.fields?.length || 0} fields`}
                  actions={
                    <button
                      onClick={() => deleteSurvey(survey.id, survey.title)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      Delete
                    </button>
                  }
                />
              ))
            )}
          </div>
        )}
      </main>

      {showVcModal && (
        <VcModal
          vc={editingVc}
          onClose={() => setShowVcModal(false)}
          onSave={() => { setShowVcModal(false); loadVcs(); }}
        />
      )}
    </div>
  );
}

function VcModal({ vc, onClose, onSave }: { vc: VillageCouncil | null; onClose: () => void; onSave: () => void }) {
  const [name, setName] = useState(vc?.name || "");
  const [prefix, setPrefix] = useState(vc?.property_prefix || "");
  const [brandColor, setBrandColor] = useState(vc?.brand_color || "#1e40af");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!name.trim()) { setError("Enter VC name"); return; }
    if (!vc && (!email || !password)) { setError("Enter admin email and password"); return; }

    setLoading(true);
    setError("");
    const supabase = createClient();

    if (vc) {
      const { error } = await supabase
        .from("village_councils")
        .update({ name, property_prefix: prefix, brand_color: brandColor })
        .eq("id", vc.id);
      if (error) { setError(error.message); setLoading(false); return; }
    } else {
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) { setError(authError.message); setLoading(false); return; }

      const { data: vcData, error: vcError } = await supabase
        .from("village_councils")
        .insert({ name, property_prefix: prefix, brand_color: brandColor })
        .select()
        .single();
      if (vcError) { setError(vcError.message); setLoading(false); return; }

      const { error: profileError } = await supabase.from("public_users").insert({
        id: authData.user!.id,
        email,
        full_name: name + " Admin",
        role: "admin",
        vc_id: vcData.id,
        status: "active",
      });
      if (profileError) { setError(profileError.message); setLoading(false); return; }
    }

    setLoading(false);
    onSave();
  }

  return (
    <Modal
      title={vc ? "Edit Village Council" : "Add Village Council"}
      subtitle={vc ? "Update the village council settings." : "Create a new village council and admin account."}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Saving..." : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">VC Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. North Village Council"
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Property Prefix</label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            placeholder="e.g. NSN"
            maxLength={6}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Brand Color</label>
          <input
            type="color"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            className="w-12 h-10 rounded-lg border border-gray-200 cursor-pointer"
          />
        </div>
        {!vc && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Admin Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Admin Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </>
        )}
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      </div>
    </Modal>
  );
}
