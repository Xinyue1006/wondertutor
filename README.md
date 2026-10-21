# WonderTutor

Intelligent Education Matching Web Platform — FYP (Tan Xin Yue & Yap Yan Hsi, TARUMT).

| Part | Tech |
|---|---|
| `frontend/` | React 19 + Vite + Tailwind CSS v4 + React Router + Axios |
| `backend/` | Node.js + Express 5 + Prisma 6 + MySQL, JWT + bcrypt, email OTP, reCAPTCHA, Google OAuth |

## 1. Install once

- **Node.js 20+** — https://nodejs.org
- **MySQL 8** — MySQL Community Server, or XAMPP (start the MySQL module)
- **Git**

## 2. Database

Create an empty database:

```sql
CREATE DATABASE wondertutor;
```

## 3. Backend

```bash
cd backend
copy .env.example .env      # Windows   (Mac/Linux: cp .env.example .env)
```

Edit `.env`: set `DATABASE_URL` to your MySQL user/password and `JWT_SECRET` to a long random string.
(XAMPP default: user `root`, empty password -> `DATABASE_URL="mysql://root:@localhost:3306/wondertutor"`.) Then:

```bash
npm install
npm run db:migrate          # creates all tables from prisma/schema.prisma (name it e.g. "init")
npm run db:seed             # settings, admin, 16 sample tutors + reviews, and a demo parent (about 5 s)
npm run dev                 # http://localhost:5000/api/health   (from the project's top folder you can use: npm run dev:backend)
npm test                    # unit tests for the tutor-matching scoring (Jest)
```

Seeded accounts:

| Role | Login | Password |
|---|---|---|
| Admin | `admin@wondertutor.local` | `Admin1234` |
| Parent (demo, has children + bookings in every state) | `parent@wondertutor.local` | `Parent1234` |
| Tutors | `daniel-tan@tutor.wondertutor.local`, `tan-hui-wen@...`, `lee-xin-yi@...` (any tutor key) | `Tutor1234` |

To wipe the database and start again: `npx prisma migrate reset` (re-runs the seed).

**Testing the booking flow without the Tutor Portal:** until the tutor screens exist, answer a booking as the tutor from the terminal:

```bash
npm run dev:respond -- <bookingId> accept            # -> parent must pay
npm run dev:respond -- <bookingId> counter 55        # tutor counter offer, RM55/hour
npm run dev:respond -- <bookingId> reject "Not available"
npm run dev:respond -- <bookingId> complete          # lesson done -> parent can review
npm run dev:respond -- <bookingId> reschedule 2026-10-22 18:00   # tutor asks the parent for a new time
npm run dev:respond -- <bookingId> reschedule-accept # tutor agrees to the parent's new time
npm run dev:respond -- <bookingId> reschedule-decline # no agreement -> escalated to Admin
```

The payment page uses a **sandbox** FPX gateway (no real money). Payment success/failure is simulated in the pay dialog.

In development, leave `SMTP_USER` empty — OTP codes are **printed in the backend terminal** instead of emailed.

## 4. Frontend

```bash
cd frontend
copy .env.example .env
npm install
npm run dev                 # http://localhost:5173   (from the top folder: npm run dev:frontend)
```

Vite forwards `/api/*` to the backend on port 5000, so run both at the same time.

## What is built in the Parent Portal (Xin Yue)

Matches the `docs/UI_v1.pdf` mockups: Login / Sign up (3 steps + email OTP) · Dashboard · Find a Tutor (filters, sort, cards) ·
3-step matching wizard + results with match % and reasons · AI Tutor Assistant (Book Robot chat panel) · Tutor profile ·
Book a Lesson (weekly calendar) · My Bookings (pending / counter offer / payment / upcoming / completed / cancelled) ·
My Children · Payments (sandbox FPX, transactions, refunds shown) · notifications bell · reviews.

Also built for the Parent Portal and Admin (Xin Yue):
- **Sign-up** with Basic / Contact / My Children (subject + learning goals) / Preferences steps; progress kept for the session.
- **Forgot / reset password** with an emailed 6-digit code; **rate limiting** on login and code endpoints.
- **Recommendation**: Find a Tutor ranks by the weighted score using the search, the parent's saved preferences and home
  area; every card shows its own match % and reasons; results are paged ("Showing 1–9 of 11 tutors").
- **Saved tutors** (heart button + Saved Tutors page) · **Learning progress** per child (lesson history with tutor summaries,
  check-in records, subjects, next lesson).
- **Reschedule requests**: mutual agreement moves the lesson, disagreement escalates to Admin.
- **Disputed attendance** on a completed lesson marks it DISPUTED and asks Admin to review a refund.
- **Booking housekeeping** (runs every 5 minutes in `backend/src/services/lifecycle.service.js`): unanswered requests expire at
  the lesson time, unpaid bookings expire 1 hour before it, and parents and tutors get a reminder within 24 hours of a lesson.
- **Admin**: user management, qualification approval (with a link to the uploaded document), a warning about upcoming
  lessons before deactivating someone, complaints with a report (date range, overdue, time to close, categories,
  most complained about) and CSV export.
- **Reviews** may carry an optional photo; **trial lessons** can be marked (only a child's first lesson with that tutor).
- **Refunds**: Cancel is the way to get money back for a lesson that has not started (Admin decides the refund);
  a refund request is for a lesson that has started or finished (e.g. the tutor did not come).
- **Add to calendar**: a confirmed lesson can be added to Google Calendar or downloaded as an `.ics` file (Apple / Outlook),
  one lesson or all upcoming ones (`backend/src/services/calendar.service.js`). Importing again after a reschedule updates the event.
- **Reminder emails**: the day before a lesson, and once when a payment is due within 24 hours (the booking is released
  1 hour before the lesson). Parents can switch them off in My Profile; payment and refund emails are always sent.
- **Privacy (PDPA)**: a Privacy Notice page (`/privacy`), a required consent tick at sign-up (email and Google) that records the
  time, and *Privacy & account* in My Profile: reminder emails on/off, **download my data** (JSON) and **delete my account**
  (personal details are removed; lesson and payment records stay without a name; refused while a booking, refund request or
  complaint is still open). The notice text is a draft: the centre should confirm the wording, the retention period and a contact address
  (`VITE_PRIVACY_EMAIL`).
- **Input validation** everywhere (`backend/src/utils/validators.js`, mirrored in `frontend/src/lib/validation.js`):
  Malaysian phone numbers (stored as +60…), real names, passwords (8–72 characters), real dates and times, RM amounts
  with at most 2 decimals, and every ID in a URL.
- **Robustness**: actions only apply to a booking still in the status it was loaded in (no double payments, refunds,
  reviews or answers from a double click or a stale page); an expired session returns to Log In with the reason and
  then back to the page the user wanted; pages that fail to load offer *Try again*.
- **Accessibility**: dialogs keep keyboard focus inside and return it when closed, errors and new chat messages are
  announced to screen readers, dropdowns report whether they are open, and every control has a label.

Matching is **rule-based weighted scoring** (`backend/src/services/matching.service.js`, weights from Form 2), not machine learning.
The chatbot is a guided quick-reply flow that fills the same criteria and calls the same service.
Verified tutors are listed before unverified ones in Find a Tutor (Recommended), the matching wizard and the chatbot;
the score and its weights are unchanged.

## What is built in the Tutor Portal (Yan Hsi)

Matches `WonderTutor_Mockups_All.pdf` pages 1 to 7:
- **Log in**: reCAPTCHA on login as well as sign-up (checked by the server when `RECAPTCHA_SECRET` is set, skipped when empty),
  "Remember me on this device", Show/Hide password, Google sign-in.
- **Sign up**: Choose role, Create account, Verify email, and for tutors a 4th step, Complete profile. A tutor account needs only
  name, email, phone and password (plus terms); gender and emergency contact moved to the profile setup. The parent form is unchanged.
  The email code screen has 6 boxes (typing moves on, paste fills all), the real rules (10 minutes, 5 tries, 60 s before a resend),
  and a Change email link.
- **Forgot password**: still an emailed 6-digit code (not a link), restyled in two steps; the same message is shown whether
  or not the email has an account.
- **Profile setup** (`/tutor/setup`): basic information (gender, emergency contact, home area), teaching information
  (subjects and grades, hourly rate, experience, mode, languages, teaching style, about me), qualifications and an identity
  document (PDF/JPG/PNG to Cloudinary), profile photo and portfolio, review and submit. Each step saves a draft.
- **Verification status** (`/tutor/verification`): not submitted, under review, changes requested (with Admin's reason),
  or verified. A tutor is verified once Admin approves **an identity document and a qualification**.
  Until then only setup, status and the profile preview open; every other tutor page redirects to the status page
  (`VerifiedTutorRoute` in the frontend, `requireVerifiedTutor` on the API).

- **Google sign-in**: an existing verified account is linked (role unchanged); an email signup that was never verified is
  replaced by a clean Google account, so a password chosen by someone else cannot be used; deactivated accounts are refused
  and left untouched; a bad or expired Google token gives a plain 401. The Google picture is not kept: a tutor uploads their own photo.
- **Email failures**: if a code email cannot be sent, the unsent code is removed. Forgot password still gives the same answer
  for every email (the failure is only logged on the server); resend says the code could not be sent.
- **Documents**: a tutor may remove an approved document after a warning; the verified badge is worked out again
  (`recomputeVerified`, shared with Admin's review) and comes back when Admin approves a replacement.

**Migration `tutor_profile_setup`** (pull, then `npm run db:migrate`): tutor gender and emergency contact may be empty until the
setup is filled in, `TutorProfile.verificationSubmittedAt` records when the setup was submitted, and `Qualification.kind`
(`QUALIFICATION` or `IDENTITY`, default `QUALIFICATION`) tells the two kinds of document apart. Re-run the seed
(`npx prisma migrate reset`) so the seeded verified tutors also get an approved identity document.

## Project structure

```
backend/
  prisma/schema.prisma   # ALL tables for both portals — change via migrations only
  prisma/seed.js
  src/
    app.js, server.js
    config/              # env, prisma client
    middleware/          # requireAuth, requireRole, loadParentProfile / loadTutorProfile, requireVerifiedTutor, error handler
    routes/              # one file per module (auth, parent, tutor, admin), registered in routes/index.js
    controllers/         # request handlers: Zod validation + ownership, then a service (parent/, tutor/, admin/)
    services/            # email, OTP, JWT, reCAPTCHA, matching, booking (slots + conflicts), notifications,
                         # tutorSetup (setup draft, submit for verification, verification status)
    data/catalog.js      # subjects, Klang Valley locations (lat/lng), teaching styles
    tests/               # Jest unit tests
frontend/src/
  api/client.js          # axios with JWT attached
  context/AuthContext    # current user, login/logout
  layouts/               # PublicLayout, AppLayout (role-based nav)
  pages/auth|parent|tutor|admin
  assistant/             # Book Robot chat panel + matching state shared with the wizard
  components/            # TutorCard, FilterChips, LessonDetails, ui/ (Icon, Robot, Common)
```

## Who builds what

| Area | Owner |
|---|---|
| Auth, layouts, schema | Shared (done) |
| Parent: children, find tutor (browse + matching + chatbot), bookings, payments, reviews, complaints | Xin Yue |
| Admin: user management, complaints & reports | Xin Yue |
| Tutor: profile, availability, booking responses, attendance check-in, summaries, earnings, withdrawals | Yan Hsi |
| Admin: booking oversight, finance, system settings, analytics | Yan Hsi |

## Working together

- Each person works on their own branch (`git checkout -b xinyue/find-tutor`) and opens a PR into `main`.
- **Schema changes:** edit `schema.prisma`, run `npm run db:migrate`, and commit the generated `prisma/migrations/` folder. Tell your teammate to pull and run `npm run db:migrate`.
- Never commit `.env`.

## Testing

| What | Command | Notes |
|---|---|---|
| Backend (Jest): matching scoring, booking rules, payments + commission snapshot, refunds, reviews, admin, complaints, security, parent signup and saved preferences, input validation, double-submit and stale-page races | `cd backend && npm test` | Uses a **separate** database `wondertutor_test`, created and migrated automatically (`pretest`). Your dev data is never touched. MySQL must be running. |
| Backend tutor onboarding (`tutorSetup.test.js`): reCAPTCHA on login, tutor sign-up without profile details, setup drafts and bad input, submit rules, identity + qualification approval, changes requested, the verification gate | `cd backend && npm test` | Same test database. |
| Frontend (Vitest + React Testing Library): login (with reCAPTCHA), sign-up (parent sections, tutor form, code boxes), route protection, the tutor verification gate, profile setup steps, matching wizard, tutor card, chatbot text reader, date helpers, form validation rules | `cd frontend && npm test` | Runs in a simulated browser, no servers needed. |
| API demo (Postman) | Import `docs/WonderTutor.postman_collection.json` | Run *Login (parent)* and *Login (admin)* first; they store the tokens. |

Vitest is used instead of Jest on the frontend because it reads the Vite config directly (Jest needs extra setup for `import.meta.env`). The test syntax is the same.

## Optional integrations (leave empty in development)

Each one switches on only when its keys are filled in. Without keys the app still works.

| Feature | Backend `.env` | Frontend `.env` | Where to get it |
|---|---|---|---|
| Google sign-in | `GOOGLE_CLIENT_ID` | `VITE_GOOGLE_CLIENT_ID` (same value) | Google Cloud Console > APIs & Services > Credentials > OAuth client ID (Web). Add `http://localhost:5173` under *Authorised JavaScript origins*. |
| reCAPTCHA v2 checkbox | `RECAPTCHA_SECRET` | `VITE_RECAPTCHA_SITE_KEY` | google.com/recaptcha/admin > create a **v2 "I'm not a robot"** key for `localhost`. |
| Photo and document upload | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | none | cloudinary.com dashboard (free plan). Photos and tutor documents upload straight from the browser using a signature from `POST /api/uploads/signature`. Needed to finish the tutor profile setup locally. |
| Real email | `SMTP_USER`, `SMTP_PASS` | none | Gmail App Password. |

Restart both servers after changing `.env` files.

## Still to configure later
- Payment gateway sandbox (Billplz / ToyyibPay / Stripe test mode). The pay dialog currently simulates the gateway.
