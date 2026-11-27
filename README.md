# Village Council Platform

A multi-Village-Council workspace for managing council records and operational workflows.

**Production site:** https://villagecouncil.enga.in

## Current technology

| Area | Technology |
|---|---|
| Application | Next.js 16 (App Router) |
| UI | React 19, TypeScript |
| Styling | Tailwind CSS 4 and shared CSS design tokens |
| Authentication and data | Supabase Auth, PostgreSQL and Row Level Security |
| Government-data processing | Supabase Edge Functions |
| Build output | Next.js static export |
| Hosting | Vercel |

The deployed application is a single web application. Council data is scoped to the signed-in user's active Village Council; database access is protected by Supabase policies.

## Current workspace modules

| Module | Status | Route |
|---|---|---|
| Dashboard | Available | `/dashboard/` |
| Job Cards | Available | `/job-cards/` |
| FTO Monitoring | Available | `/fto-monitoring/` |
| Register | Planned | `/register/` |
| Contributions | Job Card contribution workspace and Batch Operations entry point | `/contributions/` |
| Batch Operations | Available — bulk Payments and Manual/Extra Charges | `/contributions/batch-operations/` |
| Reports | Planned | `/reports/` |
| Settings | Available | `/settings/` |

The Dashboard is the workspace entry point. It presents the available modules as clickable cards, with relevant summary KPIs embedded inside each card. CO calculation is an operation within each imported FTO card in FTO Monitoring; it is not a separate management page. Formula settings are maintained in Settings. Batch Operations supports bulk BANK payments and Manual/Extra Charges. The Contributions ledger itself remains an initial Job Card view of eligible Regular CO Charges from each FTO's latest saved calculation; canonical payment allocations and net balances are not yet displayed there.

## Repository structure

```text
src/
├── app/
│   ├── (workspace)/
│   │   ├── dashboard/          # Workspace overview and module cards
│   │   ├── job-cards/          # Job Card workspace
│   │   ├── fto-monitoring/     # FTO discovery, review, import and per-FTO CO actions
│   │   ├── contributions/      # Job Card financial accounts and shared Batch Operations
│   │   ├── settings/           # Council CO formula settings
│   │   └── layout.tsx          # Authenticated workspace layout
│   ├── layout.tsx              # Root document and global stylesheet
│   └── globals.css             # Shared design tokens and global styles
├── components/
│   ├── app/                    # App shell, auth gate and shared components
│   └── fto/                    # FTO-specific UI components
├── lib/
│   └── supabase.ts             # Browser Supabase client
└── types/                      # Shared TypeScript types

supabase/
├── functions/                  # Supabase Edge Functions
└── migrations/                 # Database migrations

docs/
├── architecture.md             # Current application architecture
├── fto-monitoring.md           # FTO discovery and import behavior
└── ui-design-system.md         # Shared visual system and component patterns
```

## Local development

### Prerequisites

- Node.js 20 or later
- npm
- Access to the project's Supabase environment

### Setup

1. Clone the repository.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a local `.env.local` file:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open http://localhost:3000.

Do not commit `.env.local`, service-role keys, access tokens or other secrets. Use the project's existing Supabase migrations and deployment procedures; do not recreate production data by applying an old schema snapshot.

## Available scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local Next.js development server |
| `npm run build` | Run the production build and static export |
| `npm run start` | Start the Next.js server (for environments using server output) |
| `npm run lint` | Run ESLint |

The Next.js configuration currently sets `output: "export"` and `trailingSlash: true`. The static build is written to `out/`. Vercel builds and hosts the application from the repository.

## Multi-council access

The authenticated workspace uses the active membership associated with the signed-in user to resolve the Village Council context. The workspace gate checks the user's membership and council onboarding state before rendering the application shell.

Council-owned records must remain scoped to the relevant `village_council_id`. Supabase Row Level Security and appropriately scoped database operations are part of the tenant-isolation boundary. Do not rely on client-side filtering as a substitute for database authorization.

## Documentation

- [Architecture](docs/architecture.md) — application structure, tenant context, backend and deployment.
- [UI design system](docs/ui-design-system.md) — shared colors, surfaces, reusable components and future-module conventions.
- [FTO Monitoring](docs/fto-monitoring.md) — Government portal discovery, Panchayat-based ownership, validation, retry and import activation.
- [Financial Workflow Requirements](docs/financial-workflow-requirements.md) — CO calculation foundation and original detailed rules.
- [Contribution Management Workflow](docs/contribution-management-workflow.md) — complete Job Card-centred Contribution, payment, bulk collection, FIFO, reports, responsive UI decisions and shipped Batch Operations behavior.
- [Financial Decision Log](docs/decision-log.md) — Confirmed financial workflow decisions and amendments.

## Contribution guidelines

- Keep the application as one Next.js app with shared layouts and components.
- Reuse the shared design tokens and UI components before introducing module-specific visual styles.
- Keep each module's actions and data logic inside its own route/component boundary.
- Scope council data queries to the active council and preserve server/database authorization.
- Treat Supabase migrations and Edge Functions as production-critical code; review their impact separately from UI changes.
- Run `npm run build` and `npm run lint` before merging when practical.
- Update the relevant documentation when routes, data ownership, import behavior, deployment or shared UI conventions change.
