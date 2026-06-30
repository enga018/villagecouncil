-- Add lgd_code column to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lgd_code TEXT;
