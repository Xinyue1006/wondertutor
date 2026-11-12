# Backend review — Xin Yue scope — 11 November 2026

This review covers concrete defects in parent booking/payment/refund flows and shared rescheduling/deployment infrastructure. It does not certify Hostinger, a live payment account, the teammate's unfinished financial screens or real-client acceptance.

## Corrections implemented

| Priority | Defect and consequence | Change / regression |
| --- | --- | --- |
| High | Two parents could accept separate counter offers into the same tutor slot because checking and updating were separate. | Lock tutor then child, recheck availability/child conflicts inside the transaction, and conditionally claim the same status, price and time snapshot. Reject deactivated tutors. Concurrent integration test expects exactly one reservation. |
| High | Two different confirmed lessons could approve reschedules into one slot. | Shared reschedule acceptance uses the same tutor/child lock order and rechecks the booking snapshot before approving. Concurrent regression expects one accepted request and one conflict. |
| High | A delayed reschedule acceptance could move a lesson after its original start. | Refuse an already-started original lesson and repeat the snapshot/start-time check inside the transaction. Regression keeps the pending request unchanged. |
| High | A stale `PAID` snapshot could create a fresh refund request after an admin completed a refund. | Reload payment status and booking status/time after taking the payment-row lock. A deterministic race regression changes the payment after the initial read and expects no new refund. |
| Important | Returning to an old Billplz URL after refund claimed that no payment happened, and after cancellation could claim the lesson was still confirmed. | Preserve `REFUNDED` / `PARTIALLY_REFUNDED` and show a received-payment record for a booking no longer confirmed. Return-page UI does not claim money has reached the bank. Backend/frontend regressions cover all three. |
| Important | A production process could start even when the React build was missing, leaving all website pages unusable. | Production startup now requires an actual `index.html` in one of the supported deployment folders. Development still uses Vite. |
| Important | Hosting had no simple liveness/database-readiness probes. | Public `/api/health` and `/api/ready` contain no private details, disable caching, and separate process health from database availability. Readiness has an additional per-IP ceiling and a two-second response deadline; the underlying Prisma operation still relies on its connection/query timeout. |

The existing code already contains useful protections: parent ownership checks, role restrictions, signed private media, positive/decimal payment validation, conditional status changes, original Billplz bill recovery, signature/provider amount verification and production blocking of simulated payments. The changes above strengthen those controls; they are not replacements for the existing tests.

## Files changed

- `backend/src/controllers/parent/bookings.controller.js`
- `backend/src/controllers/parent/payments.controller.js`
- `backend/src/services/reschedule.service.js` (**shared with tutor integration**)
- `backend/src/app.js` and `backend/src/services/deployment.service.js` (**shared deployment infrastructure**)
- `frontend/src/pages/parent/PaymentReturn.jsx`
- Regression files: `bookings.test.js`, `reschedule.test.js`, `payments.test.js`, `billplz.test.js`, `deployment.test.js`, `PaymentReturn.test.jsx`.

No database schema, payment-provider credentials, live money or production records were changed by this work. The root review may separately contain a schema migration for review moderation; do not confuse that with these fixes.

## Validation

- Focused frontend `PaymentReturn.test.jsx`: **3 passed**.
- Root's aggregate backend run passed **34 suites / 439 tests** before the final delayed-reschedule and deployment additions. Root must rerun the affected suites/full suite after all agents finish; use that final report as the final count.
- Added database tests are intended for the existing `_test` database only. Do not run them alongside the browser-fixture server or another backend test run.

Suggested affected backend selection:

```powershell
npm test -- --runInBand src/tests/bookings.test.js src/tests/reschedule.test.js src/tests/payments.test.js src/tests/billplz.test.js src/tests/deployment.test.js
```

## External release gates and integration limits

1. **Real gateway acceptance remains open.** Fake-provider tests do not demonstrate a working Billplz sandbox/live account. Merchant onboarding, collection/environment, signed callback delivery, timeout reconciliation and refund execution need staging acceptance. A queued/approved refund is not proof of a bank transfer. Do not enable real payments without the owner's approved integration and finance workflow.
2. **Every reservation writer must follow one protocol.** This review locks parent counter acceptance and shared reschedules. Teammate tutor acceptance/finance/admin arbitration writers must also use the tutor/child locking protocol before the team claims end-to-end prevention of double booking.
3. **Notification delivery is not durable.** Notifications/emails are generally sent after business transactions. A crash can commit the booking/payment and miss a notification; a notification database failure can also turn the HTTP response into an error after the main operation succeeded. A transactional outbox with retry/event deduplication remains a future reliability requirement.
4. **Hostinger is unverified locally.** Confirm the paid plan supports the selected Node runtime and MySQL, direct SPA URLs, canonical HTTPS domain, proxy/IP configuration, private DB networking, environment variables, finite cron jobs, deployment rollback and health probes. The repository guide is a proposal, not evidence that hPanel is configured.
5. **Backups need a restore rehearsal.** Agree recovery point/time objectives with the client. Use restricted, encrypted, off-host MySQL backups and a protected test restore. A backup file alone does not show that recovery works. Do not reset/seed a production database.
6. **Operational access must be reviewed.** Replace demo admin credentials, use a restricted DB application account, protect/de-scope logs and define retention and staff access to child/identity evidence. Keep API keys and `.env` outside Git. In-memory rate limits/chats do not coordinate multiple app processes.
7. **Large datasets still need a workload test.** Some parent list/progress/report flows read all of the parent's records and filter/aggregate in memory. They are scoped to the account, but current synthetic tests are not a load/soak test. Apply pagination or database aggregation based on measured client volumes rather than inventing capacity guarantees.

No new refund policy, fees or cancellation windows were invented. Existing parent refunds still require the established administrator decision; unresolved client/finance policy should be agreed and documented before launch.
