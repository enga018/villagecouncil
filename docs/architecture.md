# Architecture

## 1. System overview

Village Council Platform is a single Next.js application with a shared workspace UI and a Supabase backend.

- **Frontend:** Next.js App Router, React and TypeScript.
- **Styling:** Tailwind CSS 4, global CSS and shared design tokens.
- **Authentication:** Supabase Auth.
- **Data:** Supabase PostgreSQL, accessed through the Supabase client.
- **Authorization and tenant isolation:** Supabase Row Level Security (RLS), membership checks and council-scoped queries.
- **Government portal integration:** Supabase Edge Functions.
- **Build and hosting:** Next.js static export deployed through Vercel.

Production URL: https://villagecouncil.enga.in

## 2. Application structure

The application uses the Next.js App Router. Workspace routes share a route-group layout; the route group does not add a URL segment.

```text
src/
├── app/
│   ├── (workspace)/
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   ├── job-cards/
│   │   └── fto-monitoring/
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── app/
│   │   ├── AppShell.tsx
│   │   ├── AuthGate.tsx
│   │   └── ModuleCard.tsx
│   └── fto/
├── lib/
│   └── supabase.ts
└── types/
```

### Root layout

`src/app/layout.tsx` loads the global stylesheet and application fonts.

### Workspace layout

`src/app/(workspace)/layout.tsx` wraps workspace pages in:

1. `AuthGate` — verifies the signed-in user, active council membership and council onboarding state.
2. `AppShell` — provides shared navigation, responsive sidebar/mobile navigation, top bar, content frame and sign-out action.

New authenticated workspace routes should normally live under `src/app/(workspace)/` so they inherit this shared shell and access gate.

### Current and planned routes

Available workspace modules:

- `/dashboard/`
- `/job-cards/`
- `/fto-monitoring/`

The navigation and dashboard also identify future module areas such as Register, Contributions, CO Calculation, Payments, Reports and Settings. A navigation entry or Coming soon card does not by itself mean the module's business workflow is implemented.

## 3. Authentication and council context

The workspace access gate uses Supabase Auth to identify the current user. It then resolves an active record in `council_memberships` and the corresponding active council in `council_tenants`.

The gate handles these states:

- Loading while access is checked.
- Signed out: redirect to login, preserving the requested path.
- No active council membership: show an access-assignment message.
- Council onboarding incomplete: redirect to onboarding.
- Ready: render the workspace.
- Error: show an error and allow retry.

Workspace pages that query council-owned data must resolve and use the active `village_council_id`. Do not hardcode a council ID or assume the user's current council from a browser-provided value.

## 4. Data isolation and security

The platform is designed to support multiple Village Councils in one application.

- Council-owned records are associated with a `village_council_id`.
- Supabase RLS is a core authorization boundary.
- Client-side filters improve correctness and presentation but are not an authorization mechanism.
- Edge Functions must authenticate callers and validate their council/jurisdiction context before reading or writing protected data.
- Do not expose Supabase service-role credentials in browser code.
- Do not introduce shared cross-council business ledgers when the data is meant to be council-owned.

Any new table, view, RPC or Edge Function that handles council data must be reviewed for tenant scoping and RLS/function permissions.

## 5. Supabase client and Edge Functions

The browser Supabase client is created in `src/lib/supabase.ts` using `@supabase/ssr` and the public environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The current FTO workflow uses Supabase Edge Functions to interact with the Government portal. The detailed navigation, Panchayat ownership, validation, retry and activation rules are documented in [FTO Monitoring](fto-monitoring.md).

Keep Government portal parsing and protected server-side operations in Edge Functions rather than moving them into browser UI components.

## 6. Rendering and deployment

The current `next.config.ts` sets:

- `output: "export"`
- `trailingSlash: true`
- `images.unoptimized: true`

The production build creates a static export in `out/`. Vercel builds and hosts the repository output. The custom production URL is `https://villagecouncil.enga.in`.

The frontend therefore must not depend on Next.js server-only runtime features that are incompatible with static export. Supabase remains the backend for authentication, data access and Edge Function workflows.

## 7. Shared UI architecture

Shared application-level UI belongs in `src/components/app/`. Module-specific components belong in their module folders (for example, `src/components/fto/`).

The current shared module pattern is implemented in `src/components/app/ModuleCard.tsx`:

- `ModuleCard` — full-card navigation surface with a module accent and optional content.
- `MiniKpi` — compact embedded KPI well.
- `StatusBadge` — reusable semantic status badge.

Global design tokens and Tailwind theme mappings live in `src/app/globals.css`. See [UI Design System](ui-design-system.md) for the token reference and implementation conventions.

## 8. Adding a future module

When adding a module:

1. Add its route under `src/app/(workspace)/`.
2. Reuse the authenticated workspace layout; do not create a parallel app shell.
3. Add module-specific components under `src/components/<module>/`.
4. Use the shared design tokens and established card, KPI and status patterns.
5. Scope all council data to the active council and enforce access through Supabase RLS and backend authorization.
6. Add navigation and dashboard availability only when the module's readiness is accurately represented.
7. Document new tables, Edge Functions, data ownership and workflow rules where relevant.
8. Run the production build and review the mobile layout.

## 9. Related documentation

- [README](../README.md) — setup, scripts and module overview.
- [UI Design System](ui-design-system.md) — visual tokens and reusable component API.
- [FTO Monitoring](fto-monitoring.md) — Government portal integration and import behavior.
