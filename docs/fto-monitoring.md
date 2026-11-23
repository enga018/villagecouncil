# FTO Monitoring

## Purpose

FTO Monitoring discovers First Signatory Fund Transfer Orders (FTOs) from the official VBGRAMG portal, inspects their transaction details, and stages only the transactions belonging to the current Village Council.

Each Village Council maintains its own inspection and import records. The application does not create a shared Block-level FTO transaction ledger.

## Government navigation

The source function follows the official portal navigation:

1. Open the India/state selection flow.
2. Select the relevant State.
3. Open the District.
4. Open the Block.
5. In the Block status table, follow the numeric First Signatory signed-FTO count.
6. Read the First Signatory FTO listing and follow each FTO detail link.

The navigation does not require CAPTCHA entry or manual file upload.

The portal uses ASP.NET navigation and opaque generated detail URLs. The application preserves the discovered URLs and postback values; it must not construct or guess the opaque detail payload.

Official portal hosts currently allow-listed by the Edge Functions:
- `vbgramg.dord.gov.in`
- `vbgramgrep.dord.gov.in`

## Shared navigation versus Council-owned data

The application may cache verified District/Block navigation URLs in `shared_fto_navigation` so that Councils do not need to rediscover the same navigation path independently.

This cache contains navigation metadata only. It is not a shared FTO transaction store.

FTO discovery, inspection outcomes, staged rows, and imported transactions are scoped to the current Village Council. Each Council independently inspects the Government detail page and applies its own Panchayat filter.

## Transaction ownership

Ownership is determined by the Panchayat name embedded in the Government Job Card/Panchayat cell on each FTO transaction row.

It is **not** determined by matching the Job Card number against the Council's local Job Card register. A Job Card number can exist in more than one Council, including after transfer.

For each transaction, the parser:
1. Extracts the Job Card number from the combined Government cell.
2. Removes that Job Card number from the cell to obtain the Panchayat text.
3. Normalizes the Panchayat text using Unicode NFKC normalization, lowercase conversion, punctuation removal, and whitespace normalization.
4. Compares it with the normalized official Panchayat name configured for the current Council.

Only matching transactions are staged as in-scope. FTOs with no matching transactions are recorded as out-of-scope for that Council.

If the Panchayat value is missing or cannot be validated, the detail inspection fails safely; the transaction is not assigned based on Job Card number alone.

## Detail validation

Before Council-specific filtering, the detail function validates the Government FTO transaction rows and reconciles them against the First Signatory listing totals.

Validation includes:
- Job Card number is present and has the expected format.
- Panchayat text is present.
- Reference number is present and unique within the FTO.
- Credit amount is present and valid.
- Government status is recognized.
- Processed count and amount match the listing.
- Rejected count and amount match the listing.
- Total transaction amount matches the listing.

Status mapping:

| Government status | Normalized status | Import status |
|---|---|---|
| `Processed` | `processed` | `processed` |
| `Rejected` | `rejected` | `rejected` |
| Blank | `blank` | `deferred` |
| Any other nonblank value | `other` | Validation failure |

A failed fetch or validation does not create a successful inspection record. The FTO therefore remains eligible for a later retry.

## Inspection and refetch policy

The `council_fto_inspections` table records the inspection result for each Council/FTO pair. The record includes the listing fingerprint, matching and unresolved transaction counts, inspection result, last inspection/error information, and import activation timestamp.

The source function evaluates FTOs as follows:

| Condition | Action |
|---|---|
| Force refresh requested | Fetch again |
| No previous inspection | Fetch |
| Listing fingerprint changed | Fetch again |
| Previous inspection has no matching transactions | Skip |
| Inspection has not been activated by import | Fetch again |
| Matching transactions remain unresolved | Fetch again |
| All matching transactions are terminal and import is activated | Skip |
| Previous fetch or validation failed | Retry; no successful inspection record exists |

For this policy, terminal statuses are Processed and Rejected. Blank Government statuses remain deferred and unresolved.

The fingerprint is based on the discovered detail URL, listing row, and listing headers. Changes to the Council's local Job Card register do not trigger an FTO refetch.

The manual **Force refresh all** action requests a refresh of the current First Signatory listing, including FTOs that would normally be skipped.

## Processing and import flow

The current user-facing flow is:

1. **Discover:** The `council-fto-source` Edge Function navigates the Government portal, prepares the eligible FTO listing, and returns a protected manifest for the batch.
2. **Fetch and validate details:** The client invokes `council-fto-details` in groups of up to five FTOs.
3. **Stage:** Validated FTO rows and Council-matching transactions are stored in the Council's import batch.
4. **Review:** The page displays in-scope FTOs, out-of-village FTOs, transaction counts, and a sample of matching Job Cards.
5. **Activate:** A user explicitly activates the batch through `activate_council_fto_import`. The database function imports the Council-owned records and marks the corresponding inspection records as activated.

Failed FTO detail requests can be retried from the current batch. Already staged FTOs are not intended to be imported twice.

## Security and isolation

- Both Edge Functions require an authenticated user and validate the user's Council/jurisdiction context.
- The detail manifest is encrypted and bound to its Council, batch, and Panchayat context.
- Government requests are restricted to the allow-listed official hosts.
- Discovered links and redirects are checked before requests are followed.
- FTO inspection and transaction records are Council-scoped.
- Row Level Security and database function permissions protect Council data.

## Current scope and limitations

The current implementation supports manual discovery, detail processing, retry, review, and explicit batch activation.

The following are **not implemented by this FTO feature yet**:
- Scheduled daily FTO fetching.
- Automatic FTO fetching after onboarding or Job Card import.
- Background orchestration independent of a user-opened page.
- Automatic import activation without user review.

A future scheduled workflow must reuse the same validation, Council ownership, inspection, and idempotent activation rules. It must also ensure that FTO processing does not start if the prerequisite Job Card import fails.

## Related implementation

- `supabase/functions/council-fto-source/index.ts` — Government navigation, listing discovery, and refetch eligibility.
- `supabase/functions/council-fto-details/index.ts` — Detail-page parsing, validation, Panchayat ownership filtering, and inspection recording.
- `src/app/(workspace)/fto-monitoring/page.tsx` — Manual fetch, force refresh, retry, review, and activation UI.
- `supabase/migrations/20261123130000_create_shared_fto_navigation.sql` — Shared navigation cache.
- `supabase/migrations/20261123140000_create_council_fto_transactions.sql` — Council FTO import data.
- `supabase/migrations/20261123142000_use_fto_panchayat_for_ownership.sql` — Panchayat-based import ownership.
- `supabase/migrations/20261123160000_add_council_fto_inspection_ledger.sql` — Council inspection ledger.
- `supabase/migrations/20261123161000_track_fto_import_activation.sql` — Import activation tracking.
