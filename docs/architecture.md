# Architecture

## High-Level Model

The application uses a single codebase with a shared frontend and a Supabase backend.

## Deployment Model

All users access the same URL: `https://villagecouncil.enga.in`

- Tenant isolation is handled by Supabase RLS (Row Level Security)
- Workers do not choose a Village Council manually

## Application Shape

The app follows a static page structure with shared JavaScript modules.

Existing entry points include:

- `index.html` - Landing page for signed-out visitors; dashboard for admin, worker, and supervisor roles
- `superadmin.html` - Super admin console, isolated from the other roles
- `login.html` - Authentication
- `survey.html` - Property survey form
- `household.html` - Household registration form
- `register.html` - Worker registration

`index.html` serves admin, worker, and supervisor roles based on the user's profile, plus query-param-driven supersede state. Super admin is routed to `superadmin.html` instead, since it's the one role that operates across all tenants rather than within one. Superseding into another role's view (e.g. super admin viewing as admin) crosses between the two files via a confirm-then-redirect handshake using sessionStorage flags; admin superseding into worker/supervisor stays on `index.html` since those roles share the same file.

Shared logic lives in:

- `app.js` - Authentication, Supabase client, data helpers

## Backend

Supabase is used for:

- authentication
- profiles
- tenant data
- properties
- families
- tax records
- worker assignments

## Roles

### Super Admin

Accessed from `villagecouncil.enga.in`.

Responsibilities:

- create Village Councils
- manage tenants
- set property prefixes
- set property number digit length
- create admins
- view all Village Councils

### Admin

Accessed from `villagecouncil.enga.in`.

Responsibilities:

- manage surveys
- assign work
- approve records
- manage workers

### Worker

Accessed from `villagecouncil.enga.in`.

Main menu:

- Collect
- My Work
- Follow Up

## Data Model Direction

The core business objects are:

- properties
- owners
- units
- families
- persons
- property_photos
- tenants

The current code also indicates support for:

- worker module assignments
- property number ranges
- dashboard stats
