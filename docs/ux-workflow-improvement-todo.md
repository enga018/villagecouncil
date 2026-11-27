# Village Council Platform — UX & Workflow Improvement TODO

> **Status:** Deferred  
> **When to start:** After the current application is functionally complete.  
> **Purpose:** Revisit the finished application and improve usability and automation without unnecessarily changing its established appearance or navigation.

## Guiding objective

**Less manual work. Less confusion. More reliable records.**

Make the application easier for non-technical Village Council users. The system should handle routine work—such as calculations, validation, matching, status updates and record relationships—while users focus on decisions that genuinely require human judgement.

## 1. Preserve the existing application experience

- [ ] Keep the current overall visual design and established look and feel.
- [ ] Keep the existing navigation structure, tabs, routes and page-to-page behaviour.
- [ ] Keep the existing responsive and mobile behaviour unless a specific usability problem is identified.
- [ ] Do not add, remove, rename or rearrange tabs merely as part of this UX improvement.
- [ ] Avoid a ground-up redesign; improve the way users work within the existing application.
- [ ] Preserve existing functionality, permissions, financial safeguards, audit history and established workflows.

**Acceptance criteria**
- Users can navigate the application in the familiar way.
- Existing tabs and workflows continue to work.
- Improvements do not silently remove capabilities or weaken safeguards.

## 2. Introduce Simple and Detailed views

- [ ] Make **Simple view** the default experience.
- [ ] Make **Detailed view** available only to authorised users.
- [ ] Define a consistent way to switch views across applicable pages.
- [ ] In Simple view, show the information most users need to complete everyday tasks.
- [ ] In Detailed view, expose relevant technical, accounting, reference and audit information.
- [ ] Keep underlying data and functionality available; simplify presentation rather than deleting information.
- [ ] Decide whether the view preference is user-wide or page-specific, and implement consistently.

**Acceptance criteria**
- Ordinary users are not overwhelmed by technical details.
- Authorised users can still access the information needed for administration, reconciliation and audits.
- Permissions are enforced by the application, not merely by hiding a visual control.

## 3. Reduce manual work and repeated data entry

Review every module and workflow to identify work the system can safely perform.

- [ ] Reuse information already stored instead of asking users to enter it again.
- [ ] Retrieve and prefill known information where appropriate.
- [ ] Calculate totals, balances and derived values automatically.
- [ ] Detect duplicate records and likely duplicate submissions.
- [ ] Match related records automatically when confidence is sufficient.
- [ ] Validate data before submission and explain errors in plain language.
- [ ] Update dependent statuses and summaries automatically where rules are clear.
- [ ] Identify repetitive multi-step tasks that can be simplified.
- [ ] Avoid asking users to remember information the application can display or track.

**Acceptance criteria**
- Each workflow asks for only the information genuinely needed from the user.
- Automatic results are traceable and can be checked where appropriate.
- Ambiguous matches or uncertain results are not silently accepted.

## 4. Use the right level of human involvement

Classify operations into three categories.

### Automatic — system handles it

- [ ] Automate routine calculations and balance updates.
- [ ] Automate clear validation, duplicate detection and status updates.
- [ ] Automate routine comparisons and matching when the result is reliable.
- [ ] Keep a suitable record of automated operations where auditability matters.

### Review required — system prepares it

- [ ] Present uncertain matches for user review.
- [ ] Highlight conflicting or incomplete records.
- [ ] Identify unusual transactions and exceptions.
- [ ] Explain why an item needs review and suggest the next step.

### Manual approval — user decides

- [ ] Retain explicit user control for important or irreversible actions.
- [ ] Preserve appropriate approval and confirmation requirements for financial and administrative operations.
- [ ] Never silently perform a consequential action just to reduce clicks.

**Acceptance criteria**
- Routine work is automated where safe.
- Human judgement is requested only when needed.
- Important actions remain controlled, authorised and auditable.

## 5. Make pages task-oriented and easy to understand

- [ ] Make each page clearly communicate where the user is.
- [ ] Put the information needed for the current task first.
- [ ] Make the next appropriate action easy to identify.
- [ ] Prefer familiar, plain-language labels over internal technical terminology.
- [ ] Show useful summaries before detailed records.
- [ ] Move technical identifiers and diagnostic information into Detailed view or an appropriate expandable area.
- [ ] Keep forms focused, with sensible defaults and no unnecessary fields.
- [ ] Make errors actionable: explain what happened and how the user can resolve it.
- [ ] Keep interaction patterns consistent across modules.

**Three questions every screen should answer**
1. Where am I?
2. What information do I need?
3. What should I do next?

## 6. Review all modules after the application is functionally complete

Conduct a module-by-module review. Do not assume every module needs the same changes.

- [ ] Dashboard — prioritise important information and work requiring attention.
- [ ] Job Cards — make finding records and understanding their status straightforward.
- [ ] Contributions — simplify balances, charge/payment history and financial actions while preserving accounting detail.
- [ ] Meetings — reduce repetitive setup and data entry while preserving meeting controls and records.
- [ ] Members — reuse member information and simplify routine member management.
- [ ] Periods — simplify creation, management and closure while preserving workflow rules.
- [ ] Review every other existing module using the same principles.
- [ ] Record issues and proposed changes before implementing them.

## 7. Test with non-technical users

- [ ] Test common tasks from the perspective of an ordinary Village Council user.
- [ ] Check that users can understand labels, balances, statuses and actions without technical explanations.
- [ ] Measure unnecessary steps and repeated data entry in important workflows.
- [ ] Test on mobile as well as desktop.
- [ ] Verify role-based access to Simple and Detailed views.
- [ ] Regression-test existing tabs, navigation and workflows.
- [ ] Verify financial calculations, permissions and audit trails after changes.
- [ ] Fix confusing or error-prone workflows before considering the review complete.

## 8. Implementation rules for this improvement phase

- [ ] Treat this document as a future TODO list, not approval to change the current application now.
- [ ] Wait until the current application is functionally complete before starting the overall review.
- [ ] Review and agree on proposed changes before implementation.
- [ ] Implement incrementally, module by module.
- [ ] Avoid unrelated navigation or visual redesign.
- [ ] Do not change production data, database rules or financial workflows without the required review and explicit approval.
- [ ] Update this checklist as decisions are made and tasks are completed.

---

## Completion definition

This improvement phase is complete when:

- [ ] The established look, navigation and tabs remain familiar.
- [ ] Simple view is clear and usable for everyday non-technical users.
- [ ] Authorised users can access the necessary Detailed view.
- [ ] Repetitive manual work has been reduced wherever safe and practical.
- [ ] Automation, review and approval responsibilities are clearly separated.
- [ ] All existing modules have been reviewed.
- [ ] Existing functionality, permissions, financial integrity and auditability remain intact.
- [ ] Common workflows have been tested successfully on mobile and desktop.

**Core principle:** Do not make the application look different just for the sake of redesign. Make it easier to use and let the system do more of the routine work.
