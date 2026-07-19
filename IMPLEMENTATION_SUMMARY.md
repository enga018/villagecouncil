# Subdomain Routing & Module Architecture - Implementation Summary

## Overview

This implementation adds dynamic subdomain routing and a modular survey system to Village Council, enabling multi-tenant operations with VC-specific branding and functionality.

## Architecture Components

### 1. Subdomain Detection & Routing
**Files**: `src/lib/subdomain.ts`, `src/lib/vcValidation.ts`

- Detects if user is on main domain (`villagecouncil.enga.in`) or VC subdomain
- Automatically parses VC names from subdomains (e.g., `newserchhipnorth.villagecouncil.enga.in`)
- Routes users to correct subdomain after signin
- Validates subdomain access against user's assigned VC

**Key Functions**:
- `getSubdomainContext()` - Parses current hostname
- `validateVCAccess()` - Ensures user's VC matches subdomain
- `redirectToVC()` - Redirects to specific VC subdomain

### 2. Authentication & User Context
**Files**: `src/context/AuthContext.tsx`, `src/hooks/useVCContext.ts`

- `AuthProvider` - Client-side auth state management
- Manages user session and profile loading
- Detects changes in auth state
- Provides `useAuth()` hook for components

- `useVCContext()` - VC context detection
- Determines VC from subdomain or user profile
- Provides VC metadata to child components

### 3. Page Routing & Redirection

**Landing Page** (`src/app/landing/page.tsx`)
- Shown only on main domain
- Lists all Village Councils
- Provides VC-specific signin links
- Displays platform features

**Home Page** (`src/app/page.tsx`)
- Redirects main domain to `/landing`
- Routes VC subdomains to role-based dashboards
- Validates user's VC matches subdomain

**Login Page** (`src/app/login/page.tsx`)
- Loads VC branding if on VC subdomain
- Validates user belongs to VC
- Redirects authenticated users to their VC on main domain signin
- Shows VC-specific branding (logo, colors)

**Protected Pages** (Admin, Worker, Supervisor, Superadmin)
- Added VC access validation
- Redirects if user tries wrong subdomain
- Ensures data isolation per VC

### 4. Module Framework
**Files**: `src/lib/moduleLoader.ts`

Defines structure for pluggable survey modules:
```typescript
interface Module {
  config: ModuleConfig;
  component: () => ReactNode;
  hooks?: Record<string, () => unknown>;
}
```

**Database**: `vc_modules` table
- Maps VCs to enabled modules
- Allows per-VC feature control
- Stores module configuration

### 5. Property Survey Module
**Location**: `src/modules/property-survey/`

**Features**:
- Collect property type, owner info, address
- GPS location capture
- Photo upload to storage
- Auto-generated property IDs based on VC prefix
- Occupancy status tracking

**Components**:
- `PropertySurveyForm` - React form component
- CSV import/export utilities
- TypeScript types for data validation

**Database**: `survey_properties` table
- VC-scoped via RLS policies
- Indexed for performance
- Linked to users via `created_by`

### 6. Household Survey Module
**Location**: `src/modules/household-survey/`

**Features**:
- Link households to properties
- Add multiple family members per household
- Demographics: age, gender, relation
- Auto-count children
- Auto-generate family IDs (PROPERTY_ID/1, PROPERTY_ID/2, etc.)

**Components**:
- `HouseholdSurveyForm` - React form component
- CSV import/export utilities
- TypeScript types

**Database**: `survey_households` table
- Stores family data as JSON
- Linked to survey_properties via FK
- VC-scoped via RLS

### 7. Dashboard & Data Management
**Files**: 
- `src/app/dashboard/page.tsx`
- `src/components/surveys/SurveyDataTable.tsx`
- `src/components/surveys/ImportExportPanel.tsx`

**Features**:
- Display survey data with filtering & sorting
- Stats cards (total properties, households, occupancy)
- CSV export of collected data
- CSV import for bulk data loading
- Data validation on import

### 8. Branding System
**Files**: `src/context/BrandingContext.tsx`

- Loads VC branding from database
- Provides brand colors and logos to components
- Dynamic page titles and metadata
- Per-VC styling through CSS variables

**Database Fields Used**:
- `brand_color` - Primary color
- `logo_url` - VC logo image
- `name` - VC name
- `property_prefix` - For generating property IDs

## Database Schema

### New Tables

**vc_modules**
```sql
id UUID PRIMARY KEY
vc_id UUID -> village_councils
module_name TEXT
enabled BOOLEAN
config JSONB
created_at TIMESTAMP
updated_at TIMESTAMP
```

**survey_properties**
```sql
id UUID PRIMARY KEY
vc_id UUID -> village_councils
property_id TEXT (UNIQUE per VC)
property_type TEXT (residential, commercial, agricultural, other)
owner_name TEXT
owner_contact TEXT
address TEXT
latitude DECIMAL
longitude DECIMAL
photo_url TEXT
occupancy_status TEXT
created_by UUID -> auth.users
created_at TIMESTAMP
updated_at TIMESTAMP
```

**survey_households**
```sql
id UUID PRIMARY KEY
property_id UUID -> survey_properties
vc_id UUID -> village_councils
family_id TEXT (UNIQUE per property)
head_of_household TEXT
members JSONB (array of FamilyMember objects)
total_members INTEGER
children_count INTEGER
created_by UUID -> auth.users
created_at TIMESTAMP
updated_at TIMESTAMP
```

### RLS Policies
- Users see only data from their VC
- Users can only create data for their VC
- Users can only update data they created
- Superadmins have global access (no RLS filtering)

## File Structure

```
src/
├── app/
│   ├── layout.tsx (with AuthProvider, BrandingProvider)
│   ├── page.tsx (subdomain-aware routing)
│   ├── landing/page.tsx (main domain landing)
│   ├── login/page.tsx (VC-specific branding)
│   ├── dashboard/page.tsx (data display)
│   ├── surveys/
│   │   ├── page.tsx (hub)
│   │   ├── property/page.tsx (property entry)
│   │   └── household/page.tsx (household entry)
│   ├── admin/page.tsx (with VC validation)
│   ├── worker/page.tsx (with VC validation)
│   ├── supervisor/page.tsx (with VC validation)
│   └── superadmin/page.tsx
├── lib/
│   ├── subdomain.ts (parsing & routing)
│   ├── vcValidation.ts (access control)
│   ├── moduleLoader.ts (module registry)
│   └── auth.ts (existing)
├── context/
│   ├── AuthContext.tsx (client-side auth)
│   └── BrandingContext.tsx (VC branding)
├── hooks/
│   └── useVCContext.ts (VC detection)
├── modules/
│   ├── property-survey/
│   │   ├── components/PropertySurveyForm.tsx
│   │   ├── types/index.ts
│   │   ├── utils/csvUtils.ts
│   │   ├── module.config.ts
│   │   └── index.ts
│   └── household-survey/
│       ├── components/HouseholdSurveyForm.tsx
│       ├── types/index.ts
│       ├── utils/csvUtils.ts
│       ├── module.config.ts
│       └── index.ts
└── components/
    └── surveys/
        ├── SurveyDataTable.tsx
        └── ImportExportPanel.tsx
```

## User Workflows

### 1. User Signup & First Login
1. User signs in on `villagecouncil.enga.in/login`
2. System validates their VC assignment
3. Post-login, redirects to their VC subdomain (`vcname.villagecouncil.enga.in/admin`)
4. User sees their VC's branding

### 2. Property Data Collection
1. User visits `vcname.villagecouncil.enga.in/surveys`
2. Clicks "Property Survey"
3. Fills out form: property type, owner, address, GPS, photo
4. System auto-generates property ID based on VC's prefix
5. Data saved to `survey_properties` table
6. User sees success message, ready for next entry

### 3. Household Data Collection
1. User visits `vcname.villagecouncil.enga.in/surveys`
2. Clicks "Household Survey"
3. Selects property (dropdown of collected properties)
4. Adds family members with demographics
5. System auto-generates family ID
6. Data saved to `survey_households` table

### 4. Data Management & Export
1. Admin visits `vcname.villagecouncil.enga.in/dashboard`
2. Views collected properties and households
3. Filters by type, occupancy status
4. Exports to CSV for analysis
5. Can import CSV for bulk data loading

## Infrastructure Requirements

### DNS Configuration
```
*.villagecouncil.enga.in  -> A record -> GitHub Pages IP
villagecouncil.enga.in    -> A record -> GitHub Pages IP
```

### Reverse Proxy (Required for GitHub Pages)
Option A: **Cloudflare Workers**
- Route all `*.villagecouncil.enga.in` to GitHub Pages
- Free tier sufficient
- Configuration: Pass-through routing

Option B: **Nginx on separate server**
- Reverse proxy to GitHub Pages
- Certificate via Let's Encrypt

### Storage
- File uploads (photos) → Supabase Storage
- CSV exports → Browser download
- Database → Supabase PostgreSQL

## Security Considerations

1. **RLS Enforcement**: All data access controlled by Supabase RLS policies
2. **Subdomain Validation**: Frontend validates but DB enforces via RLS
3. **User Isolation**: Users see only their VC's data
4. **Photo Storage**: Organized by VC ID
5. **CSV Validation**: Imported data validated before insertion

## Testing Checklist

- [ ] Landing page renders on main domain only
- [ ] VC-specific branding appears on subdomains
- [ ] Users redirected to their VC after signin on main domain
- [ ] Cannot access wrong VC's subdomain
- [ ] Property survey creates correct property IDs
- [ ] Household survey links to properties correctly
- [ ] CSV export contains all data
- [ ] CSV import validates and loads data
- [ ] Dashboard shows filtered data correctly
- [ ] Cross-subdomain navigation maintains auth
- [ ] Logout redirects to main landing page
- [ ] Photos upload and display correctly

## Deployment Steps

1. **Database Migrations**
   ```bash
   supabase migration up
   ```

2. **Enable Storage Bucket** (if using photos)
   ```sql
   -- Create storage bucket in Supabase dashboard
   -- Name: property-photos
   -- Public: false (private, auth required)
   ```

3. **DNS Configuration**
   - Update registrar with wildcard DNS
   - Wait for propagation (up to 24 hours)

4. **Reverse Proxy Setup**
   - Configure Cloudflare Workers or Nginx
   - Test routing to all subdomains

5. **Environment Variables**
   - Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set

6. **Deploy to GitHub Pages**
   ```bash
   npm run build
   git push origin main
   ```

## Future Enhancements

1. **White-label Customization**: Layouts, not just colors
2. **Custom Domains**: `council.mycity.gov` → VC's subdomain
3. **Superadmin Context Switching**: Access any VC without subdomain switch
4. **Mobile App**: React Native version of surveys
5. **Analytics Dashboard**: Adoption metrics per VC
6. **Approval Workflow**: Admin review before data finalization
7. **Offline Mode**: Service worker for data sync
8. **Multi-language**: i18n for different regions

## Support & Troubleshooting

**Issue**: Users see "Access Denied" on VC subdomain
- **Solution**: Check RLS policies, ensure user's vc_id matches subdomain

**Issue**: Photos not uploading
- **Solution**: Verify Supabase storage bucket exists and is configured

**Issue**: Subdomains not resolving
- **Solution**: Check DNS propagation, verify reverse proxy configuration

**Issue**: Cross-subdomain auth not working
- **Solution**: Ensure Supabase auth cookie domain is `.villagecouncil.enga.in`
