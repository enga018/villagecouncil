# Contribution and Payment Workflow

**Project:** Village Council Platform  
**Status:** Workflow baseline — confirmed decisions separated from open design questions  
**Decision baseline:** 2026-11-27

This document describes how Contribution Management and Payments fit together. It supersedes conflicting older wording in the Contribution and Payments sections of [Financial Workflow Requirements](financial-workflow-requirements.md). It does not authorize database or application changes by itself.

## 1. Core model

### 1.1 Job Card is the financial account

- The **Job Card Number** is the primary grouping key and owns the contribution balance.
- Charges are associated with a Job Card.
- Payments are recorded against a Job Card, not against an FTO or an Apply Tag.
- The Job Card account brings together its outstanding Regular CO Charges and Other Charges, irrespective of which Apply Tags those charges came from.
- A Job Card's financial history must remain available even if its operational status changes to Inactive, Deleted or Exempt.
- Retain source traceability: every Regular CO Charge must be traceable to its source FTO, FTO transaction and CO calculation version.

### 1.2 FTO and Apply Tag roles

- FTOs remain the source of Regular CO Charges.
- Each FTO has one current Apply Tag. Tags are assigned/generated during the CO Calculation workflow, not created as a Contribution-period workflow.
- An Apply Tag classifies/groups FTOs for Contribution reporting. It is not a financial account, payment destination, or separate period entity.
- Do not create a Contribution Period entity or require a period to be opened.
- Changing an FTO's current tag changes its reporting classification, but does not move the Job Card balance, change the charge amount, or rewrite payment/allocation history.
- A payment is not restricted to one tag. FIFO allocation considers all eligible outstanding charges on that Job Card across all tags.

### 1.3 Charge categories

The financial account must distinguish at least:
- **Regular CO Charge** — generated from an eligible, non-Exempt FTO transaction through CO Calculation.
- **Other Charge** — a separate charge category that can be included in the Job Card balance and paid through the same payment/FIFO system.

The exact creation, editing, reversal and authorization rules for Other Charges remain open; do not assume that legacy manual-charge behavior has been approved for the new application.

## 2. Regular CO Charge creation and eligibility

- CO calculation remains an operation on each FTO in FTO Monitoring.
- Calculation snapshots include all source transactions in the FTO, regardless of current Government status.
- Contribution charge visibility is dynamic: a transaction is eligible to contribute to the Job Card balance only when its latest FTO Monitoring status is **Processed** and its saved permanent Exempt mark is false.
- Deferred and Rejected transactions do not create visible Regular CO Charges while in those states.
- If a previously Deferred transaction becomes Processed, its already-saved CO amount becomes eligible without requiring another calculation.
- A transaction marked Exempt remains excluded permanently, even if the Job Card's exemption is later removed.
- Charges created before a later exemption interval remain valid and payable.
- A transaction first imported after an exemption interval has ended can be considered through a new Preview → Apply cycle.
- The calculation formula and immutable calculation-version rules remain governed by [Financial Workflow Requirements](financial-workflow-requirements.md).
- A Regular CO Charge must retain the Job Card Number, FTO, source transaction, calculation version, amount, applicable Apply Tag snapshot/current grouping reference, and lifecycle/audit references needed to explain its history.

## 3. Contribution Management

Contribution Management is the Job Card contribution ledger, not a period-creation tool.

The module should provide:
- A Job Card-centred view of contribution balances.
- Charge details separated into Regular CO Charges and Other Charges.
- Traceability from every Regular CO Charge to its source FTO transaction and calculation.
- Current Apply Tag classification for reporting and filtering.
- A clear distinction between total charges, payments received, allocations, adjustments and outstanding balance.
- Access to the financial history for a Job Card.

Apply Tags may be used to filter or group charge records for inspection/reporting. They must not become the ownership key for balances or payments.

No final decision has been made here about the exact page layout, default grouping, expansion behavior, KPI selection, or export formats.

## 4. Payment workflow

### 4.1 Payment ownership and entry

- Every payment belongs to one Job Card.
- A payment can be recorded even when that Job Card has no current outstanding balance.
- A payment is a separate financial record; do not collapse multiple Job Card payments into one undifferentiated batch payment.
- A Job Card payment can cover Regular CO Charges and Other Charges across all Apply Tags.
- Payments are allowed for Active, Inactive, Deleted and Exempt Job Cards. Exemption prevents eligible new charges; it does not prevent repayment of existing balances.
- Keep payment history and the original payment record when later corrections, refunds or allocation changes occur.

The exact fields for an individual payment form (such as payment date, reference, receipt number, payer and notes) remain to be finalized.

### 4.2 Bulk payment entry

The agreed bulk-entry text format is one Job Card payment per line:

```text
JOB-CARD-NUMBER, AMOUNT
JOB-CARD-NUMBER, AMOUNT
```

Rules:
- Each non-empty line represents one payment for one Job Card.
- The batch has a selectable payment method: **CASH** or **BANK**.
- Before saving, show a preview and validate each line, including Job Card identification and amount.
- Invalid lines must be identified clearly and must not be silently accepted.
- Saving creates separate payment records for the valid Job Card entries; the batch is an entry convenience, not a replacement for the individual payment ledger.
- The exact policy for partial acceptance versus all-or-nothing batch submission must be finalized before implementation.

### 4.3 FIFO allocation

- Run FIFO automatically against the Job Card's outstanding charges across **all Apply Tags**. The administrator does not select a tag when recording a payment.
- Do not treat an Apply Tag as a separate payment bucket or account.
- Permit partial allocations.
- If a payment exceeds the currently outstanding amount, retain the excess as unallocated credit on that Job Card for future eligible charges.
- Keep the payment's unallocated balance visible and auditable.
- FIFO must be deterministic and safe to rerun without duplicating allocation effects.

The Job Card-level scope and no-tag-selection rule are confirmed. The precise chronological ordering key for charges across Regular CO Charges and Other Charges must be documented before implementing the allocator.

### 4.4 Allocation corrections

- Administrators may manually edit payment allocations.
- Allocation changes must be audited.
- Preserve the history of the original allocation and every subsequent adjustment; do not silently overwrite the financial trail.
- Reallocation is an allowed workflow and must preserve traceability between payment, Job Card and charge.

The exact correction interface, reason requirements for each type of edit, and whether edits are represented as release/reallocate events or another append-only event model remain implementation details to finalize.

## 5. Refunds

Refunds and subsequent reallocation are part of the accepted workflow scope.

The detailed refund policy still needs to be finalized before implementation, including:
- Full versus partial refund behavior.
- Required reason and supporting reference.
- Refund limits and validation.
- How affected allocations are released.
- How remaining valid payment funds are recalculated and reallocated.
- Required audit fields and whether refund records are immutable.

Do not delete or silently overwrite the original payment when implementing refunds.

## 6. Waivers, manual charges and legacy behaviors

The previous system has included manual/extra contribution charges with reasons, waivers, refunds, deferred charges and voiding with audit history. These are known legacy capabilities, but their complete behavior has not yet been approved as the new application's requirements.

Current status:
- **Other Charges:** the new account/payment model must be able to distinguish them from Regular CO Charges. Their creation and lifecycle rules remain open.
- **Manual/extra charge entry:** legacy behavior is known; the new entry workflow, required reason, permissions and audit requirements need confirmation.
- **Waivers:** a waiver workflow has been discussed but is not yet confirmed. Do not implement a waiver operation or infer whether it applies to a charge, Job Card balance, or another unit.
- **Deferred charges:** legacy behavior is known; the meaning and required state transitions in the new ledger remain open.
- **Voiding:** legacy behavior is known; the new void/reversal distinction and permissions remain open.
- **CO charge reversal/reinstatement:** retain the separately documented CO charge reversal and reinstatement requirements. These are not the same as deleting a charge or voiding a payment.

## 7. Audit, atomicity and permissions

- All financial records and operations are scoped to `village_council_id`.
- Every financial write must authenticate the caller and verify active Council membership on the backend.
- Supabase RLS and appropriately restricted database functions must enforce tenant isolation; client-side filtering alone is insufficient.
- The initial permission model gives every active Council member administrator-level financial permissions. Do not introduce a separate finance role unless a later decision changes this.
- Preserve actor and timestamp information for financial changes.
- Payment, allocation, refund, charge and adjustment history must be explainable after the event; do not erase history through destructive edits.
- Financial operations that change multiple related records must be atomic so partial writes cannot leave balances inconsistent.
- Re-running an operation must not duplicate payments, charges or allocation effects.

## 8. Implementation sequence

1. Complete and verify CO Calculation as the source of Regular CO Charge eligibility and traceability.
2. Implement the Job Card-centred Contribution ledger and Regular CO Charge records.
3. Implement Other Charges only after their creation/lifecycle rules are confirmed.
4. Implement individual and bulk payment entry, including CASH/BANK selection and validation preview.
5. Implement Job Card-level FIFO across all Apply Tags, unallocated credit and manual allocation corrections.
6. Implement refunds and reallocation after the detailed refund policy is confirmed.
7. Implement waivers, deferred charges and voiding only after their rules are explicitly confirmed.
8. Run end-to-end financial, audit, tenant-isolation and concurrency tests.

## 9. Open decisions before database design is finalized

1. Exact Contribution page layout and default grouping.
2. Exact fields for individual payment entry.
3. Bulk payment batch policy when some lines are invalid: reject the whole batch or allow valid lines to be saved separately.
4. Chronological FIFO ordering across Regular CO Charges and Other Charges, independent of mutable Apply Tags.
5. Exact manual allocation edit/reallocation rules and reason requirements.
6. Detailed refund rules, including full/partial refunds, limits and allocation handling.
7. Whether and how to implement manual/extra charges in the new application.
8. Whether to implement waivers; if yes, their target, amount rules, priority and audit requirements.
9. Whether to implement deferred charges and voiding, and their state transitions.
10. Receipt/reference numbering and export/reporting requirements.

Until these questions are resolved, they must remain open rather than being filled in by assumption.
