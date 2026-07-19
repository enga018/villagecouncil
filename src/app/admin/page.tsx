"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { getProfile, logout } from "@/lib/auth";
import { getSubdomainContext, redirectToVC } from "@/lib/subdomain";
import Sidebar from "@/components/ui/Sidebar";
import Tabs from "@/components/ui/Tabs";
import InfoCard from "@/components/ui/InfoCard";
import ListCard from "@/components/ui/ListCard";
import Modal from "@/components/ui/Modal";
import type { UserProfile, SurveyTemplate, SurveyAssignment } from "@/types";

export default function AdminPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [surveys, setSurveys] = useState<SurveyTemplate[]>([]);
  const [workers, setWorkers] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [assignments, setAssignments] = useState<(SurveyAssignment & { survey_templates: SurveyTemplate; public_users: { full_name: string } })[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showAddWorkerModal, setShowAddWorkerModal] = useState(false);

  useEffect(() => {
    async function loadData() {
      const profile = await getProfile();
      if (!profile || profile.profile.role !== "admin") {
        window.location.href = "/login";
        return;
      }

      // Validate subdomain matches user's VC
      const subdomain = getSubdomainContext();
      if (!subdomain.isMainDomain && profile.vc) {
        const vcNameFromSubdomain = subdomain.vcName?.toLowerCase().replace('-', ' ');
        const userVcName = profile.vc.name.toLowerCase();
        if (vcNameFromSubdomain !== userVcName) {
          redirectToVC(profile.vc.name);
          return;
        }
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
      .from("survey_templates")
      .select("*")
      .in(
        "id",
        (await supabase.from("vc_survey_access").select("survey_template_id").eq("vc_id", profile.vc?.id || "")).data?.map((a) => a.survey_template_id) || []
      )
      .order("title");
    setSurveys(data || []);
  }

  async function loadWorkers(profile: UserProfile) {
    if (!profile.vc?.id) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("public_users")
      .select("id, full_name, email")
      .eq("vc_id", profile.vc.id)
      .in("role", ["worker", "supervisor"])
      .eq("status", "active")
      .order("full_name");
    setWorkers(data || []);
  }

  async function loadAssignments(profile: UserProfile) {
    if (!profile.vc?.id) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("survey_assignments")
      .select("*, survey_templates(title), public_users!assigned_to(full_name)")
      .eq("vc_id", profile.vc.id)
      .order("created_at", { ascending: false });
    setAssignments(data || []);
  }

  const filteredAssignments = assignments.filter((a) =>
    activeTab === "all" ? true : a.status === activeTab
  );

  const tabCounts = {
    all: assignments.length,
    pending: assignments.filter((a) => a.status === "pending").length,
    in_progress: assignments.filter((a) => a.status === "in_progress").length,
    completed: assignments.filter((a) => a.status === "completed").length,
  };

  const tabs = [
    { id: "workers", label: "Workers", count: workers.length },
    { id: "all", label: "All", count: tabCounts.all },
    { id: "pending", label: "Pending", count: tabCounts.pending },
    { id: "in_progress", label: "In Progress", count: tabCounts.in_progress },
    { id: "completed", label: "Completed", count: tabCounts.completed },
  ];

  function statusBadge(status: string) {
    switch (status) {
      case "completed":
        return { text: "Completed", className: "bg-green-100 text-green-700" };
      case "in_progress":
        return { text: "In Progress", className: "bg-blue-100 text-blue-700" };
      default:
        return { text: "Pending", className: "bg-gray-100 text-gray-600" };
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

  const vcInitial = ctx?.vc?.name ? ctx.vc.name.charAt(0).toUpperCase() : "C";

  return (
    <div className="min-h-screen bg-white flex">
      <Sidebar
        brand={{ name: ctx?.vc?.name || "Council", subtitle: "Admin Portal" }}
        items={[
          {
            id: "dashboard",
            label: "Dashboard",
            active: true,
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            ),
          },
          {
            id: "surveys",
            label: "Surveys",
            badge: surveys.length,
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
          },
          {
            id: "workers",
            label: "Workers",
            badge: workers.length,
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            ),
          },
          {
            id: "assignments",
            label: "Assignments",
            badge: tabCounts.pending,
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            ),
          },
        ]}
        footer={{
          userName: ctx?.profile.full_name || "",
          userRole: "admin",
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
          <span className="text-gray-900 font-medium">{activeTab === "workers" ? "Workers" : "Assignments"}</span>
        </nav>

        {/* Title */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold"
              style={{ backgroundColor: ctx?.vc?.brand_color || "#1e40af" }}
            >
              {vcInitial}
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              {activeTab === "workers" ? "Workers" : "Survey Assignments"}
            </h1>
          </div>
          <p className="text-sm text-gray-500">
            {activeTab === "workers"
              ? "Manage workers and supervisors in your village council."
              : "Manage and track survey assignments for your village council."}
          </p>
        </div>

        {/* Info Card */}
        <InfoCard
          items={[
            { label: "Village Council", value: ctx?.vc?.name || "—" },
            { label: "Workers", value: workers.length },
            { label: "Available Surveys", value: surveys.length },
            { label: "Total Assignments", value: assignments.length },
          ]}
          className="mb-6"
        />

        {/* Tabs + Action button */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
          {activeTab === "workers" ? (
            <button
              onClick={() => setShowAddWorkerModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              + Add Worker
            </button>
          ) : (
            <button
              onClick={() => setShowAssignModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              + Create Assignment
            </button>
          )}
        </div>

        {/* Workers list */}
        {activeTab === "workers" && (
          <div className="space-y-2">
            {workers.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-lg">
                No workers yet. Add a worker to get started.
              </div>
            ) : (
              workers.map((w) => (
                <ListCard
                  key={w.id}
                  title={w.full_name}
                  subtitle={w.email}
                />
              ))
            )}
          </div>
        )}

        {/* Assignment list */}
        {activeTab !== "workers" && (
          <div className="space-y-2">
            {filteredAssignments.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-lg">
                No assignments found.
              </div>
            ) : (
              filteredAssignments.map((a) => (
                <ListCard
                  key={a.id}
                  title={a.survey_templates?.title || "Survey"}
                  subtitle={`Assigned to ${a.public_users?.full_name || "Worker"}`}
                  meta={a.due_date ? `Due: ${new Date(a.due_date).toLocaleDateString()}` : undefined}
                  badge={statusBadge(a.status)}
                />
              ))
            )}
          </div>
        )}
      </main>

      {showAssignModal && (
        <AssignModal
          surveys={surveys}
          workers={workers}
          vcId={ctx?.vc?.id || ""}
          assignedBy={ctx?.profile.id || ""}
          onClose={() => setShowAssignModal(false)}
          onSave={() => {
            setShowAssignModal(false);
            if (ctx) loadAssignments(ctx);
          }}
        />
      )}

      {showAddWorkerModal && ctx && (
        <AddWorkerModal
          vcId={ctx.vc?.id || ""}
          onClose={() => setShowAddWorkerModal(false)}
          onSave={() => {
            setShowAddWorkerModal(false);
            if (ctx) loadWorkers(ctx);
          }}
        />
      )}
    </div>
  );
}

function AssignModal({
  surveys,
  workers,
  vcId,
  assignedBy,
  onClose,
  onSave,
}: {
  surveys: SurveyTemplate[];
  workers: { id: string; full_name: string; email: string }[];
  vcId: string;
  assignedBy: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const [surveyId, setSurveyId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!surveyId) {
      setError("Select a survey");
      return;
    }
    if (!workerId) {
      setError("Select a worker");
      return;
    }

    setLoading(true);
    setError("");
    const supabase = createClient();

    const { error } = await supabase.from("survey_assignments").insert({
      survey_template_id: surveyId,
      vc_id: vcId,
      assigned_to: workerId,
      assigned_by: assignedBy,
      due_date: dueDate || null,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setLoading(false);
    onSave();
  }

  return (
    <Modal
      title="Create Assignment"
      subtitle="Assign a survey template to a worker in your village council."
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
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Survey Template</label>
          <select
            value={surveyId}
            onChange={(e) => setSurveyId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Select survey...</option>
            {surveys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Assign to Worker</label>
          <select
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Select worker...</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Due Date (optional)</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      </div>
    </Modal>
  );
}

function AddWorkerModal({
  vcId,
  onClose,
  onSave,
}: {
  vcId: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"worker" | "supervisor">("worker");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!fullName.trim()) { setError("Enter full name"); return; }
    if (!email.trim()) { setError("Enter email"); return; }
    if (!password || password.length < 6) { setError("Password must be at least 6 characters"); return; }

    setLoading(true);
    setError("");
    const supabase = createClient();

    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) { setError(authError.message); setLoading(false); return; }

    const { error: profileError } = await supabase.from("public_users").insert({
      id: authData.user!.id,
      email,
      full_name: fullName,
      role,
      vc_id: vcId,
      status: "active",
    });
    if (profileError) { setError(profileError.message); setLoading(false); return; }

    setLoading(false);
    onSave();
  }

  return (
    <Modal
      title="Add Worker"
      subtitle="Create a new worker or supervisor account for your village council."
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
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. John Doe"
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="worker@example.com"
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "worker" | "supervisor")}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="worker">Worker</option>
            <option value="supervisor">Supervisor</option>
          </select>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      </div>
    </Modal>
  );
}
