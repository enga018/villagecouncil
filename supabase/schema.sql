-- Village Council Management Platform - New Schema
-- Run this in Supabase SQL Editor

-- Drop existing tables if they exist (for clean migration)
DROP TABLE IF EXISTS survey_responses CASCADE;
DROP TABLE IF EXISTS survey_assignments CASCADE;
DROP TABLE IF EXISTS vc_survey_access CASCADE;
DROP TABLE IF EXISTS survey_templates CASCADE;
DROP TABLE IF EXISTS public_users CASCADE;
DROP TABLE IF EXISTS village_councils CASCADE;

-- Village Councils (tenants)
CREATE TABLE village_councils (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  property_prefix TEXT NOT NULL DEFAULT '',
  brand_color TEXT DEFAULT '#1e40af',
  logo_url TEXT DEFAULT NULL,
  id_digit_length INTEGER DEFAULT 4,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Public Users (linked to auth.users)
CREATE TABLE public_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'worker', 'supervisor')),
  vc_id UUID REFERENCES village_councils(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Survey Templates (no-code survey builder)
CREATE TABLE survey_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings JSONB NOT NULL DEFAULT '{"auto_capture_gps": false, "allow_drafts": true, "require_photos": false}'::jsonb,
  created_by UUID REFERENCES public_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- VC Survey Access (which VCs can use which surveys)
CREATE TABLE vc_survey_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vc_id UUID NOT NULL REFERENCES village_councils(id) ON DELETE CASCADE,
  survey_template_id UUID NOT NULL REFERENCES survey_templates(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES public_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(vc_id, survey_template_id)
);

-- Survey Assignments (admin assigns surveys to workers)
CREATE TABLE survey_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  survey_template_id UUID NOT NULL REFERENCES survey_templates(id) ON DELETE CASCADE,
  vc_id UUID NOT NULL REFERENCES village_councils(id) ON DELETE CASCADE,
  assigned_to UUID NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES public_users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  due_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Survey Responses (worker submissions)
CREATE TABLE survey_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES survey_assignments(id) ON DELETE CASCADE,
  survey_template_id UUID NOT NULL REFERENCES survey_templates(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES public_users(id) ON DELETE SET NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  gps_location JSONB,
  rejection_note TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE village_councils ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc_survey_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Village Councils
CREATE POLICY "Superadmins can manage all VCs"
  ON village_councils FOR ALL
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "Admins can read their own VC"
  ON village_councils FOR SELECT
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND vc_id = village_councils.id AND role = 'admin'));

CREATE POLICY "Workers can read their own VC"
  ON village_councils FOR SELECT
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND vc_id = village_councils.id AND role IN ('worker', 'supervisor')));

-- Public Users
CREATE POLICY "Superadmins can manage all users"
  ON public_users FOR ALL
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "Admins can manage users in their VC"
  ON public_users FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public_users admin_check WHERE admin_check.id = auth.uid() AND admin_check.role = 'admin' AND admin_check.vc_id = public_users.vc_id)
  );

CREATE POLICY "Users can read their own profile"
  ON public_users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update their own profile"
  ON public_users FOR UPDATE
  USING (id = auth.uid());

-- Survey Templates
CREATE POLICY "Superadmins can manage all surveys"
  ON survey_templates FOR ALL
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "Admins can read surveys assigned to their VC"
  ON survey_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM vc_survey_access 
      JOIN public_users ON public_users.vc_id = vc_survey_access.vc_id 
      WHERE vc_survey_access.survey_template_id = survey_templates.id 
      AND public_users.id = auth.uid() 
      AND public_users.role = 'admin'
    )
  );

CREATE POLICY "Workers can read surveys assigned to them"
  ON survey_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM survey_assignments 
      JOIN public_users ON public_users.id = survey_assignments.assigned_to
      WHERE survey_assignments.survey_template_id = survey_templates.id 
      AND public_users.id = auth.uid()
      AND public_users.role IN ('worker', 'supervisor')
    )
  );

-- VC Survey Access
CREATE POLICY "Superadmins can manage survey access"
  ON vc_survey_access FOR ALL
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "Admins can read their VC's survey access"
  ON vc_survey_access FOR SELECT
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND vc_id = vc_survey_access.vc_id AND role = 'admin'));

CREATE POLICY "Workers can read their VC's survey access"
  ON vc_survey_access FOR SELECT
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND vc_id = vc_survey_access.vc_id AND role IN ('worker', 'supervisor')));

-- Survey Assignments
CREATE POLICY "Superadmins can manage all assignments"
  ON survey_assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "Admins can manage assignments in their VC"
  ON survey_assignments FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'admin' AND vc_id = survey_assignments.vc_id)
  );

CREATE POLICY "Workers can read their own assignments"
  ON survey_assignments FOR SELECT
  USING (assigned_to = auth.uid());

CREATE POLICY "Supervisors can read assignments in their VC"
  ON survey_assignments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'supervisor' AND vc_id = survey_assignments.vc_id)
  );

-- Survey Responses
CREATE POLICY "Superadmins can manage all responses"
  ON survey_responses FOR ALL
  USING (EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "Admins can manage responses in their VC"
  ON survey_responses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM survey_assignments 
      JOIN public_users ON public_users.id = auth.uid() 
      WHERE survey_assignments.id = survey_responses.assignment_id 
      AND public_users.role = 'admin' 
      AND public_users.vc_id = survey_assignments.vc_id
    )
  );

CREATE POLICY "Workers can read and write their own responses"
  ON survey_responses FOR ALL
  USING (submitted_by = auth.uid());

CREATE POLICY "Supervisors can read responses in their VC"
  ON survey_responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM survey_assignments 
      JOIN public_users ON public_users.id = auth.uid() 
      WHERE survey_assignments.id = survey_responses.assignment_id 
      AND public_users.role = 'supervisor' 
      AND public_users.vc_id = survey_assignments.vc_id
    )
  );

-- Indexes for performance
CREATE INDEX idx_public_users_vc_id ON public_users(vc_id);
CREATE INDEX idx_public_users_role ON public_users(role);
CREATE INDEX idx_survey_templates_created_by ON survey_templates(created_by);
CREATE INDEX idx_vc_survey_access_vc_id ON vc_survey_access(vc_id);
CREATE INDEX idx_vc_survey_access_survey_id ON vc_survey_access(survey_template_id);
CREATE INDEX idx_survey_assignments_vc_id ON survey_assignments(vc_id);
CREATE INDEX idx_survey_assignments_assigned_to ON survey_assignments(assigned_to);
CREATE INDEX idx_survey_responses_assignment_id ON survey_responses(assignment_id);
CREATE INDEX idx_survey_responses_submitted_by ON survey_responses(submitted_by);
CREATE INDEX idx_survey_responses_status ON survey_responses(status);

-- Storage bucket for survey images
INSERT INTO storage.buckets (id, name, public)
VALUES ('survey-images', 'survey-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Authenticated users can upload survey images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'survey-images');

CREATE POLICY "Public read access to survey images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'survey-images');

CREATE POLICY "Users can delete their own survey images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'survey-images' AND (storage.foldername(name))[1] = auth.uid()::text);
