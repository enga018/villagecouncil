# Financial Workflow Decision Log

**Project:** Village Council Platform  
**Decision baseline:** 2026-11-26  
**Status:** Agreed decisions captured; open technical details listed at the end

This log records the product decisions made for CO Calculation, exemptions, FTO tags, Contribution Management and Payments. The detailed requirements live in [Financial Workflow Requirements](financial-workflow-requirements.md).

When a decision changes:
1. Add a new dated entry rather than silently rewriting history.
2. Update the requirements document to show the current rule.
3. Record what changed and why.

## Current implementation decisions — 2026-11-26

The following decisions were confirmed after the original financial requirements were drafted. They supersede any conflicting earlier wording in this document and in the decision index below.

1. **CO calculation location:** CO calculation is an operational action on each FTO card in the existing FTO Monitoring → Imported FTO register. The card offers **Calculate CO** before the first calculation and **View CO** afterward. Recalculation is available from the View CO workflow. There is no separate CO Calculation management page. Contribution remains a separate module/page.
2. **Calculation scope:** Calculate every transaction in the selected FTO, including Processed, Deferred and Rejected transactions. Government status is shown read-only in preview and is never stored in the CO calculation header or item records.
3. **Contribution visibility:** Contribution later displays only transactions whose latest FTO Monitoring status is Processed and whose saved exemption mark is false. Deferred and Rejected transactions remain calculated but hidden. If status later changes to Processed, the existing saved amount becomes visible without recalculation.
4. **Recalculation:** Administrators may recalculate an FTO at any time. Each confirmation creates a new immutable version; earlier versions remain retained for audit. Do not build a version-comparison screen. Show the divisor and multiplier used for the latest calculation, and retain both values in every historical version.
5. **Recalculation and payments:** When payment records and FIFO allocation exist, a confirmed recalculation must atomically update the active charge values, release affected allocations and run FIFO allocation again. Payment records themselves are never changed or duplicated. Allocation changes are append-only events. The payment module is a later implementation phase; the CO schema must preserve the versioned charge identity needed for this integration.
6. **FTO tags:** Each FTO has one current tag. The tag can be changed after calculation, independently of recalculation. Tag changes update Contribution grouping but do not change CO amounts, formula snapshots or payment records. The tag at calculation time is retained as a historical snapshot.
7. **Formula settings:** Divisor and multiplier are configured only in Settings, defaulting to 300 and 100. Both are positive whole numbers. Every calculation version snapshots the values used. Formula changes require a reason and audit history; they do not alter existing versions.
8. **Exempt transactions:** Exempt transactions are still calculated and saved with their CO amounts, but their permanent Exempt mark prevents them from appearing in Contribution.
9. **Preview and confirmation:** Preview lists every FTO transaction and shows its current Government status read-only, Credit Amount, calculated CO amount and exemption marker. Apply revalidates the source transaction set and formula settings, then saves the new version atomically.


## Decision index

| ID | Area | Decision |
|---|---|---|
| FIN-001 | Scope | Implement CO Calculation first; Contribution Management and Payments follow in later phases. |
| FIN-002 | Period model | Do not require a separately created/open Contribution Period before calculation; use FTO Apply Tags for grouping. |
| FIN-003 | Formula | Use ROUND((Credit Amount / divisor) × multiplier, 2), default 300 and 100. |
| FIN-004 | Source eligibility | Only Processed FTO transactions are chargeable; Credit Amount is authoritative. |
| FIN-005 | Exemption timing | Evaluate transaction first_imported_at against exemption intervals. |
| FIN-006 | Permanent exemption mark | Transactions first imported during an exemption interval remain Exempt permanently and never appear on Contribution. |
| FIN-007 | Existing charges | Exemption does not cancel existing charges, outstanding balances or payments. |
| FIN-008 | Exemption intervals | Exemptions are temporary; each add/remove cycle has permanent history. |
| FIN-009 | Exemption reasons | Adding and removing an exemption both require a reason. |
| FIN-010 | Exemption permissions | Every active Council member can view and manage exemptions in the initial permission model. |
| FIN-011 | Exemption UI | No exemption badges/controls on Job Cards list or Contribution page; use ledger marks for Contribution filtering. |
| FIN-012 | FTO tags | One current tag per FTO; multiple FTOs and batches can share a tag. |
| FIN-013 | Exempt-only FTO | Even an FTO containing only Exempt transactions receives a tag. |
| FIN-014 | Tag scope | Tags are FTO-level, not Job Card-level or transaction-level. |
| FIN-015 | Tag defaults | Suggest most recently used tag; administrator confirms, chooses existing or creates new. |
| FIN-016 | Tag editing | Individual and bulk FTO reassignment are allowed at any time, including after payments. |
| FIN-017 | Tag rename/merge | Rename updates assigned FTOs; merge is achieved by moving FTOs to a destination tag. |
| FIN-018 | Tag identity | Names are unique per Council, case-insensitive, and trimmed. |
| FIN-019 | Tag archive | Archive/restore instead of permanent deletion; preserve historical FTO associations. |
| FIN-020 | Tag audit | Record create, rename, assignment/reassignment, bulk reassignment, archive and restore. |
| FIN-021 | Tag financial neutrality | Tag changes do not alter CO amounts, charges, payments or existing allocations. |
| FIN-022 | Preview | Preview is grouped by FTO and shows eligible/exempt counts, Credit Amount, CO amount and exclusions. |
| FIN-023 | Preview tag correction | FTO tags can be corrected directly in Preview; bulk changes require confirmation. |
| FIN-024 | Apply | Explicit confirmation, atomic commit and idempotent retry; no duplicate charges. |
| FIN-025 | Recalculation | Reuse Preview → Apply and reconcile new/unchanged/reversed/exempt transactions. |
| FIN-026 | Calculation history | Applied batches are read-only; corrections use a new Preview → Apply. |
| FIN-027 | Charge reversal | Manual reversal is allowed with a reason; source becoming Rejected causes reversal. |
| FIN-028 | Reinstatement | Explicit reinstatement requires a reason and current Processed eligibility; restore original charge. |
| FIN-029 | Reversal cycles | A charge can be reversed/reinstated multiple times with complete history. |
| FIN-030 | Payment availability | Payments can be recorded with no outstanding balance and for Active, Inactive, Deleted or Exempt Job Cards. |
| FIN-031 | FIFO | Job Card-level FIFO across all Apply Tags without tag selection; partial allocations; excess remains unallocated. Chronological ordering across charge categories remains open. |
| FIN-032 | Allocation history | Record Allocate, Release and Reallocate events; do not overwrite allocation history. |
| FIN-033 | Refunds | Full/partial refunds; mandatory reason; original payment retained; release allocations then rerun FIFO. |
| FIN-034 | Permissions | Every active Council membership has administrator-level financial permissions in this phase; no finance role. |
| FIN-035 | Tenant isolation | Every financial operation must be Council-scoped and backend-authorized. |

## Decision details

### FIN-001 — Phased implementation

CO Calculation is the first implementation target. Contribution Management follows. Payments and FIFO follow Contribution Management. Integration and end-to-end financial tests come after those modules.

The first phase must design for downstream financial workflows without implementing the full payment system.

### FIN-002 — No mandatory Contribution Period creation

An administrator should not have to create and open a separate Contribution Period before calculating CO. FTO Apply Tags provide the grouping used later on the Contribution page.

### FIN-003 and FIN-004 — Formula and source data

Formula:

\`ROUND((Credit Amount / Divisor) × Multiplier, 2)\`

Defaults are divisor 300 and multiplier 100. Both are configurable positive whole numbers. Formula changes affect future calculations only, retain snapshots on existing charges, require a reason and audit record, and invalidate pending previews.

Only Processed transactions are chargeable. Rejected and Deferred/blank-status transactions are excluded. Credit Amount is the formula input; Amount to be Credited is for reconciliation/display.

### FIN-005 through FIN-011 — Exemptions

Exemptions are temporary intervals attached to a Job Card. The calculation checks each transaction's immutable \`first_imported_at\` against those intervals.

A transaction first imported during an exemption interval receives a permanent Exempt mark in the CO ledger/eligibility record. Removing the exemption does not clear the mark. It stays hidden from Contribution permanently.

Transactions first imported before the interval are not made exempt by a later exemption; existing charges remain valid. Transactions first imported after the interval ends can be considered in a later Preview → Apply.

Adding an exemption does not reverse existing charges or prevent payment of them. Payments and FIFO continue for existing active charges during exemption.

Each exemption add/remove requires a reason and retains actor, timestamp and interval history. Job Card status changes do not automatically end an exemption. Exemptions can apply to Active, Inactive and Deleted Job Cards.

All active Council members can view and manage exemptions in the initial permission model. Do not add visible exemption indicators or controls to the Job Cards list or Contribution page; Contribution filtering uses the transaction-level Exempt mark.

### FIN-012 through FIN-021 — FTO tags

A tag is a grouping label assigned at FTO level. Each FTO has one current tag, and many FTOs may share a tag. An FTO with only Exempt transactions still receives a tag. Mixed FTOs share one tag across all their transactions, while Exempt transactions remain hidden from Contribution.

The most recently used tag is suggested. The administrator can choose another existing tag or create one. Names are trimmed and unique case-insensitively within a Council.

Administrators can change tags individually or in bulk, rename tags and merge groups by reassigning FTOs. Bulk changes require a confirmation summary. Tag changes are allowed even after payments have been recorded.

Tags are not financial controls. Changing a tag must not alter charges, payment records or existing allocations. A tag rename updates the grouping name for all currently assigned FTOs.

Tags are archived/restored, not permanently deleted. Audit tag creation, rename, FTO assignment/reassignment, bulk changes, archive and restore.

### FIN-022 through FIN-026 — Preview, Apply and history

Preview is grouped by FTO and shows FTO number, tag, eligible count, Exempt count, eligible Credit Amount, calculated CO amount and exclusion reasons. Transaction detail is available.

Preview does not create permanent charges. Apply requires explicit confirmation and revalidates formula settings, source status, Credit Amount, Job Card ownership and exemption eligibility.

Apply is atomic and idempotent. Retrying must not duplicate charges. FIFO runs only after successful charge changes have committed.

Recalculation uses Preview → Apply and distinguishes new charges, unchanged charges, reversals, Exempt transactions and total changes.

Applied calculation history is read-only. Corrections use a new batch.

### FIN-027 through FIN-029 — Charge reversal and reinstatement

Manual reversal is allowed even if the source remains Processed; it requires a reason. A source transaction becoming Rejected causes reversal. Never delete the original charge.

Reinstatement is explicit, requires a reason, and is allowed only if the source transaction is currently Processed and otherwise eligible. Restore the original charge, not a duplicate. Reinstatement reruns FIFO. Multiple reversal/reinstatement cycles are supported and audited.

### FIN-030 through FIN-033 — Payments, FIFO and refunds (later phase)

Payments can be recorded even with no current outstanding charges. The unallocated balance remains available for future charges. Payments are allowed against Active, Inactive, Deleted and Exempt Job Cards; this does not make those Job Cards eligible for new charges.

FIFO priority:
1. Oldest outstanding Apply Tag first.
2. Oldest available payment first.
3. Partial allocations.
4. Unallocated balances remain available.

Allocation history is append-only: Allocate, Release and Reallocate events. Charge reversals release allocations; reinstatements rerun FIFO.

Full and partial refunds are supported. A refund requires a reason and records administrator/time. The original payment is retained. For a refund, release affected allocations, record the refund, recalculate the remaining valid payment balance and run FIFO again. Refunds cannot exceed the refundable balance.

### FIN-034 and FIN-035 — Permissions and tenant isolation

Every active Council membership is treated as administrator-level for the initial financial implementation. No separate finance role or role column is introduced in this phase.

All financial data and writes must be Council-scoped and backend-authorized, with Supabase RLS and membership validation.

## Open technical details (not yet decided)

These are not product decisions and must not be silently filled in:

1. **FIFO ordering across charge categories:** FIFO runs at Job Card level across all Apply Tags. Define the immutable chronological key for ordering Regular CO Charges and Other Charges while preserving existing allocations.
2. **Payment-entry form:** Exact required/optional fields and UI layout remain unconfirmed.
3. **Exemption management navigation:** The exemption business rules are agreed, but the separate entry point has not been specified. Do not add controls to the Job Cards list or Contribution page.
4. **Archiving a tag with current FTO assignments:** Historical associations must survive. Confirm whether current assignments must be moved before archive or whether an assigned tag can be archived directly.


## 2026-11-27 — Job Card-centred Contribution and Payment model

The following decisions were confirmed in the latest workflow review and are now recorded as the current model:

1. **Job Card financial account:** Job Card Number is the primary financial account/grouping key. Charges are sourced from FTOs and remain traceable to the source FTO transaction and calculation version.
2. **Apply Tag role:** Tags classify/group FTOs. They are assigned/generated during CO Calculation, not created as a Contribution-period workflow. Tags are not financial accounts or payment destinations.
3. **No Contribution Period entity:** Do not introduce a separate Contribution Period or require period creation/opening.
4. **Payment ownership:** Payments are recorded against a Job Card and can cover Regular CO Charges and Other Charges across all Apply Tags. The user does not select a tag when recording a payment.
5. **Payment with no outstanding balance:** A payment may be recorded even when there is no current outstanding charge. Any excess remains as unallocated credit on that Job Card for future eligible charges.
6. **Bulk payment format:** One Job Card payment per line, using `JOB-CARD-NUMBER, AMOUNT`. The batch payment method is selected as CASH or BANK. Preview and validation are required before saving; each line creates a separate payment record.
7. **FIFO scope:** Automatic FIFO operates at Job Card level across all Apply Tags. Partial allocations are supported. The exact chronological key across Regular CO Charges and Other Charges remains open.
8. **Allocation edits:** Manual allocation edits are allowed and all changes must be audited. Reallocation is supported and must preserve the financial trail.
9. **Refunds:** Refunds and reallocation are within the accepted workflow scope. Detailed refund rules remain to be finalized before implementation.

### Not yet approved for the new application

The previous system's manual/extra charges, waivers, deferred charges and voiding are known legacy capabilities. Their existence does not by itself approve identical workflows in the new application. Other Charges must be represented in the account/payment model, but creation rules are open. A waiver workflow has been discussed but not confirmed. Do not implement these operations until their rules are explicitly agreed.

### Open implementation details

- Individual payment form fields.
- Bulk batch behavior when some lines fail validation.
- FIFO chronological ordering across charge categories, independent of mutable tags.
- Exact manual allocation correction semantics and reason requirements.
- Refund validation, full/partial behavior, limits, audit fields and allocation release/reallocation sequence.
- Other Charge creation, editing, reversal and permissions.
- Whether to implement waivers, deferred charges and voiding, and their precise behavior.
- Contribution page layout and reporting/export requirements.

These decisions are documented in [Contribution and Payment Workflow](contribution-management-workflow.md).