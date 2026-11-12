# Child-avatar privacy follow-up — 12 November 2026

This closes the code-path gap identified in the review for **new child-avatar uploads**. A final synthetic live Cloudinary check verified signed delivery and blocked unsigned access (results below). Historical public cloud files have not been revoked, and tutor access to sensitive notes has not been decided.

## Implemented

- Child avatars use a new `child-avatar` upload purpose. Only authenticated parents can request it; the server chooses `wondertutor/children/<ParentProfile.id>`, `type=authenticated` and JPG/JPEG/PNG formats. A client cannot select another family's destination folder.
- Child creation/update rejects public URLs, PDF files, private evidence from other purposes and other-family avatar references. Omitting a photo during a normal edit leaves its stored reference unchanged; explicit `null` removes the reference.
- Canonical `photoReference` is separate from `photoUrl`. The database stores an unsigned authenticated resource reference. Parent-authorized DTOs generate a signed download URL expiring in about five minutes; an expiring download URL is never accepted as the stored child reference.
- Child list, dashboard, progress/report, booking DTO and account export use private display delivery. Existing public references are not rendered or included as public image links in the export. Private avatar references are still rejected by the public review-image endpoint.
- The child editor uses the signed display URL for an existing image and a local Blob preview for a newly selected image, while saving the canonical reference. Blob previews are revoked on replacement/removal/unmount. Adult profile and public review uploads keep their existing public behavior.
- An old public photo is shown as a migration warning with options to upload a private replacement or remove the stored reference. A private image unavailable because storage configuration is missing is reported separately; it is not mislabeled as an old public asset.

No Prisma schema change, new database table, `.env` change, commit or push was needed for this workstream.

## Existing public photos and cloud-file lifecycle

Hiding a URL in the app does **not** revoke a previously public Cloudinary asset. Removing the database reference, replacing an avatar or deleting an account does not itself delete that cloud file. Authorized staff still need to inventory and revoke/migrate old assets according to the client's retention decision; do that before discarding the last known reference where possible.

`backend/scripts/migrate-private-media.js` now includes child photos in its inventory. With no arguments it is **read-only** and prints record type/ID, never private URLs or keys. An explicit migration requires the expected Cloudinary asset ID and verifies both source and destination identity. The script refuses to rename an asset referenced by another child, adult profile, review, portfolio or complaint, because doing so could break that other record or change its visibility. Shared assets should be re-uploaded as separate private files and investigated before the old public asset is revoked.

```powershell
# Inventory only — no Cloudinary writes:
node scripts/migrate-private-media.js

# Deliberate migration of an individually verified record, by authorized staff only:
node scripts/migrate-private-media.js child CHILD_RECORD_ID EXPECTED_CLOUDINARY_ASSET_ID
```

No explicit cloud migration was executed during this follow-up. A temporary signed URL can be used by anyone who possesses it until expiry; it is a short-lived bearer link, not a per-image browser login check. Refresh the page to renew expired viewing links. An account export contains metadata/references and temporary links, not an offline archive of image binaries.

## Validation

- Targeted backend suites `childPhotoPrivacy`, `security`, `account`, `progress`: **35 tests passed**.
- Targeted frontend suites `ChildPhotoPicker`, `MyChildrenRecovery`, `Profile`: **15 tests passed**.
- Tests cover parent-only signatures, canonical/display round-tripping, private URL ownership, public/other-family/PDF/evidence substitution rejection, legacy reference preservation, booking/export delivery, private-avatar rejection on public reviews, storage-configuration failure messaging, local preview cleanup and unchanged default public uploads.
- Final full regression: **483 backend tests in 39 suites; 234 frontend tests in 42 suites; production build passed**.
- A separate live Cloudinary test uploaded one synthetic one-pixel PNG through the actual parent-scoped signature, saved it via the real Express child endpoint, and checked: signed display **200**, unsigned reference **401**, other-family reference substitution **400**, unchanged canonical-reference edit **200**. Synthetic test accounts and the newly uploaded test asset were cleaned up afterward. No existing cloud asset was renamed or removed.
- Dry-run inventory found **two legacy child-photo references**. Neither belonged to the currently configured Cloudinary public namespace, so no ownership-verified automatic migration was available. They remain hidden in the app with replacement/removal guidance; this is not proof that their original public links have been revoked.

## Policy still to confirm

Ask the supervisor/client which child fields tutors need, whether access should require a confirmed lesson and what should happen after shared access is withdrawn. Confirm retention and deletion responsibilities for old cloud evidence. This implementation does not invent note-visibility or retention policy.
