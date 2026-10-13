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
npm run dev                 # http://localhost:5000/api/health
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
```

The payment page uses a **sandbox** FPX gateway (no real money). Payment success/failure is simulated in the pay dialog.

In development, leave `SMTP_USER` empty — OTP codes are **printed in the backend terminal** instead of emailed.

## 4. Frontend

```bash
cd frontend
copy .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Vite forwards `/api/*` to the backend on port 5000, so run both at the same time.

## What is built in the Parent Portal (Xin Yue)

Matches the `docs/UI_v1.pdf` mockups: Login / Sign up (3 steps + email OTP) · Dashboard · Find a Tutor (filters, sort, cards) ·
3-step matching wizard + results with match % and reasons · AI Tutor Assistant (Book Robot chat panel) · Tutor profile ·
Book a Lesson (weekly calendar) · My Bookings (pending / counter offer / payment / upcoming / completed / cancelled) ·
My Children · Payments (sandbox FPX, transactions, refunds shown) · notifications bell · reviews.

Matching is **rule-based weighted scoring** (`backend/src/services/matching.service.js`, weights from Form 2), not machine learning.
The chatbot is a guided quick-reply flow that fills the same criteria and calls the same service.

## Project structure

```
backend/
  prisma/schema.prisma   # ALL tables for both portals — change via migrations only
  prisma/seed.js
  src/
    app.js, server.js
    config/              # env, prisma client
    middleware/          # requireAuth, requireRole, error handler
    routes/              # one file per module, registered in routes/index.js
    controllers/         # request handlers
    services/            # email, OTP, JWT, reCAPTCHA, matching, booking (slots + conflicts), notifications
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

## Optional integrations (leave empty in development)

Each one switches on only when its keys are filled in. Without keys the app still works.

| Feature | Backend `.env` | Frontend `.env` | Where to get it |
|---|---|---|---|
| Google sign-in | `GOOGLE_CLIENT_ID` | `VITE_GOOGLE_CLIENT_ID` (same value) | Google Cloud Console > APIs & Services > Credentials > OAuth client ID (Web). Add `http://localhost:5173` under *Authorised JavaScript origins*. |
| reCAPTCHA v2 checkbox | `RECAPTCHA_SECRET` | `VITE_RECAPTCHA_SITE_KEY` | google.com/recaptcha/admin > create a **v2 "I'm not a robot"** key for `localhost`. |
| Photo upload | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | none | cloudinary.com dashboard (free plan). Photos upload straight from the browser using a signature from `POST /api/uploads/signature`. |
| Real email | `SMTP_USER`, `SMTP_PASS` | none | Gmail App Password. |

Restart both servers after changing `.env` files.

## Still to configure later
- Payment gateway sandbox (Billplz / ToyyibPay / Stripe test mode). The pay dialog currently simulates the gateway.
