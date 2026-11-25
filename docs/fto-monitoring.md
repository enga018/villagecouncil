# FTO Monitoring

## Purpose

FTO Monitoring discovers First Signatory Fund Transfer Orders (FTOs) from the official VBGRAMG portal, inspects their transaction details, imports the transactions that belong to the current Village Council, and leaves the rest for manual review.

Each Village Council maintains its own inspection, staging, review and import records. The application does not create a shared Block-level FTO transaction ledger.

## Government navigation

The source function follows the official portal navigation:

1. Open the India/state selection flow.
2. Select the relevant State.
3. Open the District.
4. Open the Block.
5. In the Block status table, follow the numeric First Signatory signed-FTO count.
6. Read the First Signatory FTO listing and follow each FTO detail link.

The navigation does not require CAPTCHA entry or manual file upload.

The portal uses ASP.NET navigation and opaque generated detail URLs. The application preserves the discovered URLs and postback values; it must not construct or guess the opaque detail payload. Each listing load generates new detail links.

Official portal hosts currently allow-listed by the Edge Functions:
- `vbgramg.dord.gov.in`
- `vbgramgrep.dord.gov.in`

## Shared navigation versus Council-owned data

The application may cache verified District/Block navigation URLs in `shared_fto_navigation` so that Councils do not need to rediscover the same navigation path independently.

This cache contains navigation metadata only. It is not a shared FTO transaction store.

FTO discovery, inspection outcomes, staged rows, review decisions and imported transactions are scoped to the current Village Council. Each Council independently inspects the Government detail page and applies its own Panchayat filter.

## Transaction ownership

Ownership is determined by the Panchayat name embedded in the Government Job Card/Panchayat cell on each FTO transaction row.

It is **not** determined by matching the Job Card number against the Council's local Job Card register on its own. A Job Card keeps its original number after transfer, so the Panchayat code inside the number reflects where the card was issued, not where it works now.

For each transaction, the parser:
1. Extracts the Job Card number from the combined Government cell.
2. Removes that Job Card number from the cell to obtain the Panchayat text.
3. Normalizes the Panchayat text using Unicode NFKC normalization, lowercase conversion, punctuation removal, and whitespace normalization.
4. Compares it with the normalized official Panchayat name configured for the current Council.

Named Panchayat rows that match are in scope. FTOs with no matching transactions are recorded as out-of-scope for that Council.

### Blank Panchayat name

If the Government Panchayat name is blank (the portal shows only `()` in the Job Card/Panchayat cell), the row is **not** rejected and is **not** assigned by Panchayat. Instead:

1. The FTO is staged as needing review, and each blank-name transaction is marked **needs review**. Other validation checks still apply to the whole FTO.
2. If the row's Job Card is **active** in the Council's register, the row is included automatically as In village when the batch is applied. Inactive, missing and non-matching cards are not included automatically.
3. Every other blank-name row appears in the manual review table. An authorized Council user marks it **In village** or **Not in village**. Decisions are stored per transaction row (FTO number and reference number), with the user and timestamp.
4. A decision made by a user always takes precedence over the automatic register match. Automatic matches never overwrite an existing decision.
5. Activation imports named in-scope rows plus review rows whose decision is In village. Undecided rows are not imported; their count is shown after activation.

## Automatic import on Fetch

Clicking **Fetch FTOs** runs the whole import without a further confirmation step:

1. **Discover:** `council-fto-source` navigates the Government portal, lists the Block's First Signatory FTOs and returns a protected manifest for the batch. FTOs that don't need a check are skipped (see the refetch policy).
2. **Fetch and validate:** `council-fto-details` processes FTOs in groups of up to five, two at a time.
3. **Stage:** validated FTOs are written to the Council's batch, with in-scope and review transactions.
4. **Apply and activate:** the page applies active register matches and imports the in-scope and decided rows through `activate_council_fto_import`. Inspection records are marked as activated.

The **Apply review decisions** button, in the manual review table, applies decisions made after a fetch. It does this for every batch that still has review rows and is complete or pending.

The manual review table loads from the Council's batches, not only the batch from the current session. For each FTO it uses the most recent batch that contains it, so rows survive a page reload and older rows are replaced once a newer fetch covers the same FTO.

## Detail validation

Before Council-specific filtering, the detail function validates the Government FTO transaction rows and reconciles them against the First Signatory listing totals.

Validation includes:
- Job Card number is present and has the expected format.
- Reference number is present and unique within the FTO.
- Credit amount is present and valid.
- Government status is recognized.
- Processed count and amount match the listing.
- Rejected count and amount match the listing.
- Total transaction amount matches the listing.

A blank Panchayat name is not a validation failure (see above).

Status mapping:

| Government status | Normalized status | Import status |
|---|---|---|
| `Processed` | `processed` | `processed` |
| `Rejected` | `rejected` | `rejected` |
| Blank | `blank` | `deferred` |
| Any other nonblank value | `other` | Validation failure |

A failed fetch or validation does not create a successful inspection record. The FTO therefore remains eligible for a later retry.

## Dates

Government dates are **day-first**, in `dd/mm/yy` or `dd/mm/yyyy`, using slashes or dashes. Both the FTO date and the transaction dates are converted to ISO `yyyy-mm-dd`. A two-digit year is read as 20yy. Impossible dates (for example 31/02) are rejected and stored as blank, and the validation step reports them.

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
| All matching transactions are resolved and import is activated | Skip |
| Previous fetch or validation failed | Retry; no successful inspection record exists |

A transaction is **resolved** when its Government status is Processed or Rejected, or when it is a blank-name row that has a decision (In village or Not in village). Blank Government statuses that are still deferred remain unresolved, and so do undecided blank-name rows.

The **listing fingerprint** is built from the FTO number, the listing row values and the listing headers. It does **not** include the detail link, because the link changes on every visit to the Government page. A changed amount, count or date in the listing triggers a fetch again.

Changes to the Council's local Job Card register do not trigger an FTO refetch.

The manual **Force refresh all** action requests a refresh of the current First Signatory listing, including FTOs that would normally be skipped.

## Current scope and limitations

Implemented:
- Manual discovery and fetch from the FTO Monitoring page, with automatic import of the results.
- Automatic register matching for active Job Cards.
- Manual review of blank-name rows, with decisions that are kept across page loads.
- Retry of failed FTO detail requests.

Not implemented yet:
- Scheduled daily FTO fetching.
- Background orchestration independent of a user-opened page.
- Per-Job-Card review decisions (one decision covering all rows of a Job Card).
- Cleanup of staging rows after activation.

A future scheduled workflow must reuse the same validation, Council ownership, inspection, and idempotent activation rules. It must also ensure that FTO processing does not start if the prerequisite Job Card import fails.

## Related implementation

- `supabase/functions/council-fto-source/index.ts` — Government navigation, listing discovery, and refetch eligibility.
- `supabase/functions/council-fto-details/index.ts` — Detail-page parsing, validation, Panchayat ownership, decided-row resolution and inspection recording.
- `supabase/functions/_shared/fto-domain.ts` — Shared rules: day-first date parsing, listing fingerprint, unresolved counting, Panchayat normalization.
- `src/app/(workspace)/fto-monitoring/page.tsx` — Fetch, retry, apply decisions, and the import summary.
- `src/components/fto/fto-review-queue.tsx` — Manual review table and register suggestions.
- `src/components/fto/fto-imported-register.tsx` — Imported FTO register and per-FTO status counts.
- `supabase/migrations/20261123130000_create_shared_fto_navigation.sql` — Shared navigation cache.
- `supabase/migrations/20261123140000_create_council_fto_transactions.sql` — Council FTO import data.
- `supabase/migrations/20261123142000_use_fto_panchayat_for_ownership.sql` — Panchayat-based import ownership.
- `supabase/migrations/20261123160000_add_council_fto_inspection_ledger.sql` — Council inspection ledger.
- `supabase/migrations/20261123161000_track_fto_import_activation.sql` — Import activation tracking.
- `supabase/migrations/20261124100000_add_fto_review_decisions.sql` — Review decisions and the activation rule for blank-name rows.
- `supabase/migrations/20261124110000_auto_import_register_fto_review.sql` — Decision source and automatic register matching.
- `supabase/migrations/20261124120000_normalize_fto_dates.sql` — ISO normalization of stored FTO dates.
