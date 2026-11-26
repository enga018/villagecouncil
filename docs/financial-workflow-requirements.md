# Financial Workflow Requirements

**Project:** Village Council Platform  
**Status:** Agreed product requirements; implementation not yet started  
**Decision baseline:** 2026-11-26

This document is the product source of truth for the financial workflows discussed and agreed for the Village Council Platform. It records both the initial CO Calculation scope and the downstream Contribution Management and Payments rules so that implementation can be phased without losing decisions.

If a future product decision changes a rule, update this document and record the change in [Decision Log](decision-log.md). Do not silently reinterpret an earlier decision.

## 1. Scope and implementation sequence

The financial workflow is broader than CO Calculation, but implementation is intentionally phased:

1. **CO Calculation** — implement first.
2. **Contribution Management** — implement after CO Calculation.
3. **Payments and FIFO allocation** — implement after Contribution Management.
4. **Integration and end-to-end financial testing** — implement after the preceding modules.

The CO ledger and database design must leave room for later payments, refunds, allocations and reversals. However, the first implementation phase must not expand into building the complete payment workflow.

There is **no requirement to create a separate Contribution Period before calculating CO**. Administrators should not have to create and open a period as a prerequisite. FTO Apply Tags provide the grouping mechanism used by the Contribution page.

## 2. CO calculation rules

### 2.1 Eligible source transactions

- Only FTO transactions whose current normalized Government status is **Processed** are eligible for a CO charge.
- Government Rejected transactions are not chargeable.
- Government blank-status transactions (normalized as Deferred in the current import pipeline) are not chargeable while they remain Deferred.
- If a previously charged transaction later becomes Rejected, its charge must be reversed through the auditable reversal workflow; do not delete the charge.
- If a Deferred transaction later becomes Processed, it can be reconsidered through a new Preview → Apply cycle, subject to all other eligibility rules.
- **Credit Amount** is the authoritative CO calculation input.
- **Amount to be Credited** is separate reconciliation/display data. It must not replace Credit Amount in the formula.

### 2.2 Formula

The formula is:

\`CO Amount = ROUND((Credit Amount / Divisor) × Multiplier, 2)\`

Council defaults:

- Divisor: **300**
- Multiplier: **100**

Rules:

- Divisor and multiplier are configurable by the Council.
- Both values must be positive whole numbers.
- Invalid values block calculation.
- A formula change affects future calculations only.
- Existing charges retain the formula values used when they were created.
- Formula changes require a reason and an immutable audit record containing the previous and new values, actor and timestamp.
- A formula change invalidates pending previews. The administrator must generate a fresh preview using the current formula.

### 2.3 Exemption eligibility

Exemptions are temporary intervals on a Job Card, but the effect on an FTO transaction is determined by the transaction's immutable first-import time.

- During calculation, check the Job Card's exemption history for each FTO transaction.
- Use the transaction's immutable \`first_imported_at\` timestamp to determine whether it was first imported during an exemption interval. Do not use a mutable \`updated_at\` or later re-import timestamp for this decision.
- A transaction first imported **during** an exemption interval is marked **Exempt** in the CO ledger/eligibility record and must not generate a payable CO charge.
- That Exempt mark is permanent for that transaction. Removing the Job Card from the active exemption list does not clear the historical mark or make that transaction chargeable later.
- A transaction first imported **before** an exemption interval is not made exempt merely because the Job Card is later exempted. Existing charges remain valid and visible.
- A transaction first imported **after** the exemption interval has ended can be considered for a new CO charge, subject to the other eligibility rules.
- Removing an exemption does not automatically create charges. A new Preview → Apply cycle is required.
- An exempt transaction remains excluded from the Contribution page permanently, even after the Job Card's exemption is removed.
- A Job Card may be exempted, have the exemption removed, and be exempted again. Each interval is retained separately.

This is a transaction-level decision. Do not hide every transaction for a Job Card merely because another transaction on the same Job Card is exempt.

### 2.4 Exemption effect on existing financial records

Adding an exemption:

- Blocks new CO charges for transactions first imported during the exemption interval.
- Does not cancel or reverse existing charges.
- Does not remove existing outstanding balances.
- Does not block payment of existing charges.
- Does not stop FIFO allocation to existing active charges.
- Does not delete or alter existing payment history.

Exemption is not debt forgiveness and does not freeze the financial ledger.

## 3. Exemption management

### 3.1 Current state and history

Maintain a current active exemption state and a permanent interval history.

Each exemption interval must retain:

- Village Council and Job Card association.
- Start timestamp.
- End timestamp (null while active).
- Add reason and removal reason.
- Administrator who added it.
- Administrator who removed it.
- Creation and change timestamps.

A Job Card can have multiple exemption intervals over time, but only one active interval at a time.

### 3.2 Add and remove actions

- Adding an exemption requires a reason.
- Removing an exemption requires a reason.
- Record the acting administrator and timestamp for both actions.
- Never delete or overwrite a previous interval.
- A Job Card's Active, Inactive or Deleted status does not automatically end an exemption.
- Only an explicit administrator removal ends the current interval.
- Exemptions can be managed for Active, Inactive and Deleted Job Cards.

### 3.3 Permissions

For the initial implementation, every active Council membership has the same administrator-level financial permissions. Do not introduce a separate finance role or a new role column in this phase.

All active Council members can:

- View current exemptions.
- View exemption history.
- Add exemptions.
- Remove exemptions.

All writes must validate the authenticated user's active Council membership and remain tenant-scoped.

### 3.4 User interface boundary

Do not add exemption badges, visible exemption status indicators, or exemption controls to the Job Cards list or Contribution page as part of this workflow. Exemption is checked and recorded during CO calculation. The Contribution page uses the transaction-level Exempt mark in the ledger to decide what to exclude.

The final placement of any separate exemption-management entry point is not specified by this decision set and should not be invented as part of the CO calculation implementation.

## 4. FTO-level Apply Tags

### 4.1 Tag meaning and ownership

An Apply Tag is a grouping label for FTOs. It is not a separate financial ledger, a Job Card attribute, or a prerequisite Contribution Period.

- Each FTO has exactly one current tag.
- Multiple FTOs can share the same tag.
- The tag is assigned at **FTO level**, not at transaction or Job Card level.
- If one FTO contains transactions for several Job Cards, changing that FTO's tag changes the grouping for all its transactions together.
- Every FTO in the tagging workflow receives a tag, including an FTO whose transactions are all Exempt.
- An FTO with a mixture of eligible and Exempt transactions uses the same tag for both; only eligible, non-Exempt charges appear on the Contribution page.
- Multiple calculation batches can use the same existing tag.

### 4.2 Tag selection

- The system suggests the most recently used tag by default.
- The administrator may accept the suggestion, select any existing non-archived tag, or create a new tag.
- The system must not silently create or assign a tag without administrator confirmation.
- An existing tag can be reused by later FTOs and later calculation batches.
- Tags are unique within a Village Council, case-insensitively.
- Trim leading and trailing whitespace before comparing or saving names.
- Names such as \`NOV26\`, \`NOV26 (2)\` and \`DEC26\` are supported.
- An archived tag cannot be selected for a new assignment until restored.

### 4.3 Individual and bulk management

Administrators can:

- Change one FTO's tag.
- Select multiple FTOs and assign them to one shared tag.
- Move selected FTOs from one tag to another.
- Rename a tag, updating the current tag name for all FTOs assigned to it.
- Merge groups by reassigning the relevant FTOs to the destination tag and then archiving the old tag if appropriate.

Bulk reassignment requires a confirmation summary showing:

- Number of selected FTOs.
- Their current tag distribution.
- Destination tag.
- Explicit confirmation before saving.

Tag changes are allowed at any time, including after CO charges have been applied and payments have been recorded.

### 4.4 Tags do not alter financial records

A tag is only a grouping label.

Changing, renaming, moving, merging or archiving a tag must not:

- Change a CO amount or formula snapshot.
- Create, delete, reverse or reinstate a charge.
- Change a payment amount or refund.
- Change an existing payment allocation.
- Rewrite a calculation batch.
- Change the source FTO transaction's eligibility or Exempt mark.

Existing payment allocations remain attached to their original charges when tags change. The Contribution page grouping updates to reflect the current FTO tag.

### 4.5 Archive, restore and audit

- Tags are archived rather than permanently deleted.
- Archived tags remain available in historical records.
- Archived tags cannot be used for new assignments until restored.
- An archived tag can be restored; its historical FTO associations and audit history are retained.
- Tag history records creation, rename, FTO assignment/reassignment, bulk reassignment, archive and restore.
- Each event records the actor, timestamp, action, affected FTOs and old/new values where applicable. A reason is recorded where required by the relevant action.
- No permanent tag deletion is supported.

### 4.6 Tagging during CO Preview

The administrator can correct an FTO's tag directly in the CO Calculation Preview without leaving the workflow.

- Individual and bulk tag changes are available.
- The tag change is a separate grouping operation; it does not change the calculation formula or financial amounts.
- The updated tag is shown before Apply.
- Bulk changes still require the confirmation summary.
- Tag changes must be audited.

## 5. CO Calculation Preview and Apply

### 5.1 Preview contents

Preview is grouped by FTO and includes, at minimum:

- FTO number.
- Current Apply Tag.
- Number of eligible transactions.
- Number of Exempt transactions.
- Total Credit Amount for eligible transactions.
- Total calculated CO amount for eligible transactions.
- Exclusion reasons for transactions that are not eligible.

Transaction-level detail must be available so the administrator can inspect why a transaction is included or excluded.

An FTO containing only Exempt transactions still receives a tag and remains represented in the calculation/eligibility records; it produces no payable charge.

### 5.2 Preview is non-destructive

- Preview does not create permanent CO charges.
- The administrator must explicitly confirm Apply.
- Formula settings, source transaction status, Credit Amount, Job Card ownership and exemption eligibility must be revalidated at Apply time.
- If the preview is stale, it cannot be applied; generate a new preview.
- A formula change invalidates pending previews.
- Preview and Apply must preserve a snapshot of the formula and the source values used for the calculation.

### 5.3 Atomic Apply and idempotency

- Apply is an atomic database operation: all approved charge changes commit together, or none of them do.
- A failed or interrupted Apply must not leave partially committed charge changes.
- Retrying an Apply must not create duplicate charges.
- A source FTO transaction must not acquire a duplicate CO charge through repeated imports, previews or retries.
- Record batch status and error details.
- Run FIFO allocation only after the approved charge changes have committed successfully. The allocator must be safe to retry without duplicating allocation events.

### 5.4 Recalculation and reconciliation

Previously calculated FTOs can be recalculated when new transactions arrive or source data changes.

Recalculation uses the same Preview → Apply workflow. Its preview distinguishes:

- New charges to create.
- Existing charges that remain unchanged.
- Charges requiring reversal.
- Transactions remaining Exempt.
- Changes in total CO amount.

Apply revalidates the current source data and exemption decision. Recalculation must not duplicate existing charges. New eligible transactions may create new charges. A transaction that becomes Rejected must have its existing charge reversed with history preserved.

### 5.5 Calculation batch history

Maintain a separate calculation batch history. Each batch records:

- Batch date and time.
- Administrator.
- FTOs included.
- Apply Tags involved.
- New charges created.
- Charges reversed or corrected.
- Total CO amount.
- Status and error details where applicable.
- Transaction-level calculation details.

Relevant lifecycle states include Preview, Applied, Failed, Cancelled and Stale.

Applied calculation history is read-only. Administrators can inspect and export it, but cannot edit or rewrite an applied batch. Corrections require a new Preview → Apply operation and their own audit history.

## 6. CO charge reversal and reinstatement

### 6.1 Manual and automatic reversal

- An administrator may manually reverse an individual CO charge even if its source FTO transaction remains Processed.
- A manual reversal requires a reason.
- A source transaction that becomes Rejected triggers reversal of its existing charge.
- A reversal never deletes the original charge or its calculation details.
- Record the administrator/system actor, timestamp, reversal cause and reason.
- Releasing a charge releases its payment allocations. The released valid payment balance becomes available for FIFO allocation to other outstanding charges on the same Job Card.

### 6.2 Reinstatement

- Reinstatement is an explicit, separate administrator action.
- It requires a reason and audit record.
- Reinstatement is blocked if the source FTO transaction is not currently Processed and otherwise eligible.
- Reinstate the original charge; do not create a duplicate.
- Preserve the original calculation details and original Apply Tag association unless the FTO's current tag has subsequently been changed (tag grouping follows the FTO's current tag).
- After reinstatement, run FIFO again using the available unallocated payments for that Job Card.
- A charge may be reversed and reinstated multiple times. Every cycle is retained in history.

## 7. Contribution Management (later phase)

Contribution Management is implemented after CO Calculation.

- Display eligible, non-Exempt CO charges grouped by the current tag of their source FTO.
- Do not display transactions marked Exempt in the CO ledger, even after the Job Card's exemption is removed.
- Charges calculated before an exemption interval remain visible and payable.
- Transactions first imported during an exemption interval remain hidden permanently.
- Transactions first imported after the exemption interval ends may appear after a new calculation is previewed and applied.
- A mixed FTO can have eligible charges shown and Exempt transactions hidden under the same FTO tag.
- Tag changes update grouping immediately but do not alter charge or payment history.
- Outstanding balances remain associated with the underlying charges, not with a mutable tag name.

There is no separate period creation step required before CO calculation. Apply Tags provide the grouping for Contribution Management.

## 8. Payments and FIFO allocation (later phase)

These rules are agreed for the later Payments phase. They are recorded now so the CO ledger and charge model do not block them.

### 8.1 Payment entry and eligibility

- Payments may be recorded even when a Job Card has no outstanding CO charges. The unallocated balance remains available for future eligible charges.
- Payments may be recorded against Active, Inactive, Deleted and Exempt Job Cards.
- Allowing a payment does not make an Inactive or Deleted Job Card eligible for new CO charges.
- Exemption blocks new CO charges, not repayment of existing obligations.
- Payments and FIFO allocation continue for existing active charges during an exemption interval.

The exact payment-entry form fields and UI layout have not yet been finalized.

### 8.2 FIFO priority

The agreed allocation priority is:

1. Oldest outstanding Apply Tag first.
2. Oldest available payment first.
3. Partial allocations are supported.
4. Any unallocated payment balance remains available for future charges.

FIFO operates within the same Job Card. Payment allocations must not exceed the remaining valid payment amount or the outstanding amount of a charge.

A tag is mutable and is not an accounting control. The implementation must preserve the agreed oldest-tag-first priority without allowing a rename, reassignment or merge to rewrite existing allocations. The immutable chronological key used to order tags for future FIFO runs remains an implementation detail to resolve before building the allocator.

### 8.3 Allocation event history

Do not overwrite allocation history. Record financial allocation changes as events, including:

- Allocate: positive amount.
- Release: negative amount.
- Reallocate: new positive allocation.

Original payments and charges remain intact. Unallocated valid payment balances can be consumed by later charges.

### 8.4 Charge reversal and reinstatement interaction

- Reversing a charge releases its allocations.
- Released valid payment balances become available for other outstanding charges on the same Job Card.
- Reinstating a charge triggers FIFO again.
- Reallocation follows the same priority rules and creates new events rather than rewriting prior events.

### 8.5 Refunds

- Refunds are separate records; never delete or overwrite the original payment.
- Full and partial refunds are supported.
- Each refund requires a reason and records administrator and timestamp.
- Multiple partial refunds are allowed.
- Total refunds cannot exceed the refundable balance of the original payment.
- When a refund is processed, first release the affected allocations, then record the refund, recalculate the remaining valid payment balance and run FIFO again.
- Preserve all release and reallocation events.

## 9. Permissions and tenant isolation

For the initial implementation, every active Council membership is treated as an administrator for financial workflows. No separate finance role or role column is introduced in this phase.

All active Council members can view CO and payment information and perform the agreed financial operations, including settings changes, Preview/Apply, payment/refund entry, charge reversal/reinstatement and audit-history review.

Every write must:

- Authenticate the caller.
- Validate an active membership for the target \`village_council_id\`.
- Operate only on that Council's records.
- Be enforced by backend authorization and Supabase RLS/RPC permissions, not only by client-side filters.

All financial, exemption, tag, batch, charge, payment and allocation records are Council-scoped. Preserve tenant-safe foreign keys and constraints when designing the schema.

## 10. Implementation boundaries and open items

### In scope for the first implementation phase

- Council CO formula settings and settings history.
- Exemption current state and interval history.
- Transaction-level eligibility decisions, including permanent Exempt marks.
- FTO-level tags and tag audit history.
- CO calculation Preview and atomic Apply.
- Idempotent recalculation/reconciliation.
- Calculation batch history.
- Manual/automatic charge reversal and reinstatement.
- RLS, tenant isolation and audit controls.

### Explicitly deferred

- Full Contribution Management UI and reports.
- Payment-entry UI.
- FIFO allocator implementation.
- Refund UI and processing.
- End-to-end payment reconciliation.

These later workflows must be supported by the data model, but should not delay the first CO Calculation implementation.

### Decisions still requiring technical resolution before the relevant implementation

1. **FIFO tag chronology:** Tags can be renamed, reassigned and merged, but FIFO uses oldest outstanding tag first. Define an immutable chronological ordering key for FIFO without changing existing allocations when tags are edited.
2. **Payment-entry form:** The exact required and optional fields and UI layout have not been confirmed.
3. **Exemption management entry point:** The business rules and permissions are agreed, but the separate navigation/UI placement has not been specified. Do not add exemption indicators or controls to the Job Cards list or Contribution page.
4. **Tag archival with current assignments:** Tags are not deleted and historical associations must survive archive/restore. Confirm whether a tag may be archived while FTOs are still currently assigned, or whether all current FTOs must first be reassigned.

## 11. Existing platform constraints

The financial modules are part of the existing multi-Council Village Council Platform, not a separate application.

- Reuse the authenticated workspace and active Council context.
- Council-owned records must be scoped by \`village_council_id\`.
- Supabase RLS and backend authorization are mandatory.
- Do not expose service-role credentials in browser code.
- Follow the existing Next.js static-export and Supabase Edge Function architecture.
- Do not change existing FTO import behavior as part of the financial schema work unless a specific dependency is identified and approved.

See [Architecture](architecture.md) and [FTO Monitoring](fto-monitoring.md).
