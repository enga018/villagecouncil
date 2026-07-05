-- Add branding columns to tenants table
-- Run this in Supabase SQL Editor

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#1e40af',
ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT NULL;

COMMENT ON COLUMN tenants.brand_color IS 'Primary brand color for the VC dashboard (hex code)';
COMMENT ON COLUMN tenants.logo_url IS 'URL of the VC logo image';

-- Create storage bucket for VC logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('vc-logos', 'vc-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload logos
CREATE POLICY "Allow authenticated uploads to vc-logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vc-logos');

-- Allow public read access to logos
CREATE POLICY "Allow public read access to vc-logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'vc-logos');

-- Allow authenticated users to delete logos
CREATE POLICY "Allow authenticated deletes from vc-logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'vc-logos');
