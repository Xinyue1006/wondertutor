# WonderTutor review and testing handover

Review began 11 November and completed 12 November 2026 (Malaysia time). Scope: Xin Yue's Parent Portal and Admin users/qualifications/complaints/reports, plus shared integration needed for those workflows.

## Result and practical limits

Follow-up after this review: [child-avatar privacy](CHILD_PHOTO_PRIVACY_2026-11-12.md) now protects new child-photo uploads and their DTO delivery. Final follow-up regressions passed 483 backend and 234 frontend tests, with a synthetic live Cloudinary signed/unsigned access check. The original results and gap list below describe the earlier review snapshot; old public references still require ownership-verified cleanup. Ranking, suspension and other client-policy decisions have not been silently changed.

Your assigned screens and APIs have substantial functional coverage, and this review fixed concrete concurrency, reporting, moderation and usability defects. The final local regression and browser checks pass. **This is not a certification that the entire platform is ready to take real clients' money.** Tutor lesson delivery and financial Admin remain incomplete in this integrated branch, external service/deployment checks remain, and only actual clients can establish satisfaction.

GitHub `origin/main` was fetched and merged into `xinyue/admin-complaints` as `512c4d1`. The user subsequently authorized committing and pushing this review on the same branch; consult Git history for its current publication status. The separate `origin/yanhsi/tutor-availability` branch has additional unmerged scheduling work; it was inspected but not silently merged over the integrated implementation. Existing `docs/OVERNIGHT_REVIEW.md` was preserved outside the commit.

No `.env` contents or API keys were changed or committed. No real bank payment, production deployment or real-user email was sent during the test journeys. Tests used synthetic accounts in `wondertutor_test`. A non-destructive additive migration was also applied to the local working `wondertutor` database; that database was not reset or seeded.

## Changes made

| Priority | Defect/improvement and resulting behaviour | Main files |
| --- | --- | --- |
| High | Competing counter-offer acceptances could reserve the same tutor slot. Tutor/child locks and a transactional snapshot/status check now allow only a valid acceptance. | `backend/src/controllers/parent/bookings.controller.js` |
| High | Rescheduling different bookings into one slot could race; acceptance could happen after the original lesson started. Acceptance now serializes tutor/child checks and rechecks both old and proposed lesson timing. | `backend/src/services/reschedule.service.js` |
| High | A refund request could use a stale paid snapshot after the payment had already been refunded. Locked payment/booking state is rechecked before creating the request. | `backend/src/controllers/parent/payments.controller.js` |
| High | An old signed Billplz return could say a refunded payment never happened, or that an already-cancelled lesson was confirmed. Refunded, partly-refunded and recorded-but-not-confirmed outcomes now remain distinct. | payments controller; `frontend/src/pages/parent/PaymentReturn.jsx` |
| High | Public reviews had no real reporting/moderation process. Added screening, private review reports, an Admin hide/restore decision with a required reason, author notification, concurrency checks and visible-review-only rating aggregation. | `reviewContent.js`, parent/admin review controllers, routes, schema/migration, MyBookings/TutorProfile/AdminComplaints |
| High | A private attendance/qualification URL must not be republished as a review image. The review API rejects authenticated/private evidence URLs. | parent reviews controller |
| Important | Older progress requests could overwrite newer filters/another child, and stale results could be exported. Requests now ignore obsolete responses, isolate child navigation and disable stale/failed export and print. | ChildProgress/ProgressReport + regression tests |
| Important | Notification failures looked like an empty inbox. Loading, failure/retry and failed read-action feedback are now distinct; duplicate read clicks are guarded. | NotificationBell in AppLayout |
| Important | Child dialogs could close/reopen during a pending mutation and list-refresh failures could be hidden. Save/delete close controls are guarded and refresh errors remain visible with retry. | MyChildren + recovery test |
| Important | Added searchable Help & FAQs at `/faq` and `/parent/help`, with quick-start steps, clear/empty/retry states, native keyboard-accessible answer disclosures and issue-report links. Answers come from the same server policy list as the assistant; no AI service is needed. | public controller/routes, Help, PublicLayout/AppLayout, assistant FAQ |
| Important | Updated availability search to offer one-hour starts from 07:00 through 21:00, consistent with lessons ending by 22:00. | FindTutor |
| Important | Small-screen booking summaries and complaint cards could squeeze/overflow. They now shrink/wrap within the available width; account-menu naming and expanded state were added. | MyBookings, AdminComplaints, AppLayout |
| Important | Network/timeout failures now offer recovery guidance; concurrent database conflicts map to a safe 409 instead of an unexplained 500. | API client, error middleware |
| Important | Account deletion copy implied all retained evidence was anonymous. UI and confirmation email now disclose that retained free-text/evidence can still contain personal information. The owner's data export also includes review moderation state/reason/time. | PrivacyAccountCard; account controller |
| Important | Production could start without a usable frontend build; health alone did not establish DB readiness. Production now fails clearly for missing index.html; `/api/ready` checks DB availability with a bounded HTTP deadline, no sensitive detail and a probe limit. `/api/health` remains liveness. | app.js, deployment.service.js |
| Important | Root `build` used to run database migrations implicitly. It now builds locked dependencies without changing the database; `npm run db:deploy` is an explicit release step. | root package.json, README, Hostinger guidance |
| Important | Patched the frontend's vulnerable transitive Undici version using a compatible lockfile-only update. | frontend/package-lock.json |
| Usability | Missing-page recovery now explains what happened and offers the user's dashboard and FAQ links. | NotFound |

## Review and abuse handling

- Public review checks cover a conservative finite set of English/Malay/Manglish/Chinese abuse, common punctuation/zero-width/leetspeak disguises, explicit threats, contact details/links and repetitive spam.
- Legitimate negative feedback, low ratings and star-only reviews remain allowed. Validation failures keep the review dialog and typed comment available for correction.
- Posting bounds, repeated-content checks and the existing one-review-per-completed-owned-booking rule supplement text matching. Rating aggregates are serialized with review changes.
- A parent can report public content privately. Duplicate reports are prevented. The reporter does not receive the author's family's booking or child's identity through the new report link.
- Reports enter Admin Complaints. Reporting alone does not hide a review. An Admin investigates, records a reason and may hide or restore it. The original review is retained; the author is notified. Hidden reviews do not contribute to public counts, distributions or cached averages.
- Moderation does not automatically close a complaint. Admin still responds and resolves/dismisses it separately.
- This is not a semantic toxicity classifier. It can miss slang or context and can reject quoted abuse. Private complaints deliberately allow quoted evidence. Images require human investigation. Existing reviews are not automatically removed retrospectively.

## Final verification

| Check | Final result | Scope |
| --- | --- | --- |
| Backend full Jest regression | **38 suites, 477 tests passed** | Real local MySQL/MariaDB test DB; provider/gateway failure cases use stand-ins/signatures, not live banks |
| Frontend full Vitest regression | **41 suites, 231 tests passed** | Includes stale report responses, child-route isolation, notifications, child save recovery, moderation and FAQ |
| Frontend production build | **Passed** | After the compatible dependency patch |
| Root clean install/build command | **Passed** | Database migration removed from build; frontend build and backend Prisma generation succeed |
| Browser page/viewport checks | **75/75 passed**, no JavaScript page errors | 25 public/parent/owned-admin routes at desktop 1440px and mobile 375px/320px. Checked page rendering and document-level horizontal overflow; calendar/table internal scrolling is intentional |
| Real browser workflows | **9/9 passed** | Listed below; synthetic accounts and simulated payment only |
| HTTP access/probe smoke | health 200, readiness 200; unauthenticated parent/admin data 401 | Actual isolated Express server |
| Local backup/restore rehearsal | **Passed** | Restored synthetic `_test` dump into a new temporary DB; all 26 table counts/75 rows matched; temporary restore DB removed |
| Frontend npm audit | **0 findings** | Full and production-only views after patch |
| Backend npm audit | **23 findings remain** | 3 high / 17 moderate / 3 low; see dependency report before release |
| Lint | Command completed; warnings remain | Existing hook/style/tooling warnings were not treated as proof of a clean lint report |

Browser workflows completed using the real frontend, Express API and test database:

1. Add, edit and remove a child profile.
2. Save personal profile changes and verify after refresh.
3. Change Form 5 Chemistry to Primary 1 and verify incompatible subject removal; clear search filters.
4. Select lessons on different dates and send a multi-slot booking request.
5. Complete a simulated payment and see successful confirmation.
6. Reject disguised abusive review text, preserve the form, then accept honest negative feedback.
7. Report another parent's public review privately and find the report in My Complaints.
8. Admin hide/restore with a new required reason for each action, including mobile; complaint remains open.
9. Export the Admin complaint report as CSV.

The initial browser scripts needed locator corrections for a subject toggle button, two matching success texts, and the required separate restore reason; those were test-harness mistakes, not counted as application defects. Final results above include the verified reruns. The review is regression plus exploratory testing, not exhaustive proof of every possible input, formal accessibility certification, production-scale load testing or human client acceptance.

## Schema and teammate handoff

Migration: `backend/prisma/migrations/20261111090000_review_moderation/migration.sql`.

It adds Review `isHidden`, `moderationReason`, `moderatedAt`, `moderatedById` and nullable Complaint `reviewId`, with a review-report relationship and a per-reporter/review uniqueness rule. No table was dropped; existing reviews default to visible. `moderatedById` is an audit scalar, not a declared User FK.

Applied and verified in local working and test databases. Other machines/Hostinger must apply migrations explicitly before running the updated code:

```powershell
npm run db:deploy
```

Tell Yan Hsi about the shared schema, booking/reschedule locking, FAQ policy entry, booking review DTO, app health/build validation and root build-command changes. Do not automatically merge her separate scheduling branch without integration review.

## Release blockers and client decisions

### Critical before real-client release

1. **Integrated tutor/financial workflow:** Tutor bookings/students/earnings and Admin bookings/finance/settings still include placeholders in the integrated branch. Parent request creation is not a complete teaching/payment business journey by itself.
2. **Actual money:** Billplz onboarding, real gateway timeout/reconciliation/callbacks and actual refund execution need sandbox/provider evidence. A queued or approved refund is not proof that money returned. The local simulator must not be used as production evidence.
3. **Deployment and recovery:** Verify the actual Hostinger Node plan, runtime, domain/TLS, DB permissions, secret configuration, cron, monitoring, encrypted off-host backups and a Hostinger restore drill. The local synthetic restore does not certify these. Hostinger does not back up a history of app environment variable values; keep a separate secure recovery record.
4. **Backend dependency advisories:** Prisma 6/config/deepmerge-ts and test-tool findings need a supported patch/backport or a separately tested upgrade plan. No forced major dependency override was applied. Ordinary JSON requests do not demonstrate exploitability of the recursive-config advisory, but the audit is not clean.

### Important requirement/policy decisions

- Form2 says suspended tutors can view history; current account-wide deactivation blocks all authenticated access. Function-specific suspension from Chapter3 is also not implemented. Agree the intended policy before changing shared auth.
- Verified tutors currently rank before score; the proposal describes score-first/tie-break rules. Document and obtain acceptance of the implemented ordering, or deliberately revise it with tests.
- Interview-requested sensitive child-note visibility controls are absent. Child avatar photos remain public uploads; attendance/qualification evidence is private. Do not claim all child files are private or fully anonymized on deletion.
- Free-tier Gemini can be slow or block responses; this review did not repeat paid/live model calls. Keep guided search and evaluate a frozen multilingual test set separately from prompt tuning.
- Important-only email implementation and the broad “same events by email” requirement need scope alignment. Durable email/outbox delivery and full administrator action history are still limited.
- Large production datasets/load, multiple app instances (rate limits/chat memory), provider delivery and real keyboard/screen-reader user acceptance require further evidence. Automated tests are not a client satisfaction score.

Optional next enhancements: user-controlled note visibility with a defined audience, paged historical parent lists, durable notification delivery/outbox, a formal review appeal policy and broader human-reviewed language moderation. These should follow the release blockers, not replace them.

## ERD and class diagram

The current schema has **25 Prisma models** and **33 declared foreign-key relationships**. The central chain is ParentProfile → Child → Booking ← TutorProfile. Booking has optional one-to-one Payment, Attendance, SessionSummary and Review; Payment has many Refund records. Complaint can now reference a reported Review.

- [Complete data model, Mermaid sources and interpretation](CURRENT_DATA_MODEL.md)
- [Zoomable full ERD](diagrams/current-erd.svg)
- [Domain class diagram](diagrams/current-domain-classes.svg)
- [Actual application layers/MVC-style flow](diagrams/current-application-layers.svg)

The domain class diagram describes entities/associations; it does not invent a Java/PHP-style class for every Express controller. React pages/components are the presentation/view responsibility, Express controllers/services handle requests/business logic, and Prisma models/client plus MySQL handle persistence. This is a three-layer modular monolith with MVC-style responsibilities, kept in one deployment.

## Review evidence and sources

- [Requirements traceability and detailed gaps](ACCEPTANCE_REVIEW_2026-11-11.md)
- [Backend defects and shared impacts](BACKEND_FIXES_2026-11-11.md)
- [Dependency audit and primary advisories](DEPENDENCY_AUDIT_2026-11-11.md)
- [Hostinger release guide](HOSTINGER_DEPLOYMENT.txt)
- Browser JSON evidence: `%TEMP%/wt-browser-qa/full-review-results.json` and `journey-results.json`; restore evidence: `restore-result.json`. Data in these files is synthetic. Browser scripts/screenshots stay in that local QA directory, not in the production app.
- Hostinger primary references checked: [Node app deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), [Prisma deployment](https://www.hostinger.com/support/how-to-deploy-prisma-apps-on-hostinger-node-js-hosting/), [environment updates/recovery limitations](https://www.hostinger.com/support/how-to-edit-or-add-environment-variables-after-deployment/). These describe platform capabilities; they do not verify this account's subscription or settings.

For human acceptance, ask a first-time parent, tutor and Admin to complete real scenarios without coaching; record completion, time, mistakes, help requests and satisfaction. Resolve the critical release gates before introducing real clients or bank money.
