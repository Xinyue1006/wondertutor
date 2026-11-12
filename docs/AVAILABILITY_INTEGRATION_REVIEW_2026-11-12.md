# Availability integration review — 12 November 2026

Reviewed `origin/yanhsi/tutor-availability` at `129ec1a` against the current working copy. Its merge base is `d1881e3`. This review does not merge the branch, change application code, or run database migrations.

## Recommended reply to Yan Hsi

> Hi Yan Hsi, yes, I agree with the availability order: exact-date override first, then week override, then usual weekly hours. An explicitly closed date or week must stay closed.
>
> Please send the focused diff/PR before merging. We should use the same availability calculation for the parent calendar, tutor search, new booking, counter-offer acceptance and rescheduling, including each slot's teaching mode. Please preserve the existing booking locks and payment reconciliation. I am adding public IDs now, so we should coordinate changes to the shared booking files and Prisma schema.
>
> For payment, let's keep the 24-hour window as a separate policy change. The proposed rule is the earlier of acceptance + 24 hours and lesson start − 1 hour, so a lesson starting soon does not get a full 24 hours. Once the policy is agreed, it needs to apply consistently to checkout, reminders, expiry and late payment callbacks. Existing bookings with no saved deadline should keep their current cutoff.

中文说明：可以同意她修复「指定日期 → 指定星期 → 平常每周」和每个时段的上课模式检查。这是修复预约一致性。24 小时付款期限属于另一项业务规则，建议独立提交；并非所有预约都能有完整 24 小时，因为仍需要保留开课前 1 小时的截止时间。

## What is already in her branch

- Weekly availability tables (`AvailabilityWeek` and `AvailabilityWeekSlot`), a per-slot `SlotMode`, nullable `Booking.payBy`, and related migrations.
- A new `availability.service.js` with week-over-recurring resolution and mode helpers.
- A `paymentWindow.js` helper that already calculates `min(now + 24 hours, lesson start − 1 hour)`. Its legacy fallback uses the original one-hour cutoff.
- Tutor UI/API changes for usual hours, week overrides, exact-date exceptions and quick additions.
- The branch does **not yet change** `booking.service.js` or `lifecycle.service.js`. Her proposed integration still needs implementation and review; the branch alone does not fix parent booking.

## Availability integration requirements

The effective availability for a Malaysia-local date must be resolved once and reused:

1. If an exact-date exception exists, use its ranges, including an empty range list meaning closed.
2. Otherwise, if that date's Monday-starting week has an override, use only that weekday's ranges. An empty week or a weekday with no ranges means closed; do not fall back to usual hours.
3. Otherwise, use the usual recurring ranges for that weekday.
4. Apply booked-slot blocking, the tutor's overall offered modes, and the selected slot's mode. `BOTH` permits online or physical lessons; a single-mode range permits only that mode.

Do not create a circular dependency between `booking.service.js` and `availability.service.js`. The shared resolver/constants can live in an independent module.

### Call sites to cover

| Area | Current gap / required integration |
| --- | --- |
| `backend/src/services/booking.service.js`: `getTutorSlots` | Currently uses exact-date exceptions or recurring hours. Include weekly overrides and return usable mode information to the UI. |
| `booking.service.js`: `assertSlotBookable` | Currently uses exact-date exceptions or recurring hours and does not receive teaching mode. Resolve all three sources and validate the entire requested interval and mode. |
| `backend/src/controllers/parent/tutors.controller.js`: `freeAt` | Independently checks exact-date/recurring hours. Use the same resolver for date/time search so search and booking agree. |
| Parent booking creation, counter-offer acceptance and reschedule | Pass the lesson mode into the shared check. Recheck inside the existing transaction/lock. Preserve child-overlap and tutor-slot checks. |
| `backend/src/controllers/tutor/availabilityExceptions.controller.js`: removal | Removing an exact-date override currently checks usual hours directly. The fallback must be that week's override, then usual hours. |
| Tutor save/reset/copy availability | Protect existing held/confirmed lessons with the same tutor-row lock as booking acceptance. Week availability transactions currently do not acquire that lock. |
| Profile and parent booking UI | Show the effective date's hours/modes, not a mixture of inherited sources. Keep the selected multiple-lesson list working. |

Exact-date ranges currently contain only `startTime` and `endTime`, whereas the new weekly ranges carry `mode`. Define the compatibility rule for old date ranges before merging. They must not accidentally offer a mode the tutor does not teach. If exact-date mode control is intended, add explicit range mode support and a clear legacy fallback rather than guessing silently.

## Payment policy and implementation requirements

Recommended rule, subject to the agreed project/client policy:

```text
payBy = min(acceptance time + 24 hours, lesson start − 1 hour)
expired when now >= payBy
```

- Save the deadline when the tutor accepts or the parent accepts a counter-offer. Opening checkout, retrying a failed request or refreshing a page must not restart the clock.
- Reject acceptance if its resulting deadline is already reached.
- Store instants consistently; use Malaysia time for displayed dates and Monday week boundaries. A 24-hour duration is elapsed time, not “tomorrow at midnight”.
- For existing accepted bookings where `payBy` is null, retain `lesson start − 1 hour`. Do not infer acceptance time from `updatedAt`.
- Agree on rescheduling: a later lesson should not silently grant another 24 hours; an earlier lesson must respect the new one-hour cutoff. Document any deliberate deadline reset.
- Apply the same deadline to checkout eligibility, held-slot display, reminder timing, lifecycle expiry, payment-page countdown and provider bill expiry where supported.
- Recheck the deadline during payment settlement. Relying only on the scheduled expiry job leaves a gap where an overdue booking could still be confirmed.
- Define how a payment made before the deadline but reported late is handled. Use trusted provider payment information, preserve the paid transaction, and never confirm a slot already released/rebooked.
- Preserve existing reconciliation: a real payment arriving after cancellation/expiry is recorded and queued for the appropriate refund; duplicate callbacks remain idempotent. Preserve neutral result pages for already-paid/refunded transactions.

## Focused merge checklist

- [ ] Keep the availability correctness fix separate from the payment policy change so each can be reviewed and tested independently.
- [ ] Merge schema additions alongside the current public-ID/privacy changes; do not replace the current schema with an older copy.
- [ ] Use one resolver for all parent/tutor availability consumers, with explicit closed overrides taking precedence.
- [ ] Carry teaching mode through every availability display and write path.
- [ ] Preserve ownership checks, child overlaps, conditional status updates, tutor locks and payment reconciliation.
- [ ] Lock availability writers too, so an availability edit cannot race with booking acceptance.
- [ ] Check exact-date removal against the correct weekly fallback.
- [ ] Confirm Monday-local boundaries and date-only database conversion, including Sunday evening/Monday transitions.
- [ ] Decide and document the new payment policy, legacy fallback and reschedule behavior.
- [ ] Test migrations on a disposable copy before any deployed database; no production migration was run for this review.

## Regression cases for the integration PR

| Case | Expected result |
| --- | --- |
| Usual Monday 14:00–17:00; next-week Monday override 09:00–12:00 | Parent sees/books 09:00–12:00 for that week only. Other Mondays retain 14:00–17:00. |
| Exact-date closure over an open week override | No times offered; direct booking and acceptance also reject. |
| Empty week override over open usual hours | Entire week stays closed. |
| Week override has Tuesday only | Monday stays closed, rather than falling back to usual Monday hours. |
| Remove an exact-date override | Correct week override becomes effective; do not expose usual hours instead. |
| Online-only hour / physical request, and reverse | Search, calendar, new booking, acceptance and rescheduling consistently reject incompatible mode. |
| `BOTH` range with tutor profile offering one mode only | Tutor's profile limit still applies. |
| Hour spanning a gap, boundary or mixed-mode ranges | Accept only when the complete lesson interval is covered for its requested mode. |
| Multiple slots across dates with different overrides | Each selected lesson is checked against its own effective date/mode; no partial invalid request is saved. |
| Availability save races with booking acceptance | Serialization preserves the accepted/held booking; neither side silently invalidates it. |
| Two parents accept/request the same live slot | Existing concurrency protections still prevent duplicate held/confirmed lessons. |
| Acceptance 72 hours before lesson | Deadline is acceptance + 24 hours. |
| Acceptance 5 hours before lesson | Deadline is lesson start − 1 hour, giving 4 hours. |
| Acceptance at or within 1 hour of lesson | Rejected, with a clear message. |
| Checkout retry and page refresh | Saved deadline does not extend. |
| Legacy `payBy = null` | Original one-hour-before-lesson cutoff remains. |
| Payment at the deadline; callback delayed beyond expiry | Agreed boundary policy applied consistently; money recorded, no double booking, safe refund path if slot was released. |
| Repeated provider callback or ambiguous bill-creation timeout | Existing idempotency and original-bill reconciliation continue working; no duplicate charge/bill is created blindly. |

These are review requirements and proposed acceptance cases, not a claim that the branch has passed them. No application tests, live payment calls, database migrations or external messages were performed for this review.
