# Auth & 2FA Design — Self-Hosted Organized Backend
## v2 — post-M4 (updated after implementation)

**Status:** M4 is IMPLEMENTED and verified. This document now serves two roles:
the **live security principles** that continue to govern the project (§0, §6, §7,
§8, §11), and a record of which parts of the original design were **superseded**
by reusing upstream's existing machinery (§2, §3, §5 — marked below).

Rule of precedence: where this document and the code/M4_GUIDE disagree on
mechanics, the code wins. On principles (§0 especially), this document wins.

### What was actually built (M4 summary)

- **Identity layer** (ours, new): `src/v3/services/identity/` — store.ts
  (email→uid index + credential records as encrypted blobs on the M3 disk
  adapter), tokens.ts (15-min EdDSA access JWTs via jose; single-use hashed
  email-login tokens), passwords.ts (argon2id, 64 MiB / t=3).
- **Sessions, visitorid cookie, revocation, TOTP MFA**: upstream's, unchanged —
  NOT rebuilt. This superseded most of §2–§5 below.
- **Real endpoints** (upstream mounts auth router at `/`):
  `/api/v3/password-login`, `/api/v3/token-login` (+ upstream's existing
  `/api/v3/user-login`, `/api/v3/user-passwordless-login`, `/api/v3/verify-email-token`).
- **Security hardening done in implementation**: timing-equalized unknown-email
  vs wrong-password (argon2 dummy verify), identical generic error for both,
  rate limiting 5/15min per IP+email (IPv6-safe keying), TOTP gate added to the
  email-OTP login path (upstream gap: `verify-email-token` set
  `mfaVerified: true` unconditionally — our branch gates it when `mfa_enabled`).
- **Deliberately deferred**: `register-password` endpoint (unauthenticated
  version = account-takeover primitive; needs auth or email-token guard first);
  refresh-token families (upstream session cookie + silent JWT re-issue via
  `/session-token` covers device revocation and expiry UX); Postgres (decision:
  not needed — see PROJECT.md §10).

---

## 0. The one principle everything hangs on

**Authentication and encryption are separate systems. The server does one and is
blind to the other.**

- **Authentication** = proving *who you are* to the server (password, 2FA, sessions).
  The server handles this.
- **Encryption** = the keys that decrypt congregation data. These are derived and held
  **client-side only**. The server never sees them, never stores them, cannot derive them.

If we ever find ourselves sending an encryption key to the server "just for convenience,"
we have broken the entire security model. Don't. The server is allowed to know that
*Anna logged in*. It is never allowed to be able to read *what Anna's congregation stored*.

This mirrors upstream's existing model (self-defined encryption keys, two-level
encryption). Keep their client-side crypto untouched; we are only replacing the
*authentication* and *storage transport*, not the encryption.

---

## 1. What the server stores (and what it must never store)

**Stored, per user:**
- `user_id` (UUID)
- `email`
- `password_hash` — Argon2id hash. Never the password.
- `totp_secret_enc` — the user's TOTP secret, encrypted at rest with a server-side
  key from secrets manager (see §7). Needed server-side to verify codes.
- `totp_enabled` (bool), `totp_confirmed_at`
- `recovery_codes_hash[]` — hashed one-time recovery codes (Argon2id or SHA-256+salt;
  these are high-entropy so a fast hash with salt is acceptable).
- role / rights, congregation membership, session records.

**NEVER stored:**
- The password (only its Argon2id hash).
- Any data-encryption key, key-derivation passphrase, or anything that could decrypt
  congregation blobs.
- TOTP secret in plaintext at rest.

---

## 2. Token model — ⚠️ SUPERSEDED (kept for reference)

> **Superseded by implementation.** Access JWTs exist as designed (15-min EdDSA),
> but refresh-token families were NOT built: upstream's signed `visitorid`
> session cookie already provides per-device revocable sessions, and the client
> silently re-issues JWTs via `/session-token` against that session. Revisit
> refresh-token families only if the session-cookie model ever proves
> insufficient. Original design follows for reference.

### Original §2: short access JWT + long refresh token

Two tokens, different lifetimes, different jobs.

**Access token (JWT)**
- Lifetime: **15 minutes**.
- Stateless: signed with server key, carries `user_id`, role, `congregation_id`,
  `exp`. Verified on every request, no DB hit.
- Sent as `Authorization: Bearer <jwt>`.
- Short life means a leaked access token is useless quickly.

**Refresh token (opaque, stateful)**
- Lifetime: **e.g. 30 days**, sliding.
- A random high-entropy string. **Stored hashed** in a `sessions` table, never as a
  raw JWT. One row = one session = one device.
- Used only against `POST /auth/refresh` to mint a new access token.
- Because it's a DB row, sessions are **revocable** — this is what powers upstream's
  "view and terminate user sessions" feature. Revoke = delete/flag the row.
- **Rotate on every refresh**: each refresh issues a new refresh token and invalidates
  the old one. If an old (already-used) refresh token is ever presented again, that
  signals theft → revoke the whole session family and force re-login.

**Transport:** prefer refresh token in an **httpOnly, Secure, SameSite=Strict cookie**
so JS can't read it (XSS resistance). Access token kept in memory client-side. If the
PWA's existing architecture expects tokens in a specific place, match it — but never put
the refresh token in localStorage.

---

## 3. Registration / first login — ⚠️ SUPERSEDED (kept for reference)

> **Superseded.** Onboarding follows upstream's existing flows (email OTP /
> email link creates the account; congregation joining uses upstream's own
> mechanics). The invite-code design in §5 was not needed. Password setting is
> deferred until it can be done safely (see v2 summary). Original follows.

### Original §3

Organized is elder-first and invite-gated — nobody self-registers into a congregation.
So "registration" is really "redeeming an invite." See §5 for invite codes.

Flow for a brand-new user redeeming an invite:

```
1. Client POST /auth/register { invite_code, email, password, [device info] }
2. Server:
   a. Look up invite by hash, check not used / not expired / matches congregation.
   b. Validate password strength (length-first; long passphrases > complexity rules).
   c. Argon2id-hash the password.
   d. Create user, link to congregation + role from the invite.
   e. Mark invite consumed (atomic — see §5).
   f. Do NOT log them in yet if 2FA enrollment is mandatory; go to §4 enrollment.
3. Return minimal profile + next step (enroll 2FA).
```

Note on the encryption side: when the user sets up their client, the **client** derives
the data-encryption key from the user's own secret/passphrase (per upstream's scheme) and
stores it locally. The server is not involved and receives nothing about it.

---

## 4. TOTP 2FA (RFC 6238) — ✅ PROVIDED BY UPSTREAM (principles still live)

> Upstream already implements TOTP via `otpauth` with window ±1 and per-session
> `mfaVerified` — we reused it rather than rebuilding. The rules below (reuse
> rejection, constant-time compare, recovery codes) remain the checklist for
> auditing/extending their implementation. Our branch's addition: the TOTP gate
> on the email-OTP login path (see v2 summary).

Standard authenticator-app TOTP (works with Aegis, which suits your privacy posture, as
well as any other app). No SMS — SMS 2FA is phishable and ties you to a telco.

**Enrollment**
```
1. Client POST /auth/2fa/enroll  (authenticated, pre-confirmation)
2. Server generates a TOTP secret, stores it encrypted-at-rest with totp_enabled=false.
3. Server returns the secret as an otpauth:// URI + QR for the authenticator app.
4. Client shows QR, user scans, enters a current 6-digit code.
5. Client POST /auth/2fa/confirm { code }
6. Server verifies code against stored secret (±1 time step window).
   On success: totp_enabled=true, totp_confirmed_at=now.
   Generate N one-time recovery codes, return them ONCE, store only their hashes.
```

**Verification at login**
```
1. POST /auth/login { email, password }
2. Server verifies Argon2id hash.
   - Wrong: generic "invalid credentials" (don't reveal which was wrong). Rate-limit (§6).
3. If password OK and totp_enabled:
   - Return a SHORT-LIVED (e.g. 5 min) "2fa_pending" token. NOT a full session yet.
4. POST /auth/2fa/verify { pending_token, code }
   - Verify TOTP (±1 step) OR a valid unused recovery code.
   - On success: issue real access + refresh tokens (§2). Create session row.
   - Recovery code used → mark it consumed (one-time).
```

**TOTP verification rules**
- Accept the current 30s step and ±1 adjacent step (clock drift). No wider.
- **Reject reuse within a step** — track the last accepted step per user so the same
  code can't be replayed inside its window.
- Constant-time comparison on the computed vs. submitted code.

---

## 5. One-time invite codes — ⚠️ SUPERSEDED (kept for reference)

> **Superseded.** Upstream's congregation-joining flow (access code + elder
> approval) already covers gated onboarding; a parallel invite-code system was
> not built. The atomic-consume pattern below WAS reused for one-time email
> login tokens (tokens.ts). Original follows.

### Original §5

Mirrors upstream: an appointed brother invites others; the code is single-use.

**Generation**
```
POST /invites  (authenticated, requires invite privilege)
{ role, [email], expires_in }
→ Server generates a high-entropy random code (e.g. 128-bit, base32, human-typable).
→ Store ONLY hash(code) + role + congregation_id + expiry + created_by + used=false.
→ Return the raw code ONCE to the inviter to pass on. It's never retrievable again.
```

**Redemption** — must be atomic to prevent two people racing the same code:
```
Use a single UPDATE ... WHERE used=false RETURNING, or SELECT ... FOR UPDATE in a
transaction. The "consume" and "check" happen as one indivisible DB operation.
Never: check-then-write as two steps (TOCTOU race).
```

Also support the **congregation access code** as a separate, longer-lived shared secret
gating the congregation, layered on top of per-user invites — matching upstream's model.

---

## 6. Rate limiting & lockout (do not skip)

Auth endpoints are the front door; brute force lives here.

- **Per-account + per-IP** limiting on `/auth/login`, `/auth/2fa/verify`,
  `/auth/register`, `/invites` redemption.
- Exponential backoff or temporary lockout after N failed attempts (e.g. 5).
- TOTP verify: tight limit (e.g. 5 tries per pending token, then the pending token dies).
- Generic error messages — never reveal whether email exists, or whether it was the
  password vs. the 2FA code that failed.
- Log failures for the audit trail (§8) but **never log secrets, codes, or tokens**.

A reverse proxy (Caddy) can add a coarse outer layer, but enforce real logic in the app.

---

## 7. Secrets & keys (server-side)

- **JWT signing key**: prefer asymmetric (EdDSA/Ed25519) — sign with private, verify with
  public. Rotatable via a key id (`kid`) in the JWT header.
- **TOTP-secret encryption key** (the at-rest key for `totp_secret_enc`): held in a
  secrets manager / Docker secret / env injected at runtime — **never** committed, never
  in the image.
- Rotation plan for both from day one (even if rotation is manual at first).
- `.env` is for local dev only and is gitignored. Production secrets come from the host's
  secret mechanism.

---

## 8. Audit logging

Append-only log of security events: logins (success/fail), 2FA outcomes, invite
creation/redemption, session creation/termination, role changes.

Record: timestamp, user_id (or "unknown"), event type, source IP, outcome.
**Never** record passwords, codes, tokens, or anything that decrypts data.
This backs the "user sessions control" feature and gives you real incident forensics.

---

## 9. Endpoint summary

```
POST /auth/register        redeem invite + create account
POST /auth/login           password step → 2fa_pending or full session
POST /auth/2fa/enroll      begin TOTP enrollment (returns otpauth URI/QR)
POST /auth/2fa/confirm     confirm enrollment with a live code
POST /auth/2fa/verify      complete login with TOTP or recovery code
POST /auth/refresh         rotate refresh token → new access token
POST /auth/logout          revoke current session
GET  /auth/sessions        list active sessions (this device + others)
DELETE /auth/sessions/:id  terminate a session remotely
POST /invites              create one-time invite (privileged)
```

---

## 10. Implementation notes (Node/TS)

- **Password hashing**: `argon2` (argon2id). Not bcrypt, not plain hashes.
- **TOTP**: `otplib` or `otpauth` — both implement RFC 6238 correctly. Don't hand-roll.
- **JWT**: `jose` (modern, supports EdDSA cleanly). Avoid abandoned libs.
- **Random**: `crypto.randomBytes` for all codes/tokens. Never `Math.random`.
- **Comparisons**: `crypto.timingSafeEqual` for any secret comparison.
- **Validation**: validate/parse every input at the boundary (`zod`), reject early.
- **HTTP framework**: Fastify (fast, first-class TS, good plugin model) or Express if you
  want maximum familiarity. Either is fine; Fastify ages better.

Match upstream's existing client-side auth call shape where you can, so the seam between
their PWA and our API stays thin and upstream merges stay manageable (see PROJECT.md §7).

---

## 11. Threat-model sanity checklist

- [ ] Server compromise leaks encrypted blobs only — **not** decryptable without
      client-held keys. (If this isn't true, the encryption separation is broken.)
- [ ] Stolen DB → no plaintext passwords (Argon2id), no plaintext TOTP secrets
      (encrypted at rest), no usable invite codes (hashed).
- [ ] Stolen access token → useless in 15 min.
- [ ] Stolen refresh token → detectable via rotation/reuse-detection; revocable.
- [ ] XSS → can't read httpOnly refresh cookie.
- [ ] Brute force → rate-limited + locked out + audited.
- [ ] Replayed TOTP code → rejected (per-step reuse tracking).
- [ ] Raced invite code → impossible (atomic consume).
- [ ] Lost authenticator → recovery codes (one-time, hashed).
