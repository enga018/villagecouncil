# Village Council

Production-grade Village Council Management Platform built with Next.js 14 and Supabase.

## Live Site

https://villagecouncil.enga.in

## Architecture

- **Framework**: Next.js 14 (App Router, Static Export)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Backend**: Supabase (Auth, Database, Storage)
- **Deployment**: GitHub Pages via GitHub Actions

## Role-Based System

| Role | Permissions |
|------|-------------|
| **Super Admin** | Creates survey templates, manages VCs, assigns surveys to VCs |
| **Admin** (per VC) | Creates assignments, manages workers, reviews submissions |
| **Worker** | Fills assigned surveys, saves drafts, submits responses |
| **Supervisor** | Reviews all submissions in their VC (read-only) |

## Dynamic Survey Builder

Superadmins create surveys via a no-code UI:
- **Field types**: text, textarea, number, select, radio, checkbox, date, image, geolocation
- **Settings**: auto-capture GPS, allow drafts, require photos
- **Conditional fields**: Show/hide based on other answers
- All stored as JSONB in `survey_templates` table

## Supabase Schema

- `village_councils` - Multi-tenant VCs
- `public_users` - Users linked to auth.users
- `survey_templates` - Survey definitions (fields JSONB + settings JSONB)
- `vc_survey_access` - Which VCs can use which surveys
- `survey_assignments` - Admin assigns surveys to workers
- `survey_responses` - Worker submissions with data JSONB

Row Level Security (RLS) ensures multi-tenant isolation.

## Getting Started

### Prerequisites

- Node.js 20+
- Supabase project

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the Supabase schema:
   - Go to your Supabase SQL Editor
   - Run the contents of `supabase/schema.sql`

4. Create `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

5. Run development server:
   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000)

## Deployment

The project deploys to GitHub Pages automatically via GitHub Actions.

### Required GitHub Secrets

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Manual Build

```bash
npm run build
```

Output is in the `out/` directory (static export).

## Project Structure

```
src/
├── app/
│   ├── login/          # Login page
│   ├── superadmin/     # Super admin dashboard
│   ├── admin/          # Admin dashboard
│   ├── worker/         # Worker dashboard
│   └── supervisor/     # Supervisor dashboard
├── components/
│   ├── surveys/        # Survey builder and form
│   ├── ui/             # Reusable UI components
│   └── layout/         # Layout components
├── lib/
│   ├── supabase.ts     # Supabase client
│   └── auth.ts         # Auth utilities
└── types/
    └── index.ts        # TypeScript types
```

## Legacy Files

Old vanilla HTML/JS files are preserved in `_legacy/` for reference.
