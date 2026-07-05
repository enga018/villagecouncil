# Village Council

Production-grade Village Council Management Platform.

## Live Site

https://villagecouncil.enga.in

## Project Docs

- [Goal](docs/goal.md)
- [Architecture](docs/architecture.md)
- [Project Memory](docs/project-memory.md)

## Project Structure

- `index.html` - App shell: landing page for signed-out visitors; dashboard for admin, worker, and supervisor roles
- `superadmin.html` - Super admin console (village councils, modules, cross-tenant supersede)
- `login.html` - Authentication
- `survey.html` - Property survey form (7-step wizard)
- `household.html` - Household registration form (5-step wizard)
- `register.html` - Worker registration
- `app.js` - Core application logic
- `modules.sql` - Module definitions
- `tenant_module_assignments.sql` - Module assignments per tenant
- `supabase/functions/` - Edge Functions
