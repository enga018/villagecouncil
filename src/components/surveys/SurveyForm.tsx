"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { SurveyTemplate, SurveyField, SurveyResponse } from "@/types";

interface SurveyFormProps {
  survey: SurveyTemplate;
  assignmentId: string;
  onBack: () => void;
}

export default function SurveyForm({ survey, assignmentId, onBack }: SurveyFormProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [existingResponse, setExistingResponse] = useState<SurveyResponse | null>(null);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadExistingResponse = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("survey_responses")
      .select("*")
      .eq("assignment_id", assignmentId)
      .eq("submitted_by", user.id)
      .maybeSingle();

    if (data) {
      setExistingResponse(data);
      setFormData(data.data || {});
      setGpsLocation(data.gps_location);
    }
  }, [assignmentId]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      await loadExistingResponse();
      if (!cancelled && survey.settings.auto_capture_gps) {
        captureGps();
      }
    }
    init();
    return () => { cancelled = true; };
  }, [loadExistingResponse, survey.settings.auto_capture_gps]);

  async function captureGps() {
    if (!navigator.geolocation) {
      setGpsError("Geolocation not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsError("");
      },
      (err) => {
        setGpsError("Could not capture location: " + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function updateField(fieldId: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleImageUpload(fieldId: string, file: File) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const ext = file.name.split(".").pop();
    const path = `${user.id}/${fieldId}_${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from("survey-images")
      .upload(path, file, { upsert: true });

    if (error) {
      setError("Image upload failed: " + error.message);
      return;
    }

    const { data } = supabase.storage.from("survey-images").getPublicUrl(path);
    updateField(fieldId, data.publicUrl);
    setImagePreviews((prev) => ({ ...prev, [fieldId]: URL.createObjectURL(file) }));
  }

  async function saveDraft() {
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      assignment_id: assignmentId,
      survey_template_id: survey.id,
      submitted_by: user.id,
      data: formData,
      status: "draft" as const,
      gps_location: gpsLocation,
    };

    let err;
    if (existingResponse) {
      const { error } = await supabase.from("survey_responses").update(payload).eq("id", existingResponse.id);
      err = error;
    } else {
      const { error } = await supabase.from("survey_responses").insert(payload);
      err = error;
    }

    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    await loadExistingResponse();
  }

  async function submitSurvey() {
    const requiredFields = survey.fields.filter((f) => f.required);
    const missing = requiredFields.filter((f) => {
      const val = formData[f.id];
      return val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
    });

    if (missing.length > 0) {
      setError(`Please fill in all required fields: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }

    if (survey.settings.require_photos) {
      const imageFields = survey.fields.filter((f) => f.type === "image");
      const missingPhotos = imageFields.filter((f) => !formData[f.id]);
      if (missingPhotos.length > 0) {
        setError("Photo uploads are required for this survey");
        return;
      }
    }

    setSubmitting(true);
    setError("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      assignment_id: assignmentId,
      survey_template_id: survey.id,
      submitted_by: user.id,
      data: formData,
      status: "submitted" as const,
      gps_location: gpsLocation,
      submitted_at: new Date().toISOString(),
    };

    let err;
    if (existingResponse) {
      const { error } = await supabase.from("survey_responses").update(payload).eq("id", existingResponse.id);
      err = error;
    } else {
      const { error } = await supabase.from("survey_responses").insert(payload);
      err = error;
    }

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    await supabase.from("survey_assignments").update({ status: "completed" }).eq("id", assignmentId);
    setSubmitting(false);
    onBack();
  }

  function evaluateCondition(condition: SurveyField["condition"]): boolean {
    if (!condition) return true;
    const val = formData[condition.field_id];
    switch (condition.operator) {
      case "equals": return val === condition.value;
      case "not_equals": return val !== condition.value;
      case "contains": return typeof val === "string" && val.includes(String(condition.value));
      case "greater_than": return Number(val) > Number(condition.value);
      case "less_than": return Number(val) < Number(condition.value);
      default: return true;
    }
  }

  function isFieldCompleted(field: SurveyField): boolean {
    const val = formData[field.id];
    if (val === undefined || val === null || val === "") return false;
    if (Array.isArray(val) && val.length === 0) return false;
    return true;
  }

  const completedCount = survey.fields.filter(isFieldCompleted).length;
  const totalCount = survey.fields.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  function renderField(field: SurveyField) {
    if (field.condition && !evaluateCondition(field.condition)) return null;

    const value = formData[field.id];

    switch (field.type) {
      case "text":
        return (
          <input
            type="text"
            value={(value as string) || ""}
            onChange={(e) => updateField(field.id, e.target.value)}
            placeholder={field.placeholder}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        );

      case "textarea":
        return (
          <textarea
            value={(value as string) || ""}
            onChange={(e) => updateField(field.id, e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        );

      case "number":
        return (
          <input
            type="number"
            value={(value as string) || ""}
            onChange={(e) => updateField(field.id, e.target.value)}
            placeholder={field.placeholder}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        );

      case "select":
        return (
          <select
            value={(value as string) || ""}
            onChange={(e) => updateField(field.id, e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Select...</option>
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );

      case "radio":
        return (
          <div className="space-y-2">
            {(field.options || []).map((opt) => (
              <label key={opt} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name={field.id}
                  value={opt}
                  checked={value === opt}
                  onChange={() => updateField(field.id, opt)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">{opt}</span>
              </label>
            ))}
          </div>
        );

      case "checkbox":
        return (
          <div className="space-y-2">
            {(field.options || []).map((opt) => {
              const checked = Array.isArray(value) && value.includes(opt);
              return (
                <label key={opt} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const current = Array.isArray(value) ? value : [];
                      updateField(field.id, e.target.checked ? [...current, opt] : current.filter((v: string) => v !== opt));
                    }}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">{opt}</span>
                </label>
              );
            })}
          </div>
        );

      case "date":
        return (
          <input
            type="date"
            value={(value as string) || ""}
            onChange={(e) => updateField(field.id, e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        );

      case "image":
        return (
          <div>
            <input
              type="file"
              accept="image/*"
              ref={(el) => { fileInputRefs.current[field.id] = el; }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(field.id, file);
              }}
              className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 cursor-pointer"
            />
            {(imagePreviews[field.id] || (typeof value === "string" && value)) && (
              <div className="mt-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreviews[field.id] || (value as string)}
                  alt="Preview"
                  className="w-32 h-32 object-cover rounded-lg border border-gray-200"
                />
              </div>
            )}
          </div>
        );

      case "geolocation":
        return (
          <div>
            {gpsLocation ? (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <p className="text-sm text-green-800 font-medium">Location captured</p>
                <p className="text-xs text-green-600 mt-0.5 font-mono">
                  {gpsLocation.lat.toFixed(6)}, {gpsLocation.lng.toFixed(6)}
                </p>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={captureGps}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Capture Location
                </button>
                {gpsError && <p className="text-xs text-red-500 mt-2">{gpsError}</p>}
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <button onClick={onBack} className="hover:text-gray-700 transition-colors">Dashboard</button>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <button onClick={onBack} className="hover:text-gray-700 transition-colors">Assignments</button>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-900 font-medium truncate">{survey.title}</span>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 pb-32">
        {survey.description && (
          <p className="text-sm text-gray-500 mb-6">{survey.description}</p>
        )}

        <div className="space-y-6">
          {survey.fields.map((field) => (
            <div key={field.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {isFieldCompleted(field) && (
                  <svg className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              {renderField(field)}
            </div>
          ))}
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mt-6">{error}</div>
        )}

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
          <div className="max-w-lg mx-auto flex gap-3">
            {survey.settings.allow_drafts && (
              <button
                onClick={saveDraft}
                disabled={saving}
                className="flex-1 border border-gray-200 text-gray-700 font-medium py-3 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Draft"}
              </button>
            )}
            <button
              onClick={submitSurvey}
              disabled={submitting}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 rounded-lg text-sm transition-colors"
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
