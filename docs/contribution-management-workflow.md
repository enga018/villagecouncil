# Contribution and Payment Workflow

**Project:** Village Council Platform  
**Status:** Agreed workflow baseline; unresolved implementation details are listed separately  
**Decision baseline:** 2026-11-27

This document records the agreed Contribution and Payment workflow. It supersedes conflicting older wording in the Contribution and Payments sections of [Financial Workflow Requirements](financial-workflow-requirements.md). It is a product/workflow specification; it does not itself authorize database or application changes.

## 1. Core financial model

### 1.1 Job Card is the financial account

- The **Job Card Number** is the primary financial account key and owns the contribution balance.
- Every charge and payment is associated with a Job Card.
- A Job Card account brings together its Regular CO Charges and Manual/Extra Charges, regardless of the Tags of their source FTOs.
- Payment allocation runs within the Job Card across all eligible charges and all Tags. Administrators do not select a Tag when recording a payment.
- Financial history remains available when a Job Card is Active, Inactive, Deleted or Exempt.
- Payments are allowed against Active, Inactive, Deleted and Exempt Job Cards. Exemption prevents eligible new CO charges; it does not prevent repayment of existing obligations.

### 1.2 Two separate charge categories

Keep these as distinct categories in the Job Card contribution detail:

1. **Regular CO Charge** — generated from FTO transaction CO calculations.
2. **Manual/Extra Charge** — an additional charge entered by an administrator; it is not a CO calculation result.

Do not combine the two categories into one indistinguishable charge type. Both contribute to the Job Card balance and can be covered by payments. Manual/Extra Charges need their own entry and reversal history.

### 1.3 FTO and Tag roles

- FTOs remain the source of Regular CO Charges.
- Each FTO has one current Tag. Tags are assigned during the FTO CO Calculation workflow.
- Tags classify/group FTOs and Manual/Extra Charges for Contribution review and reporting. They are not financial accounts, payment destinations or Contribution Periods.
- Do not create a separate Contribution Period entity or require a period to be opened.
- Changing an FTO's tag changes its reporting classification, but does not change the Job Card balance, charge amount or payment/allocation history.
- A payment is not restricted to one tag. FIFO covers eligible outstanding charges on the Job Card across all tags.

## 2. Regular CO Charges and recalculation

### 2.1 Source eligibility

- CO calculation remains an action on each FTO in FTO Monitoring.
- Calculation snapshots include all source transactions in the FTO, regardless of current Government status, as specified in the CO calculation requirements.
- A transaction contributes a visible Regular CO Charge only when its latest FTO Monitoring status is **Processed** and its saved permanent Exempt mark is false.
- Deferred and Rejected transactions remain hidden from Contribution.
- If a previously Deferred transaction becomes Processed, its saved CO amount becomes eligible without requiring another calculation.
- A transaction with a permanent Exempt mark remains excluded, even if the Job Card exemption is later removed.
- Charges calculated before a later exemption interval remain visible and payable.
- Transactions first imported after an exemption interval ends may be considered through a new Preview → Apply cycle.
- The calculation formula, exemption timing and immutable calculation-version rules remain governed by [Financial Workflow Requirements](financial-workflow-requirements.md).

### 2.2 Recalculation review and confirmation

When an administrator recalculates an FTO:

1. Generate a new calculation preview.
2. Show the existing/old calculated result as well as the proposed/new result so the administrator can review the difference.
3. Show the affected transaction details and the relevant FTO tag information.
4. Require explicit administrator review and confirmation before applying the new result.
5. Retain the previous calculation version and its history; do not overwrite or hide it.
6. After confirmation, update the active Regular CO Charge values from the confirmed calculation.
7. Automatically release affected payment allocations and run FIFO again for the Job Card(s) affected by the recalculation.
8. Keep payment records unchanged. Allocation releases and new allocations must remain auditable.

This review is part of the recalculation workflow. It is not a separate general-purpose version-comparison module. Do not add a separate manual CO-charge reversal workflow where the correction is handled by the confirmed CO recalculation process.

### 2.3 Tag changes

- FTO tag assignment/change is reviewed and confirmed by the administrator in the CO workflow.
- Show the current/old tag and the proposed/new tag before confirmation.
- A tag change changes grouping/reporting only. It must not change CO amounts, Job Card balances, payment records or existing allocations.
- Tag history remains auditable.

## 3. Contribution module navigation

The Contribution module has four sections:

1. **Contributions** — Job Card contribution accounts, charges, payments and balances.
2. **Batch Operations** — one shared batch workspace for bulk Payments and bulk Manual/Extra Charges.
3. **Reports** — contribution and financial reports.
4. **Settings** — relevant financial configuration.

All five financial actions are available from the relevant Job Card Contribution Detail, each on its own dedicated page: **Record Payment**, **Paid in Full**, **Waive**, **Refund** and **Add Manual/Extra Charge**. Do not use modals or inline forms for these actions. The Job Card context is carried into the destination page automatically; the administrator must not re-enter the Job Card Number. After a successful save, return to that Job Card's Contribution Detail. Batch Operations remains a separate workspace for bulk Payments and bulk Manual/Extra Charges only.

CO formula configuration remains in the existing Council Settings workflow.

## 4. Contributions page and Job Card detail

### 4.1 Job Card list

- The Contributions page is Job Card-number based.
- Show Job Card Number and Head of Household identification, with contribution balance information.
- Search by Job Card Number or Head of Household.
- **Outstanding** is the default list/filter view.
- Provide access to Fully Paid and All Job Cards as additional views.
- Selecting a Job Card opens its Contribution Detail.
- Tag can be used to filter/group source charge information, but never owns the account balance.
- Summary figures must reconcile to the underlying Job Card accounts and ledger.

### 4.2 Job Card Contribution Detail

The detail page is the financial workspace for that Job Card. It must show, separately and clearly:
- Regular CO Charges.
- Manual/Extra Charges.
- Payment history.
- Allocation/unallocated payment information.
- Waivers and refunds, where present.
- Current outstanding or overpaid balance.
- Relevant source and audit history.

The administrator can review payment and charge history here and initiate Job Card-specific financial actions. Each action opens its own dedicated page, with the selected Job Card carried forward automatically. Do not use modals or inline forms. After a successful save, return to this Job Card Contribution Detail. Batch Operations is separate and remains available for bulk operations involving multiple Job Cards.

### 4.3 Actions and visibility

**Record Payment**
- Show this action in Job Card Contribution Detail and always keep it available, including when outstanding is zero or negative.
- Open a dedicated Job Card-specific payment-entry page, not Batch Operations. The Job Card Number is prefilled/known and is not re-entered.
- The administrator enters the amount; receipt/reference and remarks are optional. Do not provide a manual payment date/time field.
- Individual payments use CASH. Payment timestamp and creating administrator are captured automatically.
- A payment can be recorded when outstanding is zero or negative. Excess remains as unallocated/overpaid credit on the Job Card.
- After saving, return to the same Job Card Contribution Detail.

**Paid in Full**
- Show only when the Job Card has positive outstanding.
- Open its own dedicated Job Card-specific page. Calculate and display the current outstanding amount automatically; the administrator must not type or calculate the settlement amount.
- Record a CASH payment through the atomic Paid-in-Full operation with FIFO. Prevent negative or duplicate settlement.
- After saving, return to the same Job Card Contribution Detail.

**Waive**
- Show only when the Job Card has positive outstanding.
- Open its own dedicated Job Card-specific page. Partial waiver is allowed; the amount cannot exceed current outstanding.
- A non-empty reason is mandatory. One active Council administrator records and approves the waiver in the same operation; no second approver is required. Capture actor and timestamp automatically.
- Record the waiver as an immutable adjustment, not a payment. It reduces outstanding and triggers atomic FIFO recalculation.
- After saving, return to the same Job Card Contribution Detail.

**Refund**
- Show only when the Job Card has positive overpaid credit; otherwise hide it.
- Open its own dedicated Job Card-specific page. The administrator selects a payment belonging to that Job Card and enters a full or partial refund amount.
- Require a non-empty reason. The amount cannot exceed either the Job Card's positive overpaid credit or the selected payment's remaining refundable capacity.
- Capture administrator and timestamp automatically. Preserve the original payment; record the refund as a separate immutable record.
- Release automatic FIFO allocations newest-charge-first, preserve fixed historical allocations, then record the refund and rerun FIFO atomically. Reject the operation if fixed historical allocations exceed remaining payment capacity.
- After saving, return to the same Job Card Contribution Detail.

## 5. Individual payments and payment record editing

### 5.1 Payment creation

- Every payment belongs to one Job Card.
- Payments may be recorded when no outstanding balance exists; excess is retained as unallocated credit for future eligible charges.
- Payments can cover Regular CO Charges and Manual/Extra Charges across all Tags.
- Payment date/time and the creating administrator are captured automatically. The user does not manually enter the payment date.
- Individual Job Card payments are CASH. Bulk payment batches remain in Batch Operations and follow the batch payment-method behavior documented in section 6.

### 5.2 Editing payments

- Administrators can edit **all payment records**, including individual payments and payments created through Bulk Payments.
- Editable payment details include amount and applicable payment details such as method, receipt/reference number and remarks.
- Every edit requires a correction reason.
- Preserve the original values in audit history, including revised values, editing administrator and edit timestamp.
- The original payment date/time and original creating administrator are not rewritten by an edit.
- After an amount or other allocation-relevant edit, automatically recalculate/release/reallocate FIFO. Preserve fixed historical allocations; reject the edit atomically if they exceed the corrected payment capacity.
- Editing a payment is a correction to that payment record, not a new payment or a refund.

### 5.3 No permanent deletion

- Payment records cannot be permanently deleted.
- Incorrect details are corrected through the edit workflow.
- Money actually returned is handled through the Refund workflow, and only when the Job Card is overpaid.
- Preserve the original payment and all correction/refund history.

### 5.4 Atomic payment operations (implementation detail)

- Payment creation, whether one line or multiple lines, uses the shared Batch Operations payment workflow. The administrator selects CASH or BANK for the batch; no Tag is selected or stored for payments. The database records the batch, separate payment records, creation events and FIFO allocations atomically.
- Paid in Full remains a separate CASH action inside Job Card Contribution Detail.
- Payment creation requires a client-generated idempotency key. Retrying the same request returns the original payment; reusing the key with different payment details is rejected.
- Paid in Full calculates the positive outstanding amount under the Job Card lock, then records the resulting CASH payment and runs FIFO in the same transaction. It must not create a payment when no positive outstanding amount exists.
- Payment correction updates the existing payment, appends a before/after audit event with the mandatory reason, and reruns FIFO in the same transaction. The original `paid_at` and `recorded_by` fields remain unchanged.
- If FIFO detects that fixed historical allocations exceed the corrected payment capacity, the entire correction rolls back.
- Refund processing remains a separate operation and is not implemented by payment correction.

### 5.5 Refund operation (implementation detail)

- A refund is a separate immutable record linked to its original payment and Job Card. It never changes or deletes the original payment.
- A refund requires a positive amount, a non-empty reason and an idempotency key. The system records the refund timestamp and administrator automatically.
- Validate the requested amount against both the Job Card's current positive overpaid credit and the selected payment's remaining refundable capacity after prior refunds and fixed historical allocations.
- Automatic allocations may be released and rebuilt by FIFO as part of the refund transaction. Fixed historical reviewed allocations are never changed; if they exceed the payment's remaining capacity after the refund, the entire refund rolls back.
- The refund record and FIFO reallocation commit or roll back together. Repeated requests with the same idempotency key return the original refund; a different request using that key is rejected.
- Refund history is append-only. Refund correction or deletion is not supported; an incorrect refund requires a separately designed compensating workflow.

## 6. Batch Operations

Batch Operations is one shared workspace for entering multiple financial records. At the top, the administrator selects the operation type:

- **Payments** — create one payment for each listed Job Card.
- **Manual/Extra Charges** — create one separate charge for each listed Job Card.

Both operation types use the same page structure, paste area, validation preview, review/confirmation step and batch history pattern. The fields, validation rules and resulting financial records differ by selected operation. Changing the selector changes the relevant input format and preview columns; it does not create a separate page or navigation section.

### 6.1 Payments entry format

Each line represents one Job Card payment. The Job Card Number and amount are separated by a comma:

```text
JOB-CARD-NUMBER, AMOUNT
JOB-CARD-NUMBER, AMOUNT
JOB-CARD-NUMBER, AMOUNT
```

### 6.2 Payment method

- **Current UI implementation (PR #37): BANK only.** The payment-method selector is intentionally hidden; the UI submits `BANK` for every payment batch. The database operation continues to support the `cash` and `bank` method values for other authorized workflows.
- Payments do not have a Tag field. FIFO still covers eligible outstanding charges on the Job Card across all Tags.
- Individual payments are still stored as separate payment records linked to their source batch.
- Capture batch date/time and administrator automatically.

### 6.3 Payment validation and confirmation

Before saving, show a review/confirmation preview:
- Parsed Job Card Number and amount for each line.
- Valid and invalid entries.
- Missing/invalid Job Card Numbers.
- Missing, non-numeric, zero or negative amounts.
- Duplicate Job Card Numbers are invalid; a Job Card may appear only once in a payment batch.
- Number of valid entries and total collection amount.
- Selected CASH/BANK method.

A batch is all-or-nothing. If any line is invalid, the entire batch is rejected and no payment or batch records are created. The administrator corrects the pasted lines, reviews a fresh preview, and confirms only when every line is valid. The database revalidates every line during confirmation; preview results alone are not trusted.

Amounts greater than a Job Card's current outstanding balance are allowed. The excess remains as unallocated/overpaid credit for that Job Card.

### 6.4 Payment batch history

Within Batch Operations, provide payment batch history so administrators can find previous collection batches.

The history list should support:
- Search by batch reference.
- Date-range filtering.
- Display of batch reference, payment method, number of Job Cards/payments and total amount.

Opening a batch shows:
- Batch reference.
- Collection date/time.
- CASH/BANK method.
- Administrator who recorded the batch.
- Every Job Card Number and individual amount.
- Batch total.
- Payment allocation results for the individual Job Cards.

A completed batch is not an undifferentiated payment: its individual payment records remain independently viewable and editable under the payment-editing rules above. Batch history remains available for audit.

PDF/Excel export and download were explicitly deferred for a later discussion and are not part of the current agreed scope.


### 6.6 Current Batch Operations UI implementation (PR #37)

The following describes the shipped UI behavior and takes precedence over older UI wording in this document where they conflict:

- Batch Operations remains the bulk-entry workspace for multiple Job Cards. It does not replace the dedicated single-Job-Card action pages. Job Card Detail actions for Record Payment and Add Manual/Extra Charge navigate to their own dedicated pages; Paid in Full, Waive and Refund also each have dedicated pages.
- **Payments:** the UI has no CASH/BANK selector and submits BANK for every batch. Payment batches have no Tag. The paste format remains `JOB-CARD-NUMBER, AMOUNT` per line.
- **Manual/Extra Charges:** the user selects one Tag and enters one shared Description for the whole batch. The paste area accepts only `JOB-CARD-NUMBER, AMOUNT` per line; the client combines the shared description with each line for the existing preview/confirmation RPC format. Descriptions containing commas are rejected by the UI.
- The batch preview and confirmation flow remains shared between both operation types, while each operation retains its own validation and fields.
- Batch detail history uses responsive layouts: dedicated cards on mobile and a table on desktop.
- Payment batch detail rows show only **Job Card** and **Paid Amount**. Manual/Extra Charge batch detail rows show only **Job Card** and **Charge Amount**. The shared description is not repeated on every row.
- For Manual/Extra Charge batches, the selected Tag is shown once as a static, non-clickable label above the expanded Job Card details, not as a repeated table column.
- Existing audit/correction/refund history remains available below the simplified batch rows when audit records exist.
- These are UI changes only. PR #37 introduced no database migration or schema change. The existing atomic batch RPCs remain responsible for validation, persistence and audit records.

## 7. FIFO allocation and reallocation

- FIFO operates at **Job Card level across all Tags**. Tags are grouping/reporting labels, never payment destinations or allocation accounts.
- The administrator cannot manually allocate, move, assign, adjust or override a payment allocation. All new allocations are generated by the FIFO engine.
- Partial allocations are allowed. The oldest eligible outstanding charge receives payment first; within a Job Card, the oldest available payment is consumed first.
- Excess payment remains as unallocated credit on that Job Card for future eligible charges.
- All charge types share one unified chronological FIFO queue within each Job Card. Do not prioritize Regular CO Charges or Manual/Extra Charges as separate categories.
- Regular CO Charge chronology uses Government `transaction_date`; if missing, use immutable `first_imported_at`; use the stable FTO transaction ID as the final tie-breaker.
- Manual/Extra Charge chronology uses its immutable original creation timestamp, with its immutable charge ID as the tie-breaker.
- Compare the normalized chronology timestamps across both charge types; the oldest charge receives allocation first. The charge type does not affect priority. Editing a charge never changes its FIFO position. Reversing and recreating a charge creates a new position.
- Reallocation runs automatically after confirmed CO recalculation, charge changes, payment amount corrections, refunds, waivers, reversals and reinstatements, for all affected Job Cards.
- Payment corrections recalculate automatic FIFO allocations whether the payment amount increases or decreases. Preserve fixed historical allocations. If fixed historical allocations exceed the corrected payment capacity, reject the correction atomically and report the conflict.
- Refunds release automatic FIFO allocations in reverse allocation order (newest charge first) before reducing payment capacity. Fixed historical allocations are preserved; if they exceed the remaining payment capacity, reject the refund atomically.
- Allocation state and allocation history are separate:
  - `council_payment_allocations` stores the current allocation state.
  - `council_allocation_events` is append-only and records allocation, release and reallocation events, including actor, timestamp, amount and reason/context.
  - `council_fifo_runs` records each allocation operation, its trigger, affected Job Card, outcome and failure details.
- Historical reviewed allocations, if present from an imported legacy ledger, are fixed and cannot be changed by automatic FIFO. There is no manual allocation facility for new records.
- Current allocation state is used to calculate balances. Historical events explain how the current state was reached; do not calculate balances by summing all historical events.

## 8. Manual/Extra Charges and CO recalculation distinction

- Manual/Extra Charges are additional charges entered by an administrator and are separate from Regular CO Charges.
- Single-Job-Card Manual/Extra Charge entry opens its own dedicated page from Job Card Detail. The Job Card Number is prefilled and is not re-entered. Enter description, amount and selected Tag; creator and timestamp are captured automatically. Bulk Manual/Extra Charges continue to use the Batch Operations workflow described below.
- Each Manual/Extra Charge has a stable identity and immutable original creation timestamp.
- Administrators can correct a Manual/Extra Charge; a correction reason is required. Preserve the previous and revised values and rerun FIFO for the affected Job Card.
- Administrators can reverse a Manual/Extra Charge with a reason and confirmation. Never delete the original record. Record the reversal and release/reallocate affected automatic allocations through FIFO.
- Regular CO Charge corrections are handled through the confirmed CO recalculation workflow in section 2. Do not provide a separate manual CO-charge allocation or reversal interface.
- A Regular CO Charge retains a stable identity linked to its source FTO transaction. A recalculation creates an immutable revision of its amount/eligibility; it does not create a duplicate charge.
- If a Regular CO Charge becomes zero or ineligible, retain it as an inactive historical record. If it later becomes eligible again, reactivate the same charge identity with a new revision. Preserve all prior calculation versions and lifecycle events.

### 8.1 Bulk Manual/Extra Charges

Bulk Manual/Extra Charges are entered from the same Batch Operations workspace by selecting **Manual/Extra Charges**.

Use a paste-friendly line format containing only:
- Job Card Number.
- Amount.

The administrator enters one shared **Description** for the entire batch, immediately below the Tag selector. The application applies that description to every line when preparing the validated batch request. A comma is not allowed in the shared description because the underlying preview parser uses comma-separated fields.

Select one **Tag** for the charge batch. The selected Tag and shared description are stored on each Manual/Extra Charge. Tag is classification/reporting metadata and does not change Job Card balance ownership or FIFO chronology. A Job Card may appear only once in a charge batch; duplicate Job Card Numbers invalidate the entire batch.

The preview follows the same layout and review pattern as Payments, but shows charge-specific fields and validation. Each accepted line creates a separate Manual/Extra Charge with its own stable charge identity, creator, creation timestamp and audit event.

The entire charge batch is all-or-nothing: if any line is invalid, no charges are created. The database must revalidate every line during confirmation. On successful confirmation, rerun FIFO for each affected Job Card in the same atomic operation. Preserve each charge as an independent record so it can later be corrected or reversed individually under section 8.

Batch history must distinguish Payment batches from Manual/Extra Charge batches and show the operation type, batch reference, date/time, administrator, number of Job Cards/records and total amount. Opening a batch shows each Job Card and its corresponding payment or charge details. Individual records remain independently auditable.

## 9. Reports

Provide a Reports section accessible to **all active Council administrators**. No separate reporting permission is required.

The agreed reports are:

1. **Outstanding Report**
   - Job Card Number.
   - Head of Household.
   - Total charges.
   - Payments received.
   - Waivers.
   - Outstanding balance.

2. **Collection Report**
   - Individual and bulk payments.
   - CASH and BANK totals.
   - Collection date.
   - Recorded by.

3. **CO Charge Report**
   - Job Card Number.
   - Source FTO.
   - Tag.
   - CO charge amount.
   - Recalculation adjustments.

4. **Manual Charge Report**
   - Job Card Number.
   - Description.
   - Amount.
   - Administrator.
   - Reversal history.

5. **Waiver and Refund Report**
   - Job Card Number.
   - Transaction type.
   - Amount.
   - Reason.
   - Administrator.
   - Date and time.

Report filters:
- Date range.
- Job Card Number.
- Tag, where applicable.
- Transaction type.
- CASH/BANK method, where applicable.

Export/download formats were deferred and must be discussed separately.

## 10. Responsive PC and mobile requirements

Every Contribution module screen must be designed for both PC and mobile. This includes Contributions, Job Card Detail, the dedicated Record Payment, Paid in Full, Waive, Refund and Add Manual/Extra Charge pages, Batch Operations entry/history and Reports.

**PC**
- Use dashboard summary cards and a readable Job Card table.
- Keep search and filters in an efficient toolbar.
- Use spacious Job Card detail layouts and clear transaction tables.
- Dedicated Job Card action pages use normal page navigation, not modals or inline forms. Use clear page-level review and confirmation where required.

**Mobile**
- Use compact summary cards and touch-friendly search/filters.
- Display Job Cards as readable cards rather than squeezing a wide desktop table onto the screen.
- Open Job Card Detail as a full-screen mobile view.
- Make balances and available actions clear and easy to reach.
- Use a large paste-friendly text area for Batch Operations, with the same responsive preview and confirmation layout for Payments and Manual/Extra Charges.
- Make validation, confirmation, history and report tables usable on a narrow screen.

Do not treat mobile as a scaled-down desktop view. Both layouts are required.

## 11. Audit, permissions, security and integrity

- All financial records and operations are scoped to `village_council_id`.
- Every financial write authenticates the caller and verifies active Council membership on the backend.
- Supabase RLS and appropriately restricted database functions enforce tenant isolation; client-side filtering alone is insufficient.
- Every active Council administrator has the agreed financial and reporting permissions. Do not introduce a separate finance or reporting role.
- Preserve actor and timestamp information for financial creation, editing, waiver, refund, reversal, allocation and recalculation.
- Preserve old and new values for edits and corrections.
- Do not permanently delete payment, charge or audit history.
- Multi-record financial operations must be atomic.
- Retried operations must not duplicate charges, payments, refunds or allocation effects.

## 12. Implementation sequence

1. Verify the existing CO Calculation source data, version history, FTO tags and exemption behavior.
2. Implement the Job Card-centred Regular CO Charge ledger.
3. Implement separate Manual/Extra Charges and their audited reversal workflow.
4. Implement the Contributions page and Job Card detail for PC and mobile.
5. Implement dedicated Job Card-specific pages for Record Payment, Paid in Full, Waive, Refund and Add Manual/Extra Charge; preserve Job Card context and return to detail after successful save.
6. Implement editable payment records, immutable original creation metadata and audit history.
7. Keep the shared Batch Operations workspace as a separate bulk workflow for multiple Job Cards, with a Payments/Manual-Extra Charges selector, matching paste/preview/confirmation layouts, and separate batch histories.
8. Implement Job Card-level automatic FIFO, unallocated credit, immutable allocation events and FIFO-run tracking; do not provide manual allocation.
9. Implement the five agreed reports for all active Council administrators.
10. Complete end-to-end financial, audit, tenant-isolation, concurrency and responsive UI testing.

## 13. Remaining decisions before implementation

These details remain open and must not be silently invented:
1. **Resolved:** A Job Card-specific Manual/Extra Charge page carries the Job Card context automatically and requires description, amount and Tag. Creator and timestamp are automatic.
2. **Resolved:** Manual/Extra Charge corrections require a reason; reversal requires a reason and confirmation. Preserve the original record and audit history.
4. Exact reference/receipt numbering requirements.
5. **Resolved:** Batch Operations uses all-or-nothing validation for both Payments and Manual/Extra Charges. If any line is invalid, no records in that batch are saved.
6. **Resolved:** A Job Card may appear only once in a batch, for both Payments and Manual/Extra Charges.
7. **Resolved:** Tag selection is required for Manual/Extra Charge batches and is stored on each charge. Payments do not have a Tag selector or Tag metadata; the administrator selects only CASH or BANK. Manual/Extra Charges also require a Description. Tag does not change Job Card-level FIFO allocation across Tags.
8. **Superseded by the 2026-11-27 Job Card action-page decision:** Record Payment and Add Manual/Extra Charge are dedicated single-Job-Card pages launched from Job Card Detail. Paid in Full, Waive and Refund also each have dedicated pages. Batch Operations remains a separate bulk workflow for multiple Job Cards.
6. The immutable chronological FIFO key across Regular CO Charges and Manual/Extra Charges — **resolved: unified chronology, oldest timestamp first, regardless of charge type**.
8. Exact reference/receipt numbering requirements.
9. Exemption-management navigation and tag archival with current FTO assignments remain governed by the open items in the existing financial requirements.
10. Export/download formats, which are deferred for later discussion.

Do not treat export/download, unconfirmed waiver details, or unresolved form fields as settled requirements.


## 14. Job Card-specific action pages — confirmed 2026-11-27

The five single-Job-Card financial actions are separate dedicated pages launched from Job Card Contribution Detail: Record Payment, Paid in Full, Waive, Refund and Add Manual/Extra Charge. Do not implement these as modals or inline forms. Carry the selected Job Card context into each page without asking the administrator to re-enter its number. After a successful save, navigate back to that Job Card's Contribution Detail. Record Payment remains available at any balance; Paid in Full and Waive appear only for positive outstanding; Refund appears only for positive overpaid credit; Add Manual/Extra Charge is a Job Card-level action. Single payments use CASH, with amount required and receipt/reference and remarks optional; timestamp and actor are automatic. Paid in Full calculates the current outstanding amount. Waive requires a positive amount not exceeding outstanding and a non-empty reason; one active Council administrator records and approves it. Refund requires selecting a payment belonging to the Job Card, a reason, and an amount within both Job Card overpaid credit and that payment's remaining refundable capacity. Manual/Extra Charge requires description, amount and Tag. Batch Operations remains available separately for bulk payments and bulk Manual/Extra Charges across multiple Job Cards; it is not the destination for these single-entry actions.


## 7. Job Card exemptions and exemption list

### 7.1 Purpose and scope

- Exemption is an explicit, administrator-managed status on an individual Job Card. It is not inferred automatically from the Job Card number, area/code, MIS status, missing ledger history or any other attribute.
- Exemptions are temporary and repeatable. A Job Card may have multiple exemption intervals over time; removing an exemption ends the current interval and does not erase its history.
- A Job Card exemption blocks the creation of new eligible Regular CO Charges during its effective interval. It does not cancel, waive or invalidate charges that were created before the interval.
- Exempt Job Cards remain in FTO monitoring and retain their FTO history, imported transactions, historical ledger, payments and allocations. Exemption does not remove source history.
- Exemption is Job Card-level, while the permanent exemption decision for an individual imported transaction is retained with that transaction/ledger record. Both levels must be respected when determining Contribution eligibility.

### 7.2 Effective dates and transaction eligibility

- Each Job Card exemption interval has an effective start date. The start date is configurable per Job Card; the accepted default for initial setup is **1 July 2026**.
- Future imported transactions must automatically be evaluated against the stored exemption interval for that Job Card. Do not require administrators to mark each transaction manually.
- Determine exemption eligibility by comparing the Government `processed_date` with the interval. The start date is inclusive; the removal date is the exclusive end.
- Do not use `first_imported_at` or `transaction_date` to determine exemption eligibility. A missing `processed_date` does not qualify as exempt.
- A Regular CO Charge created before the effective exemption start remains valid and payable. The exemption blocks creation of new Regular CO Charges for transactions processed within the interval.
- Removing an exemption ends the current interval but does not automatically create charges. A new CO Calculation Preview → Apply cycle is required to evaluate transactions against the updated interval.
- Exemption does not block recording payments against the Job Card. Existing outstanding charges remain payable, and payments continue to allocate through the normal Job Card-level FIFO process, including for Inactive or Deleted Job Cards.

### 7.3 Add/remove controls and audit history

- Adding an exemption requires a non-empty reason. Removing an exemption also requires a non-empty reason.
- Record the administrator, action (add or remove), reason and timestamp automatically for every change.
- Preserve every exemption interval and every add/remove event permanently in audit history. Never overwrite or delete a previous interval when a Job Card is exempted again.
- Exemption management is administrator-only.
- The initial data setup must include the **20 already identified active exemptions**. These records must be represented in the dedicated management page after the data is brought into the new application's exemption records.

### 7.4 Exemption Management page — agreed UI requirement

- Build a dedicated **Exemptions** page inside the **Contribution** module. This is a normal navigable page, not a modal, inline form, or separate top-level application module.
- Provide a clear **Exemptions** entry alongside the other Contribution module destinations.
- The page must list currently exempt Job Cards and provide administrator actions to add an exemption and remove an active exemption.
- The page must expose the Job Card Number and effective start date, and provide access to the exemption interval and add/remove audit history. Do not discard prior intervals when an exemption is removed or later added again.
- Adding or removing an exemption requires a non-empty reason. Actor and timestamp are system-recorded.
- Include the 20 already identified active exemptions in the initial data setup and ensure they appear in the page's active list.
- Do not add exemption badges, indicators or management controls to the general Job Cards list or ordinary Contributions list/detail views. Exemption management belongs on this dedicated page; CO calculation and transaction eligibility must still enforce the exemption rules.
- Exact visual layout and any additional list filters/search controls can be decided during implementation, provided the required list, add/remove actions and history access are present.


## 2026-11-28 clarification — Processed Date controls exemption eligibility

The effective exemption interval is compared with the FTO transaction's Government `processed_date`, not `transaction_date` or `first_imported_at`. The start date is the effective date added; the removal date is the exclusive end of the interval. Preview and Apply must produce the same eligibility result. Missing Processed Date does not qualify as exempt.
