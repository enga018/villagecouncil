-- Add branding columns to tenants table
-- Run this in Supabase SQL Editor

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#1e40af';

COMMENT ON COLUMN tenants.brand_color IS 'Primary brand color for the VC dashboard (hex code)';
