# UI Design System

This document defines the shared visual language for the Village Council workspace. New pages and modules should use these tokens and component patterns instead of creating a separate visual system.

Implementation source of truth:

- Tokens and Tailwind theme mappings: `src/app/globals.css`
- Reusable module components: `src/components/app/ModuleCard.tsx`
- Shared application frame: `src/components/app/AppShell.tsx`

## 1. Design principles

- Use a light slate canvas with white content surfaces.
- Keep hierarchy clear: page heading, section heading, module content and supporting metadata.
- Prefer compact, scannable layouts on mobile.
- Use color semantically and consistently.
- Keep module navigation on the module card; keep data-changing actions inside the relevant module page.
- Build future pages from shared tokens and components.

## 2. Color tokens

### Surfaces and borders

| Purpose | Token | Value |
|---|---|---|
| Page canvas | `--vc-background` | `#F1F5F9` |
| Card surface | `--vc-surface` | `#FFFFFF` |
| Muted surface | `--vc-surface-muted` | `#F8FAFC` |
| Embedded KPI well | `--vc-surface-subtle` | `#F8FAFC` |
| Card border | `--vc-border` | `#CBD5E1` |
| Subtle border | `--vc-border-subtle` | `#E2E8F0` |
| Card shadow | `--vc-shadow-card` | `0 1px 3px rgba(15, 23, 42, 0.06)` |

### Typography

| Purpose | Token | Value |
|---|---|---|
| Heading / primary number | `--vc-foreground` | `#0F172A` |
| Description | `--vc-text-secondary` | `#475569` |
| Kicker / micro-label | `--vc-text-muted` | `#64748B` |

### Brand accents

| Use | Foreground | Tint | Border |
|---|---|---|---|
| Primary / Job Cards | `#2563EB` | `#EFF6FF` | `#BFDBFE` |
| FTO Monitoring | `#4F46E5` | `#EEF2FF` | `#C7D2FE` |
| Primary action button | `#0F172A` | White text | Hover: `#1E293B` |

Corresponding CSS variables include `--vc-brand`, `--vc-brand-soft`, `--vc-brand-border`, `--vc-fto-brand`, `--vc-fto-brand-soft`, `--vc-fto-brand-border`, `--vc-action` and `--vc-action-hover`.

### Semantic status colors

| Meaning | Text | Background | Border |
|---|---|---|---|
| Active / Processed / Available | `#047857` | `#ECFDF5` | `#A7F3D0` |
| Deferred / Pending | `#B45309` | `#FFFBEB` | `#FDE68A` |
| Rejected / Inactive | `#BE123C` | `#FFF1F2` | `#FECDD3` |

Use the same semantic mapping in KPI accents, badges, filters and register rows. Do not use status colors as arbitrary decoration.

## 3. Shared component patterns

Import the reusable components from:

```tsx
import {
  ModuleCard,
  MiniKpi,
  StatusBadge,
} from "@/components/app/ModuleCard";
```

### ModuleCard

A full-card link to a module route. The card accepts:

- `title`, `description`
- `href`
- `mark` — short visual identifier
- `eyebrow` — uppercase category/kicker
- `action` — link action text
- `accent` — currently `"blue"` or `"indigo"`
- `children` — optional embedded content, commonly a KPI grid

Example:

```tsx
<ModuleCard
  title="Job Cards"
  description="Manage household job cards and applicants."
  href="/job-cards"
  mark="JC"
  eyebrow="Household records"
  action="Open Job Cards"
  accent="blue"
>
  <div className="grid grid-cols-2 gap-2">
    <MiniKpi
      label="Active Job Cards"
      value={activeCount}
      context={`of ${totalCount} total Job Cards`}
      tone="blue"
    />
    <MiniKpi
      label="Active Applicants"
      value={activeApplicants}
      context={`of ${totalApplicants} total applicants`}
      tone="blue"
    />
  </div>
</ModuleCard>
```

The whole card is a navigation link. Do not put buttons, links or other interactive controls inside it; keep actions such as Fetch, Import, Activate and Delete on the module page.

### MiniKpi

A compact KPI well for a module card or a similar summary surface.

Props:

- `label: string`
- `value: number | null` — use `null` while loading or when unavailable; it renders as an em dash.
- `context: string` — denominator or explanatory context.
- `tone?` — `neutral`, `blue`, `indigo`, `success`, `warning` or `danger`.

Use a 2-column grid for the Job Cards module and a 2×2 grid for the four FTO status KPIs. Keep labels short and context useful.

### StatusBadge

A compact status label. The current component supports:

- Available
- Active
- Processed
- Deferred
- Pending
- Rejected
- Inactive

Extend the shared component deliberately if a future workflow introduces a new shared status. Avoid introducing visually different badges for the same meaning in different modules.

## 4. Future module card conventions

Use the same card pattern for future modules such as Register, Contributions, CO Calculation, Payments, Reports and Settings.

- Use `blue` for the primary workspace / Job Cards family.
- Use `indigo` for FTO Monitoring or another module family only when the distinction is meaningful.
- Add embedded KPIs only when they help users decide which module to open or understand its current workload.
- Keep module descriptions concise.
- Use the same card surface, border, radius and shadow conventions.
- Keep Coming soon items visually secondary and non-interactive until the module is ready.

Do not create dashboard KPI cards above the module grid. Summary KPIs belong inside the module they describe.

## 5. Page layout conventions

- Use the global page canvas; content cards should use white surfaces.
- Use consistent spacing and a clear heading hierarchy.
- Use responsive grids: one column on narrow screens, then two or more columns where the content supports it.
- Keep mobile actions easy to reach and avoid tall stacks of redundant summary boxes.
- Use tabular numerals for counts and monetary values.
- Provide loading, empty, error and unavailable states rather than displaying misleading zero values.
- Preserve keyboard focus visibility and semantic headings/labels.
- Respect reduced-motion preferences; avoid relying on animation to communicate state.

## 6. Data and status presentation

- A displayed count must have a clearly defined source, scope and meaning.
- Council-level counts must be scoped to the active `village_council_id`.
- Distinguish total records from active records and imported FTOs from transaction rows.
- Use normalized status values consistently when aggregating FTO transaction states.
- Do not turn missing or failed data into a displayed zero. Use a loading or unavailable state and surface an appropriate error.

## 7. Change management

When changing shared tokens or component APIs:

1. Update `src/app/globals.css` or the shared component, not only one page's utility classes.
2. Search for existing consumers and check all affected screens.
3. Update this document if a token, component prop or convention changes.
4. Run `npm run build` and review mobile and desktop layouts.

The shared design system should evolve centrally so existing pages and future modules remain visually consistent.
