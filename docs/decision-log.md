# Financial Workflow Decision Log

> **Current exemption rule (2026-11-28):** Determine whether an FTO transaction falls within a Job Card exemption interval by comparing Government `transaction_date` with the interval start and removal dates. Start is inclusive; removal date is exclusive. Do not use `first_imported_at` or a permanent transaction mark to determine exemption eligibility. This latest clarification supersedes earlier exemption timing decisions below.

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
3. **Contribution visibility:** Contribution displays transactions whose latest FTO Monitoring status is Processed and whose latest CO calculation item is non-exempt under the Job Card's Transaction Date interval. Deferred and Rejected transactions remain calculated but hidden. If status later changes to Processed, the saved amount becomes visible without recalculation, provided the exemption interval has not changed since that calculation.
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
| FIN-002 | Period model | Do not require a separately created/open Contribution Period before calculation; use FTO Tags for grouping. |
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
| FIN-031 | FIFO | Job Card-level FIFO across all Tags without tag selection; partial allocations; excess remains unallocated. Chronological ordering across charge categories remains open. |
| FIN-032 | Allocation history | Record Allocate, Release and Reallocate events; do not overwrite allocation history. |
| FIN-033 | Refunds | Full/partial refunds; mandatory reason; original payment retained; release allocations then rerun FIFO. |
| FIN-034 | Permissions | Every active Council membership has administrator-level financial permissions in this phase; no finance role. |
| FIN-035 | Tenant isolation | Every financial operation must be Council-scoped and backend-authorized. |

## Decision details

### FIN-001 — Phased implementation

CO Calculation is the first implementation target. Contribution Management follows. Payments and FIFO follow Contribution Management. Integration and end-to-end financial tests come after those modules.

The first phase must design for downstream financial workflows without implementing the full payment system.

### FIN-002 — No mandatory Contribution Period creation

An administrator should not have to create and open a separate Contribution Period before calculating CO. FTO Tags provide the grouping used later on the Contribution page.

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
1. Oldest eligible outstanding charge first across the Job Card, regardless of Tag.
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

1. **FIFO ordering across charge categories:** FIFO runs at Job Card level across all Tags. Define the immutable chronological key for ordering Regular CO Charges and Manual/Extra Charges while preserving existing allocations.
2. **Payment-entry form:** Exact required/optional fields and UI layout remain unconfirmed.
3. **Exemption management navigation:** The exemption business rules are agreed, but the separate entry point has not been specified. Do not add controls to the Job Cards list or Contribution page.
4. **Archiving a tag with current FTO assignments:** Historical associations must survive. Confirm whether current assignments must be moved before archive or whether an assigned tag can be archived directly.


## 2026-11-27 — Job Card-centred Contribution and Payment model

The following decisions were confirmed in the latest workflow review and are now recorded as the current model:

1. **Job Card financial account:** Job Card Number is the primary financial account/grouping key. Charges are sourced from FTOs and remain traceable to the source FTO transaction and calculation version.
2. **Tag role:** Tags classify/group FTOs. They are assigned/generated during CO Calculation, not created as a Contribution-period workflow. Tags are not financial accounts or payment destinations.
3. **No Contribution Period entity:** Do not introduce a separate Contribution Period or require period creation/opening.
4. **Payment ownership:** Payments are recorded against a Job Card and can cover Regular CO Charges and Other Charges across all Tags. The user does not select a tag when recording a payment.
5. **Payment with no outstanding balance:** A payment may be recorded even when there is no current outstanding charge. Any excess remains as unallocated credit on that Job Card for future eligible charges.
6. **Bulk payment format:** One Job Card payment per line, using `JOB-CARD-NUMBER, AMOUNT`. The batch payment method is selected as CASH or BANK. Preview and validation are required before saving; each line creates a separate payment record.
7. **FIFO scope:** Automatic FIFO operates at Job Card level across all Tags. Partial allocations are supported. The exact chronological key across Regular CO Charges and Other Charges remains open.
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

## 2026-11-27 — Complete Contribution, Payment and UI decisions

The following decisions supplement and supersede conflicting older Contribution/Payment wording above and in the older FIN entries:

1. **Job Card financial account:** Contribution is Job Card Number based. Job Card Detail is the place to view charges, payments and balances; a payment entered there does not ask the administrator to re-enter the Job Card Number.
2. **Two charge categories:** Keep Regular CO Charges and Manual/Extra Charges separate. Regular CO Charges come from CO calculation; Manual/Extra Charges are additional administrator-entered charges.
3. **CO recalculation review:** Show the old calculation result and proposed new result together for administrator review and confirmation. Preserve old versions. After confirmation, automatically release affected allocations and rerun FIFO. Do not create a separate manual CO reversal interface in place of recalculation.
4. **Tag changes:** Show old/current and proposed tag values for review and confirmation. Tag changes only affect grouping; they do not alter charge values, Job Card balances or payment history.
5. **Contribution navigation:** Four sections: Contributions, Bulk Payments, Reports and Settings. Record Payment, Paid in Full, Waive and conditional Refund actions are inside Job Card Detail.
6. **Default list:** Contributions opens with Outstanding as the default view. Fully Paid and All are additional views. Search supports Job Card Number and Head of Household.
7. **Individual payment:** Entered from Job Card Detail; it is treated as CASH. Payment date/time is automatic and is not manually entered. Paid in Full calculates the amount needed to settle the outstanding balance.
8. **Waive:** Partial waiver amounts less than the current outstanding amount are allowed. Show Waive only when outstanding is positive; hide it when no positive outstanding remains. Waiver is an adjustment, not a payment.
9. **Refund:** Refunds are allowed only against Job Card overpaid balances, not as a general payment reversal. Full and partial refunds are allowed up to the available overpaid balance. A reason is required. Record actor/time automatically. Hide Refund by default and show it only while overpaid balance is positive.
10. **Payment editing:** All payment records, including individual and bulk-entered payments, can be edited. Require a correction reason. Preserve original and revised values, editor and edit time. Do not rewrite original payment date/time or original creator. Recalculate FIFO when an edit affects allocations.
11. **No payment deletion:** Payment records are never permanently deleted. Corrections use editing; actual returned money uses the overpayment-only Refund workflow.
12. **Bulk payment:** One Job Card per line, format `JOB-CARD-NUMBER, AMOUNT`. Select CASH or BANK once for the batch. Validate and preview before confirmation. Each line creates its own payment record.
13. **Bulk history:** Keep batch reference, date/time, method, administrator, Job Card entries, individual amounts, totals and allocation results. Individual payments remain editable. PDF/Excel export was deferred for later discussion.
14. **FIFO:** Allocation is Job Card based across all Tags. No tag selection at payment entry. Partial allocations are supported; excess remains as unallocated credit. Automatic reallocation follows relevant charge/payment/refund changes.
15. **Reports:** Five reports are agreed: Outstanding, Collection, CO Charge, Manual Charge, and Waiver and Refund. All active Council administrators can access them; no separate reporting permission.
16. **Responsive design:** Every Contribution screen must have both PC and mobile layouts. Job Card lists use tables on PC and readable cards on mobile; detail and data-entry workflows must be touch-friendly.
17. **Export scope:** Export/download was explicitly deferred and is not part of the current agreed implementation scope.

The detailed workflow is in [Contribution Management Workflow](contribution-management-workflow.md).

## 2026-11-27 — Final payment ledger and FIFO implementation decisions

These decisions were confirmed during the payment-ledger architecture review and supersede conflicting earlier notes above.

1. **Job Card account:** All charges, payments, waivers, refunds, allocations and balances belong to the Job Card account. Tags classify FTOs and Manual/Extra Charges for grouping/reporting only; they are not payment metadata. There is no Contribution Period entity.
2. **Payment correction:** Editing a payment amount upward or downward triggers an atomic recalculation of automatic FIFO allocations. Preserve fixed historical reviewed allocations. If those fixed allocations exceed the corrected payment capacity, reject the correction and report the conflict. Preserve the original payment creation date/time and creator; every edit requires a reason and retains old/new values, editor and timestamp.
3. **Refund allocation release:** Refunds are allowed only against positive Job Card overpaid credit, with a mandatory reason. Before reducing payment capacity, release automatic FIFO allocations in reverse allocation order (newest charge first). Preserve fixed historical reviewed allocations. If fixed allocations exceed the remaining payment capacity, reject the refund atomically. The original payment remains unchanged.
4. **No manual allocation:** Administrators cannot manually allocate, move, assign, adjust or override payment allocations. All new allocations are performed by automatic FIFO. Any `historical_fifo_reviewed` allocations imported from legacy history are fixed and cannot be modified by FIFO.
5. **Allocation persistence:** Maintain current allocation state separately from append-only allocation events. Record each allocation, release and reallocation with actor, timestamp, amount, context and associated FIFO run. Maintain a FIFO run record for each allocation operation, including trigger, affected Job Card and outcome. Calculate balances from current allocation state, not by summing historical events.
6. **Regular CO FIFO chronology:** Use Government `transaction_date`; if absent, use immutable `first_imported_at`; use stable FTO transaction ID as the final tie-breaker.
7. **Manual/Extra Charge FIFO chronology:** Use immutable original `created_at`, then immutable charge ID as tie-breaker. Editing a charge never changes its FIFO position; reversing and recreating it creates a new position.
8. **Manual/Extra Charges:** Entry fields are Job Card Number, description and amount; the administrator selects a Tag for the batch, which is stored on each charge. Creator and timestamp are automatic. Corrections require a reason and retain old/new values. Reversal requires a reason and confirmation. Never delete the original charge.
9. **Regular CO charge identity and history:** Each Regular CO Charge has a stable identity linked to its FTO transaction. Confirmed recalculation creates an immutable revision rather than a duplicate charge. A zero-value or ineligible charge becomes inactive, not deleted; later eligibility reactivates the same identity with a new revision.
10. **Charge/waiver changes and FIFO:** Relevant charge changes, confirmed CO recalculations, waivers, payment corrections, refunds, reversals and reinstatements trigger FIFO for affected Job Cards. Release only automatic allocations as required; preserve fixed historical reviewed allocations.
11. **FTO Government status finality:** Processed and Rejected are terminal transaction statuses. Deferred may transition to Processed or Rejected. A refreshed Government import must not overwrite an existing final status with a different status; enforce this in the database and keep associated status fields consistent.
12. **Refund/waiver/payment audit:** Financial records are not deleted. Payment edits, refunds, waivers, charge revisions, allocation events and FIFO runs retain actor/time and relevant before/after values.

The detailed product workflow is maintained in [Contribution Management Workflow](contribution-management-workflow.md). The implementation must be staged through repository review and tests; no production database migration or deployment is authorized by this decision-log update.


## 2026-11-27 — Implementation clarifications superseding legacy open items

The following implementation decisions resolve earlier open statements in this document:

1. **Unified FIFO chronology — resolved:** Regular CO Charges and Manual/Extra Charges share one chronological queue per Job Card. Regular CO uses Government `transaction_date`, falling back to immutable `first_imported_at`; Manual/Extra uses immutable original `created_at`. Compare the timestamps directly; use the stable source transaction ID or charge ID as the tie-breaker. Charge type never creates priority.
2. **Allocation editing — superseded:** Administrators cannot manually allocate, move, assign, adjust or override allocations. FIFO alone creates new allocations. Historical reviewed allocations are fixed.
3. **Payment operations:** Individual payment creation, Paid in Full and payment correction are implemented as atomic database operations with FIFO in the same transaction. Payment creation and Paid in Full use idempotency keys; correction requires a reason and preserves original payment date/time and creator.
4. **Refunds:** Refunds are immutable records linked to a payment and Job Card. They require a positive overpayment, a reason and an idempotency key; they are validated against Job Card credit and the selected payment's remaining capacity. Refund and FIFO reallocation are atomic.
5. **Waiver implementation remains blocked:** Partial waivers are accepted in principle, but the exact reason and approval requirements have not been decided. Do not implement waiver writes until those requirements are confirmed.
6. **Bulk invalid-line behavior remains unresolved:** Do not assume whole-batch rejection or valid-lines-only processing.
7. **No production deployment authority:** Committing migrations to the feature branch does not authorize applying them to Supabase production, merging the branch or deploying the application.


## 2026-11-27 — Waiver approval and implementation decision

1. **Approval model:** One active Council administrator may record and approve a waiver in the same operation. No second-administrator approval is required.
2. **Reason and audit:** A non-empty reason is mandatory. Record the administrator as both recorder and approver, with the timestamp captured automatically.
3. **Eligibility:** Waivers are allowed only while the Job Card has a positive outstanding balance. Partial waivers are supported, but the amount cannot exceed the current outstanding balance. The Waive action is hidden when outstanding is zero or negative.
4. **Financial treatment:** A waiver is an immutable adjustment, not a payment. It reduces Job Card outstanding balance and does not create payment credit. The FIFO engine accounts for waived outstanding before allocating payments.
5. **Integrity:** Waiver creation is tenant-scoped, membership-validated, idempotent and atomic with the FIFO recalculation. Waiver history cannot be updated or deleted.
6. **No production authorization:** The waiver migration is feature-branch code only. It does not authorize applying migrations to Supabase production, merging the branch or deploying the app.


## 2026-11-27 — Tag selection by financial operation

1. **Manual/Extra Charges:** The administrator must select a Tag for the charge batch. Store that Tag on the batch and each Manual/Extra Charge for classification and reporting.
2. **Payments:** Do not show or store a Tag on payment batches or individual payments. The administrator selects only the payment method, CASH or BANK.
3. **FIFO:** Payment allocation remains Job Card-level across all eligible charges and all Tags. The selected payment method does not affect allocation priority.


## 2026-11-27 — Batch Operations UI shipped in PR #37

The following implementation details are now shipped and supersede conflicting earlier UI descriptions:

1. **Single entry point:** The Contributions page uses one **Batch Operations** button. Payments and Manual/Extra Charges are selected inside the shared workspace; separate entry buttons are not used.
2. **Payment batches:** The current UI does not display a CASH/BANK selector. It submits BANK for all batches. Payment batches do not have Tags. The existing database RPC still accepts both CASH and BANK values; this UI decision does not remove backend capability.
3. **Manual/Extra Charge batches:** Select one Tag and enter one shared Description for the batch. Paste lines contain only `JOB-CARD-NUMBER, AMOUNT`. The client adds the shared description when constructing the existing preview request. Commas are not allowed in the shared description.
4. **Batch history layout:** Use dedicated mobile cards and a separate desktop table.
5. **Batch detail fields:** Payment rows show Job Card and Paid Amount only. Manual/Extra Charge rows show Job Card and Charge Amount only. Do not repeat the shared description on each line.
6. **Manual batch Tag display:** Show the Tag once as a static, non-clickable label above the expanded Job Card rows; do not repeat it as a table column.
7. **Audit history:** Existing audit/correction/refund history remains available beneath the simplified batch details when records exist.
8. **Database scope:** PR #37 changed the UI only. No database migration or production data change was part of this work.



## 2026-11-27 — Dedicated Job Card financial action pages

The single-Job-Card financial actions are launched from Job Card Contribution Detail and each has its own dedicated page: Record Payment, Paid in Full, Waive, Refund and Add Manual/Extra Charge. Do not use modals or inline forms. Carry Job Card context forward automatically; do not ask the administrator to re-enter the Job Card Number. After successful save, return to the same Job Card Contribution Detail. Record Payment is always available, including at zero or negative outstanding; it is a CASH payment with required amount and optional receipt/reference and remarks. Payment timestamp and actor are automatic. Paid in Full appears only for positive outstanding and calculates the amount automatically. Waive appears only for positive outstanding, supports partial amounts up to outstanding, requires a non-empty reason, and is recorded/approved by one active Council administrator in the same operation. Refund appears only for positive overpaid credit; it requires selecting a payment belonging to the Job Card, a reason and an amount within both Job Card credit and the selected payment's remaining refundable capacity. Add Manual/Extra Charge is a Job Card-level action with description, amount and Tag. Batch Operations remains a separate bulk workspace for multiple Job Cards; it is not used for single-Job-Card entry. These workflow decisions do not authorize merging, production deployment or production database changes.


## 2026-11-26 — Job Card exemption intervals and exemption list

1. **Explicit Job Card status:** Exemption is manually managed per Job Card. Do not infer exemptions from Job Card number, area/code, MIS status, missing ledger history or other attributes.
2. **Temporary and repeatable:** Exemptions have effective intervals. A Job Card may be exempted, reactivated and exempted again; retain every interval permanently.
3. **Effective start date:** Each Job Card has a configurable exemption start date. The accepted default for initial setup is 1 July 2026.
4. **Charge eligibility:** Exemption blocks new Regular CO Charges during the interval. Charges created before the interval remain valid and payable. Payments remain allowed and FIFO continues to allocate against existing eligible charges.
5. **Transaction-level permanence:** Transactions first imported while the Job Card is exempt receive a permanent Exempt mark and remain ineligible for charges even after exemption removal. Keep those transactions and their history; do not delete them.
6. **Removal and recalculation:** Removing an exemption ends the interval but does not itself create charges. A new CO Calculation Preview → Apply cycle is required to evaluate transactions imported after the interval ends. Transactions first imported during the interval remain permanently excluded.
7. **FTO and ledger history:** Exempt Job Cards remain in FTO monitoring. Preserve FTO history, imported transactions, existing charges, payments and allocations. Inactive and Deleted Job Cards remain payable as well.
8. **Mandatory audit:** Adding and removing an exemption each require a non-empty reason. Record administrator, action, reason and timestamp. Preserve every interval and every add/remove event permanently.
9. **Dedicated page:** Build a normal, dedicated **Exemptions** page inside the **Contribution** module, with an Exemptions navigation entry alongside the other Contribution destinations. It is not a modal, inline form or separate top-level module.
10. **Page capabilities:** List currently exempt Job Cards and provide administrator actions to add and remove exemptions. Show Job Card Number and effective start date, and provide access to exemption interval and add/remove audit history. Require a non-empty reason for both actions; record actor and timestamp automatically.
11. **Initial data:** Include the 20 already identified active exemptions in the initial data setup and show them in the page's active list.
12. **Scope separation:** Do not add exemption badges, indicators or management controls to the general Job Cards list or ordinary Contributions list/detail views. CO calculation and transaction eligibility must still enforce exemption rules.
13. **Implementation flexibility:** The exact visual layout and additional filters/search can be decided during implementation, provided the required list, add/remove actions and history access are delivered.

The detailed rules are maintained in [Contribution and Payment Workflow](contribution-management-workflow.md). This documentation decision does not authorize database changes, production migration or deployment.


## 2026-11-28 — CO exemption eligibility uses Government Transaction Date

This clarification supersedes earlier exemption rules that referred to `first_imported_at` or `transaction_date`:

1. The exemption interval starts on the effective date the Job Card is added to the Exemptions list.
2. The interval ends on the date the active exemption is removed. The interval is start-inclusive and end-exclusive.
3. Determine whether an FTO transaction is exempt by comparing its Government `transaction_date` with that interval.
4. Do not use `first_imported_at` to determine exemption eligibility. A missing `transaction_date` does not qualify as exempt.
5. CO Calculation Preview and Apply, including Regular CO Charge synchronization, must use this same rule.
6. Existing exemption intervals and audit history remain intact. This clarification does not authorize applying migrations to production, merging the feature branch or deploying the application.
