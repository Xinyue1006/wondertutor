# WonderTutor review and testing handover

Review began 11 November and completed 12 November 2026 (Malaysia time). Scope: Xin Yue's Parent Portal and Admin users/qualifications/complaints/reports, plus shared integration needed for those workflows.

**Current follow-up:** the 13 November section at the end records the subsequent AI reliability and tutor integration work. Earlier branch/placeholder statements below describe the earlier snapshot. Use the final follow-up and its evidence JSON for current results.

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

## 13 November 2026 follow-up

Integrated concurrent `main` updates through `61f10a7`, including tutor sessions, earnings and withdrawal reviews. Preserved the public UUID, cookie/CSRF/session, private-file and ownership protections. No schema migration was needed for these follow-up fixes. The actual `.env`, API key and billing configuration were not changed or published.

### Result

- **904 backend tests /58 suites and 473 frontend tests /54 files passed.** Production build passed with 185 modules. Lint exited successfully with zero errors and 70 warnings.
- **19/20 (95%) task success and 17/20 (85%) strict model + task score** on the final live Gemini diagnostic run. These are twenty reused synthetic cases, not independent held-out accuracy. One recent-homework query received an unavailable/bad response; a separate later retry passed. The failure remains in the published score. Median 16.54 seconds, p90 52 seconds: free-provider speed/availability remains variable.
- Real Chrome/Gemini tests verified free-form next-lesson, filtered tutor matching, compound payments + lesson and Chinese multi-criterion requests. The final Chinese browser search preserved subject, level, year, gender, mode and maximum budget, but took 42.10 seconds.
- A real parent → tutor → parent browser journey verified date/week/usual availability precedence, two dates in one request, acceptance by UUID, the payment deadline, **sandbox-only** payment confirmation and classroom-link visibility. Mocked UI tests are identified separately in the evidence.

### Fixes made

The assistant now answers approved casual greetings instantly, retains the signed-in visit's conversation, and offers quick questions. Free-form NLP still uses Gemini. Complete read plans avoid an unnecessary final generation; corrected tool calls can recover from earlier argument rejection. School years explicitly typed in English/Malay/Chinese cannot silently disappear from a model-selected tutor search. Booking lookups support subject filtering, and progress questions use authoritative progress totals rather than counting a limited booking list. Model arguments are still graded before server repairs.

The default AI budget is 60 seconds with at most three attempts per generation call, within the same turn deadline; the browser allows 65 seconds for chat. Non-final stalled attempts have an 18-second cap where enough budget remains. Backoff and waiting states support cancellation; quota failures, provider blocks and malformed replies are not blindly retried. Actual provider latency cannot be fixed by claiming a timeout is a successful answer.

Availability protects whole lesson intervals and required teaching modes, including half-hour reschedules. Exact-date/week overrides no longer pollute usual-hour editor locks. Pending saves cannot erase later edits. Late profile requests cannot restore a logged-out tutor or update another account. Stale booking/session versions offer refresh without losing the selected booking or typed report. Tutor booking/session links and actions use owned UUIDs.

Tutor reports now save optional homework, and parent booking details/progress/reports/CSV and AI cards agree on summaries and online attendance. Old online lessons with no attendance remain unknown. Private GPS/photo/upload-signature evidence does not enter AI results. Escalated refund requests now prevent a duplicate parent refund. Bank-conflict recovery reloads the destination and clears sensitive confirmation input; Admin wording states that approval does not automatically transfer funds.

### Remaining release limits

1. Physical check-in currently compares GPS against coordinates copied from the parent's **area**. A real client needs an explicitly confirmed full lesson address and precise map point saved on the booking. The radius was not weakened to conceal this gap.
2. Withdrawal approval is a ledger decision, not proof of bank settlement. The current Admin response shows a masked destination; secure full-destination access, manual payout execution/reconciliation and transfer recording remain incomplete.
3. Real Billplz settlement and the Hostinger subscription/proxy/environment configuration were not verified. Check the Hostinger proxy limit before retaining the 60-second AI deadline; deployed explicit environment values override defaults.
4. Tutor Students and Admin Booking Oversight remain placeholder routes. The newly integrated Earnings and withdrawal-review screens are implemented and tested; that does not complete every finance operation.
5. The free external AI can still stall or reject a response. Quick record questions and normal parent pages remain available. The diagnostic score is not a guarantee or client satisfaction measurement.

For a supervisor demo, refresh the browser and use a synthetic account with known records. `heyo` now demonstrates the instant social path. A genuinely free-form example is `Hi, could you tell me the next confirmed lesson in my account?`; the Chinese filtered tutor question in the AI document demonstrates multilingual extraction. Use the normal progress page as the recovery route for homework. Do not demonstrate real payment or bank transfer as verified.

Detailed AI design, all diagnostic phases and artifact locations: [AI reliability follow-up](AI_ASSISTANT.md#13-free-form-reliability-and-integration-follow-up--13-november-2026). [Machine-readable evidence](QA_EVIDENCE_2026-11-13.json) separates scripted regression, mocked UI, real API/sandbox browser journeys and genuine model runs. Normal local frontend/API were left running on ports 5173/5000; temporary QA servers were stopped.

## Precise venue, login navigation and overdue lessons — 13 November follow-up

Synced Yan Hsi's latest main first (baseline `2c09e3e`, including the new tutor/admin pages and finance migration). The earlier placeholder-page findings above are historical. Applied her additive finance migration and the new `20261113100000_confirmed_lesson_location` migration to the local working database without resetting or reseeding it. Actual `.env` files were not edited or tracked.

Physical bookings now require a full lesson address, an explicitly chosen entrance pin and confirmation. A multi-date request saves that same venue on each lesson; online bookings have no physical venue. Profile areas remain approximate matching inputs. Optional Leaflet/OpenStreetMap tiles load only when opened, with attribution and a privacy notice. Manual coordinates and explicit GPS at the venue also work. The venue form starts empty even if stale browser history supplies a prior address. The mobile booking summary no longer squeezes tutor information beside its button.

Legacy active physical bookings need parent confirmation in My Bookings before GPS check-in. Their approximate coordinates are not exposed as confirmed destinations, including calendar exports. Confirmation is ownership-, version- and row-lock-protected against check-in races. Accepted venues cannot be silently relocated; correcting a counter-offered venue returns it to tutor review. Tutor notifications omit the address/pin. AI record tools do not expose them. Data export includes the owner's venue fields; account deletion clears them. Historical attendance can still check out and submit its report.

Explicit logout no longer records the previous Payment page as the next account's return destination. Parent, Tutor and Admin logins go to their dashboards after logout. Session-expiry return paths are bound to the previous account; a different account starts at its own dashboard. Fresh anonymous deep links remain supported. Clear filters is now visible at the top of tutor search, and the Cancelled tab explicitly includes declined bookings.

The two October confirmed lessons reported by the user are aged demo data with paid payments and no attendance/report. Ended confirmed lessons now appear in Needs attention, with a dashboard notice and refund/problem-report routes, rather than Upcoming. Server time controls grouping and the live end boundary hides stale class links. The records and payment outcomes are preserved. Housekeeping already expires unanswered requests and unpaid payment holds; it deliberately does not expire paid confirmed lessons.

Validation: final full backend run **938/938 tests, 61 suites**; full frontend run **508/508 tests**, production build passes and lint has **0 errors, 69 existing warnings**. Real Express/MySQL plus browser checks passed **7 precise-location scenarios, 7 account-switch scenarios and 4 overdue-lesson scenarios**. Screenshots at 320/375/1440 pixels verified the booking/venue/session/attention layouts. Evidence is under `%TEMP%/wt-browser-qa/`: `precise-final-{backend,frontend}.json`, `precise-location-browser-results.json`, `account-switch-browser-results.json`, and `past-lessons-browser-results.json`. Browser scenarios used synthetic accounts in the isolated test database, with controlled browser GPS. No real Cloudinary upload, bank transfer or outgoing real-user OTP email was tested by this follow-up.

Remaining policy decision: agree a missed-lesson/late-report resolution and grace-period policy with the client/supervisor. Backdated check-in and ordinary rescheduling after the lesson starts are prohibited. Administrator-reviewed refund requests are supported, but an automatic refund, cancellation, completion or new lesson date must not be invented solely because time passed. The Needs attention view is a truthful unresolved classification, not a completed no-show settlement workflow. A refund on an overdue confirmed lesson does not currently close that booking's confirmed status; that transition belongs in the agreed resolution workflow.

## Compact My Bookings and FAQ follow-up — 13 November

My Bookings now defaults to Upcoming. Compact articles show tutor, child/subject, MYT date/time, mode, rate, status and a short hint. View Details contains the full record and existing counter-offer, negotiation, venue, cancellation, reschedule and review actions. Related dialogs replace one another; failed cancellation retains the explanation and shows its error inside the active dialog. Reopening or switching bookings clears old unsubmitted dialog drafts. Live details follow refreshed booking state and the server clock.

Each group initially displays at most five rows, in All and individual views. View more adds the next five, and Show fewer collapses that group. Recommended order puts upcoming/pending lessons earliest first and completed/cancelled/attention records latest first; explicit date sorting overrides this. Group totals remain complete. Changing group/sort resets expansion; ordinary clock ticks and refreshes preserve it. A UUID deep link reveals an older target beyond the initial five. The phone interface uses a labelled Booking group selector instead of a tall wrapped tab bar; desktop keeps tabs.

Booking success and its parent notification now open Pending; View All and account-deletion blocker links open All; review moderation opens Completed; general AI booking-list cards open All. Individual UUID links are retained. The maintained FAQ catalog is shared by the AI search_faq tool and Help & FAQs page. Version 2026-11-13.4 adds current booking navigation and missed-lesson explanations without promising automatic paid-lesson expiry/refunds or an unapproved grace period.

Validation: **518/518 frontend tests**, build passes, lint **0 errors/69 existing warnings**. Affected backend booking/moderation/assistant-filter tests passed **37/37**; assistant integration/unit/evaluation tests passed **51/51**, with the final FAQ/filter unit run **28/28**. These overlapping runs are not additive and used mocked model responses, not a fresh live Gemini quality assessment. Browser journeys against real Express/MySQL in the synthetic test database passed **9 compact-action scenarios plus 5 large-history scenarios**. The latter used 20 completed and eight declined records, verifying separate five-row limits, ordering, expansion/collapse, retained totals, deep links and 320/375/1440px layouts. Full action flows were also checked at 768px. No real payments or messages were sent.

Evidence: `%TEMP%/wt-browser-qa/compact-final-frontend.json`, `compact-bookings-browser-results.json`, `compact-many-bookings-browser-results.json`, `compact-final-lint.txt` and `compact-*.png`. Normal app/API remain available on 5173/5000; temporary QA services were stopped. Actual `.env` files were untouched.

## Main integration checkpoint — 13 November

Reviewed against Yan Hsi's current main baseline `2c09e3e`, fetched before release. Date exceptions still take precedence over one-week overrides and usual hours; lesson modes, the 24-hour payment window/cutoff and public-ID routes remain shared across both portals. Precise physical venue fields have the same confirmation semantics in parent DTOs, tutor requests and GPS sessions. Ended paid lessons stay unresolved pending the agreed review workflow rather than receiving an invented automatic outcome.

Fixed one integration mismatch found during the final review: Parent, Tutor and the shared reschedule service now all treat PENDING and ESCALATED time-change cases as unresolved. A second request cannot bypass an administrator's active review; the booking dates, existing case and notifications stay unchanged. Real parent/tutor UUID API regression cases cover both entry points. Also fixed stale client recovery: a saved change followed by a failed booking reload blocks old actions (including embedded refund/venue controls) and offers a GET-only refresh without repeating the write.

After pulling, each developer should keep their own `.env`, run `npm --prefix frontend ci` for the locked frontend dependencies, and run `npm --prefix backend run db:deploy` against the intended development database to apply the additive venue migration and regenerate Prisma. Do not reset/seed the shared or client database. Restart the API and refresh the browser. Deploy frontend and API together so old physical-booking clients are not left without the new address/pin form. This Git update is not a production deployment.

Final pre-push validation after these alignment fixes: **945/945 backend tests (61 suites)** and **521/521 frontend tests** passed. Production build passed; lint reported zero errors and 69 existing warnings. The staged task files were checked for `.env` paths and actual local secret values; none were included. The older unrelated untracked `docs/OVERNIGHT_REVIEW.md` was excluded. Full test evidence: `%TEMP%/wt-browser-qa/prepush-final-{backend,frontend}.json` and `prepush-final-lint.txt`.

## Local teammate-data merge — 13 November

Imported the user's supplied phpMyAdmin export as inert INSERT data, not executable SQL. The existing local database was backed up, restored to an isolated rehearsal database, merged there and checked before the real apply. The rehearsal verified rollback, preservation of every existing row, all 37 declared foreign-key relationships and a repeat merge with no further writes. The real merge used the same checks inside one serializable transaction, with a fresh backup and snapshot-change guard.

Added five missing tutor accounts/profiles, four subject rows, four qualifications, three weekly availability rows and one nonduplicate notification. The source spells the requested tutor's name **Aisyah Rahman**; her imported profile teaches **Physics, Form 4–5**. The real parent tutor-search and profile APIs both returned her successfully. Local totals after merge: 33 users, 21 tutors, 1,101 bookings, 11 payments and 1,090 reviews.

Both databases contained independently seeded relative-date histories with different public UUIDs. Those incoming shared-demo lessons and their financial/review descendants were retained as conflicts in the private report rather than duplicating 1,101 examples or overwriting local history. Existing credentials, account states, calendars and record values were preserved. Login sessions, OTPs, local settings and Prisma migration history were not imported. No `.env` change, database reset, outgoing email, payment operation or Git push was performed.

Reusable local command: `npm --prefix backend run db:merge -- --source path/to/export.sql --target-db your_database` writes a private preview only. Review its conflicts before using `--apply`; that mode creates a backup and refuses to overwrite existing rows. It supports local, non-production databases and requires backups/reports outside the repository. It is an additive merge, not automatic two-way synchronisation or a policy for replacing conflicting local edits.

Evidence is private under the current user's `.codex/backups/wondertutor/merge-20261113123513/`: original and final pre-merge SQL backups, `merge-result.json`, `rehearsal-result.json`, `website-verification.json` and the zero-change `repeat-check/merge-preview.json`. These files and the incoming SQL export must not be committed. The temporary rehearsal database was removed and the normal backend restarted. **46/46 parser/planner tests passed**, alongside the actual MariaDB rehearsal and post-merge verification.

## Name avatars and merge-tool release — 14 November

The client requested default name avatars instead of AI preview portraits. All current local user and child profile photo references were cleared in one guarded transaction: 14 users and two children now show initials. A private photo-reference backup was saved outside the repository under `.codex/backups/wondertutor/default-avatars-*/`. Every other User/Child field, including credentials and timestamps, was verified unchanged. No uploaded asset or identity/lesson evidence was deleted.

The shared Avatar component suppresses old `/img/people/` URLs even when another developer's database still contains them. The 14 generated portrait files were removed from public assets, and demo seeds now leave tutor, parent and child photos null. New database imports also discard those legacy portrait references while preserving real uploads and existing local rows. Genuine future photo uploads and Google account photos remain supported; otherwise the first two name initials are shown with the full name available to assistive technology.

Tutor public photos are optional in both the setup UI and backend submission rules. Identity documents and qualifications are still required for verification. Profile completion measures the required basic and teaching details, and the photo step explains the default initials.

The merge CLI also supports all declared Node 20 versions and explicitly reports when a merge committed but saving its final report failed. It does not claim that committed data was rolled back in that case. After pulling, restart the API and refresh the frontend; no schema migration or reset/seed is needed for these avatar changes. Existing legacy demo URLs are hidden automatically on other developers' databases.

Validation: **1,003/1,003 backend tests (63 suites)** and **530/530 frontend tests** passed. Production build passed; lint reported zero errors and 69 existing warnings. Eleven browser checks against the local app covered public home, parent dashboard/search/profile, tutor profiles at 320/375/1440px, child profiles, tutor optional-photo setup and admin users. No legacy portrait was rendered, no horizontal page overflow or browser JavaScript error occurred. These avatar checks used temporary application sessions for the existing demo accounts; they did not automate the real reCAPTCHA login challenge. Temporary sessions were revoked after QA. Evidence is private under `%TEMP%/wt-browser-qa/default-avatar-*` and `default-avatars-*.png`.
