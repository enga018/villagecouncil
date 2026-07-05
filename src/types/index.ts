export type UserRole = 'superadmin' | 'admin' | 'worker' | 'supervisor';

export interface VillageCouncil {
  id: string;
  name: string;
  property_prefix: string;
  brand_color: string;
  logo_url: string | null;
  id_digit_length: number;
  created_at: string;
}

export interface PublicUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  vc_id: string | null;
  status: 'active' | 'pending' | 'inactive';
  created_at: string;
}

export interface SurveyTemplate {
  id: string;
  title: string;
  description: string | null;
  fields: SurveyField[];
  settings: SurveySettings;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SurveyField {
  id: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox' | 'date' | 'image' | 'geolocation';
  label: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
  condition?: FieldCondition;
}

export interface FieldCondition {
  field_id: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
  value: string | number | boolean;
}

export interface SurveySettings {
  auto_capture_gps: boolean;
  allow_drafts: boolean;
  require_photos: boolean;
}

export interface VCSurveyAccess {
  id: string;
  vc_id: string;
  survey_template_id: string;
  granted_by: string;
  created_at: string;
}

export interface SurveyAssignment {
  id: string;
  survey_template_id: string;
  vc_id: string;
  assigned_to: string;
  assigned_by: string;
  status: 'pending' | 'in_progress' | 'completed';
  due_date: string | null;
  created_at: string;
}

export interface SurveyResponse {
  id: string;
  assignment_id: string;
  survey_template_id: string;
  submitted_by: string;
  data: Record<string, unknown>;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  gps_location: { lat: number; lng: number } | null;
  rejection_note: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  user: { id: string; email?: string };
  profile: PublicUser;
  vc: VillageCouncil | null;
}
