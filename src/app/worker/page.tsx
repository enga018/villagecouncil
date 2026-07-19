"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { getProfile, logout } from "@/lib/auth";
import { validateVCAccess } from "@/lib/vcValidation";
import Sidebar from "@/components/ui/Sidebar";
import Tabs from "@/components/ui/Tabs";
import InfoCard from "@/components/ui/InfoCard";
import ListCard from "@/components/ui/ListCard";
import SurveyForm from "@/components/surveys/SurveyForm";
import type { UserProfile, SurveyAssignment, SurveyTemplate } from "@/types";

export default function WorkerPage() {
  const [ctx, setCtx] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<(SurveyAssignment & { survey_templates: SurveyTemplate })[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [activeAssignment, setActiveAssignment] = useState<string | null>(null);
  const [activeSurvey, setActiveSurvey] = useState<SurveyTemplate | null>(null);

  useEffect(() => {
    async function loadData() {
      const profile = await getProfile();
      if (!profile || !["worker", "supervisor"].includes(profile.profile.role)) {
        window.location.href = "/login";
        return;
      }

      if (!validateVCAccess(profile)) {
        return;
      }

      setCtx(profile);
      await loadAssignments(profile.profile.id);
      setLoading(false);
    }

    loadData();
  }, []);

  async function loadAssignments(userId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("survey_assignments")
      .select("*, survey_templates(*)")
      .eq("assigned_to", userId)
      .order("created_at", { ascending: false });
    setAssignments((data || []) as (SurveyAssignment & { survey_templates: SurveyTemplate })[]);
  }

  function openSurvey(assignment: SurveyAssignment & { survey_templates: SurveyTemplate }) {
    setActiveAssignment(assignment.id);
    setActiveSurvey(assignment.survey_templates);
  }

  const filteredAssignments = assignments.filter((a) => {
    if (activeTab === "all") return true;
    if (activeTab === "pending") return a.status !== "completed";
    return a.status === activeTab;
  });

  const tabCounts = {
    all: assignments.length,
    pending: assignments.filter((a) => a.status !== "completed").length,
    completed: assignments.filter((a) => a.status === "completed").length,
  };

  const tabs = [
    { id: "all", label: "All", count: tabCounts.all },
    { id: "pending", label: "Pending", count: tabCounts.pending },
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

  if (activeSurvey && activeAssignment) {
    return (
      <SurveyForm
        survey={activeSurvey}
        assignmentId={activeAssignment}
        onBack={() => {
          setActiveAssignment(null);
          setActiveSurvey(null);
          if (ctx) loadAssignments(ctx.profile.id);
        }}
      />
    );
  }

  const vcInitial = ctx?.vc?.name ? ctx.vc.name.charAt(0).toUpperCase() : "C";
  const roleLabel = ctx?.profile.role === "supervisor" ? "Supervisor" : "Worker";

  return (
    <div className="min-h-screen bg-white flex">
      <Sidebar
        brand={{ name: ctx?.vc?.name || "Council", subtitle: `${roleLabel} Portal` }}
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
            id: "assignments",
            label: "My Assignments",
            badge: tabCounts.pending,
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            ),
          },
          {
            id: "completed",
            label: "Completed",
            badge: tabCounts.completed,
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
          },
        ]}
        footer={{
          userName: ctx?.profile.full_name || "",
          userRole: roleLabel,
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
          <span className="text-gray-900 font-medium">My Assignments</span>
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
            <h1 className="text-2xl font-bold text-gray-900">My Assignments</h1>
          </div>
          <p className="text-sm text-gray-500">
            {ctx?.profile.role === "supervisor"
              ? "Review survey assignments in your village council."
              : "View and complete your assigned surveys."}
          </p>
        </div>

        {/* Info Card */}
        <InfoCard
          items={[
            { label: "Village Council", value: ctx?.vc?.name || "—" },
            { label: "Total Assignments", value: assignments.length },
            { label: "Pending", value: tabCounts.pending },
            { label: "Completed", value: tabCounts.completed },
          ]}
          className="mb-6"
        />

        {/* Tabs */}
        <div className="mb-6">
          <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
        </div>

        {/* Assignment list */}
        <div className="space-y-2">
          {filteredAssignments.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-lg">
              No assignments found.
            </div>
          ) : (
            filteredAssignments.map((a) => (
              <ListCard
                key={a.id}
                title={a.survey_templates.title}
                subtitle={a.survey_templates.description || "No description"}
                meta={a.due_date ? `Due: ${new Date(a.due_date).toLocaleDateString()}` : undefined}
                badge={statusBadge(a.status)}
                actions={
                  <button
                    onClick={() => openSurvey(a)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {a.status === "completed" ? "View →" : "Start →"}
                  </button>
                }
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
}
