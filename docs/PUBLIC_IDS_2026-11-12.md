# Public references — 12 November 2026

## Purpose and scope

Bookings, children, payment receipts and complaints now have random public references for parent-facing links and the existing Admin complaint workflow. These make URLs less predictable. Access still depends on authentication, role and ownership; knowing either a public reference or an old numeric ID does not grant access.

The local development database has been migrated and existing rows backfilled; numeric keys, relationships and row counts were checked before and after. No hosted database has been migrated. Publishing this code does not apply the migration to Hostinger; use the deployment steps below. Validation results are recorded below.

## Data model

Each of `Child`, `Booking`, `Payment` and `Complaint` adds:

```prisma
publicId String? @unique @default(uuid()) @db.Char(36)
```

- The public value is a UUIDv4, for example `3b74025c-8d19-46a6-b571-15560d0f3035`. It contains no child name, payment amount or sequential record number.
- Numeric `id` remains the primary key. All joins and foreign keys continue using their current integer columns. The public-ID change itself adds no model or relationship; consult [the current data model](CURRENT_DATA_MODEL.md) for the complete schema, including subsequent authentication-session additions.
- `publicId` is nullable for migration compatibility, not a promise that new rows should be left without references. Prisma supplies the default for new rows; direct SQL writers would need to generate their own value.
- A unique index protects each model's references. MySQL permits multiple nulls while old rows await backfill.
- Treat references as stable. The backfill script never replaces an existing published value.

## Routes and links

The browser uses `publicId` when present and temporarily falls back to `id` for old/unbackfilled records. Parent APIs resolve valid UUID references within the logged-in parent's ownership scope; controllers retain their existing authorization and validation. Admin complaint APIs resolve a complaint reference only after the Admin authentication/role middleware. Other record types, including tutors, users, reviews and reschedule requests, retain their existing numeric references.

| Record | Preferred browser links / payloads | Compatible API behavior |
| --- | --- | --- |
| Child | `/parent/children?edit=<childPublicId>`, `/parent/children/<childPublicId>/progress`, `/parent/children/<childPublicId>/report`; child selection sends the reference | `/api/parent/children/:id` update/delete/progress/report; matching and booking child input accept UUID or legacy numeric ID |
| Booking | `/parent/bookings?booking=<bookingPublicId>`; complaint-prefill booking query; booking action requests and calendar links use the public reference | `/api/parent/bookings/:id` and existing action subroutes accept UUID or legacy numeric ID; checkout and complaint booking input do too |
| Payment | `/parent/payments/<paymentPublicId>/receipt`; checkout response includes `paymentPublicId` alongside the existing numeric `paymentId` | `/api/parent/payments/:id/receipt` and existing confirmation endpoint accept UUID or legacy numeric ID |
| Complaint | Admin details/update requests use the complaint's public reference; DTOs include it | `/api/admin/complaints/:id` accepts UUID or legacy numeric ID with the Admin role; parent complaint list/create retain their existing routes |

Here `/api` denotes the Express API mount; React browser routes omit that prefix. Public references do not create public, unauthenticated receipt or child pages. Complaint workflow has no new invented standalone parent detail route.

Newly generated links prefer the public reference. Existing numeric bookmarks, saved notification links, older matching criteria and the tutor portal remain compatible during rollout. That compatibility means numeric enumeration is still possible as a lookup attempt, so authorization and rate limiting remain necessary. This change does not claim to hide every numeric database ID in JSON or remove numeric IDs from internal integrations.

Calendar export uses the public booking reference in its lesson URL and download filename. Calendar UID compatibility, provider references and private-media authorization must remain stable; changing URLs must not create duplicate calendar events or weaken protected-file access.

## Deployment and backfill

Migration: `backend/prisma/migrations/20261112090000_public_ids/migration.sql`.

The migration adds four nullable columns and four unique indexes. It does not use MySQL `UUID()` to populate records, since that function can produce time-based values. The Node application backfill uses `crypto.randomUUID()`:

```text
cd backend
npm run db:deploy
```

`db:deploy` runs migrations, generates Prisma Client and then runs the public-ID backfill. For a database already migrated/generated, the separately available command is:

```text
cd backend
npm run db:backfill-public-ids
```

The script processes up to 250 null-reference rows at a time for the four fixed application-owned models. Each conditional update targets `id` plus `publicId: null`, so repeated or concurrent runs do not overwrite a reference. For timestamped records it also compares and preserves `updatedAt`, avoiding a false business edit or overwriting a concurrent edit's timestamp. It prints per-model update counts and disconnects. An interrupted run can be rerun. It never accepts a table name from a web request.

Use the normal deployment backup and migration process. Confirm the target database independently; `.env` values, credentials and keys are not part of this feature or this document. Do not execute these commands against production just to inspect the diagram.

## Coordination with Yan Hsi

- Keep integer PK/FK interfaces in `booking.service.js`, `lifecycle.service.js`, payment reconciliation and tutor services. Resolve an external reference once at the authenticated API boundary, then call existing services using the real integer ID.
- Existing tutor API URLs and DTO `id` fields remain compatible. Additive `publicId` fields do not require changing tutor attendance, finance or scheduling joins to UUIDs.
- Merge schema additions rather than replacing the schema. Her weekly availability, slot-mode and `payBy` columns are separate additions and are not included in the current 25-model diagram snapshot.
- Preserve Billplz gateway IDs, its existing booking correlation and original-bill recovery. A public URL change must not cause new bills, reset deadlines or break late-payment reconciliation.
- Preserve ownership checks on both UUID and numeric paths, child/booking overlap locks, private media access and stable existing notification deduplication. The availability review is documented separately in [the integration review](AVAILABILITY_INTEGRATION_REVIEW_2026-11-12.md).

## Validation results

Completed locally on 12 November 2026:

| Check | Result |
| --- | --- |
| Backend regression suite | 40 suites, 493 tests passed |
| Frontend regression suite | 43 files, 244 tests passed |
| Production frontend build | Passed |
| New real-browser checks | 32 passed: four complete UUID workflows, page/dialog layouts at 1440/390/320 px, and no runtime errors |
| Existing local data | All 14 children, 1,101 bookings, 11 payments and 2 complaints backfilled; numeric IDs, foreign keys and row counts unchanged |
| Repeated/concurrent backfill | Passed; existing UUIDs and business timestamps preserved by the final implementation |
| Legacy notification compatibility | Both lesson/payment reminder tests passed; no duplicate notifications or emails from switching links |

The browser checks exercised child creation/edit/progress/report/removal, multiple-date booking, payment checkout/confirmation/receipt, and complaint submission plus Admin investigation/update. They used a separate test database, synthetic accounts and the built-in payment simulator. No live Billplz charge, external AI call or hosted deployment was performed. The normal local API was restarted after Prisma generation and its health endpoint was checked.

Coverage and compatibility checks:

- New and backfilled records have valid, distinct UUIDv4 values; repeated backfill leaves existing values unchanged.
- The owner can use UUID and legacy numeric routes; another parent cannot read or mutate the same booking, child or receipt with either form.
- Unauthenticated requests and non-admin complaint access remain denied. Invalid references return a friendly validation/not-found response without leaking another family's records.
- Booking creation, matching child selection, multiple-slot booking, counter-offers, cancellations, refunds, reviews, rescheduling, progress reports, receipts and calendar downloads still work.
- Old links remain usable; new parent/admin links prefer the public reference, and null-reference fallback works during staged rollout.
- Admin complaint list, investigation, update and export remain compatible. Tutor endpoints and payment reconciliation continue using numeric internal IDs.
- Existing schema and automated regressions pass; browser/mobile checks cover the changed links and controls.
