# Archived project materials

This directory preserves historical files from the earlier Property Survey / Household Register application.

- `legacy-project-goal.md` and `legacy-project-memory.md` are historical product notes, not current requirements.
- `legacy-survey-schema.sql` is the former survey-management schema. **Never execute it against the current database.** It contains destructive `DROP TABLE` statements and creates the retired survey schema. Current database changes must be made through reviewed files in `supabase/migrations/`.

These files are retained for historical reference only. They are not part of the active application or deployment process.
