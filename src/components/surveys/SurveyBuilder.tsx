"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import InfoCard from "@/components/ui/InfoCard";
import type { SurveyField, SurveySettings } from "@/types";

interface SurveyBuilderProps {
  onBack: () => void;
}

export default function SurveyBuilder({ onBack }: SurveyBuilderProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<SurveyField[]>([]);
  const [settings, setSettings] = useState<SurveySettings>({
    auto_capture_gps: false,
    allow_drafts: true,
    require_photos: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addField(type: SurveyField["type"]) {
    const newField: SurveyField = {
      id: crypto.randomUUID(),
      type,
      label: "",
      required: false,
      placeholder: "",
      options: type === "select" || type === "radio" || type === "checkbox" ? ["Option 1", "Option 2"] : undefined,
    };
    setFields([...fields, newField]);
  }

  function updateField(id: string, updates: Partial<SurveyField>) {
    setFields(fields.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }

  function removeField(id: string) {
    setFields(fields.filter((f) => f.id !== id));
  }

  function moveField(id: string, direction: "up" | "down") {
    const index = fields.findIndex((f) => f.id === id);
    if (direction === "up" && index > 0) {
      const newFields = [...fields];
      [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
      setFields(newFields);
    } else if (direction === "down" && index < fields.length - 1) {
      const newFields = [...fields];
      [newFields[index + 1], newFields[index]] = [newFields[index], newFields[index + 1]];
      setFields(newFields);
    }
  }

  async function handleSave() {
    if (!title.trim()) { setError("Enter survey title"); return; }
    if (fields.length === 0) { setError("Add at least one field"); return; }
    if (fields.some((f) => !f.label.trim())) { setError("All fields must have labels"); return; }

    setSaving(true);
    setError("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from("survey_templates").insert({
      title,
      description,
      fields,
      settings,
      created_by: user?.id,
    });

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    onBack();
  }

  const fieldTypes: { type: SurveyField["type"]; label: string; icon: string }[] = [
    { type: "text", label: "Text", icon: "T" },
    { type: "textarea", label: "Textarea", icon: "¶" },
    { type: "number", label: "Number", icon: "#" },
    { type: "select", label: "Dropdown", icon: "▼" },
    { type: "radio", label: "Radio", icon: "○" },
    { type: "checkbox", label: "Checkbox", icon: "☐" },
    { type: "date", label: "Date", icon: "📅" },
    { type: "image", label: "Image", icon: "📷" },
    { type: "geolocation", label: "GPS", icon: "📍" },
  ];

  function settingLabel(key: keyof SurveySettings) {
    switch (key) {
      case "auto_capture_gps": return "Auto-capture GPS location";
      case "allow_drafts": return "Allow saving as draft";
      case "require_photos": return "Require photo uploads";
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <button onClick={onBack} className="hover:text-gray-700 transition-colors">
              Super Admin
            </button>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <button onClick={onBack} className="hover:text-gray-700 transition-colors">
              Survey Templates
            </button>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-900 font-medium">Create</span>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 pb-32">
        {/* Title */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Create Survey Template</h1>
          <p className="text-sm text-gray-500">Build a reusable survey with custom fields for field workers.</p>
        </div>

        {/* Title & description */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Survey Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Property Survey 2024"
                className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this survey"
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Settings info card */}
        <InfoCard
          items={[
            { label: "GPS Capture", value: settings.auto_capture_gps ? "Enabled" : "Disabled" },
            { label: "Drafts", value: settings.allow_drafts ? "Allowed" : "Disabled" },
            { label: "Photos", value: settings.require_photos ? "Required" : "Optional" },
            { label: "Total Fields", value: fields.length },
          ]}
          className="mb-6"
        />

        {/* Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Survey Settings</h3>
          <div className="space-y-3">
            {(Object.keys(settings) as (keyof SurveySettings)[]).map((key) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                  className="w-4 h-4 text-indigo-600 rounded"
                />
                <span className="text-sm text-gray-700">{settingLabel(key)}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Fields */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Survey Fields</h3>
            <span className="text-xs text-gray-400">{fields.length} field{fields.length !== 1 ? "s" : ""}</span>
          </div>

          {fields.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-lg">
              No fields yet. Add fields using the buttons below.
            </div>
          ) : (
            <div className="space-y-4">
              {fields.map((field, index) => (
                <div key={field.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-400">#{index + 1}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                        {fieldTypes.find((t) => t.type === field.type)?.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => moveField(field.id, "up")}
                        disabled={index === 0}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => moveField(field.id, "down")}
                        disabled={index === fields.length - 1}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <button onClick={() => removeField(field.id)} className="text-red-400 hover:text-red-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Label *</label>
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => updateField(field.id, { label: e.target.value })}
                        placeholder="Field label"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {(field.type === "text" || field.type === "textarea" || field.type === "number") && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Placeholder</label>
                        <input
                          type="text"
                          value={field.placeholder || ""}
                          onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                          placeholder="Placeholder text"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    )}

                    {(field.type === "select" || field.type === "radio" || field.type === "checkbox") && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Options (one per line)</label>
                        <textarea
                          value={(field.options || []).join("\n")}
                          onChange={(e) => updateField(field.id, { options: e.target.value.split("\n").filter((o) => o.trim()) })}
                          placeholder="Option 1&#10;Option 2&#10;Option 3"
                          rows={3}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        />
                      </div>
                    )}

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(field.id, { required: e.target.checked })}
                        className="w-4 h-4 text-indigo-600 rounded"
                      />
                      <span className="text-xs text-gray-700">Required field</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add Field Buttons */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-3">Add a field:</p>
            <div className="flex flex-wrap gap-2">
              {fieldTypes.map((ft) => (
                <button
                  key={ft.type}
                  onClick={() => addField(ft.type)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <span>{ft.icon}</span>
                  <span>{ft.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Error & Save */}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 border border-gray-200 text-gray-700 font-medium py-3 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 rounded-lg text-sm transition-colors"
          >
            {saving ? "Saving..." : "Save Survey Template"}
          </button>
        </div>
      </main>
    </div>
  );
}
