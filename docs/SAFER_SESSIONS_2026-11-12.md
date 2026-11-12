# Safer browser login sessions — 12 November 2026

## Scope

Parent, Tutor and Admin use the same server-managed session mechanism. Their existing role, account-status, profile and record-ownership checks still apply. This change replaces the browser's long-lived bearer token with an opaque cookie; it does not add MFA or change the tutor verification policy.

Implemented locally, with automated results recorded below. The additive session migration has been applied to the local working database without resetting it, and the local API was restarted and checked healthy. No hosted deployment is implied by this document.

## Session design

- The server generates a cryptographically random 32-byte session credential at successful password login, Google login or email-OTP verification. It never returns that credential in JSON.
- Only a SHA-256 hash of that credential is persisted in `AuthSession`, linked to the real User. The record also binds the session to the current password credential and records its expiry.
- Browser authentication uses an HttpOnly cookie. Production uses the `__Host-` cookie prefix, `Secure`, `SameSite=Lax`, `Path=/` and no Domain attribute. Local HTTP development uses an unprefixed cookie with Secure disabled.
- Ordinary login uses a browser-session cookie with a 12-hour server lifetime. Remember Me uses a persistent cookie with a seven-day server lifetime. Closing a browser is not a reliable substitute for logout because some browsers restore session cookies.
- A fresh login rotates the current browser session. The old cookie cannot authenticate after the corresponding database session has been revoked. Other devices keep their own sessions unless a password change or another invalidation rule ends them.
- Every authenticated request still checks the current User, expiry and password-credential binding. Password reset/change therefore invalidates earlier sessions, and a deactivated account is refused.
- Legacy Authorization bearer JWTs are no longer accepted as login credentials. Existing users sign in again after deployment. Old `wt_token` keys are removed from browser storage; no new authentication credential is saved to localStorage or sessionStorage.

The existing `JWT_SECRET` environment variable remains a server-only secret used by the session/CSRF credential binding. Retaining that configuration name does not mean browser JWT authentication remains enabled. `JWT_EXPIRES_IN` no longer controls browser-session lifetime; the explicit 12-hour/seven-day policy is defined in `session.service.js`. Never print or commit secret values.

## CSRF protection and browser flow

1. The browser fetches `GET /api/auth/csrf`, which returns `{ csrfToken }` with caching disabled. Before login, a separate HttpOnly random seed cookie binds this token to that browser. After login, the token is bound to its authenticated session.
2. The shared API client sends cookies and adds `X-CSRF-Token` to every unsafe API request: POST, PUT, PATCH and DELETE. This includes login, Google sign-in, registration, OTP verification and logout.
3. Successful login rotates the session and returns `{ user, csrfToken }`. The CSRF token stays in JavaScript memory; it is not the authentication credential. Page reload obtains the current user/session state from the server again.
4. The server verifies the header token and rejects untrusted Origin/Referer or cross-site browser request metadata. SameSite is an additional layer, not the sole CSRF defense.
5. The only server-to-server exemption is the exact signed Billplz callback route, `POST /api/payments/billplz/callback`. Billplz signatures and reconciliation still authorize that callback. Browser requests to `/api/parent/payments/return` remain authenticated and CSRF-protected.

The client does **not** automatically refresh a rejected CSRF token and replay a mutation. Another tab may have logged into a different account; replaying an old profile form under that new account would be unsafe even though the new CSRF token is valid. A CSRF rejection preserves the form and instructs the user to refresh the page. Repeated clicks retain the rejected proof rather than silently switching identities. A full refresh restores the actual account from `/auth/me` before another action is attempted.

SameSite=Lax preserves the login cookie for a top-level GET return from Billplz. Google credential verification remains on the server. Neither provider should be allowed to choose the application User's role or bypass normal ownership checks.

## Logout and failure behavior

`POST /api/auth/logout` revokes the current session in the database before reporting success and clears the browser cookie. It is a CSRF-protected operation; simply navigating to a URL must not log a person out. Replaying the previous session credential after successful logout must fail, even if its original expiry has not arrived.

The browser must await server logout before claiming success or redirecting. If the network/database request fails, show a retryable error. A temporary failure while restoring a session must not be presented as proof that the user has logged out. Password changes and account deletion have their own invalidation rules, and the interface should still guide the person to sign in again where needed.

An ordinary authentication failure does not send a cookie-deletion header. A late `/auth/me` response from an earlier session must not erase a new cookie issued by a successful login. Server-side expiry/revocation still denies access; explicit logout owns cookie deletion.

Read-only file downloads continue using the shared credentialed API client. Child progress links, calendar files, receipts and Admin exports must retain their existing ownership/role checks.

## Hostinger and local configuration

- Keep React and `/api` on one canonical HTTPS origin, as described in [the deployment guide](HOSTINGER_DEPLOYMENT.txt). Do not loosen cookie SameSite or add a broad cookie Domain merely to work around a misconfigured deployment.
- Set `NODE_ENV=production` and an exact canonical `CLIENT_URL`. Verify HTTPS redirects and the actual trusted reverse-proxy topology. Production cookies must retain Secure and the `__Host-` prefix.
- Database sessions persist across application restarts and can be shared by multiple app processes using the same database and server secret. Rate-limit counters and AI conversation memory are separate process-local concerns; this change does not make them distributed.
- Apply the additive `20261112160000_cookie_sessions` session-table migration using the normal reviewed `npm --prefix backend run db:deploy` release step. Never reset or seed production to install the feature.
- Deploy the frontend and backend together. Stale browser assets that still send bearer JWTs must refresh and log in again. Preserve a reviewed rollback plan for both the application and migration.
- Keep localhost and 127.0.0.1 consistent during local testing. For a synthetic browser server on another port, set that process's CLIENT_URL before importing the application; do not edit shared `.env` merely to bypass an Origin failure.

No `.env` file needs to be committed. No extra paid service is required for database-backed sessions.

## API/manual testing

The updated [Postman collection](WonderTutor.postman_collection.json) uses its cookie jar and CSRF header. Fetch “Get CSRF token”, log in as the role being tested, then run that role's requests. There is one active account per cookie jar: a later Admin login replaces the current Parent login. Do not run both logins first and expect bearer-style separate credentials. Fetch CSRF again after clearing cookies or logging out. The collection itself was structurally checked; this is not a claim that every historical example was exercised or that the collection is safe to run against production.

Validation recorded by the implementation task on 12 November 2026:

| Check | Result |
| --- | --- |
| Backend regression suite | 41 suites, 519 tests passed |
| Frontend regression suite | 45 files, 262 tests passed |
| Production frontend build | Passed |
| Local working database | Additive AuthSession migration applied; database not reset |
| Local API after migration | Restarted and health check passed |
| Synthetic session browser journeys | 22 passed: Parent/Tutor/Admin login/reload/logout/replay, failed-logout recovery, CSRF defenses, cross-tab account-switch blocking, tutor availability save/restore and Admin account management |
| Public-ID browser regression | 32 passed: four complete cookie-authenticated workflows plus desktop/mobile page and dialog checks |
| Role layout checks | Nine passed: Parent/Tutor/Admin at 1440, 375 and 320 px |
| Browser total | 63 checks passed; zero runtime errors |
| Independent API processes | Passed: a login created on one process authenticated on another; logout on the second process revoked replay on the first |
| Postman collection | 72 requests structurally validated; collection-level scripts parse; no collection requests executed |
| ERD/domain exports | Regenerated; XML-valid; declared schema confirmed as 26 models and 34 foreign-key relations |

Tests use synthetic accounts and a separate test database. Google authentication is tested through mocked provider verification, and browser payment checks use the built-in simulator. No live Google browser sign-in, real Billplz payment or Hostinger deployment was performed. Hostinger's HTTPS/proxy/cookie behavior still requires the normal staging deployment checks.

The cross-tab browser scenario attempted to submit an old account's form twice after another tab switched accounts. Both submissions were blocked and the other parent's data remained unchanged. The cross-process check used separate local API processes connected to the same test database, demonstrating that authentication and logout do not depend on one process's memory.

Regression coverage to retain:

- Parent, Tutor and Admin password login, correct routing and portal role rejection; Google and OTP session issuance.
- Remember Me and nonpersistent-cookie attributes; production Secure/HttpOnly/SameSite/host-only flags.
- Reload, expired sessions, deactivated accounts, password reset/change and successful logout with replay rejection.
- Missing/wrong/cross-session CSRF tokens, foreign Origin/Referer, simple-form attacks and cross-site Fetch Metadata rejection.
- Signed Billplz callback remains usable without browser CSRF; browser payment return retains protection.
- Authenticated child/booking/payment/Admin workflows, protected file downloads and public-ID compatibility.
- Database/session failures leave clear, retryable UI feedback; no auth credentials in JSON/browser storage/logs.
- Existing automated suites, production frontend build and synthetic desktop/mobile browser journeys.

## Design references

- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): cookie transport, credential lifecycle and server-side session invalidation.
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): session-bound tokens, Origin checks and SameSite as an additional layer.
- [Express production security](https://expressjs.com/advanced/best-practice-security/): HTTPS, cookie attributes and proxy configuration.

These references explain the controls. Local checks cannot certify Hostinger's actual configuration, a live payment provider or the absence of all XSS vulnerabilities. HttpOnly prevents JavaScript from reading the session cookie; malicious same-origin scripts can still perform actions while a user is signed in, so the separate CSP/input-handling work remains relevant.
