-- VC Modules Table: Maps which modules are enabled for each VC
CREATE TABLE IF NOT EXISTS vc_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vc_id UUID NOT NULL REFERENCES village_councils(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(vc_id, module_name)
);

-- Property Survey Table
CREATE TABLE IF NOT EXISTS survey_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vc_id UUID NOT NULL REFERENCES village_councils(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  property_type TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_contact TEXT,
  address TEXT NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  photo_url TEXT,
  occupancy_status TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(vc_id, property_id)
);

-- Household Survey Table
CREATE TABLE IF NOT EXISTS survey_households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES survey_properties(id) ON DELETE CASCADE,
  vc_id UUID NOT NULL REFERENCES village_councils(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  head_of_household TEXT NOT NULL,
  members JSONB NOT NULL DEFAULT '[]',
  total_members INTEGER DEFAULT 0,
  children_count INTEGER DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(property_id, family_id)
);

-- Enable RLS
ALTER TABLE vc_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_households ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vc_modules
CREATE POLICY "Users can view modules for their VC" ON vc_modules
  FOR SELECT USING (
    vc_id IN (SELECT vc_id FROM public_users WHERE user_id = auth.uid())
  );

-- RLS Policies for survey_properties
CREATE POLICY "Users can view properties in their VC" ON survey_properties
  FOR SELECT USING (
    vc_id IN (SELECT vc_id FROM public_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create properties in their VC" ON survey_properties
  FOR INSERT WITH CHECK (
    vc_id IN (SELECT vc_id FROM public_users WHERE user_id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "Users can update their properties" ON survey_properties
  FOR UPDATE USING (created_by = auth.uid());

-- RLS Policies for survey_households
CREATE POLICY "Users can view households in their VC" ON survey_households
  FOR SELECT USING (
    vc_id IN (SELECT vc_id FROM public_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create households in their VC" ON survey_households
  FOR INSERT WITH CHECK (
    vc_id IN (SELECT vc_id FROM public_users WHERE user_id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "Users can update their households" ON survey_households
  FOR UPDATE USING (created_by = auth.uid());

-- Indexes
CREATE INDEX idx_survey_properties_vc_id ON survey_properties(vc_id);
CREATE INDEX idx_survey_properties_created_by ON survey_properties(created_by);
CREATE INDEX idx_survey_households_vc_id ON survey_households(vc_id);
CREATE INDEX idx_survey_households_property_id ON survey_households(property_id);
CREATE INDEX idx_survey_households_created_by ON survey_households(created_by);
