-- Tenant Module Assignments Table
-- Maps modules to village councils (tenants)

CREATE TABLE IF NOT EXISTS tenant_module_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_code TEXT NOT NULL, -- 'property', 'family', 'property_tax', etc.
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure each module is assigned only once per tenant
  UNIQUE(tenant_id, app_code)
);

-- Enable RLS
ALTER TABLE tenant_module_assignments ENABLE ROW LEVEL SECURITY;

-- Policy: Super admins can read/write all assignments
CREATE POLICY "Super admins can manage tenant module assignments"
  ON tenant_module_assignments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- Policy: Admins can read their own tenant's assignments
CREATE POLICY "Admins can read their tenant module assignments"
  ON tenant_module_assignments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.tenant_id = tenant_module_assignments.tenant_id
      AND profiles.role = 'admin'
    )
  );

-- Policy: Workers can read their own tenant's assignments
CREATE POLICY "Workers can read their tenant module assignments"
  ON tenant_module_assignments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.tenant_id = tenant_module_assignments.tenant_id
      AND profiles.role IN ('worker', 'supervisor')
    )
  );

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tenant_module_assignments_tenant_id 
  ON tenant_module_assignments(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_module_assignments_app_code 
  ON tenant_module_assignments(app_code);
