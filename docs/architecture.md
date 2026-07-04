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

- `index.html` - Landing page
- `login.html` - Authentication
- `dashboard.html` - Main dashboard (role-based views)
- `survey.html` - Property survey form
- `household.html` - Household registration form
- `admin.html` - Legacy admin dashboard
- `register.html` - Worker registration

The `dashboard.html` file serves all roles based on the user's profile.

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
